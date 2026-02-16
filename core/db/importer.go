package db

import (
	"database/sql"
	"encoding/csv"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

type ImportSummary struct {
	FilesSeen      int
	FilesImported  int
	FilesSkipped   int
	RowsImported   int
	RowsDuplicates int
}

func ImportFromDir(db *sql.DB, dir string, accountsCfg AccountsConfigFile) (ImportSummary, error) {
	if db == nil {
		return ImportSummary{}, fmt.Errorf("database is nil")
	}
	if strings.TrimSpace(dir) == "" {
		dir = "imports"
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return ImportSummary{}, fmt.Errorf("create imports dir: %w", err)
	}
	if err := ensureImportTables(db); err != nil {
		return ImportSummary{}, err
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		return ImportSummary{}, fmt.Errorf("read imports dir: %w", err)
	}
	files := make([]string, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if strings.EqualFold(filepath.Ext(name), ".csv") {
			files = append(files, name)
		}
	}
	sort.Strings(files)

	summary := ImportSummary{FilesSeen: len(files)}
	for _, name := range files {
		if imported, err := alreadyImported(db, name); err != nil {
			return summary, err
		} else if imported {
			summary.FilesSkipped++
			continue
		}

		format, ok := detectImportFormat(name, accountsCfg.Account)
		if !ok {
			summary.FilesSkipped++
			continue
		}
		accountID, err := ensureAccount(db, format)
		if err != nil {
			return summary, err
		}
		knownKeys, err := loadImportedTxnKeys(db, accountID)
		if err != nil {
			return summary, err
		}
		path := filepath.Join(dir, name)
		imported, dupes, err := importCSVFile(db, path, name, accountID, format, knownKeys)
		if err != nil {
			return summary, err
		}
		if err := recordImport(db, name, imported); err != nil {
			return summary, err
		}
		summary.FilesImported++
		summary.RowsImported += imported
		summary.RowsDuplicates += dupes
	}
	return summary, nil
}

func ensureImportTables(db *sql.DB) error {
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS imports (
			id INTEGER PRIMARY KEY,
			filename TEXT NOT NULL UNIQUE,
			row_count INTEGER NOT NULL,
			imported_at TEXT NOT NULL
		);`,
		`CREATE INDEX IF NOT EXISTS idx_imports_filename ON imports(filename);`,
		`CREATE TABLE IF NOT EXISTS import_transaction_index (
			id INTEGER PRIMARY KEY,
			source_file TEXT NOT NULL,
			account_id INTEGER NOT NULL,
			date_iso TEXT NOT NULL,
			amount REAL NOT NULL,
			description TEXT NOT NULL,
			imported_at TEXT NOT NULL
		);`,
		`CREATE INDEX IF NOT EXISTS idx_import_txn_lookup
			ON import_transaction_index(account_id, date_iso, amount, description);`,
	}
	for _, stmt := range stmts {
		if _, err := db.Exec(stmt); err != nil {
			return fmt.Errorf("ensure import table: %w", err)
		}
	}
	return nil
}

func alreadyImported(db *sql.DB, filename string) (bool, error) {
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM imports WHERE filename = ?`, filename).Scan(&count); err != nil {
		return false, fmt.Errorf("check prior import %q: %w", filename, err)
	}
	return count > 0, nil
}

func detectImportFormat(filename string, accounts map[string]AccountConfig) (AccountConfig, bool) {
	file := strings.ToLower(strings.TrimSpace(filename))
	bestPrefix := ""
	var out AccountConfig
	for _, acct := range accounts {
		prefix := strings.ToLower(strings.TrimSpace(acct.ImportPrefix))
		if prefix == "" {
			continue
		}
		if !strings.HasPrefix(file, prefix) {
			continue
		}
		if len(prefix) > len(bestPrefix) {
			bestPrefix = prefix
			out = acct
		}
	}
	return out, bestPrefix != ""
}

func ensureAccount(db *sql.DB, cfg AccountConfig) (int, error) {
	name := strings.TrimSpace(cfg.Name)
	if name == "" {
		return 0, fmt.Errorf("account name is required")
	}
	typ := strings.ToLower(strings.TrimSpace(cfg.Type))
	if typ == "" {
		typ = "debit"
	}
	active := 1
	if cfg.Active != nil && !*cfg.Active {
		active = 0
	}
	prefix := strings.TrimSpace(cfg.ImportPrefix)

	var id int
	err := db.QueryRow(`SELECT id FROM accounts WHERE lower(name) = lower(?) LIMIT 1`, name).Scan(&id)
	if err == nil {
		if _, uerr := db.Exec(`UPDATE accounts SET type = ?, prefix = ?, active = ? WHERE id = ?`, typ, prefix, active, id); uerr != nil {
			return 0, fmt.Errorf("update account %q: %w", name, uerr)
		}
		return id, nil
	}
	if err != sql.ErrNoRows {
		return 0, fmt.Errorf("load account %q: %w", name, err)
	}

	res, err := db.Exec(`INSERT INTO accounts(name, type, prefix, active) VALUES(?, ?, ?, ?)`, name, typ, prefix, active)
	if err != nil {
		return 0, fmt.Errorf("insert account %q: %w", name, err)
	}
	lastID, err := res.LastInsertId()
	if err != nil {
		return 0, fmt.Errorf("account last insert id: %w", err)
	}
	return int(lastID), nil
}

func importCSVFile(db *sql.DB, path, fileName string, accountID int, cfg AccountConfig, knownKeys map[string]bool) (int, int, error) {
	f, err := os.Open(path)
	if err != nil {
		return 0, 0, fmt.Errorf("open %s: %w", fileName, err)
	}
	defer f.Close()

	r := csv.NewReader(f)
	r.FieldsPerRecord = -1
	runes := []rune(cfg.Delimiter)
	if len(runes) == 1 {
		r.Comma = runes[0]
	}

	minCols := maxInt(cfg.DateCol, maxInt(cfg.AmountCol, cfg.DescCol)) + 1
	rowNum := 0
	inserted := 0
	dupes := 0
	indexRows := make([]txnIndexRow, 0, 128)
	for {
		rec, err := r.Read()
		if err != nil {
			if err == io.EOF {
				break
			}
			return inserted, dupes, fmt.Errorf("read csv %s: %w", fileName, err)
		}
		rowNum++
		if rowNum == 1 && cfg.HasHeader {
			continue
		}
		if isBlankCSVRecord(rec) {
			continue
		}
		if len(rec) < minCols {
			return inserted, dupes, fmt.Errorf("%s row %d: expected at least %d columns", fileName, rowNum, minCols)
		}
		dateRaw := strings.TrimSpace(rec[cfg.DateCol])
		amountRaw := strings.TrimSpace(rec[cfg.AmountCol])
		desc := extractDescription(rec, cfg.DescCol, cfg.DescJoin)
		if dateRaw == "" || amountRaw == "" || desc == "" {
			return inserted, dupes, fmt.Errorf("%s row %d: date, amount, description required", fileName, rowNum)
		}
		dateISO, err := parseDateISO(dateRaw, cfg.DateFormat)
		if err != nil {
			return inserted, dupes, fmt.Errorf("%s row %d: %w", fileName, rowNum, err)
		}
		amount, err := parseAmount(amountRaw, cfg.AmountStrip)
		if err != nil {
			return inserted, dupes, fmt.Errorf("%s row %d: %w", fileName, rowNum, err)
		}
		key := txnIndexKey(accountID, dateISO, amount, desc)
		if knownKeys[key] {
			dupes++
			continue
		}
		if _, err := db.Exec(
			`INSERT INTO transactions(account_id, date_iso, amount, description, category_id, notes) VALUES(?, ?, ?, ?, NULL, '')`,
			accountID, dateISO, amount, desc,
		); err != nil {
			return inserted, dupes, fmt.Errorf("insert transaction from %s row %d: %w", fileName, rowNum, err)
		}
		indexRows = append(indexRows, txnIndexRow{
			AccountID:   accountID,
			DateISO:     dateISO,
			Amount:      amount,
			Description: desc,
		})
		inserted++
	}
	if err := recordImportedTxnKeys(db, fileName, indexRows); err != nil {
		return inserted, dupes, err
	}
	return inserted, dupes, nil
}

type txnIndexRow struct {
	AccountID   int
	DateISO     string
	Amount      float64
	Description string
}

func loadImportedTxnKeys(db *sql.DB, accountID int) (map[string]bool, error) {
	rows, err := db.Query(
		`SELECT account_id, date_iso, amount, description
		 FROM import_transaction_index
		 WHERE account_id = ?`,
		accountID,
	)
	if err != nil {
		return nil, fmt.Errorf("load import transaction index: %w", err)
	}
	defer rows.Close()
	out := map[string]bool{}
	for rows.Next() {
		var row txnIndexRow
		if err := rows.Scan(&row.AccountID, &row.DateISO, &row.Amount, &row.Description); err != nil {
			return nil, fmt.Errorf("scan import transaction index: %w", err)
		}
		out[txnIndexKey(row.AccountID, row.DateISO, row.Amount, row.Description)] = true
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read import transaction index: %w", err)
	}
	return out, nil
}

func recordImportedTxnKeys(db *sql.DB, fileName string, rows []txnIndexRow) error {
	for _, row := range rows {
		if _, err := db.Exec(
			`INSERT INTO import_transaction_index(
				source_file, account_id, date_iso, amount, description, imported_at
			) VALUES(?, ?, ?, ?, ?, ?)`,
			fileName, row.AccountID, row.DateISO, row.Amount, row.Description, time.Now().Format(time.RFC3339),
		); err != nil {
			return fmt.Errorf("record import transaction index: %w", err)
		}
	}
	return nil
}

func txnIndexKey(accountID int, dateISO string, amount float64, description string) string {
	return fmt.Sprintf("%d|%s|%s|%s",
		accountID,
		strings.TrimSpace(dateISO),
		strconv.FormatFloat(amount, 'f', 6, 64),
		strings.TrimSpace(description),
	)
}

func recordImport(db *sql.DB, fileName string, rows int) error {
	_, err := db.Exec(
		`INSERT INTO imports(filename, row_count, imported_at) VALUES(?, ?, ?)`,
		fileName, rows, time.Now().Format(time.RFC3339),
	)
	if err != nil {
		return fmt.Errorf("record import %s: %w", fileName, err)
	}
	return nil
}

func parseDateISO(raw string, layout string) (string, error) {
	layout = strings.TrimSpace(layout)
	if layout == "" {
		layout = "2/01/2006"
	}
	t, err := time.Parse(layout, strings.TrimSpace(raw))
	if err != nil {
		return "", fmt.Errorf("invalid date %q with format %q: %w", raw, layout, err)
	}
	return t.Format("2006-01-02"), nil
}

func parseAmount(raw string, stripChars string) (float64, error) {
	s := strings.TrimSpace(raw)
	for _, ch := range stripChars {
		s = strings.ReplaceAll(s, string(ch), "")
	}
	s = strings.ReplaceAll(s, "$", "")
	s = strings.ReplaceAll(s, " ", "")
	v, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid amount %q: %w", raw, err)
	}
	return v, nil
}

func extractDescription(rec []string, descCol int, join bool) string {
	if descCol < 0 || descCol >= len(rec) {
		return ""
	}
	if !join {
		return strings.TrimSpace(rec[descCol])
	}
	parts := make([]string, 0, len(rec)-descCol)
	for _, cell := range rec[descCol:] {
		cell = strings.TrimSpace(cell)
		if cell != "" {
			parts = append(parts, cell)
		}
	}
	return strings.TrimSpace(strings.Join(parts, " "))
}

func isBlankCSVRecord(rec []string) bool {
	for _, v := range rec {
		if strings.TrimSpace(v) != "" {
			return false
		}
	}
	return true
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
