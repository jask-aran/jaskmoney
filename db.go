package main

import (
	"database/sql"
	"fmt"

	tea "github.com/charmbracelet/bubbletea"
	_ "modernc.org/sqlite"
)

// openDB opens (or creates) the SQLite database and ensures the schema exists.
func openDB(path string) (*sql.DB, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}
	if _, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS transactions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			date_raw TEXT NOT NULL,
			date_iso TEXT NOT NULL,
			amount REAL NOT NULL,
			description TEXT NOT NULL
		)`); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("create schema: %w", err)
	}
	return db, nil
}

// loadRows retrieves all transactions ordered by insertion.
func loadRows(db *sql.DB) ([]transaction, error) {
	rows, err := db.Query(`
		SELECT date_raw, amount, description
		FROM transactions
		ORDER BY id ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("query transactions: %w", err)
	}
	defer rows.Close()

	var out []transaction
	for rows.Next() {
		var t transaction
		if err := rows.Scan(&t.dateRaw, &t.amount, &t.description); err != nil {
			return nil, fmt.Errorf("scan transaction: %w", err)
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// refreshCmd returns a Bubble Tea command that reloads rows from the database.
func refreshCmd(db *sql.DB) tea.Cmd {
	return func() tea.Msg {
		rows, err := loadRows(db)
		return refreshDoneMsg{rows: rows, err: err}
	}
}

// clearCmd returns a Bubble Tea command that deletes all transactions.
func clearCmd(db *sql.DB) tea.Cmd {
	return func() tea.Msg {
		_, err := db.Exec("DELETE FROM transactions")
		return clearDoneMsg{err: err}
	}
}
