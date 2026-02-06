package main

import (
	"database/sql"
	"fmt"

	tea "github.com/charmbracelet/bubbletea"
	_ "modernc.org/sqlite"
)

// ---------------------------------------------------------------------------
// Schema version
// ---------------------------------------------------------------------------

const schemaVersion = 2

// ---------------------------------------------------------------------------
// Default categories seeded on fresh DB
// ---------------------------------------------------------------------------

var defaultCategories = []struct {
	name      string
	color     string
	sortOrder int
	isDefault int
}{
	{"Income", "#a6e3a1", 1, 0},
	{"Groceries", "#94e2d5", 2, 0},
	{"Dining & Drinks", "#fab387", 3, 0},
	{"Transport", "#89b4fa", 4, 0},
	{"Bills & Utilities", "#cba6f7", 5, 0},
	{"Entertainment", "#f5c2e7", 6, 0},
	{"Shopping", "#f2cdcd", 7, 0},
	{"Health", "#74c7ec", 8, 0},
	{"Transfers", "#b4befe", 9, 0},
	{"Uncategorised", "#7f849c", 10, 1},
}

// ---------------------------------------------------------------------------
// Schema DDL (v2)
// ---------------------------------------------------------------------------

const schemaV2 = `
CREATE TABLE IF NOT EXISTS schema_meta (
	version INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
	id          INTEGER PRIMARY KEY AUTOINCREMENT,
	name        TEXT NOT NULL UNIQUE,
	color       TEXT NOT NULL,
	sort_order  INTEGER NOT NULL DEFAULT 0,
	is_default  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS category_rules (
	id            INTEGER PRIMARY KEY AUTOINCREMENT,
	pattern       TEXT NOT NULL,
	category_id   INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
	priority      INTEGER NOT NULL DEFAULT 0,
	UNIQUE(pattern)
);

CREATE TABLE IF NOT EXISTS transactions (
	id            INTEGER PRIMARY KEY AUTOINCREMENT,
	date_raw      TEXT NOT NULL,
	date_iso      TEXT NOT NULL,
	amount        REAL NOT NULL,
	description   TEXT NOT NULL,
	category_id   INTEGER REFERENCES categories(id) ON DELETE SET NULL,
	notes         TEXT NOT NULL DEFAULT '',
	import_id     INTEGER REFERENCES imports(id),
	created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS imports (
	id            INTEGER PRIMARY KEY AUTOINCREMENT,
	filename      TEXT NOT NULL,
	row_count     INTEGER NOT NULL,
	imported_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date_iso);
CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_category_rules_pattern ON category_rules(pattern);
`

// ---------------------------------------------------------------------------
// Open / migrate
// ---------------------------------------------------------------------------

// openDB opens (or creates) the SQLite database and ensures the schema is
// at the current version. If the schema is outdated, it drops and recreates.
func openDB(path string) (*sql.DB, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}

	// Enable foreign keys
	if _, err := db.Exec("PRAGMA foreign_keys = ON"); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("enable foreign keys: %w", err)
	}

	ver, err := currentSchemaVersion(db)
	if err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("check schema version: %w", err)
	}

	if ver < schemaVersion {
		if err := migrateSchema(db, ver); err != nil {
			_ = db.Close()
			return nil, fmt.Errorf("migrate schema: %w", err)
		}
	}

	return db, nil
}

// currentSchemaVersion returns the schema version from schema_meta,
// or 0 if the table doesn't exist (indicating v0.1 or fresh DB).
func currentSchemaVersion(db *sql.DB) (int, error) {
	// Check if schema_meta table exists
	var count int
	err := db.QueryRow(`
		SELECT COUNT(*) FROM sqlite_master
		WHERE type='table' AND name='schema_meta'
	`).Scan(&count)
	if err != nil {
		return 0, err
	}
	if count == 0 {
		return 0, nil // no schema_meta = v0 (either fresh or v0.1)
	}

	var ver int
	err = db.QueryRow("SELECT version FROM schema_meta LIMIT 1").Scan(&ver)
	if err == sql.ErrNoRows {
		return 0, nil
	}
	return ver, err
}

// migrateSchema drops all existing tables and recreates the v2 schema.
// This is acceptable for a personal tool where data can be re-imported.
func migrateSchema(db *sql.DB, fromVersion int) error {
	// Drop old tables (order matters for foreign keys)
	drops := []string{
		"DROP TABLE IF EXISTS category_rules",
		"DROP TABLE IF EXISTS transactions",
		"DROP TABLE IF EXISTS imports",
		"DROP TABLE IF EXISTS categories",
		"DROP TABLE IF EXISTS schema_meta",
	}
	for _, stmt := range drops {
		if _, err := db.Exec(stmt); err != nil {
			return fmt.Errorf("drop table: %w", err)
		}
	}

	// Create v2 schema
	if _, err := db.Exec(schemaV2); err != nil {
		return fmt.Errorf("create v2 schema: %w", err)
	}

	// Seed default categories
	if err := seedDefaultCategories(db); err != nil {
		return fmt.Errorf("seed categories: %w", err)
	}

	// Record schema version
	if _, err := db.Exec("INSERT INTO schema_meta (version) VALUES (?)", schemaVersion); err != nil {
		return fmt.Errorf("insert schema version: %w", err)
	}

	return nil
}

// seedDefaultCategories inserts the default category set.
func seedDefaultCategories(db *sql.DB) error {
	stmt, err := db.Prepare(`
		INSERT INTO categories (name, color, sort_order, is_default)
		VALUES (?, ?, ?, ?)
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, c := range defaultCategories {
		if _, err := stmt.Exec(c.name, c.color, c.sortOrder, c.isDefault); err != nil {
			return fmt.Errorf("insert category %q: %w", c.name, err)
		}
	}
	return nil
}

// ---------------------------------------------------------------------------
// Category types and queries
// ---------------------------------------------------------------------------

type category struct {
	id        int
	name      string
	color     string
	sortOrder int
	isDefault bool
}

// loadCategories retrieves all categories ordered by sort_order.
func loadCategories(db *sql.DB) ([]category, error) {
	rows, err := db.Query(`
		SELECT id, name, color, sort_order, is_default
		FROM categories
		ORDER BY sort_order ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("query categories: %w", err)
	}
	defer rows.Close()

	var out []category
	for rows.Next() {
		var c category
		var isDef int
		if err := rows.Scan(&c.id, &c.name, &c.color, &c.sortOrder, &isDef); err != nil {
			return nil, fmt.Errorf("scan category: %w", err)
		}
		c.isDefault = isDef == 1
		out = append(out, c)
	}
	return out, rows.Err()
}

// ---------------------------------------------------------------------------
// Category rule types and queries
// ---------------------------------------------------------------------------

type categoryRule struct {
	id         int
	pattern    string
	categoryID int
	priority   int
}

// loadCategoryRules retrieves all rules ordered by priority (descending).
func loadCategoryRules(db *sql.DB) ([]categoryRule, error) {
	rows, err := db.Query(`
		SELECT id, pattern, category_id, priority
		FROM category_rules
		ORDER BY priority DESC, id ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("query rules: %w", err)
	}
	defer rows.Close()

	var out []categoryRule
	for rows.Next() {
		var r categoryRule
		if err := rows.Scan(&r.id, &r.pattern, &r.categoryID, &r.priority); err != nil {
			return nil, fmt.Errorf("scan rule: %w", err)
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// ---------------------------------------------------------------------------
// Import record types and queries
// ---------------------------------------------------------------------------

type importRecord struct {
	id         int
	filename   string
	rowCount   int
	importedAt string
}

// loadImports retrieves all import records ordered by most recent first.
func loadImports(db *sql.DB) ([]importRecord, error) {
	rows, err := db.Query(`
		SELECT id, filename, row_count, imported_at
		FROM imports
		ORDER BY imported_at DESC
	`)
	if err != nil {
		return nil, fmt.Errorf("query imports: %w", err)
	}
	defer rows.Close()

	var out []importRecord
	for rows.Next() {
		var r importRecord
		if err := rows.Scan(&r.id, &r.filename, &r.rowCount, &r.importedAt); err != nil {
			return nil, fmt.Errorf("scan import: %w", err)
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// ---------------------------------------------------------------------------
// Transaction queries (v2)
// ---------------------------------------------------------------------------

// loadRows retrieves all transactions ordered by date (newest first), then id.
func loadRows(db *sql.DB) ([]transaction, error) {
	rows, err := db.Query(`
		SELECT date_raw, amount, description
		FROM transactions
		ORDER BY date_iso DESC, id DESC
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

// ---------------------------------------------------------------------------
// Tea commands
// ---------------------------------------------------------------------------

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
