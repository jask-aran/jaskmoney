package main

import (
	"database/sql"
	"fmt"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	_ "modernc.org/sqlite"
)

// ---------------------------------------------------------------------------
// Schema version
// ---------------------------------------------------------------------------

const schemaVersion = 4
const mandatoryIgnoreTagName = "IGNORE"

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

var mandatoryTags = []struct {
	name  string
	color string
}{
	{mandatoryIgnoreTagName, "#f38ba8"},
}

// ---------------------------------------------------------------------------
// Schema DDL
// ---------------------------------------------------------------------------

const schemaV4 = `
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

CREATE TABLE IF NOT EXISTS tags (
	id          INTEGER PRIMARY KEY AUTOINCREMENT,
	name        TEXT NOT NULL UNIQUE,
	color       TEXT NOT NULL DEFAULT '#94e2d5',
	category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
	sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS transaction_tags (
	transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
	tag_id         INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
	PRIMARY KEY (transaction_id, tag_id)
);

CREATE TABLE IF NOT EXISTS tag_rules (
	id       INTEGER PRIMARY KEY AUTOINCREMENT,
	pattern  TEXT NOT NULL UNIQUE,
	tag_id   INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
	priority INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS accounts (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	name       TEXT NOT NULL UNIQUE,
	type       TEXT NOT NULL CHECK(type IN ('debit','credit')) DEFAULT 'debit',
	sort_order INTEGER NOT NULL DEFAULT 0,
	is_active  INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS account_selection (
	account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE
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
	account_id    INTEGER REFERENCES accounts(id),
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
CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_category_rules_pattern ON category_rules(pattern);
CREATE INDEX IF NOT EXISTS idx_accounts_sort_order ON accounts(sort_order);
CREATE INDEX IF NOT EXISTS idx_tags_sort_order ON tags(sort_order);
CREATE INDEX IF NOT EXISTS idx_tag_rules_pattern ON tag_rules(pattern);
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
	if err := ensureMandatoryTags(db); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("ensure mandatory tags: %w", err)
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

// migrateSchema upgrades the schema to the current version.
func migrateSchema(db *sql.DB, fromVersion int) error {
	if fromVersion == 3 {
		return migrateFromV3ToV4(db)
	}
	return migrateClean(db)
}

func migrateFromV3ToV4(db *sql.DB) error {
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS tags (
			id          INTEGER PRIMARY KEY AUTOINCREMENT,
			name        TEXT NOT NULL UNIQUE,
			color       TEXT NOT NULL DEFAULT '#94e2d5',
			category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
			sort_order  INTEGER NOT NULL DEFAULT 0
		)`,
		`CREATE TABLE IF NOT EXISTS transaction_tags (
			transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
			tag_id         INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
			PRIMARY KEY (transaction_id, tag_id)
		)`,
		`CREATE TABLE IF NOT EXISTS tag_rules (
			id       INTEGER PRIMARY KEY AUTOINCREMENT,
			pattern  TEXT NOT NULL UNIQUE,
			tag_id   INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
			priority INTEGER NOT NULL DEFAULT 0
		)`,
		`CREATE INDEX IF NOT EXISTS idx_tags_sort_order ON tags(sort_order)`,
		`CREATE INDEX IF NOT EXISTS idx_tag_rules_pattern ON tag_rules(pattern)`,
	}
	for _, stmt := range stmts {
		if _, err := db.Exec(stmt); err != nil {
			return fmt.Errorf("migrate v3->v4 statement failed: %w", err)
		}
	}
	if _, err := db.Exec(`DELETE FROM schema_meta`); err != nil {
		return fmt.Errorf("clear schema_meta: %w", err)
	}
	if err := ensureMandatoryTags(db); err != nil {
		return fmt.Errorf("ensure tags v3->v4: %w", err)
	}
	if _, err := db.Exec(`INSERT INTO schema_meta (version) VALUES (?)`, schemaVersion); err != nil {
		return fmt.Errorf("set schema version: %w", err)
	}
	return nil
}

// migrateClean drops everything and starts fresh at schema v4.
func migrateClean(db *sql.DB) error {
	drops := []string{
		"DROP TABLE IF EXISTS transaction_tags",
		"DROP TABLE IF EXISTS tag_rules",
		"DROP TABLE IF EXISTS category_rules",
		"DROP TABLE IF EXISTS account_selection",
		"DROP TABLE IF EXISTS transactions",
		"DROP TABLE IF EXISTS imports",
		"DROP TABLE IF EXISTS tags",
		"DROP TABLE IF EXISTS accounts",
		"DROP TABLE IF EXISTS categories",
		"DROP TABLE IF EXISTS schema_meta",
	}
	for _, stmt := range drops {
		if _, err := db.Exec(stmt); err != nil {
			return fmt.Errorf("drop table: %w", err)
		}
	}
	if _, err := db.Exec(schemaV4); err != nil {
		return fmt.Errorf("create v4 schema: %w", err)
	}
	if err := seedDefaultCategories(db); err != nil {
		return fmt.Errorf("seed categories: %w", err)
	}
	if err := ensureMandatoryTags(db); err != nil {
		return fmt.Errorf("seed tags: %w", err)
	}
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

func ensureMandatoryTags(db *sql.DB) error {
	for _, t := range mandatoryTags {
		var id int
		err := db.QueryRow(`SELECT id FROM tags WHERE LOWER(name) = LOWER(?) LIMIT 1`, t.name).Scan(&id)
		if err == nil {
			continue
		}
		if err != sql.ErrNoRows {
			return fmt.Errorf("lookup mandatory tag %q: %w", t.name, err)
		}
		if _, err := insertTag(db, t.name, t.color, nil); err != nil {
			return fmt.Errorf("insert mandatory tag %q: %w", t.name, err)
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

// loadCategoryByNameCI returns a category by case-insensitive exact name.
func loadCategoryByNameCI(db *sql.DB, name string) (*category, error) {
	var c category
	var isDef int
	err := db.QueryRow(`
		SELECT id, name, color, sort_order, is_default
		FROM categories
		WHERE LOWER(name) = LOWER(?)
		LIMIT 1
	`, name).Scan(&c.id, &c.name, &c.color, &c.sortOrder, &isDef)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("query category by name: %w", err)
	}
	c.isDefault = isDef == 1
	return &c, nil
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
// Transaction queries
// ---------------------------------------------------------------------------

// loadRows retrieves all transactions with category info, ordered by date (newest first).
func loadRows(db *sql.DB) ([]transaction, error) {
	rows, err := db.Query(`
		SELECT t.id, t.date_raw, t.date_iso, t.amount, t.description,
		       t.category_id, COALESCE(c.name, 'Uncategorised'), COALESCE(c.color, '#7f849c'),
		       t.notes, t.account_id, COALESCE(a.name, ''), COALESCE(a.type, '')
		FROM transactions t
		LEFT JOIN categories c ON t.category_id = c.id
		LEFT JOIN accounts a ON t.account_id = a.id
		ORDER BY t.date_iso DESC, t.id DESC
	`)
	if err != nil {
		return nil, fmt.Errorf("query transactions: %w", err)
	}
	defer rows.Close()

	var out []transaction
	for rows.Next() {
		var t transaction
		if err := rows.Scan(&t.id, &t.dateRaw, &t.dateISO, &t.amount, &t.description,
			&t.categoryID, &t.categoryName, &t.categoryColor, &t.notes, &t.accountID, &t.accountName, &t.accountType); err != nil {
			return nil, fmt.Errorf("scan transaction: %w", err)
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// updateTransactionCategory sets the category for a transaction.
func updateTransactionCategory(db *sql.DB, txnID int, categoryID *int) error {
	_, err := db.Exec("UPDATE transactions SET category_id = ? WHERE id = ?", categoryID, txnID)
	if err != nil {
		return fmt.Errorf("update category: %w", err)
	}
	return nil
}

// updateTransactionsCategory sets the same category for a list of transactions
// atomically and returns the number of affected rows.
func updateTransactionsCategory(db *sql.DB, txnIDs []int, categoryID *int) (int, error) {
	if len(txnIDs) == 0 {
		return 0, nil
	}
	tx, err := db.Begin()
	if err != nil {
		return 0, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck // rollback is a no-op after commit

	stmt, err := tx.Prepare("UPDATE transactions SET category_id = ? WHERE id = ?")
	if err != nil {
		return 0, fmt.Errorf("prepare update category: %w", err)
	}
	defer stmt.Close()

	affected := 0
	for _, txnID := range txnIDs {
		res, execErr := stmt.Exec(categoryID, txnID)
		if execErr != nil {
			return 0, fmt.Errorf("update category for txn %d: %w", txnID, execErr)
		}
		n, rowsErr := res.RowsAffected()
		if rowsErr != nil {
			return 0, fmt.Errorf("rows affected for txn %d: %w", txnID, rowsErr)
		}
		affected += int(n)
	}
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("commit tx: %w", err)
	}
	return affected, nil
}

// updateTransactionNotes sets the notes for a transaction.
func updateTransactionNotes(db *sql.DB, txnID int, notes string) error {
	_, err := db.Exec("UPDATE transactions SET notes = ? WHERE id = ?", notes, txnID)
	if err != nil {
		return fmt.Errorf("update notes: %w", err)
	}
	return nil
}

// updateTransactionDetail updates category and notes in a single transaction.
func updateTransactionDetail(db *sql.DB, txnID int, categoryID *int, notes string) error {
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck // rollback is a no-op after commit

	_, err = tx.Exec("UPDATE transactions SET category_id = ?, notes = ? WHERE id = ?", categoryID, notes, txnID)
	if err != nil {
		return fmt.Errorf("update transaction: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit tx: %w", err)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Category CRUD
// ---------------------------------------------------------------------------

// insertCategory adds a new category and returns its ID.
func insertCategory(db *sql.DB, name, color string) (int, error) {
	// Determine next sort_order
	var maxOrder int
	err := db.QueryRow("SELECT COALESCE(MAX(sort_order), 0) FROM categories").Scan(&maxOrder)
	if err != nil {
		return 0, fmt.Errorf("max sort_order: %w", err)
	}
	res, err := db.Exec(`
		INSERT INTO categories (name, color, sort_order, is_default)
		VALUES (?, ?, ?, 0)
	`, name, color, maxOrder+1)
	if err != nil {
		return 0, fmt.Errorf("insert category: %w", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return 0, fmt.Errorf("last insert id: %w", err)
	}
	return int(id), nil
}

// updateCategory modifies an existing category's name and color.
func updateCategory(db *sql.DB, id int, name, color string) error {
	_, err := db.Exec("UPDATE categories SET name = ?, color = ? WHERE id = ?", name, color, id)
	if err != nil {
		return fmt.Errorf("update category: %w", err)
	}
	return nil
}

// deleteCategory removes a category by ID. Returns an error if it is the
// default ("Uncategorised") category.
func deleteCategory(db *sql.DB, id int) error {
	var isDef int
	err := db.QueryRow("SELECT is_default FROM categories WHERE id = ?", id).Scan(&isDef)
	if err != nil {
		return fmt.Errorf("check default: %w", err)
	}
	if isDef == 1 {
		return fmt.Errorf("cannot delete default category")
	}
	_, err = db.Exec("DELETE FROM categories WHERE id = ?", id)
	if err != nil {
		return fmt.Errorf("delete category: %w", err)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Category rule CRUD
// ---------------------------------------------------------------------------

// insertCategoryRule adds a new rule and returns its ID.
func insertCategoryRule(db *sql.DB, pattern string, categoryID int) (int, error) {
	res, err := db.Exec(`
		INSERT INTO category_rules (pattern, category_id, priority)
		VALUES (?, ?, 0)
	`, pattern, categoryID)
	if err != nil {
		return 0, fmt.Errorf("insert rule: %w", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return 0, fmt.Errorf("last insert id: %w", err)
	}
	return int(id), nil
}

// updateCategoryRule modifies a rule's pattern and target category.
func updateCategoryRule(db *sql.DB, id int, pattern string, categoryID int) error {
	_, err := db.Exec("UPDATE category_rules SET pattern = ?, category_id = ? WHERE id = ?",
		pattern, categoryID, id)
	if err != nil {
		return fmt.Errorf("update rule: %w", err)
	}
	return nil
}

// deleteCategoryRule removes a rule by ID.
func deleteCategoryRule(db *sql.DB, id int) error {
	_, err := db.Exec("DELETE FROM category_rules WHERE id = ?", id)
	if err != nil {
		return fmt.Errorf("delete rule: %w", err)
	}
	return nil
}

// applyCategoryRules runs all rules against uncategorised transactions.
// It uses case-insensitive LIKE matching. Returns the number of rows updated.
func applyCategoryRules(db *sql.DB) (int, error) {
	rules, err := loadCategoryRules(db)
	if err != nil {
		return 0, err
	}
	total := 0
	for _, r := range rules {
		res, err := db.Exec(`
			UPDATE transactions
			SET category_id = ?
			WHERE category_id IS NULL
			AND LOWER(description) LIKE LOWER(?)
		`, r.categoryID, "%"+r.pattern+"%")
		if err != nil {
			return total, fmt.Errorf("apply rule %q: %w", r.pattern, err)
		}
		n, _ := res.RowsAffected()
		total += int(n)
	}
	return total, nil
}

// ---------------------------------------------------------------------------
// Tags and tag rules
// ---------------------------------------------------------------------------

type tag struct {
	id         int
	name       string
	color      string
	categoryID *int
	sortOrder  int
}

type tagRule struct {
	id       int
	pattern  string
	tagID    int
	priority int
}

func loadTags(db *sql.DB) ([]tag, error) {
	rows, err := db.Query(`
		SELECT id, name, color, category_id, sort_order
		FROM tags
		ORDER BY sort_order ASC, LOWER(name) ASC, id ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("query tags: %w", err)
	}
	defer rows.Close()
	var out []tag
	for rows.Next() {
		var t tag
		if err := rows.Scan(&t.id, &t.name, &t.color, &t.categoryID, &t.sortOrder); err != nil {
			return nil, fmt.Errorf("scan tag: %w", err)
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func loadTagByNameCI(db *sql.DB, name string) (*tag, error) {
	var t tag
	err := db.QueryRow(`
		SELECT id, name, color, category_id, sort_order
		FROM tags
		WHERE LOWER(name) = LOWER(?)
		LIMIT 1
	`, name).Scan(&t.id, &t.name, &t.color, &t.categoryID, &t.sortOrder)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("query tag by name: %w", err)
	}
	return &t, nil
}

func insertTag(db *sql.DB, name, color string, categoryID *int) (int, error) {
	var maxOrder int
	if err := db.QueryRow(`SELECT COALESCE(MAX(sort_order), 0) FROM tags`).Scan(&maxOrder); err != nil {
		return 0, fmt.Errorf("max tag sort_order: %w", err)
	}
	if strings.TrimSpace(color) == "" {
		color = autoTagColor(name)
	}
	res, err := db.Exec(`
		INSERT INTO tags (name, color, category_id, sort_order)
		VALUES (?, ?, ?, ?)
	`, name, color, categoryID, maxOrder+1)
	if err != nil {
		return 0, fmt.Errorf("insert tag: %w", err)
	}
	lastID, err := res.LastInsertId()
	if err != nil {
		return 0, fmt.Errorf("last insert id tag: %w", err)
	}
	return int(lastID), nil
}

func updateTag(db *sql.DB, id int, name, color string) error {
	if strings.TrimSpace(color) == "" {
		color = autoTagColor(name)
	}
	if _, err := db.Exec(`UPDATE tags SET name = ?, color = ? WHERE id = ?`, name, color, id); err != nil {
		return fmt.Errorf("update tag: %w", err)
	}
	return nil
}

func deleteTag(db *sql.DB, id int) error {
	var name string
	if err := db.QueryRow(`SELECT name FROM tags WHERE id = ?`, id).Scan(&name); err != nil {
		return fmt.Errorf("lookup tag: %w", err)
	}
	if strings.EqualFold(strings.TrimSpace(name), mandatoryIgnoreTagName) {
		return fmt.Errorf("cannot delete mandatory tag %q", mandatoryIgnoreTagName)
	}
	if _, err := db.Exec(`DELETE FROM tags WHERE id = ?`, id); err != nil {
		return fmt.Errorf("delete tag: %w", err)
	}
	return nil
}

func loadTagRules(db *sql.DB) ([]tagRule, error) {
	rows, err := db.Query(`
		SELECT id, pattern, tag_id, priority
		FROM tag_rules
		ORDER BY priority DESC, id ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("query tag rules: %w", err)
	}
	defer rows.Close()
	var out []tagRule
	for rows.Next() {
		var r tagRule
		if err := rows.Scan(&r.id, &r.pattern, &r.tagID, &r.priority); err != nil {
			return nil, fmt.Errorf("scan tag rule: %w", err)
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func insertTagRule(db *sql.DB, pattern string, tagID int) (int, error) {
	res, err := db.Exec(`
		INSERT INTO tag_rules (pattern, tag_id, priority)
		VALUES (?, ?, 0)
	`, pattern, tagID)
	if err != nil {
		return 0, fmt.Errorf("insert tag rule: %w", err)
	}
	lastID, err := res.LastInsertId()
	if err != nil {
		return 0, fmt.Errorf("last insert id tag rule: %w", err)
	}
	return int(lastID), nil
}

func loadTransactionTags(db *sql.DB) (map[int][]tag, error) {
	rows, err := db.Query(`
		SELECT tt.transaction_id, t.id, t.name, t.color, t.category_id, t.sort_order
		FROM transaction_tags tt
		JOIN tags t ON t.id = tt.tag_id
		ORDER BY tt.transaction_id ASC, t.sort_order ASC, LOWER(t.name) ASC, t.id ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("query transaction tags: %w", err)
	}
	defer rows.Close()
	out := make(map[int][]tag)
	for rows.Next() {
		var txnID int
		var t tag
		if err := rows.Scan(&txnID, &t.id, &t.name, &t.color, &t.categoryID, &t.sortOrder); err != nil {
			return nil, fmt.Errorf("scan transaction tag: %w", err)
		}
		out[txnID] = append(out[txnID], t)
	}
	return out, rows.Err()
}

func upsertTransactionTag(db *sql.DB, txnID, tagID int) error {
	if _, err := db.Exec(`
		INSERT INTO transaction_tags (transaction_id, tag_id)
		VALUES (?, ?)
		ON CONFLICT(transaction_id, tag_id) DO NOTHING
	`, txnID, tagID); err != nil {
		return fmt.Errorf("upsert transaction tag txn=%d tag=%d: %w", txnID, tagID, err)
	}
	return nil
}

func setTransactionTags(db *sql.DB, txnID int, tagIDs []int) error {
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("begin set transaction tags: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck
	if _, err := tx.Exec(`DELETE FROM transaction_tags WHERE transaction_id = ?`, txnID); err != nil {
		return fmt.Errorf("clear transaction tags: %w", err)
	}
	for _, tagID := range tagIDs {
		if _, err := tx.Exec(`INSERT INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)`, txnID, tagID); err != nil {
			return fmt.Errorf("insert transaction tag: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit set transaction tags: %w", err)
	}
	return nil
}

func addTagsToTransactions(db *sql.DB, txnIDs, tagIDs []int) (int, error) {
	if len(txnIDs) == 0 || len(tagIDs) == 0 {
		return 0, nil
	}
	tx, err := db.Begin()
	if err != nil {
		return 0, fmt.Errorf("begin add tags to transactions: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	affected := 0
	for _, txnID := range txnIDs {
		for _, tagID := range tagIDs {
			res, err := tx.Exec(`
				INSERT INTO transaction_tags (transaction_id, tag_id)
				VALUES (?, ?)
				ON CONFLICT(transaction_id, tag_id) DO NOTHING
			`, txnID, tagID)
			if err != nil {
				return 0, fmt.Errorf("insert transaction tag txn=%d tag=%d: %w", txnID, tagID, err)
			}
			n, _ := res.RowsAffected()
			affected += int(n)
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("commit add tags to transactions: %w", err)
	}
	return affected, nil
}

func removeTagFromTransactions(db *sql.DB, txnIDs []int, tagID int) (int, error) {
	if len(txnIDs) == 0 || tagID == 0 {
		return 0, nil
	}
	tx, err := db.Begin()
	if err != nil {
		return 0, fmt.Errorf("begin remove tag from transactions: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	affected := 0
	for _, txnID := range txnIDs {
		res, execErr := tx.Exec(`
			DELETE FROM transaction_tags
			WHERE transaction_id = ? AND tag_id = ?
		`, txnID, tagID)
		if execErr != nil {
			return 0, fmt.Errorf("delete transaction tag txn=%d tag=%d: %w", txnID, tagID, execErr)
		}
		n, rowsErr := res.RowsAffected()
		if rowsErr != nil {
			return 0, fmt.Errorf("rows affected delete txn=%d tag=%d: %w", txnID, tagID, rowsErr)
		}
		affected += int(n)
	}
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("commit remove tag from transactions: %w", err)
	}
	return affected, nil
}

func applyTagRules(db *sql.DB) (int, error) {
	rules, err := loadTagRules(db)
	if err != nil {
		return 0, err
	}
	rows, err := db.Query(`SELECT id, description FROM transactions`)
	if err != nil {
		return 0, fmt.Errorf("query transactions for tag rules: %w", err)
	}
	defer rows.Close()

	type txnDesc struct {
		id   int
		desc string
	}
	var txns []txnDesc
	for rows.Next() {
		var t txnDesc
		if err := rows.Scan(&t.id, &t.desc); err != nil {
			return 0, fmt.Errorf("scan txn for tag rules: %w", err)
		}
		txns = append(txns, t)
	}
	if err := rows.Err(); err != nil {
		return 0, err
	}

	applied := 0
	for _, r := range rules {
		pat := strings.ToLower(strings.TrimSpace(r.pattern))
		if pat == "" {
			continue
		}
		for _, txn := range txns {
			if !strings.Contains(strings.ToLower(txn.desc), pat) {
				continue
			}
			if err := upsertTransactionTag(db, txn.id, r.tagID); err != nil {
				return applied, fmt.Errorf("apply tag rule %q: %w", r.pattern, err)
			}
			applied++
		}
	}
	return applied, nil
}

func autoTagColor(name string) string {
	palette := TagAccentColors()
	if len(palette) == 0 {
		return "#94e2d5"
	}
	s := strings.ToLower(strings.TrimSpace(name))
	sum := 0
	for i := 0; i < len(s); i++ {
		sum += int(s[i]) * (i + 1)
	}
	return string(palette[sum%len(palette)])
}

// ---------------------------------------------------------------------------
// Import record helpers
// ---------------------------------------------------------------------------

// insertImportRecord records an import and returns its ID.
func insertImportRecord(db *sql.DB, filename string, rowCount int) (int, error) {
	res, err := db.Exec(`INSERT INTO imports (filename, row_count) VALUES (?, ?)`,
		filename, rowCount)
	if err != nil {
		return 0, fmt.Errorf("insert import: %w", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return 0, fmt.Errorf("last insert id: %w", err)
	}
	return int(id), nil
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

type account struct {
	id        int
	name      string
	acctType  string
	sortOrder int
	isActive  bool
}

func loadAccounts(db *sql.DB) ([]account, error) {
	rows, err := db.Query(`
		SELECT id, name, type, sort_order, is_active
		FROM accounts
		ORDER BY sort_order ASC, LOWER(name) ASC, id ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("query accounts: %w", err)
	}
	defer rows.Close()

	var out []account
	for rows.Next() {
		var a account
		var active int
		if err := rows.Scan(&a.id, &a.name, &a.acctType, &a.sortOrder, &active); err != nil {
			return nil, fmt.Errorf("scan account: %w", err)
		}
		a.isActive = active == 1
		out = append(out, a)
	}
	return out, rows.Err()
}

func loadAccountByNameCI(db *sql.DB, name string) (*account, error) {
	var a account
	var active int
	err := db.QueryRow(`
		SELECT id, name, type, sort_order, is_active
		FROM accounts
		WHERE LOWER(name) = LOWER(?)
		LIMIT 1
	`, name).Scan(&a.id, &a.name, &a.acctType, &a.sortOrder, &active)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("query account by name: %w", err)
	}
	a.isActive = active == 1
	return &a, nil
}

func insertAccount(db *sql.DB, name, acctType string, isActive bool) (int, error) {
	var maxOrder int
	if err := db.QueryRow(`SELECT COALESCE(MAX(sort_order), 0) FROM accounts`).Scan(&maxOrder); err != nil {
		return 0, fmt.Errorf("max account sort_order: %w", err)
	}
	active := 0
	if isActive {
		active = 1
	}
	res, err := db.Exec(`
		INSERT INTO accounts (name, type, sort_order, is_active)
		VALUES (?, ?, ?, ?)
	`, name, normalizeAccountType(acctType), maxOrder+1, active)
	if err != nil {
		return 0, fmt.Errorf("insert account: %w", err)
	}
	lastID, err := res.LastInsertId()
	if err != nil {
		return 0, fmt.Errorf("last insert id account: %w", err)
	}
	return int(lastID), nil
}

func updateAccount(db *sql.DB, id int, name, acctType string, isActive bool) error {
	active := 0
	if isActive {
		active = 1
	}
	_, err := db.Exec(`
		UPDATE accounts
		SET name = ?, type = ?, is_active = ?
		WHERE id = ?
	`, name, normalizeAccountType(acctType), active, id)
	if err != nil {
		return fmt.Errorf("update account: %w", err)
	}
	return nil
}

func countTransactionsForAccount(db *sql.DB, accountID int) (int, error) {
	var n int
	if err := db.QueryRow(`SELECT COUNT(*) FROM transactions WHERE account_id = ?`, accountID).Scan(&n); err != nil {
		return 0, fmt.Errorf("count transactions for account %d: %w", accountID, err)
	}
	return n, nil
}

func clearTransactionsForAccount(db *sql.DB, accountID int) (int, error) {
	res, err := db.Exec(`DELETE FROM transactions WHERE account_id = ?`, accountID)
	if err != nil {
		return 0, fmt.Errorf("clear transactions for account %d: %w", accountID, err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("rows affected clear account %d: %w", accountID, err)
	}
	return int(n), nil
}

func deleteAccountIfEmpty(db *sql.DB, accountID int) error {
	count, err := countTransactionsForAccount(db, accountID)
	if err != nil {
		return err
	}
	if count > 0 {
		return fmt.Errorf("account has %d transactions; clear it first", count)
	}
	if _, err := db.Exec(`DELETE FROM account_selection WHERE account_id = ?`, accountID); err != nil {
		return fmt.Errorf("delete account selection: %w", err)
	}
	if _, err := db.Exec(`DELETE FROM accounts WHERE id = ?`, accountID); err != nil {
		return fmt.Errorf("delete account: %w", err)
	}
	return nil
}

func nukeAccountWithTransactions(db *sql.DB, accountID int) (int, error) {
	tx, err := db.Begin()
	if err != nil {
		return 0, fmt.Errorf("begin nuke account tx: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	res, err := tx.Exec(`DELETE FROM transactions WHERE account_id = ?`, accountID)
	if err != nil {
		return 0, fmt.Errorf("delete account transactions: %w", err)
	}
	if _, err := tx.Exec(`DELETE FROM account_selection WHERE account_id = ?`, accountID); err != nil {
		return 0, fmt.Errorf("delete account selection: %w", err)
	}
	if _, err := tx.Exec(`DELETE FROM accounts WHERE id = ?`, accountID); err != nil {
		return 0, fmt.Errorf("delete account: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("commit nuke account: %w", err)
	}
	n, _ := res.RowsAffected()
	return int(n), nil
}

func saveSelectedAccounts(db *sql.DB, accountIDs []int) error {
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("begin save selected accounts: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	if _, err := tx.Exec(`DELETE FROM account_selection`); err != nil {
		return fmt.Errorf("clear account selection: %w", err)
	}
	for _, id := range accountIDs {
		if _, err := tx.Exec(`INSERT INTO account_selection (account_id) VALUES (?)`, id); err != nil {
			return fmt.Errorf("insert selected account %d: %w", id, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit save selected accounts: %w", err)
	}
	return nil
}

func loadSelectedAccounts(db *sql.DB) (map[int]bool, error) {
	rows, err := db.Query(`SELECT account_id FROM account_selection`)
	if err != nil {
		return nil, fmt.Errorf("query account_selection: %w", err)
	}
	defer rows.Close()

	out := make(map[int]bool)
	for rows.Next() {
		var id int
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("scan account_selection: %w", err)
		}
		out[id] = true
	}
	return out, rows.Err()
}

func syncAccountsFromFormats(db *sql.DB, formats []csvFormat) error {
	type entry struct {
		fmt csvFormat
		pos int
	}
	byName := make(map[string]entry)
	for i, f := range formats {
		name := strings.TrimSpace(f.Account)
		if name == "" {
			name = strings.TrimSpace(f.Name)
		}
		if name == "" {
			continue
		}
		f.Account = name
		byName[strings.ToLower(name)] = entry{fmt: f, pos: i}
	}
	for _, ent := range byName {
		existing, err := loadAccountByNameCI(db, ent.fmt.Account)
		if err != nil {
			return err
		}
		sortOrder := ent.fmt.SortOrder
		if sortOrder <= 0 {
			sortOrder = ent.pos + 1
		}
		active := 1
		if !ent.fmt.IsActive {
			active = 0
		}
		if existing == nil {
			if _, err := db.Exec(`
				INSERT INTO accounts (name, type, sort_order, is_active)
				VALUES (?, ?, ?, ?)
			`, ent.fmt.Account, normalizeAccountType(ent.fmt.AccountType), sortOrder, active); err != nil {
				return fmt.Errorf("insert synced account %q: %w", ent.fmt.Account, err)
			}
			continue
		}
		if _, err := db.Exec(`
			UPDATE accounts
			SET type = ?, sort_order = ?, is_active = ?
			WHERE id = ?
		`, normalizeAccountType(ent.fmt.AccountType), sortOrder, active, existing.id); err != nil {
			return fmt.Errorf("update synced account %q: %w", ent.fmt.Account, err)
		}
	}
	return nil
}

// ---------------------------------------------------------------------------
// Database info
// ---------------------------------------------------------------------------

// dbInfo holds summary statistics about the database.
type dbInfo struct {
	schemaVersion    int
	transactionCount int
	categoryCount    int
	ruleCount        int
	tagCount         int
	tagRuleCount     int
	importCount      int
	accountCount     int
}

// loadDBInfo retrieves summary statistics.
func loadDBInfo(db *sql.DB) (dbInfo, error) {
	var info dbInfo
	err := db.QueryRow("SELECT COALESCE(version, 0) FROM schema_meta LIMIT 1").Scan(&info.schemaVersion)
	if err != nil {
		return info, fmt.Errorf("schema version: %w", err)
	}
	if err := db.QueryRow("SELECT COUNT(*) FROM transactions").Scan(&info.transactionCount); err != nil {
		return info, fmt.Errorf("transaction count: %w", err)
	}
	if err := db.QueryRow("SELECT COUNT(*) FROM categories").Scan(&info.categoryCount); err != nil {
		return info, fmt.Errorf("category count: %w", err)
	}
	if err := db.QueryRow("SELECT COUNT(*) FROM category_rules").Scan(&info.ruleCount); err != nil {
		return info, fmt.Errorf("rule count: %w", err)
	}
	if err := db.QueryRow("SELECT COUNT(*) FROM tags").Scan(&info.tagCount); err != nil {
		return info, fmt.Errorf("tag count: %w", err)
	}
	if err := db.QueryRow("SELECT COUNT(*) FROM tag_rules").Scan(&info.tagRuleCount); err != nil {
		return info, fmt.Errorf("tag rule count: %w", err)
	}
	if err := db.QueryRow("SELECT COUNT(*) FROM imports").Scan(&info.importCount); err != nil {
		return info, fmt.Errorf("import count: %w", err)
	}
	if err := db.QueryRow("SELECT COUNT(*) FROM accounts").Scan(&info.accountCount); err != nil {
		return info, fmt.Errorf("account count: %w", err)
	}
	return info, nil
}

// clearAllData deletes all transactions and imports, but preserves categories and rules.
func clearAllData(db *sql.DB) error {
	statements := []string{
		"DELETE FROM transactions",
		"DELETE FROM imports",
	}
	for _, stmt := range statements {
		if _, err := db.Exec(stmt); err != nil {
			return fmt.Errorf("clear data: %w", err)
		}
	}
	return nil
}

// ---------------------------------------------------------------------------
// Tea commands
// ---------------------------------------------------------------------------

// refreshCmd returns a Bubble Tea command that reloads rows, categories,
// rules, and imports.
func refreshCmd(db *sql.DB) tea.Cmd {
	return func() tea.Msg {
		rows, err := loadRows(db)
		if err != nil {
			return refreshDoneMsg{err: err}
		}
		cats, err := loadCategories(db)
		if err != nil {
			return refreshDoneMsg{err: err}
		}
		rules, err := loadCategoryRules(db)
		if err != nil {
			return refreshDoneMsg{err: err}
		}
		tags, err := loadTags(db)
		if err != nil {
			return refreshDoneMsg{err: err}
		}
		tagRules, err := loadTagRules(db)
		if err != nil {
			return refreshDoneMsg{err: err}
		}
		txnTags, err := loadTransactionTags(db)
		if err != nil {
			return refreshDoneMsg{err: err}
		}
		imports, err := loadImports(db)
		if err != nil {
			return refreshDoneMsg{err: err}
		}
		accounts, err := loadAccounts(db)
		if err != nil {
			return refreshDoneMsg{err: err}
		}
		selectedAccounts, err := loadSelectedAccounts(db)
		if err != nil {
			return refreshDoneMsg{err: err}
		}
		info, err := loadDBInfo(db)
		if err != nil {
			return refreshDoneMsg{err: err}
		}
		return refreshDoneMsg{
			rows:             rows,
			categories:       cats,
			rules:            rules,
			tags:             tags,
			tagRules:         tagRules,
			txnTags:          txnTags,
			imports:          imports,
			accounts:         accounts,
			selectedAccounts: selectedAccounts,
			info:             info,
		}
	}
}
