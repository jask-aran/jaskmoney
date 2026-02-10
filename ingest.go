package main

import (
	"database/sql"
	"encoding/csv"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
)

type parsedCSVRow struct {
	dateRaw     string
	dateISO     string
	amount      float64
	description string
}

// ingestCmd returns a Bubble Tea command that imports a CSV file into the DB,
// skipping duplicates, recording the import, and auto-applying category rules.
// When skipDupes is true, duplicate rows are silently skipped; when false,
// duplicates are imported anyway (force mode).
func ingestCmd(db *sql.DB, filename, basePath string, formats []csvFormat, skipDupes bool) tea.Cmd {
	return func() tea.Msg {
		path := filename
		if !filepath.IsAbs(path) {
			path = filepath.Join(basePath, path)
		}
		base := filepath.Base(path)
		format := detectFormat(formats, base)
		if format == nil {
			return ingestDoneMsg{err: fmt.Errorf("no matching format for %q", base), file: base}
		}
		acct, err := loadAccountByNameCI(db, format.Account)
		if err != nil {
			return ingestDoneMsg{err: fmt.Errorf("resolve account %q: %w", format.Account, err), file: base}
		}
		if acct == nil {
			return ingestDoneMsg{
				err:  fmt.Errorf("account %q not found; create or sync it in Manager", format.Account),
				file: base,
			}
		}
		count, dupes, err := importCSVForAccount(db, path, *format, &acct.id, skipDupes)
		if err != nil {
			return ingestDoneMsg{count: count, dupes: dupes, err: err, file: base}
		}
		if _, err := insertImportRecord(db, base, count); err != nil {
			return ingestDoneMsg{count: count, dupes: dupes, err: err, file: base}
		}
		if _, err := applyCategoryRules(db); err != nil {
			return ingestDoneMsg{count: count, dupes: dupes, err: err, file: base}
		}
		if _, err := applyTagRules(db); err != nil {
			return ingestDoneMsg{count: count, dupes: dupes, err: err, file: base}
		}
		return ingestDoneMsg{count: count, dupes: dupes, err: nil, file: base}
	}
}

// scanDupesCmd scans a CSV file for duplicates without importing.
// Returns a dupeScanMsg with the count of duplicates found.
func scanDupesCmd(db *sql.DB, filename, basePath string, formats []csvFormat) tea.Cmd {
	return func() tea.Msg {
		path := filename
		if !filepath.IsAbs(path) {
			path = filepath.Join(basePath, path)
		}
		base := filepath.Base(path)
		format := detectFormat(formats, base)
		if format == nil {
			return dupeScanMsg{err: fmt.Errorf("no matching format for %q", base), file: base}
		}
		acct, err := loadAccountByNameCI(db, format.Account)
		if err != nil {
			return dupeScanMsg{err: fmt.Errorf("resolve account %q: %w", format.Account, err), file: base}
		}
		if acct == nil {
			return dupeScanMsg{err: fmt.Errorf("account %q not found; create or sync it in Manager", format.Account), file: base}
		}
		total, dupes, err := countDuplicatesForAccount(db, path, *format, &acct.id)
		if err != nil {
			return dupeScanMsg{err: err, file: base}
		}
		return dupeScanMsg{total: total, dupes: dupes, file: base}
	}
}

// detectFormat picks the first format whose name appears as a prefix (case-insensitive)
// in the filename. Falls back to the first format if none match.
func detectFormat(formats []csvFormat, filename string) *csvFormat {
	lower := strings.ToLower(filename)
	for i := range formats {
		prefix := strings.ToLower(strings.TrimSpace(formats[i].ImportPrefix))
		if prefix == "" {
			prefix = strings.ToLower(strings.TrimSpace(formats[i].Name))
		}
		if strings.HasPrefix(lower, prefix) {
			return &formats[i]
		}
	}
	if len(formats) > 0 {
		return &formats[0]
	}
	return nil
}

// importCSV reads a CSV file using the given format and inserts valid rows.
// When skipDupes is true, rows matching (date_iso, amount, description) are skipped.
func importCSV(db *sql.DB, path string, format csvFormat, skipDupes bool) (inserted int, dupes int, err error) {
	return importCSVForAccount(db, path, format, nil, skipDupes)
}

// importCSVForAccount reads a CSV file using the given format and inserts valid rows.
// When skipDupes is true, rows matching (date_iso, amount, description, account_id) are skipped.
func importCSVForAccount(db *sql.DB, path string, format csvFormat, accountID *int, skipDupes bool) (inserted int, dupes int, err error) {
	tx, err := db.Begin()
	if err != nil {
		return 0, 0, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck // rollback is a no-op after commit

	var existingSet map[string]bool
	if skipDupes {
		existingSet, err = loadDuplicateSet(db)
		if err != nil {
			return 0, 0, fmt.Errorf("load duplicates: %w", err)
		}
	}

	walkErr := walkParsedCSVRows(path, format,
		func(row parsedCSVRow) error {
			if skipDupes {
				key := duplicateKeyForAccount(row.dateISO, row.amount, row.description, accountID)
				if existingSet[key] {
					dupes++
					return nil
				}
				existingSet[key] = true
			}
			_, execErr := tx.Exec(`
				INSERT INTO transactions (date_raw, date_iso, amount, description, notes, account_id)
				VALUES (?, ?, ?, ?, '', ?)
			`, row.dateRaw, row.dateISO, row.amount, row.description, accountID)
			if execErr != nil {
				return fmt.Errorf("insert row: %w", execErr)
			}
			inserted++
			return nil
		},
		func(parseErr error) error { return parseErr },
	)
	if walkErr != nil {
		return inserted, dupes, walkErr
	}
	if commitErr := tx.Commit(); commitErr != nil {
		return inserted, dupes, fmt.Errorf("commit tx: %w", commitErr)
	}
	return inserted, dupes, nil
}

// countDuplicates scans a CSV file and counts how many rows would be duplicates.
func countDuplicates(db *sql.DB, path string, format csvFormat) (total int, dupes int, err error) {
	return countDuplicatesForAccount(db, path, format, nil)
}

func countDuplicatesForAccount(db *sql.DB, path string, format csvFormat, accountID *int) (total int, dupes int, err error) {
	existingSet, err := loadDuplicateSet(db)
	if err != nil {
		return 0, 0, fmt.Errorf("load duplicates: %w", err)
	}

	seenInFile := make(map[string]bool)
	walkErr := walkParsedCSVRows(path, format,
		func(row parsedCSVRow) error {
			total++
			key := duplicateKeyForAccount(row.dateISO, row.amount, row.description, accountID)
			if existingSet[key] || seenInFile[key] {
				dupes++
			}
			seenInFile[key] = true
			return nil
		},
		func(parseErr error) error {
			// Scans skip bad rows so users can still see likely duplicate counts.
			return nil
		},
	)
	if walkErr != nil {
		return total, dupes, walkErr
	}
	return total, dupes, nil
}

func walkParsedCSVRows(
	path string,
	format csvFormat,
	onRow func(parsedCSVRow) error,
	onParseError func(error) error,
) error {
	f, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("open csv: %w", err)
	}
	defer f.Close()

	r := csv.NewReader(f)
	r.FieldsPerRecord = -1
	if format.Delimiter != "" {
		r.Comma = rune(format.Delimiter[0])
	}

	minCols := max(format.DateCol, format.AmountCol, format.DescCol) + 1
	firstRow := true
	for {
		rec, readErr := r.Read()
		if readErr != nil {
			if readErr == io.EOF {
				break
			}
			return fmt.Errorf("read csv row: %w", readErr)
		}
		if firstRow && format.HasHeader {
			firstRow = false
			continue
		}
		firstRow = false

		row, keep, parseErr := parseCSVRecord(rec, format, minCols)
		if !keep {
			continue
		}
		if parseErr != nil {
			if onParseError == nil {
				return parseErr
			}
			if err := onParseError(parseErr); err != nil {
				return err
			}
			continue
		}
		if onRow != nil {
			if err := onRow(row); err != nil {
				return err
			}
		}
	}
	return nil
}

func parseCSVRecord(rec []string, format csvFormat, minCols int) (parsedCSVRow, bool, error) {
	if len(rec) < minCols {
		return parsedCSVRow{}, false, nil
	}
	dateRaw := strings.TrimSpace(rec[format.DateCol])
	amountRaw := strings.TrimSpace(rec[format.AmountCol])
	if dateRaw == "" || amountRaw == "" {
		return parsedCSVRow{}, false, nil
	}

	description := strings.TrimSpace(rec[format.DescCol])
	if format.DescJoin {
		description = strings.TrimSpace(strings.Join(rec[format.DescCol:], ","))
	}

	if format.AmountStrip != "" {
		for _, ch := range format.AmountStrip {
			amountRaw = strings.ReplaceAll(amountRaw, string(ch), "")
		}
	}

	dateISO, err := parseDateISO(dateRaw, format.DateFormat)
	if err != nil {
		return parsedCSVRow{}, true, fmt.Errorf("parse date %q: %w", dateRaw, err)
	}
	amount, err := parseAmount(amountRaw)
	if err != nil {
		return parsedCSVRow{}, true, fmt.Errorf("parse amount %q: %w", amountRaw, err)
	}

	return parsedCSVRow{
		dateRaw:     dateRaw,
		dateISO:     dateISO,
		amount:      amount,
		description: description,
	}, true, nil
}

// duplicateKey builds a composite key for duplicate detection.
func duplicateKey(dateISO string, amount float64, description string) string {
	return duplicateKeyForAccount(dateISO, amount, description, nil)
}

func duplicateKeyForAccount(dateISO string, amount float64, description string, accountID *int) string {
	acc := 0
	if accountID != nil {
		acc = *accountID
	}
	return fmt.Sprintf("%s|%.2f|%s|%d", dateISO, amount, strings.ToLower(description), acc)
}

// loadDuplicateSet returns a set of existing transaction keys for fast lookup.
func loadDuplicateSet(db *sql.DB) (map[string]bool, error) {
	rows, err := db.Query("SELECT date_iso, amount, description, account_id FROM transactions")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	set := make(map[string]bool)
	for rows.Next() {
		var dateISO, desc string
		var amount float64
		var accountID *int
		if err := rows.Scan(&dateISO, &amount, &desc, &accountID); err != nil {
			return nil, err
		}
		set[duplicateKeyForAccount(dateISO, amount, desc, accountID)] = true
	}
	return set, rows.Err()
}

// loadFilesCmd returns a Bubble Tea command that scans basePath for CSV files.
func loadFilesCmd(basePath string) tea.Cmd {
	return func() tea.Msg {
		entries, err := os.ReadDir(basePath)
		if err != nil {
			return filesLoadedMsg{err: fmt.Errorf("read dir: %w", err)}
		}
		var names []string
		for _, entry := range entries {
			if entry.IsDir() {
				continue
			}
			name := entry.Name()
			if strings.HasSuffix(strings.ToLower(name), ".csv") {
				names = append(names, name)
			}
		}
		return filesLoadedMsg{files: names, err: nil}
	}
}

// parseDateISO converts a human date string to ISO format using the given Go time format.
func parseDateISO(input, dateFormat string) (string, error) {
	parsed, err := time.Parse(dateFormat, input)
	if err != nil {
		return "", err
	}
	return parsed.Format("2006-01-02"), nil
}

// parseAmount converts a string like "1,234.56" to float64.
func parseAmount(input string) (float64, error) {
	input = strings.ReplaceAll(input, ",", "")
	return strconv.ParseFloat(input, 64)
}
