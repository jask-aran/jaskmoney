package db

import (
	"database/sql"
	"strings"
)

const schemaSQL = `
CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    prefix TEXT,
    active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_default INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL DEFAULT '#94e2d5',
    scope_id INTEGER,
    sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY,
    account_id INTEGER NOT NULL,
    import_index INTEGER NOT NULL DEFAULT 0,
    date_iso TEXT NOT NULL,
    amount REAL NOT NULL,
    description TEXT NOT NULL,
    category_id INTEGER,
    notes TEXT,
    FOREIGN KEY (account_id) REFERENCES accounts(id)
);

CREATE TABLE IF NOT EXISTS transaction_tags (
    transaction_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    PRIMARY KEY (transaction_id, tag_id)
);

CREATE TABLE IF NOT EXISTS imports (
	id INTEGER PRIMARY KEY,
	filename TEXT NOT NULL UNIQUE,
	row_count INTEGER NOT NULL,
	imported_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS import_transaction_index (
	id INTEGER PRIMARY KEY,
	source_file TEXT NOT NULL,
	account_id INTEGER NOT NULL,
	date_iso TEXT NOT NULL,
	amount REAL NOT NULL,
	description TEXT NOT NULL,
	imported_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rules_v2 (
	id INTEGER PRIMARY KEY,
	name TEXT NOT NULL,
	saved_filter_id TEXT NOT NULL,
	set_category_id INTEGER,
	add_tag_ids TEXT NOT NULL DEFAULT '[]',
	sort_order INTEGER NOT NULL DEFAULT 0,
	enabled INTEGER NOT NULL DEFAULT 1,
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS saved_filters (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	expr TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS filter_usage_state (
	filter_id TEXT PRIMARY KEY,
	use_count INTEGER NOT NULL DEFAULT 0,
	last_used_unix INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS account_selection (
	account_id INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS category_budgets (
	id INTEGER PRIMARY KEY,
	category_id INTEGER NOT NULL UNIQUE,
	amount REAL NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS category_budget_overrides (
	id INTEGER PRIMARY KEY,
	budget_id INTEGER NOT NULL,
	month_key TEXT NOT NULL,
	amount REAL NOT NULL,
	UNIQUE(budget_id, month_key)
);

CREATE TABLE IF NOT EXISTS spending_targets (
	id INTEGER PRIMARY KEY,
	name TEXT NOT NULL,
	saved_filter_id TEXT NOT NULL,
	amount REAL NOT NULL DEFAULT 0,
	period_type TEXT NOT NULL DEFAULT 'monthly',
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS spending_target_overrides (
	id INTEGER PRIMARY KEY,
	target_id INTEGER NOT NULL,
	period_key TEXT NOT NULL,
	amount REAL NOT NULL,
	UNIQUE(target_id, period_key)
);

CREATE TABLE IF NOT EXISTS credit_offsets (
	id INTEGER PRIMARY KEY,
	credit_txn_id INTEGER NOT NULL,
	debit_txn_id INTEGER NOT NULL,
	amount REAL NOT NULL CHECK(amount > 0),
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	CHECK(credit_txn_id != debit_txn_id),
	UNIQUE(credit_txn_id, debit_txn_id)
);

CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date_iso);
CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_accounts_name ON accounts(name);
CREATE INDEX IF NOT EXISTS idx_imports_filename ON imports(filename);
CREATE INDEX IF NOT EXISTS idx_import_txn_lookup ON import_transaction_index(account_id, date_iso, amount, description);
CREATE INDEX IF NOT EXISTS idx_rules_v2_sort ON rules_v2(sort_order);
CREATE INDEX IF NOT EXISTS idx_category_budgets_cat ON category_budgets(category_id);
CREATE INDEX IF NOT EXISTS idx_credit_offsets_debit ON credit_offsets(debit_txn_id);
CREATE INDEX IF NOT EXISTS idx_credit_offsets_credit ON credit_offsets(credit_txn_id);
`

func InitSchema(db *sql.DB) error {
	if _, err := db.Exec(schemaSQL); err != nil {
		return err
	}
	for _, stmt := range []string{
		`ALTER TABLE transactions ADD COLUMN import_index INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE categories ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE categories ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE tags ADD COLUMN color TEXT NOT NULL DEFAULT '#94e2d5'`,
		`ALTER TABLE tags ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0`,
	} {
		if err := execAddColumn(db, stmt); err != nil {
			return err
		}
	}
	if _, err := db.Exec(`UPDATE transactions SET import_index = id WHERE import_index = 0`); err != nil {
		return err
	}
	if _, err := db.Exec(`UPDATE categories SET sort_order = id WHERE sort_order = 0`); err != nil {
		return err
	}
	if _, err := db.Exec(`UPDATE tags SET sort_order = id WHERE sort_order = 0`); err != nil {
		return err
	}
	for _, stmt := range []string{
		`CREATE INDEX IF NOT EXISTS idx_categories_sort_order ON categories(sort_order)`,
		`CREATE INDEX IF NOT EXISTS idx_tags_sort_order ON tags(sort_order)`,
	} {
		if _, err := db.Exec(stmt); err != nil {
			return err
		}
	}
	return nil
}

func execAddColumn(db *sql.DB, stmt string) error {
	if _, err := db.Exec(stmt); err != nil {
		const duplicateColumn = "duplicate column name"
		if !strings.Contains(strings.ToLower(err.Error()), duplicateColumn) {
			return err
		}
	}
	return nil
}
