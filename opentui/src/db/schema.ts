/** Schema v7 subset for MVP (from db.go schemaV7). */

export const SCHEMA_VERSION = 7

export const SCHEMA_SQL = `
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

CREATE TABLE IF NOT EXISTS imports (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  filename      TEXT NOT NULL,
  row_count     INTEGER NOT NULL,
  imported_at   TEXT NOT NULL DEFAULT (datetime('now'))
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

CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date_iso);
CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_accounts_sort_order ON accounts(sort_order);
CREATE INDEX IF NOT EXISTS idx_tags_sort_order ON tags(sort_order);
`

export const DEFAULT_CATEGORIES: { name: string; color: string; sortOrder: number; isDefault: number }[] = [
  { name: "Income", color: "#a6e3a1", sortOrder: 1, isDefault: 0 },
  { name: "Groceries", color: "#94e2d5", sortOrder: 2, isDefault: 0 },
  { name: "Dining & Drinks", color: "#fab387", sortOrder: 3, isDefault: 0 },
  { name: "Transport", color: "#89b4fa", sortOrder: 4, isDefault: 0 },
  { name: "Bills & Utilities", color: "#cba6f7", sortOrder: 5, isDefault: 0 },
  { name: "Entertainment", color: "#f5c2e7", sortOrder: 6, isDefault: 0 },
  { name: "Shopping", color: "#f2cdcd", sortOrder: 7, isDefault: 0 },
  { name: "Health", color: "#74c7ec", sortOrder: 8, isDefault: 0 },
  { name: "Transfers", color: "#b4befe", sortOrder: 9, isDefault: 0 },
  { name: "Uncategorised", color: "#7f849c", sortOrder: 10, isDefault: 1 },
]

export const MANDATORY_TAGS = [{ name: "IGNORE", color: "#f38ba8" }] as const
