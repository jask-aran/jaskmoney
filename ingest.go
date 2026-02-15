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
func ingestCmd(db *sql.DB, filename, basePath string, formats []csvFormat, savedFilters []savedFilter, skipDupes bool) tea.Cmd {
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
		count, dupes, txnIDs, err := importCSVForAccountWithTxnIDs(db, path, *format, &acct.id, skipDupes)
		if err != nil {
			return ingestDoneMsg{count: count, dupes: dupes, err: err, file: base}
		}
		if _, err := insertImportRecord(db, base, count); err != nil {
			return ingestDoneMsg{count: count, dupes: dupes, err: err, file: base}
		}
		if len(txnIDs) > 0 {
			rules, err := loadRulesV2(db)
			if err != nil {
				return ingestDoneMsg{count: count, dupes: dupes, err: err, file: base}
			}
			if len(rules) > 0 {
				txnTags, err := loadTransactionTags(db)
				if err != nil {
					return ingestDoneMsg{count: count, dupes: dupes, err: err, file: base}
				}
				updatedTxns, catChanges, tagChanges, failedRules, err := applyRulesV2ToTxnIDs(db, rules, txnTags, txnIDs, savedFilters)
				if err != nil {
					return ingestDoneMsg{count: count, dupes: dupes, err: err, file: base}
				}
				return ingestDoneMsg{
					count:           count,
					dupes:           dupes,
					err:             nil,
					file:            base,
					rulesApplied:    true,
					rulesTxnUpdated: updatedTxns,
					rulesCatChanges: catChanges,
					rulesTagChanges: tagChanges,
					rulesFailed:     failedRules,
				}
			}
			return ingestDoneMsg{count: count, dupes: dupes, err: nil, file: base, rulesApplied: true}
		}
		return ingestDoneMsg{count: count, dupes: dupes, err: nil, file: base}
	}
}

// ingestSnapshotCmd imports a previously scanned immutable preview snapshot.
// Decisions always apply to the full snapshot, not only displayed rows.
func ingestSnapshotCmd(db *sql.DB, snapshot *importPreviewSnapshot, skipDupes bool) tea.Cmd {
	return func() tea.Msg {
		if db == nil {
			return ingestDoneMsg{err: fmt.Errorf("database not ready")}
		}
		if snapshot == nil {
			return ingestDoneMsg{err: fmt.Errorf("missing import preview snapshot")}
		}
		if snapshot.errorCount > 0 || len(snapshot.parseErrors) > 0 {
			return ingestDoneMsg{
				file: snapshot.fileName,
				err:  fmt.Errorf("snapshot has %d parse/normalize errors", max(snapshot.errorCount, len(snapshot.parseErrors))),
			}
		}

		count, dupes, txnIDs, err := importSnapshotRows(db, snapshot, skipDupes)
		if err != nil {
			return ingestDoneMsg{count: count, dupes: dupes, err: err, file: snapshot.fileName}
		}
		if _, err := insertImportRecord(db, snapshot.fileName, count); err != nil {
			return ingestDoneMsg{count: count, dupes: dupes, err: err, file: snapshot.fileName}
		}

		done := ingestDoneMsg{count: count, dupes: dupes, file: snapshot.fileName}
		if len(txnIDs) == 0 {
			return done
		}
		txnTags, err := loadTransactionTags(db)
		if err != nil {
			done.err = err
			return done
		}
		updatedTxns, catChanges, tagChanges, err := applyResolvedRulesV2ToTxnIDs(db, snapshot.lockedRules.resolved, txnTags, txnIDs)
		if err != nil {
			done.err = err
			return done
		}
		done.rulesApplied = true
		done.rulesTxnUpdated = updatedTxns
		done.rulesCatChanges = catChanges
		done.rulesTagChanges = tagChanges
		return done
	}
}

// scanDupesCmd scans a CSV file and builds an immutable preview snapshot
// without importing or writing to the database.
func scanDupesCmd(db *sql.DB, filename, basePath string, formats []csvFormat, savedFilters []savedFilter) tea.Cmd {
	return func() tea.Msg {
		if db == nil {
			return importPreviewMsg{err: fmt.Errorf("database not ready")}
		}
		path := filename
		if !filepath.IsAbs(path) {
			path = filepath.Join(basePath, path)
		}
		base := filepath.Base(path)
		format := detectFormat(formats, base)
		if format == nil {
			return importPreviewMsg{err: fmt.Errorf("no matching format for %q", base)}
		}
		acct, err := loadAccountByNameCI(db, format.Account)
		if err != nil {
			return importPreviewMsg{err: fmt.Errorf("resolve account %q: %w", format.Account, err)}
		}
		if acct == nil {
			return importPreviewMsg{err: fmt.Errorf("account %q not found; create or sync it in Manager", format.Account)}
		}
		snapshot, err := buildImportPreviewSnapshot(db, path, base, *format, *acct, savedFilters)
		if err != nil {
			return importPreviewMsg{err: err}
		}
		return importPreviewMsg{snapshot: snapshot}
	}
}

func importSnapshotRows(db *sql.DB, snapshot *importPreviewSnapshot, skipDupes bool) (inserted int, dupes int, txnIDs []int, err error) {
	tx, err := db.Begin()
	if err != nil {
		return 0, 0, nil, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck // rollback is a no-op after commit

	insertedIDs := make([]int, 0, len(snapshot.rows))
	for _, row := range snapshot.rows {
		if skipDupes && row.isDupe {
			dupes++
			continue
		}
		res, execErr := tx.Exec(`
			INSERT INTO transactions (date_raw, date_iso, amount, description, notes, account_id)
			VALUES (?, ?, ?, ?, '', ?)
		`, row.dateRaw, row.dateISO, row.amount, row.description, snapshot.accountID)
		if execErr != nil {
			return inserted, dupes, insertedIDs, fmt.Errorf("insert row: %w", execErr)
		}
		lastID, idErr := res.LastInsertId()
		if idErr != nil {
			return inserted, dupes, insertedIDs, fmt.Errorf("last insert id: %w", idErr)
		}
		inserted++
		insertedIDs = append(insertedIDs, int(lastID))
	}
	if err := tx.Commit(); err != nil {
		return inserted, dupes, insertedIDs, fmt.Errorf("commit tx: %w", err)
	}
	return inserted, dupes, insertedIDs, nil
}

func applyResolvedRulesV2ToTxnIDs(db *sql.DB, resolved []resolvedRuleV2, txnTags map[int][]tag, txnIDs []int) (updatedTxns, catChanges, tagChanges int, err error) {
	if len(txnIDs) == 0 || len(resolved) == 0 {
		return 0, 0, 0, nil
	}
	rows, err := loadRowsByTxnIDs(db, txnIDs)
	if err != nil {
		return 0, 0, 0, err
	}
	return applyResolvedRulesV2ToRows(db, resolved, txnTags, rows)
}

func buildImportPreviewSnapshot(db *sql.DB, path, fileName string, format csvFormat, account account, savedFilters []savedFilter) (*importPreviewSnapshot, error) {
	existingSet, err := loadDuplicateSet(db)
	if err != nil {
		return nil, fmt.Errorf("load duplicates: %w", err)
	}
	rows, parseErrors, totalRows, err := parseImportPreviewRows(path, format, account.id, existingSet)
	if err != nil {
		return nil, err
	}

	snapshot := &importPreviewSnapshot{
		fileName:    fileName,
		createdAt:   time.Now(),
		totalRows:   totalRows,
		rows:        rows,
		parseErrors: parseErrors,
		errorCount:  len(parseErrors),
		accountID:   account.id,
	}
	for _, row := range rows {
		if row.isDupe {
			snapshot.dupeCount++
		} else {
			snapshot.newCount++
		}
	}

	rules, err := loadRulesV2(db)
	if err != nil {
		return nil, err
	}
	ruleIDs := make([]int, 0, len(rules))
	for _, rule := range rules {
		ruleIDs = append(ruleIDs, rule.id)
	}
	resolved, _ := resolveRulesV2(rules, savedFilters)
	snapshot.lockedRules = importPreviewLockedRules{
		ruleIDs:    ruleIDs,
		rules:      append([]ruleV2(nil), rules...),
		lockReason: "preview-open",
		resolved:   resolved,
	}
	snapshot.rows, err = projectImportPreviewRows(db, snapshot.rows, account.name, account.id, resolved)
	if err != nil {
		return nil, err
	}

	return snapshot, nil
}

func parseImportPreviewRows(path string, format csvFormat, accountID int, existingSet map[string]bool) (rows []importPreviewRow, parseErrors []importPreviewParseError, totalRows int, err error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, nil, 0, fmt.Errorf("open csv: %w", err)
	}
	defer f.Close()

	r := csv.NewReader(f)
	r.FieldsPerRecord = -1
	if format.Delimiter != "" {
		r.Comma = rune(format.Delimiter[0])
	}
	minCols := max(format.DateCol, format.AmountCol, format.DescCol) + 1

	firstRow := true
	sourceLine := 0
	rowIndex := 0
	for {
		rec, readErr := r.Read()
		if readErr != nil {
			if readErr == io.EOF {
				break
			}
			return nil, nil, totalRows, fmt.Errorf("read csv row: %w", readErr)
		}
		sourceLine++
		if firstRow && format.HasHeader {
			firstRow = false
			continue
		}
		firstRow = false

		if csvRecordIsBlank(rec) {
			// Preserve historical behavior: ignore trailing/blank rows.
			continue
		}

		rowIndex++
		totalRows++

		parsed, issue := parseCSVRecordForPreview(rec, format, minCols)
		if issue != nil {
			parseErrors = append(parseErrors, importPreviewParseError{
				rowIndex:   rowIndex,
				sourceLine: sourceLine,
				field:      issue.field,
				message:    issue.message,
			})
			continue
		}

		key := duplicateKeyForAccount(parsed.dateISO, parsed.amount, parsed.description, &accountID)
		// Import preview duplicate detection is DB-scoped only.
		// Repeated rows within the same file are treated as unique first-import rows.
		isDupe := existingSet[key]
		rows = append(rows, importPreviewRow{
			index:       rowIndex,
			sourceLine:  sourceLine,
			dateRaw:     parsed.dateRaw,
			dateISO:     parsed.dateISO,
			amount:      parsed.amount,
			description: parsed.description,
			isDupe:      isDupe,
		})
	}
	return rows, parseErrors, totalRows, nil
}

func csvRecordIsBlank(rec []string) bool {
	if len(rec) == 0 {
		return true
	}
	for _, field := range rec {
		if strings.TrimSpace(field) != "" {
			return false
		}
	}
	return true
}

type previewParseIssue struct {
	field   string
	message string
}

func parseCSVRecordForPreview(rec []string, format csvFormat, minCols int) (parsedCSVRow, *previewParseIssue) {
	if len(rec) < minCols {
		return parsedCSVRow{}, &previewParseIssue{field: "row", message: fmt.Sprintf("expected at least %d columns", minCols)}
	}
	dateRaw := strings.TrimSpace(rec[format.DateCol])
	amountRaw := strings.TrimSpace(rec[format.AmountCol])
	if dateRaw == "" {
		return parsedCSVRow{}, &previewParseIssue{field: "date", message: "date is required"}
	}
	if amountRaw == "" {
		return parsedCSVRow{}, &previewParseIssue{field: "amount", message: "amount is required"}
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
		return parsedCSVRow{}, &previewParseIssue{field: "date", message: err.Error()}
	}
	amount, err := parseAmount(amountRaw)
	if err != nil {
		return parsedCSVRow{}, &previewParseIssue{field: "amount", message: err.Error()}
	}
	return parsedCSVRow{
		dateRaw:     dateRaw,
		dateISO:     dateISO,
		amount:      amount,
		description: description,
	}, nil
}

func projectImportPreviewRows(db *sql.DB, rows []importPreviewRow, accountName string, accountID int, resolved []resolvedRuleV2) ([]importPreviewRow, error) {
	if len(rows) == 0 {
		return rows, nil
	}
	categories, err := loadCategories(db)
	if err != nil {
		return nil, err
	}
	tags, err := loadTags(db)
	if err != nil {
		return nil, err
	}
	catNames := categoryNameByID(categories)
	tagByID := tagByIDMap(tags)
	accountIDCopy := accountID

	out := make([]importPreviewRow, 0, len(rows))
	for _, row := range rows {
		workCat := (*int)(nil)
		workTagSet := make(map[int]bool)
		workTxn := transaction{
			dateRaw:      row.dateRaw,
			dateISO:      row.dateISO,
			amount:       row.amount,
			description:  row.description,
			categoryID:   nil,
			categoryName: categoryNameForPtr(nil, catNames),
			accountID:    &accountIDCopy,
			accountName:  accountName,
		}
		for _, rule := range resolved {
			if rule.parsed == nil || !evalFilter(rule.parsed, workTxn, tagStateToSlice(workTagSet, tagByID)) {
				continue
			}
			if rule.rule.setCategoryID != nil {
				workCat = copyIntPtr(rule.rule.setCategoryID)
				workTxn.categoryID = copyIntPtr(workCat)
				workTxn.categoryName = categoryNameForPtr(workCat, catNames)
			}
			for _, id := range rule.rule.addTagIDs {
				if id > 0 {
					workTagSet[id] = true
				}
			}
		}
		row.previewCat = categoryNameForPtr(workCat, catNames)
		previewTags := tagStateToSlice(workTagSet, tagByID)
		row.previewTags = make([]string, 0, len(previewTags))
		for _, tg := range previewTags {
			row.previewTags = append(row.previewTags, tg.name)
		}
		out = append(out, row)
	}
	return out, nil
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
	inserted, dupes, _, err = importCSVForAccountWithTxnIDs(db, path, format, accountID, skipDupes)
	return inserted, dupes, err
}

func importCSVForAccountWithTxnIDs(db *sql.DB, path string, format csvFormat, accountID *int, skipDupes bool) (inserted int, dupes int, txnIDs []int, err error) {
	tx, err := db.Begin()
	if err != nil {
		return 0, 0, nil, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck // rollback is a no-op after commit

	var existingSet map[string]bool
	if skipDupes {
		existingSet, err = loadDuplicateSet(db)
		if err != nil {
			return 0, 0, nil, fmt.Errorf("load duplicates: %w", err)
		}
	}
	insertedIDs := make([]int, 0)

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
			res, execErr := tx.Exec(`
				INSERT INTO transactions (date_raw, date_iso, amount, description, notes, account_id)
				VALUES (?, ?, ?, ?, '', ?)
			`, row.dateRaw, row.dateISO, row.amount, row.description, accountID)
			if execErr != nil {
				return fmt.Errorf("insert row: %w", execErr)
			}
			lastID, idErr := res.LastInsertId()
			if idErr != nil {
				return fmt.Errorf("last insert id: %w", idErr)
			}
			inserted++
			insertedIDs = append(insertedIDs, int(lastID))
			return nil
		},
		func(parseErr error) error { return parseErr },
	)
	if walkErr != nil {
		return inserted, dupes, insertedIDs, walkErr
	}
	if commitErr := tx.Commit(); commitErr != nil {
		return inserted, dupes, insertedIDs, fmt.Errorf("commit tx: %w", commitErr)
	}
	return inserted, dupes, insertedIDs, nil
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
