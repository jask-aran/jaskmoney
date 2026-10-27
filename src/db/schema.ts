/** OpenTUI schema. v17 lets the budget cycle start early on payday. v16 adds income categories. v15 adds budgets and the budget cycle. v14 let a category be excluded from spending. v13 linked local tags to provider tags. v12 added the category tree (parent, provider category id)
 * and who set each transaction's category. v11 added provider transaction details (categorisable flag,
 * method, card, foreign amount, round-up, cashback). v10 added a per-account
 * sync switch. v9 added synced sources (Up Bank): external identity,
 * settlement status and raw provider fields. v8 replaced the old destructive
 * version fallback with an additive migration registry. v7 was the initial
 * partial OpenTUI port. */

export const SCHEMA_VERSION = 26

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

/** v12: category tree. A provider category (Up: one of its 4 parents or 40
 * children) has ext_id; local-only categories have NULL ext_id. */
export const CATEGORY_TREE_COLUMNS_LIST = [
  "parent_id INTEGER REFERENCES categories(id) ON DELETE SET NULL",
  "ext_id TEXT",
] as const

/** v14: 1 = money in this category is not spending or income (e.g. transfers
 * to your own accounts elsewhere). The default Transfers category starts at 1. */
export const CATEGORY_NOT_SPENDING_COLUMN = "not_spending INTEGER NOT NULL DEFAULT 0"

/** v16: 1 = money in this category, or in one under it, is income. The local
 * Income group carries it; Salary, Interest and Other income sit under it. */
export const CATEGORY_INCOME_COLUMN = "income INTEGER NOT NULL DEFAULT 0"

/** v12: who set transactions.category_id. NULL = never set (falls back to the
 * provider's category on sync); 'provider' = mirrors the provider category
 * (sync keeps it in step); 'user' = chosen locally and not pushable (a local-only
 * category, or one Up rejected); 'pending' = chosen locally for the provider,
 * not yet confirmed by it (each Up sync pushes it again); 'rule' = set by a rule; 'type' (v16) = set from the provider's
 * transaction type (Up's Salary, Interest). Sync overwrites only NULL and
 * 'provider'. No CHECK: values are added without a migration. */
export const CATEGORY_SOURCE_COLUMN = "category_source TEXT"

/** v13: provider tag id (Up: the tag's name, which is its id). NULL = local
 * only (e.g. IGNORE, which never syncs). */
export const TAG_EXT_COLUMN = "ext_id TEXT"

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
const TRANSACTION_SYNC_COLUMNS = [...TRANSACTION_SYNC_COLUMNS_LIST, ...TRANSACTION_DETAIL_COLUMNS_LIST, CATEGORY_SOURCE_COLUMN].join(",\n  ")
const CATEGORY_TREE_COLUMNS = [...CATEGORY_TREE_COLUMNS_LIST, CATEGORY_NOT_SPENDING_COLUMN, CATEGORY_INCOME_COLUMN].join(",\n  ")

/** v17: 1 = a cycle starts early on the day pay arrives (see cycleFor). */
export const BUDGET_PAY_EARLY_COLUMN = "pay_early INTEGER NOT NULL DEFAULT 0"

/** v15: budgets (one per scope: overall, an account, or a category) and the
 * single budget cycle definition shared by all of them. */
export const BUDGET_SQL = `
CREATE TABLE IF NOT EXISTS budgets (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  scope_kind TEXT NOT NULL CHECK(scope_kind IN ('overall','account','category')),
  target_id  INTEGER,
  amount     REAL NOT NULL CHECK(amount >= 0),
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_budgets_scope ON budgets(scope_kind, COALESCE(target_id, 0));
CREATE TABLE IF NOT EXISTS budget_cycle (
  id          INTEGER PRIMARY KEY CHECK(id = 1),
  unit        TEXT NOT NULL CHECK(unit IN ('week','fortnight','month')),
  anchor      TEXT NOT NULL CHECK(anchor IN ('calendar','date','weekStartNearDate')),
  anchor_date TEXT
);
INSERT OR IGNORE INTO budget_cycle (id, unit, anchor, anchor_date) VALUES (1, 'month', 'calendar', NULL);
`

/** Category suggestions awaiting the user (v18; v19 took them from Jev, not Clef). */
const categorySuggestionsTable = (name: string) => `
CREATE TABLE IF NOT EXISTS ${name} (
  transaction_id INTEGER PRIMARY KEY REFERENCES transactions(id) ON DELETE CASCADE,
  category_id    INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  confidence     REAL NOT NULL,
  source         TEXT NOT NULL CHECK(source IN ('history','jev')),
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
`

export const CATEGORY_SUGGESTIONS_SQL = categorySuggestionsTable("category_suggestions")

/** v19: suggestions come from Jev. Clef's are dropped (asking again is cheap);
 * history's are kept. */
export const CATEGORY_SUGGESTIONS_V19_SQL = `
${categorySuggestionsTable("category_suggestions_v19")}
INSERT INTO category_suggestions_v19 SELECT * FROM category_suggestions WHERE source = 'history';
DROP TABLE category_suggestions;
ALTER TABLE category_suggestions_v19 RENAME TO category_suggestions;
`

/** v20: the categories a suggestion ranked, most likely first (JSON
 * [[category id, confidence], ...], the pick first); NULL for older ones. */
export const SUGGESTION_RANKED_COLUMN = "ranked TEXT"

/** v21: a tag's scope, a filter expression (no ask:) naming the rows it can
 * go on: the picker lists it first for them and tag suggestions look only
 * there. NULL = anywhere. Replaces tags.category_id (v21 converts each to
 * its cat: term and clears the column). Approved deviation from legacy
 * (Go: a tag's scope is one category), 2026-10-27. */
export const TAG_SCOPE_COLUMN = "scope TEXT"

/** v22: dismissals that last. A dismissed category suggestion stays, marked
 * (re-suggesting skips it); a dismissed tag candidate is remembered per tag
 * name (a tag being found may not exist yet). */
export const SUGGESTION_DISMISSED_COLUMN = "dismissed INTEGER NOT NULL DEFAULT 0"
export const TAG_DISMISSALS_SQL = `
CREATE TABLE IF NOT EXISTS tag_dismissals (
  tag_name       TEXT NOT NULL,
  transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  PRIMARY KEY (tag_name, transaction_id)
);
`

/** v23: how often you've put a description in a category (each accept or
 * choice adds the rows it categorised), which turns into a rule offer; and
 * offers you declined. Needed because a category Up confirms reads as
 * Up's own ('provider'). `description` is lower-case and trimmed. */
export const CATEGORY_CHOICES_SQL = `
CREATE TABLE IF NOT EXISTS category_choices (
  description TEXT NOT NULL,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  times       INTEGER NOT NULL DEFAULT 0,
  declined    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (description, category_id)
);
`

/** v24: what you (or a rule) did, when: each category set by accepting a
 * suggestion, choosing one, or a rule, and each tag added or removed by the
 * tag picker, a tag review, or a rule. Forward only (no times before v24).
 * The AI's history of a category or tag reads it (domain/aiHistory). */
export const ACTIVITY_LOG_SQL = `
CREATE TABLE IF NOT EXISTS category_log (
  id                   INTEGER PRIMARY KEY,
  transaction_id       INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  category_id          INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  previous_category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  how                  TEXT NOT NULL,
  at                   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS category_log_category ON category_log(category_id, at);
CREATE TABLE IF NOT EXISTS tag_log (
  id             INTEGER PRIMARY KEY,
  transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  tag_id         INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  added          INTEGER NOT NULL,
  how            TEXT NOT NULL,
  at             TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS tag_log_tag ON tag_log(tag_id, at);
`

/** v25: rules the AI proposed that you declined, so it isn't asked for them again. */
export const RULE_DECLINES_SQL = `
CREATE TABLE IF NOT EXISTS rule_declines (
  expr        TEXT NOT NULL,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (expr, category_id)
);
`

/** v26: local tag changes that Up has not confirmed; the latest action wins. */
export const TAG_PUSHES_SQL = `
CREATE TABLE IF NOT EXISTS tag_pushes (
  transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('add','remove')),
  PRIMARY KEY (transaction_id, tag_id)
);
`

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
  is_default  INTEGER NOT NULL DEFAULT 0,
  ${CATEGORY_TREE_COLUMNS}
);

CREATE TABLE IF NOT EXISTS tags (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  color       TEXT NOT NULL DEFAULT '#94e2d5',
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  ${TAG_EXT_COLUMN}
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
CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_ext ON categories(ext_id) WHERE ext_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_ext ON tags(ext_id) WHERE ext_id IS NOT NULL;
${BUDGET_SQL}
${CATEGORY_SUGGESTIONS_SQL}
ALTER TABLE budget_cycle ADD COLUMN ${BUDGET_PAY_EARLY_COLUMN};
ALTER TABLE category_suggestions ADD COLUMN ${SUGGESTION_RANKED_COLUMN};
ALTER TABLE tags ADD COLUMN ${TAG_SCOPE_COLUMN};
ALTER TABLE category_suggestions ADD COLUMN ${SUGGESTION_DISMISSED_COLUMN};
${TAG_DISMISSALS_SQL}
${CATEGORY_CHOICES_SQL}
${ACTIVITY_LOG_SQL}
${RULE_DECLINES_SQL}
${TAG_PUSHES_SQL}
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

/** The income group's categories, made under the local Income category. */
export const INCOME_CATEGORIES = [
  { name: "Salary", color: "#a6e3a1" },
  { name: "Interest", color: "#94e2d5" },
  { name: "Other income", color: "#f9e2af" },
] as const

export const MANDATORY_TAGS = [{ name: "IGNORE", color: "#f38ba8" }] as const
