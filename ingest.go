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

	"github.com/charmbracelet/bubbles/list"
	tea "github.com/charmbracelet/bubbletea"
)

const dateInputFormat = "2/01/2006"

// ingestCmd returns a Bubble Tea command that imports a CSV file into the DB.
func ingestCmd(db *sql.DB, filename, basePath string) tea.Cmd {
	return func() tea.Msg {
		path := filename
		if !filepath.IsAbs(path) {
			path = filepath.Join(basePath, path)
		}
		count, err := importCSV(db, path)
		return ingestDoneMsg{count: count, err: err, file: filepath.Base(path)}
	}
}

// importCSV reads a CSV file and inserts each valid row into the database
// inside a single transaction so partial imports are rolled back on error.
func importCSV(db *sql.DB, path string) (int, error) {
	f, err := os.Open(path)
	if err != nil {
		return 0, fmt.Errorf("open csv: %w", err)
	}
	defer f.Close()

	tx, err := db.Begin()
	if err != nil {
		return 0, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck // rollback is a no-op after commit

	r := csv.NewReader(f)
	inserted := 0
	for {
		rec, err := r.Read()
		if err != nil {
			if err == io.EOF {
				break
			}
			return inserted, fmt.Errorf("read csv row: %w", err)
		}
		if len(rec) < 3 {
			continue
		}
		dateRaw := strings.TrimSpace(rec[0])
		amountRaw := strings.TrimSpace(rec[1])
		description := strings.TrimSpace(strings.Join(rec[2:], ","))
		if dateRaw == "" || amountRaw == "" {
			continue
		}
		dateISO, err := parseDateISO(dateRaw)
		if err != nil {
			return inserted, fmt.Errorf("parse date %q: %w", dateRaw, err)
		}
		amount, err := parseAmount(amountRaw)
		if err != nil {
			return inserted, fmt.Errorf("parse amount %q: %w", amountRaw, err)
		}
		_, err = tx.Exec(`
			INSERT INTO transactions (date_raw, date_iso, amount, description, notes)
			VALUES (?, ?, ?, ?, '')
		`, dateRaw, dateISO, amount, description)
		if err != nil {
			return inserted, fmt.Errorf("insert row: %w", err)
		}
		inserted++
	}
	if err := tx.Commit(); err != nil {
		return inserted, fmt.Errorf("commit tx: %w", err)
	}
	return inserted, nil
}

// loadFilesCmd returns a Bubble Tea command that scans basePath for CSV files.
func loadFilesCmd(basePath string) tea.Cmd {
	return func() tea.Msg {
		entries, err := os.ReadDir(basePath)
		if err != nil {
			return filesLoadedMsg{err: fmt.Errorf("read dir: %w", err)}
		}
		var items []list.Item
		for _, entry := range entries {
			if entry.IsDir() {
				continue
			}
			name := entry.Name()
			if strings.HasSuffix(strings.ToLower(name), ".csv") {
				items = append(items, fileItem{name: name})
			}
		}
		return filesLoadedMsg{items: items, err: nil}
	}
}

// parseDateISO converts a human date string (e.g. "2/01/2006") to ISO format.
func parseDateISO(input string) (string, error) {
	parsed, err := time.Parse(dateInputFormat, input)
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
