/** OpenTUI schema. v11 adds provider transaction details (categorisable flag,
 * method, card, foreign amount, round-up, cashback). v10 added a per-account
 * sync switch. v9 added synced sources (Up Bank): external identity,
 * settlement status and raw provider fields. v8 replaced the old destructive
 * version fallback with an additive migration registry. v7 was the initial
 * partial OpenTUI port. */

export const SCHEMA_VERSION = 11

/** Columns shared by the fresh schema and the v9 migration. Rows imported from
 * CSV keep source = 'csv' and NULL external fields. */
export const ACCOUNT_SYNC_COLUMNS_LIST = [
  "source TEXT NOT NULL DEFAULT 'csv'",
  // Provider account id (Up: accounts.id). Unique per source when present.
  "external_id TEXT",
  // Provider account kind (Up: TRANSACTIONAL | SAVER | HOME_LOAN).
  "external_kind TEXT",
  // Provider balance in dollars and when it was read; NULL for CSV accounts.
  "balance REAL",
  "balance_at TEXT",
  // v10: 0 = the user switched sync off; the account and its transactions
  // are hidden and skipped by sync, but the row remembers the choice.
  "sync_enabled INTEGER NOT NULL DEFAULT 1",
] as const

export const TRANSACTION_SYNC_COLUMNS_LIST = [
  "source TEXT NOT NULL DEFAULT 'csv'",
  // Provider transaction id (Up: transactions.id); stable from HELD to SETTLED.
  "external_id TEXT",
  // 'HELD' | 'SETTLED' for synced rows, NULL for CSV rows.
  "status TEXT",
  // Provider timestamps, RFC 3339 with offset, verbatim.
  "external_created_at TEXT",
  "settled_at TEXT",
  "raw_text TEXT",
  "message TEXT",
  // Own-account transfer counterpart (Up: relationships.transferAccount).
  "transfer_account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL",
  // Provider classification, stored raw and not mapped to local categories.
  "ext_category TEXT",
  "ext_parent_category TEXT",
  "ext_tags TEXT NOT NULL DEFAULT '[]'",
] as const

/** v11: provider transaction details shown in the transaction detail view.
 * All NULL for CSV rows. */
export const TRANSACTION_DETAIL_COLUMNS_LIST = [
  // 1/0: the provider accepts a category for this transaction (Up:
  // isCategorizable; transfers and some payments are not).
  "ext_categorizable INTEGER",
  // e.g. "Purchase", "BPAY Payment", "Transfer".
  "transaction_type TEXT",
  // Card purchase method (e.g. "CARD_ON_FILE", "CONTACTLESS") and last 4 digits.
  "card_method TEXT",
  "card_suffix TEXT",
  // Foreign currency amount as "<currency> <value>", e.g. "USD -12.00".
  "foreign_amount TEXT",
  // Dollars: round-up taken with this purchase (negative) and cashback (positive).
  "round_up REAL",
  "cashback REAL",
] as const

const ACCOUNT_SYNC_COLUMNS = ACCOUNT_SYNC_COLUMNS_LIST.join(",\n  ")
const TRANSACTION_SYNC_COLUMNS = [...TRANSACTION_SYNC_COLUMNS_LIST, ...TRANSACTION_DETAIL_COLUMNS_LIST].join(",\n  ")

export const SYNC_SQL = `
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_external ON accounts(source, external_id) WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_external ON transactions(source, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(source, status);
CREATE TABLE IF NOT EXISTS sync_state (
  source          TEXT PRIMARY KEY,
  last_synced_at  TEXT,
  last_error      TEXT
);
`

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

CREATE TABLE IF NOT EXISTS rules_v2 (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  saved_filter_id TEXT NOT NULL,
  set_category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  add_tag_ids     TEXT NOT NULL DEFAULT '[]',
  sort_order      INTEGER NOT NULL DEFAULT 0,
  enabled         INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS accounts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  type       TEXT NOT NULL CHECK(type IN ('debit','credit')) DEFAULT 'debit',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active  INTEGER NOT NULL DEFAULT 1,
  ${ACCOUNT_SYNC_COLUMNS}
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
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  ${TRANSACTION_SYNC_COLUMNS}
);

CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date_iso);
CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_accounts_sort_order ON accounts(sort_order);
CREATE INDEX IF NOT EXISTS idx_tags_sort_order ON tags(sort_order);
CREATE INDEX IF NOT EXISTS idx_rules_v2_sort ON rules_v2(sort_order);
${SYNC_SQL}
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
