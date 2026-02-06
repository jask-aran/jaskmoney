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
		count, dupes, err := importCSV(db, path, *format, skipDupes)
		if err != nil {
			return ingestDoneMsg{count: count, dupes: dupes, err: err, file: base}
		}
		_, _ = insertImportRecord(db, base, count)
		_, _ = applyCategoryRules(db)
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
		total, dupes, err := countDuplicates(db, path, *format)
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
		if strings.HasPrefix(lower, strings.ToLower(formats[i].Name)) {
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
	f, err := os.Open(path)
	if err != nil {
		return 0, 0, fmt.Errorf("open csv: %w", err)
	}
	defer f.Close()

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
			return inserted, dupes, fmt.Errorf("read csv row: %w", readErr)
		}
		// Skip header row
		if firstRow && format.HasHeader {
			firstRow = false
			continue
		}
		firstRow = false

		if len(rec) < minCols {
			continue
		}

		dateRaw := strings.TrimSpace(rec[format.DateCol])
		amountRaw := strings.TrimSpace(rec[format.AmountCol])

		// Build description
		var description string
		if format.DescJoin {
			description = strings.TrimSpace(strings.Join(rec[format.DescCol:], ","))
		} else {
			description = strings.TrimSpace(rec[format.DescCol])
		}
		if dateRaw == "" || amountRaw == "" {
			continue
		}

		// Strip configured characters from amount
		if format.AmountStrip != "" {
			for _, ch := range format.AmountStrip {
				amountRaw = strings.ReplaceAll(amountRaw, string(ch), "")
			}
		}

		dateISO, parseErr := parseDateISO(dateRaw, format.DateFormat)
		if parseErr != nil {
			return inserted, dupes, fmt.Errorf("parse date %q: %w", dateRaw, parseErr)
		}
		amount, parseErr := parseAmount(amountRaw)
		if parseErr != nil {
			return inserted, dupes, fmt.Errorf("parse amount %q: %w", amountRaw, parseErr)
		}

		// Duplicate check
		if skipDupes {
			key := duplicateKey(dateISO, amount, description)
			if existingSet[key] {
				dupes++
				continue
			}
			existingSet[key] = true
		}

		_, execErr := tx.Exec(`
			INSERT INTO transactions (date_raw, date_iso, amount, description, notes)
			VALUES (?, ?, ?, ?, '')
		`, dateRaw, dateISO, amount, description)
		if execErr != nil {
			return inserted, dupes, fmt.Errorf("insert row: %w", execErr)
		}
		inserted++
	}
	if commitErr := tx.Commit(); commitErr != nil {
		return inserted, dupes, fmt.Errorf("commit tx: %w", commitErr)
	}
	return inserted, dupes, nil
}

// countDuplicates scans a CSV file and counts how many rows would be duplicates.
func countDuplicates(db *sql.DB, path string, format csvFormat) (total int, dupes int, err error) {
	f, err := os.Open(path)
	if err != nil {
		return 0, 0, fmt.Errorf("open csv: %w", err)
	}
	defer f.Close()

	existingSet, err := loadDuplicateSet(db)
	if err != nil {
		return 0, 0, fmt.Errorf("load duplicates: %w", err)
	}

	r := csv.NewReader(f)
	r.FieldsPerRecord = -1
	if format.Delimiter != "" {
		r.Comma = rune(format.Delimiter[0])
	}

	minCols := max(format.DateCol, format.AmountCol, format.DescCol) + 1
	firstRow := true
	seenInFile := make(map[string]bool)
	for {
		rec, readErr := r.Read()
		if readErr != nil {
			if readErr == io.EOF {
				break
			}
			return total, dupes, fmt.Errorf("read csv row: %w", readErr)
		}
		if firstRow && format.HasHeader {
			firstRow = false
			continue
		}
		firstRow = false

		if len(rec) < minCols {
			continue
		}
		dateRaw := strings.TrimSpace(rec[format.DateCol])
		amountRaw := strings.TrimSpace(rec[format.AmountCol])
		var description string
		if format.DescJoin {
			description = strings.TrimSpace(strings.Join(rec[format.DescCol:], ","))
		} else {
			description = strings.TrimSpace(rec[format.DescCol])
		}
		if dateRaw == "" || amountRaw == "" {
			continue
		}
		if format.AmountStrip != "" {
			for _, ch := range format.AmountStrip {
				amountRaw = strings.ReplaceAll(amountRaw, string(ch), "")
			}
		}
		dateISO, parseErr := parseDateISO(dateRaw, format.DateFormat)
		if parseErr != nil {
			continue // skip unparseable rows in scan
		}
		amount, parseErr := parseAmount(amountRaw)
		if parseErr != nil {
			continue
		}
		total++
		key := duplicateKey(dateISO, amount, description)
		if existingSet[key] || seenInFile[key] {
			dupes++
		}
		seenInFile[key] = true
	}
	return total, dupes, nil
}

// duplicateKey builds a composite key for duplicate detection.
func duplicateKey(dateISO string, amount float64, description string) string {
	return fmt.Sprintf("%s|%.2f|%s", dateISO, amount, strings.ToLower(description))
}

// loadDuplicateSet returns a set of existing transaction keys for fast lookup.
func loadDuplicateSet(db *sql.DB) (map[string]bool, error) {
	rows, err := db.Query("SELECT date_iso, amount, description FROM transactions")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	set := make(map[string]bool)
	for rows.Next() {
		var dateISO, desc string
		var amount float64
		if err := rows.Scan(&dateISO, &amount, &desc); err != nil {
			return nil, err
		}
		set[duplicateKey(dateISO, amount, desc)] = true
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
