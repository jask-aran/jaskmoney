package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	_ "modernc.org/sqlite"
)

// ---------------------------------------------------------------------------
// Schema version
// ---------------------------------------------------------------------------

const schemaVersion = 6
const mandatoryIgnoreTagName = "IGNORE"
const legacyRuleExprPrefix = "__legacy_expr__:"

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

const schemaV6 = `
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

CREATE TABLE IF NOT EXISTS category_budgets (
	id          INTEGER PRIMARY KEY AUTOINCREMENT,
	category_id INTEGER NOT NULL UNIQUE REFERENCES categories(id) ON DELETE CASCADE,
	amount      REAL NOT NULL DEFAULT 0,
	created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS category_budget_overrides (
	id        INTEGER PRIMARY KEY AUTOINCREMENT,
	budget_id INTEGER NOT NULL REFERENCES category_budgets(id) ON DELETE CASCADE,
	month_key TEXT NOT NULL,
	amount    REAL NOT NULL,
	UNIQUE(budget_id, month_key)
);

CREATE TABLE IF NOT EXISTS spending_targets (
	id          INTEGER PRIMARY KEY AUTOINCREMENT,
	name        TEXT NOT NULL,
	filter_expr TEXT NOT NULL,
	amount      REAL NOT NULL DEFAULT 0,
	period_type TEXT NOT NULL DEFAULT 'monthly'
	            CHECK(period_type IN ('monthly','quarterly','annual')),
	created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS spending_target_overrides (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	target_id  INTEGER NOT NULL REFERENCES spending_targets(id) ON DELETE CASCADE,
	period_key TEXT NOT NULL,
	amount     REAL NOT NULL,
	UNIQUE(target_id, period_key)
);

CREATE TABLE IF NOT EXISTS credit_offsets (
	id            INTEGER PRIMARY KEY AUTOINCREMENT,
	credit_txn_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
	debit_txn_id  INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
	amount        REAL NOT NULL CHECK(amount > 0),
	created_at    TEXT NOT NULL DEFAULT (datetime('now')),
	CHECK(credit_txn_id != debit_txn_id),
	UNIQUE(credit_txn_id, debit_txn_id)
);

CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date_iso);
CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_accounts_sort_order ON accounts(sort_order);
CREATE INDEX IF NOT EXISTS idx_tags_sort_order ON tags(sort_order);
CREATE INDEX IF NOT EXISTS idx_rules_v2_sort ON rules_v2(sort_order);
CREATE INDEX IF NOT EXISTS idx_category_budgets_cat ON category_budgets(category_id);
CREATE INDEX IF NOT EXISTS idx_credit_offsets_debit ON credit_offsets(debit_txn_id);
CREATE INDEX IF NOT EXISTS idx_credit_offsets_credit ON credit_offsets(credit_txn_id);
`

// ---------------------------------------------------------------------------
// Open / migrate
// ---------------------------------------------------------------------------

// openDB opens (or creates) the SQLite database and ensures the schema is
// at the current version. If the schema is outdated, it drops and recreates.
func openDB(path string) (*sql.DB, error) {
	if dir := filepath.Dir(path); dir != "." && dir != "" {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, fmt.Errorf("create db directory: %w", err)
		}
	}

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
	if err := normalizeExistingTagNames(db); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("normalize existing tags: %w", err)
	}
	if err := ensureFilterUsageStateTable(db); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("ensure filter usage state table: %w", err)
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
	if fromVersion == 5 {
		return migrateFromV5ToV6(db)
	}
	if fromVersion == 4 {
		if err := migrateFromV4ToV5(db); err != nil {
			return err
		}
		return migrateFromV5ToV6(db)
	}
	if fromVersion == 3 {
		if err := migrateFromV3ToV4(db); err != nil {
			return err
		}
		if err := migrateFromV4ToV5(db); err != nil {
			return err
		}
		return migrateFromV5ToV6(db)
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
	if _, err := db.Exec(`INSERT INTO schema_meta (version) VALUES (4)`); err != nil {
		return fmt.Errorf("set schema version: %w", err)
	}
	return nil
}

func migrateFromV4ToV5(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("begin v4->v5 migration: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	stmts := []string{
		"DROP TABLE IF EXISTS category_rules",
		"DROP TABLE IF EXISTS tag_rules",
		`CREATE TABLE IF NOT EXISTS rules_v2 (
			id              INTEGER PRIMARY KEY AUTOINCREMENT,
			name            TEXT NOT NULL,
			saved_filter_id TEXT NOT NULL,
			set_category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
			add_tag_ids     TEXT NOT NULL DEFAULT '[]',
			sort_order      INTEGER NOT NULL DEFAULT 0,
			enabled         INTEGER NOT NULL DEFAULT 1,
			created_at      TEXT NOT NULL DEFAULT (datetime('now'))
		)`,
		`CREATE TABLE IF NOT EXISTS category_budgets (
			id          INTEGER PRIMARY KEY AUTOINCREMENT,
			category_id INTEGER NOT NULL UNIQUE REFERENCES categories(id) ON DELETE CASCADE,
			amount      REAL NOT NULL DEFAULT 0,
			created_at  TEXT NOT NULL DEFAULT (datetime('now'))
		)`,
		`CREATE TABLE IF NOT EXISTS category_budget_overrides (
			id        INTEGER PRIMARY KEY AUTOINCREMENT,
			budget_id INTEGER NOT NULL REFERENCES category_budgets(id) ON DELETE CASCADE,
			month_key TEXT NOT NULL,
			amount    REAL NOT NULL,
			UNIQUE(budget_id, month_key)
		)`,
		`CREATE TABLE IF NOT EXISTS spending_targets (
			id          INTEGER PRIMARY KEY AUTOINCREMENT,
			name        TEXT NOT NULL,
			filter_expr TEXT NOT NULL,
			amount      REAL NOT NULL DEFAULT 0,
			period_type TEXT NOT NULL DEFAULT 'monthly'
			            CHECK(period_type IN ('monthly','quarterly','annual')),
			created_at  TEXT NOT NULL DEFAULT (datetime('now'))
		)`,
		`CREATE TABLE IF NOT EXISTS spending_target_overrides (
			id         INTEGER PRIMARY KEY AUTOINCREMENT,
			target_id  INTEGER NOT NULL REFERENCES spending_targets(id) ON DELETE CASCADE,
			period_key TEXT NOT NULL,
			amount     REAL NOT NULL,
			UNIQUE(target_id, period_key)
		)`,
		`CREATE TABLE IF NOT EXISTS credit_offsets (
			id            INTEGER PRIMARY KEY AUTOINCREMENT,
			credit_txn_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
			debit_txn_id  INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
			amount        REAL NOT NULL CHECK(amount > 0),
			created_at    TEXT NOT NULL DEFAULT (datetime('now')),
			CHECK(credit_txn_id != debit_txn_id),
			UNIQUE(credit_txn_id, debit_txn_id)
		)`,
		`INSERT INTO category_budgets (category_id, amount)
		 SELECT c.id, 0
		 FROM categories c
		 WHERE NOT EXISTS (
			SELECT 1 FROM category_budgets b WHERE b.category_id = c.id
		 )`,
		`CREATE INDEX IF NOT EXISTS idx_rules_v2_sort ON rules_v2(sort_order)`,
		`CREATE INDEX IF NOT EXISTS idx_category_budgets_cat ON category_budgets(category_id)`,
		`CREATE INDEX IF NOT EXISTS idx_credit_offsets_debit ON credit_offsets(debit_txn_id)`,
		`CREATE INDEX IF NOT EXISTS idx_credit_offsets_credit ON credit_offsets(credit_txn_id)`,
		`DELETE FROM schema_meta`,
		`INSERT INTO schema_meta (version) VALUES (5)`,
	}
	for _, stmt := range stmts {
		if _, err := tx.Exec(stmt); err != nil {
			return fmt.Errorf("migrate v4->v5 statement failed: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit v4->v5 migration: %w", err)
	}
	return nil
}

func migrateFromV5ToV6(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("begin v5->v6 migration: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	stmts := []string{
		"DROP TABLE IF EXISTS rules_v2",
		`CREATE TABLE IF NOT EXISTS rules_v2 (
			id              INTEGER PRIMARY KEY AUTOINCREMENT,
			name            TEXT NOT NULL,
			saved_filter_id TEXT NOT NULL,
			set_category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
			add_tag_ids     TEXT NOT NULL DEFAULT '[]',
			sort_order      INTEGER NOT NULL DEFAULT 0,
			enabled         INTEGER NOT NULL DEFAULT 1,
			created_at      TEXT NOT NULL DEFAULT (datetime('now'))
		)`,
		`CREATE INDEX IF NOT EXISTS idx_rules_v2_sort ON rules_v2(sort_order)`,
		`DELETE FROM schema_meta`,
		`INSERT INTO schema_meta (version) VALUES (6)`,
	}
	for _, stmt := range stmts {
		if _, err := tx.Exec(stmt); err != nil {
			return fmt.Errorf("migrate v5->v6 statement failed: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit v5->v6 migration: %w", err)
	}
	return nil
}

// migrateClean drops everything and starts fresh at schema v6.
func migrateClean(db *sql.DB) error {
	drops := []string{
		"DROP TABLE IF EXISTS credit_offsets",
		"DROP TABLE IF EXISTS spending_target_overrides",
		"DROP TABLE IF EXISTS spending_targets",
		"DROP TABLE IF EXISTS category_budget_overrides",
		"DROP TABLE IF EXISTS category_budgets",
		"DROP TABLE IF EXISTS rules_v2",
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
	if _, err := db.Exec(schemaV6); err != nil {
		return fmt.Errorf("create v6 schema: %w", err)
	}
	if err := seedDefaultCategories(db); err != nil {
		return fmt.Errorf("seed categories: %w", err)
	}
	if _, err := db.Exec(`INSERT INTO category_budgets (category_id, amount)
		SELECT id, 0 FROM categories
		WHERE NOT EXISTS (
			SELECT 1 FROM category_budgets b WHERE b.category_id = categories.id
		)`); err != nil {
		return fmt.Errorf("seed zero budgets: %w", err)
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

func normalizeTagName(name string) string {
	return strings.ToUpper(strings.TrimSpace(name))
}

func normalizeExistingTagNames(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("begin normalize tags: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	rows, err := tx.Query(`
		SELECT id, name
		FROM tags
		ORDER BY sort_order ASC, id ASC
	`)
	if err != nil {
		return fmt.Errorf("query tags for normalization: %w", err)
	}
	defer rows.Close()

	type rowTag struct {
		id   int
		name string
	}
	var tags []rowTag
	for rows.Next() {
		var t rowTag
		if err := rows.Scan(&t.id, &t.name); err != nil {
			return fmt.Errorf("scan tag for normalization: %w", err)
		}
		tags = append(tags, t)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate tags for normalization: %w", err)
	}

	keepers := make(map[string]int)
	hasLegacyTagRules := false
	var count int
	if err := tx.QueryRow(`
		SELECT COUNT(*) FROM sqlite_master
		WHERE type='table' AND name='tag_rules'
	`).Scan(&count); err == nil && count > 0 {
		hasLegacyTagRules = true
	}

	for _, tg := range tags {
		normalized := normalizeTagName(tg.name)
		if normalized == "" {
			continue
		}
		if _, ok := keepers[normalized]; ok {
			continue
		}
		keepers[normalized] = tg.id
	}

	for _, tg := range tags {
		normalized := normalizeTagName(tg.name)
		if normalized == "" {
			continue
		}
		keeperID, ok := keepers[normalized]
		if !ok {
			continue
		}
		if tg.id == keeperID {
			continue
		}
		if _, err := tx.Exec(`
			INSERT INTO transaction_tags (transaction_id, tag_id)
			SELECT transaction_id, ?
			FROM transaction_tags
			WHERE tag_id = ?
			ON CONFLICT(transaction_id, tag_id) DO NOTHING
		`, keeperID, tg.id); err != nil {
			return fmt.Errorf("merge transaction tags %d->%d: %w", tg.id, keeperID, err)
		}
		if _, err := tx.Exec(`DELETE FROM transaction_tags WHERE tag_id = ?`, tg.id); err != nil {
			return fmt.Errorf("delete duplicate transaction tags for %d: %w", tg.id, err)
		}
		if hasLegacyTagRules {
			if _, err := tx.Exec(`UPDATE tag_rules SET tag_id = ? WHERE tag_id = ?`, keeperID, tg.id); err != nil {
				return fmt.Errorf("merge tag rules %d->%d: %w", tg.id, keeperID, err)
			}
		}
		if err := rewriteRulesV2TagIDsTx(tx, tg.id, keeperID); err != nil {
			return err
		}
		if _, err := tx.Exec(`DELETE FROM tags WHERE id = ?`, tg.id); err != nil {
			return fmt.Errorf("delete duplicate tag %d: %w", tg.id, err)
		}
	}

	for _, tg := range tags {
		normalized := normalizeTagName(tg.name)
		if normalized == "" {
			continue
		}
		keeperID, ok := keepers[normalized]
		if !ok || tg.id != keeperID {
			continue
		}
		if tg.name == normalized {
			continue
		}
		if _, err := tx.Exec(`UPDATE tags SET name = ? WHERE id = ?`, normalized, tg.id); err != nil {
			return fmt.Errorf("normalize tag %d name: %w", tg.id, err)
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit normalize tags: %w", err)
	}
	return nil
}

func rewriteRulesV2TagIDsTx(tx *sql.Tx, oldID, newID int) error {
	if oldID <= 0 || newID <= 0 || oldID == newID {
		return nil
	}
	rows, err := tx.Query(`SELECT id, add_tag_ids FROM rules_v2`)
	if err != nil {
		// rules_v2 may not exist in legacy migration paths.
		return nil
	}
	defer rows.Close()

	type ruleRow struct {
		id      int
		addJSON string
	}
	var all []ruleRow
	for rows.Next() {
		var rr ruleRow
		if err := rows.Scan(&rr.id, &rr.addJSON); err != nil {
			return fmt.Errorf("scan rules_v2 for tag rewrite: %w", err)
		}
		all = append(all, rr)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for _, rr := range all {
		add, err := decodeRuleTagIDs(rr.addJSON)
		if err != nil {
			return err
		}
		changed := false
		for i, id := range add {
			if id == oldID {
				add[i] = newID
				changed = true
			}
		}
		if !changed {
			continue
		}
		if _, err := tx.Exec(`UPDATE rules_v2 SET add_tag_ids = ? WHERE id = ?`, encodeRuleTagIDs(add), rr.id); err != nil {
			return fmt.Errorf("rewrite rules_v2 tags for rule %d: %w", rr.id, err)
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
// Rules v2 types and queries
// ---------------------------------------------------------------------------

type ruleV2 struct {
	id            int
	name          string
	savedFilterID string
	setCategoryID *int
	addTagIDs     []int
	sortOrder     int
	enabled       bool
}

type dryRunRuleResult struct {
	rule       ruleV2
	filterExpr string
	filterName string
	matchCount int
	catChanges int
	tagChanges int
	samples    []dryRunSample
}

type dryRunSample struct {
	txn        transaction
	currentCat string
	newCat     string
	addedTags  []string
}

type dryRunSummary struct {
	totalModified  int
	totalCatChange int
	totalTagChange int
	failedRules    int
}

type resolvedRuleV2 struct {
	rule       ruleV2
	filterExpr string
	filterName string
	parsed     *filterNode
}

type ruleResolutionFailure struct {
	rule   ruleV2
	reason string
}

func decodeRuleTagIDs(raw string) ([]int, error) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return nil, nil
	}
	var ids []int
	if err := json.Unmarshal([]byte(s), &ids); err != nil {
		return nil, fmt.Errorf("decode tag id list %q: %w", raw, err)
	}
	return ids, nil
}

func encodeRuleTagIDs(ids []int) string {
	if len(ids) == 0 {
		return "[]"
	}
	uniq := make(map[int]bool, len(ids))
	out := make([]int, 0, len(ids))
	for _, id := range ids {
		if id <= 0 || uniq[id] {
			continue
		}
		uniq[id] = true
		out = append(out, id)
	}
	sort.Ints(out)
	b, err := json.Marshal(out)
	if err != nil {
		return "[]"
	}
	return string(b)
}

func parseRuleNode(expr string) (*filterNode, error) {
	parsed, err := parseFilterStrict(strings.TrimSpace(expr))
	if err != nil {
		return nil, fmt.Errorf("parse rule filter: %w", err)
	}
	if parsed == nil {
		return nil, fmt.Errorf("filter expression is required")
	}
	return parsed, nil
}

func normalizeRuleFilterID(id string) string {
	return strings.ToLower(strings.TrimSpace(id))
}

func savedFilterMapByID(savedFilters []savedFilter) map[string]savedFilter {
	out := make(map[string]savedFilter, len(savedFilters))
	for _, sf := range savedFilters {
		id := normalizeRuleFilterID(sf.ID)
		if id == "" {
			continue
		}
		out[id] = sf
	}
	return out
}

func resolveRuleV2Filter(rule ruleV2, filterMap map[string]savedFilter) (expr string, name string, parsed *filterNode, err error) {
	filterID := strings.TrimSpace(rule.savedFilterID)
	if strings.HasPrefix(filterID, legacyRuleExprPrefix) {
		expr = strings.TrimSpace(strings.TrimPrefix(filterID, legacyRuleExprPrefix))
		if expr == "" {
			return "", "", nil, fmt.Errorf("legacy filter expression is empty")
		}
		parsed, err = parseRuleNode(expr)
		if err != nil {
			return "", "", nil, err
		}
		return filterExprString(parsed), "", parsed, nil
	}

	key := normalizeRuleFilterID(filterID)
	if key == "" {
		return "", "", nil, fmt.Errorf("saved filter id is required")
	}
	sf, ok := filterMap[key]
	if !ok {
		return "", "", nil, fmt.Errorf("saved filter %q not found", filterID)
	}
	parsed, err = parseRuleNode(strings.TrimSpace(sf.Expr))
	if err != nil {
		return "", "", nil, fmt.Errorf("saved filter %q invalid: %w", strings.TrimSpace(sf.ID), err)
	}
	return filterExprString(parsed), strings.TrimSpace(sf.Name), parsed, nil
}

func resolveRulesV2(rules []ruleV2, savedFilters []savedFilter) ([]resolvedRuleV2, []ruleResolutionFailure) {
	ordered := append([]ruleV2(nil), rules...)
	sort.SliceStable(ordered, func(i, j int) bool {
		if ordered[i].sortOrder != ordered[j].sortOrder {
			return ordered[i].sortOrder < ordered[j].sortOrder
		}
		return ordered[i].id < ordered[j].id
	})

	filterMap := savedFilterMapByID(savedFilters)
	resolved := make([]resolvedRuleV2, 0, len(ordered))
	failed := make([]ruleResolutionFailure, 0)
	for _, rule := range ordered {
		if !rule.enabled {
			continue
		}
		expr, name, parsed, err := resolveRuleV2Filter(rule, filterMap)
		if err != nil {
			failed = append(failed, ruleResolutionFailure{rule: rule, reason: err.Error()})
			continue
		}
		resolved = append(resolved, resolvedRuleV2{
			rule:       rule,
			filterExpr: expr,
			filterName: name,
			parsed:     parsed,
		})
	}
	return resolved, failed
}

func loadRulesV2(db *sql.DB) ([]ruleV2, error) {
	rows, err := db.Query(`
		SELECT id, name, saved_filter_id, set_category_id, add_tag_ids, sort_order, enabled
		FROM rules_v2
		ORDER BY sort_order ASC, id ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("query rules_v2: %w", err)
	}
	defer rows.Close()

	out := make([]ruleV2, 0)
	for rows.Next() {
		var r ruleV2
		var addJSON string
		var enabledInt int
		if err := rows.Scan(&r.id, &r.name, &r.savedFilterID, &r.setCategoryID, &addJSON, &r.sortOrder, &enabledInt); err != nil {
			return nil, fmt.Errorf("scan rules_v2: %w", err)
		}
		r.enabled = enabledInt == 1
		r.addTagIDs, err = decodeRuleTagIDs(addJSON)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

func nextRuleSortOrder(db *sql.DB) (int, error) {
	var maxOrder int
	if err := db.QueryRow(`SELECT COALESCE(MAX(sort_order), -1) FROM rules_v2`).Scan(&maxOrder); err != nil {
		return 0, fmt.Errorf("query max rule sort order: %w", err)
	}
	return maxOrder + 1, nil
}

func insertRuleV2(db *sql.DB, r ruleV2) (int, error) {
	if strings.TrimSpace(r.name) == "" {
		return 0, fmt.Errorf("rule name is required")
	}
	if strings.TrimSpace(r.savedFilterID) == "" {
		return 0, fmt.Errorf("saved filter id is required")
	}
	sortOrder := r.sortOrder
	var err error
	if sortOrder < 0 {
		sortOrder = 0
	}
	if sortOrder == 0 {
		sortOrder, err = nextRuleSortOrder(db)
		if err != nil {
			return 0, err
		}
	}
	enabled := 0
	if r.enabled {
		enabled = 1
	}
	res, err := db.Exec(`
		INSERT INTO rules_v2 (name, saved_filter_id, set_category_id, add_tag_ids, sort_order, enabled)
		VALUES (?, ?, ?, ?, ?, ?)
	`, strings.TrimSpace(r.name), strings.TrimSpace(r.savedFilterID), r.setCategoryID, encodeRuleTagIDs(r.addTagIDs), sortOrder, enabled)
	if err != nil {
		return 0, fmt.Errorf("insert rule_v2: %w", err)
	}
	lastID, err := res.LastInsertId()
	if err != nil {
		return 0, fmt.Errorf("rule_v2 last insert id: %w", err)
	}
	return int(lastID), nil
}

func updateRuleV2(db *sql.DB, r ruleV2) error {
	if r.id <= 0 {
		return fmt.Errorf("rule id is required")
	}
	if strings.TrimSpace(r.name) == "" {
		return fmt.Errorf("rule name is required")
	}
	if strings.TrimSpace(r.savedFilterID) == "" {
		return fmt.Errorf("saved filter id is required")
	}
	enabled := 0
	if r.enabled {
		enabled = 1
	}
	_, err := db.Exec(`
		UPDATE rules_v2
		SET name = ?, saved_filter_id = ?, set_category_id = ?, add_tag_ids = ?, sort_order = ?, enabled = ?
		WHERE id = ?
	`, strings.TrimSpace(r.name), strings.TrimSpace(r.savedFilterID), r.setCategoryID, encodeRuleTagIDs(r.addTagIDs), r.sortOrder, enabled, r.id)
	if err != nil {
		return fmt.Errorf("update rule_v2: %w", err)
	}
	return nil
}

func deleteRuleV2(db *sql.DB, id int) error {
	if id <= 0 {
		return fmt.Errorf("rule id is required")
	}
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("begin delete rule_v2: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	if _, err := tx.Exec(`DELETE FROM rules_v2 WHERE id = ?`, id); err != nil {
		return fmt.Errorf("delete rule_v2: %w", err)
	}
	if err := normalizeRuleSortOrderTx(tx); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit delete rule_v2: %w", err)
	}
	return nil
}

func normalizeRuleSortOrderTx(tx *sql.Tx) error {
	rows, err := tx.Query(`SELECT id FROM rules_v2 ORDER BY sort_order ASC, id ASC`)
	if err != nil {
		return fmt.Errorf("query rules for reorder normalization: %w", err)
	}
	defer rows.Close()
	ids := make([]int, 0)
	for rows.Next() {
		var id int
		if err := rows.Scan(&id); err != nil {
			return fmt.Errorf("scan rule id: %w", err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for i, id := range ids {
		if _, err := tx.Exec(`UPDATE rules_v2 SET sort_order = ? WHERE id = ?`, i, id); err != nil {
			return fmt.Errorf("update sort order for rule %d: %w", id, err)
		}
	}
	return nil
}

func reorderRuleV2(db *sql.DB, id, newSortOrder int) error {
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("begin reorder rule_v2: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	rows, err := tx.Query(`SELECT id FROM rules_v2 ORDER BY sort_order ASC, id ASC`)
	if err != nil {
		return fmt.Errorf("query rules for reorder: %w", err)
	}
	defer rows.Close()

	ids := make([]int, 0)
	currentIdx := -1
	for rows.Next() {
		var rid int
		if err := rows.Scan(&rid); err != nil {
			return fmt.Errorf("scan rule id for reorder: %w", err)
		}
		if rid == id {
			currentIdx = len(ids)
		}
		ids = append(ids, rid)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if currentIdx == -1 {
		return fmt.Errorf("rule %d not found", id)
	}
	if len(ids) <= 1 {
		return nil
	}
	if newSortOrder < 0 {
		newSortOrder = 0
	}
	if newSortOrder >= len(ids) {
		newSortOrder = len(ids) - 1
	}
	if currentIdx == newSortOrder {
		return nil
	}

	ordered := make([]int, 0, len(ids))
	for i, rid := range ids {
		if i == currentIdx {
			continue
		}
		ordered = append(ordered, rid)
	}
	head := append([]int{}, ordered[:newSortOrder]...)
	tail := append([]int{}, ordered[newSortOrder:]...)
	ordered = append(head, id)
	ordered = append(ordered, tail...)

	for i, rid := range ordered {
		if _, err := tx.Exec(`UPDATE rules_v2 SET sort_order = ? WHERE id = ?`, i, rid); err != nil {
			return fmt.Errorf("update reordered rule %d: %w", rid, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit reorder rule_v2: %w", err)
	}
	return nil
}

func toggleRuleV2Enabled(db *sql.DB, id int, enabled bool) error {
	enabledInt := 0
	if enabled {
		enabledInt = 1
	}
	if _, err := db.Exec(`UPDATE rules_v2 SET enabled = ? WHERE id = ?`, enabledInt, id); err != nil {
		return fmt.Errorf("toggle rule_v2 enabled: %w", err)
	}
	return nil
}

// Compatibility type for legacy tests and helpers.
type categoryRule struct {
	id         int
	pattern    string
	categoryID int
	priority   int
}

func legacyPatternExpr(pattern string) string {
	trimmed := strings.TrimSpace(pattern)
	if trimmed == "" {
		return ""
	}
	quoted := strings.ReplaceAll(trimmed, `\`, `\\`)
	quoted = strings.ReplaceAll(quoted, `"`, `\"`)
	return fmt.Sprintf("desc:\"%s\"", quoted)
}

func loadCategoryRules(db *sql.DB) ([]categoryRule, error) {
	rules, err := loadRulesV2(db)
	if err != nil {
		return nil, err
	}
	out := make([]categoryRule, 0, len(rules))
	for _, r := range rules {
		if r.setCategoryID == nil {
			continue
		}
		if len(r.addTagIDs) > 0 {
			continue
		}
		if !strings.HasPrefix(strings.TrimSpace(r.savedFilterID), legacyRuleExprPrefix) {
			continue
		}
		out = append(out, categoryRule{
			id:         r.id,
			pattern:    legacyPatternFromExpr(strings.TrimSpace(strings.TrimPrefix(r.savedFilterID, legacyRuleExprPrefix))),
			categoryID: *r.setCategoryID,
			priority:   r.sortOrder,
		})
	}
	return out, nil
}

func legacyPatternFromExpr(expr string) string {
	trimmed := strings.TrimSpace(expr)
	if !strings.HasPrefix(trimmed, `desc:"`) || !strings.HasSuffix(trimmed, `"`) {
		return trimmed
	}
	raw := strings.TrimSuffix(strings.TrimPrefix(trimmed, `desc:"`), `"`)
	raw = strings.ReplaceAll(raw, `\"`, `"`)
	raw = strings.ReplaceAll(raw, `\\`, `\`)
	return raw
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

func loadRowsForAccountScope(db *sql.DB, accountFilter map[int]bool) ([]transaction, error) {
	if len(accountFilter) == 0 {
		return loadRows(db)
	}
	ids := make([]int, 0, len(accountFilter))
	for id, on := range accountFilter {
		if on {
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 {
		return nil, nil
	}
	sort.Ints(ids)
	placeholders := make([]string, 0, len(ids))
	args := make([]any, 0, len(ids))
	for _, id := range ids {
		placeholders = append(placeholders, "?")
		args = append(args, id)
	}
	query := fmt.Sprintf(`
		SELECT t.id, t.date_raw, t.date_iso, t.amount, t.description,
		       t.category_id, COALESCE(c.name, 'Uncategorised'), COALESCE(c.color, '#7f849c'),
		       t.notes, t.account_id, COALESCE(a.name, ''), COALESCE(a.type, '')
		FROM transactions t
		LEFT JOIN categories c ON t.category_id = c.id
		LEFT JOIN accounts a ON t.account_id = a.id
		WHERE t.account_id IN (%s)
		ORDER BY t.date_iso DESC, t.id DESC
	`, strings.Join(placeholders, ","))
	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("query scoped transactions: %w", err)
	}
	defer rows.Close()
	var out []transaction
	for rows.Next() {
		var t transaction
		if err := rows.Scan(&t.id, &t.dateRaw, &t.dateISO, &t.amount, &t.description,
			&t.categoryID, &t.categoryName, &t.categoryColor, &t.notes, &t.accountID, &t.accountName, &t.accountType); err != nil {
			return nil, fmt.Errorf("scan scoped transaction: %w", err)
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func loadRowsByTxnIDs(db *sql.DB, txnIDs []int) ([]transaction, error) {
	if len(txnIDs) == 0 {
		return nil, nil
	}
	ids := append([]int(nil), txnIDs...)
	sort.Ints(ids)
	placeholders := make([]string, 0, len(ids))
	args := make([]any, 0, len(ids))
	for _, id := range ids {
		placeholders = append(placeholders, "?")
		args = append(args, id)
	}
	query := fmt.Sprintf(`
		SELECT t.id, t.date_raw, t.date_iso, t.amount, t.description,
		       t.category_id, COALESCE(c.name, 'Uncategorised'), COALESCE(c.color, '#7f849c'),
		       t.notes, t.account_id, COALESCE(a.name, ''), COALESCE(a.type, '')
		FROM transactions t
		LEFT JOIN categories c ON t.category_id = c.id
		LEFT JOIN accounts a ON t.account_id = a.id
		WHERE t.id IN (%s)
		ORDER BY t.date_iso DESC, t.id DESC
	`, strings.Join(placeholders, ","))
	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("query transactions by ids: %w", err)
	}
	defer rows.Close()
	var out []transaction
	for rows.Next() {
		var t transaction
		if err := rows.Scan(&t.id, &t.dateRaw, &t.dateISO, &t.amount, &t.description,
			&t.categoryID, &t.categoryName, &t.categoryColor, &t.notes, &t.accountID, &t.accountName, &t.accountType); err != nil {
			return nil, fmt.Errorf("scan transaction by id: %w", err)
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func intPtrEqual(a, b *int) bool {
	if a == nil && b == nil {
		return true
	}
	if a == nil || b == nil {
		return false
	}
	return *a == *b
}

func copyIntPtr(v *int) *int {
	if v == nil {
		return nil
	}
	c := *v
	return &c
}

func tagIDSet(tags []tag) map[int]bool {
	out := make(map[int]bool, len(tags))
	for _, tg := range tags {
		out[tg.id] = true
	}
	return out
}

func tagStateToSlice(state map[int]bool, byID map[int]tag) []tag {
	if len(state) == 0 {
		return nil
	}
	ids := make([]int, 0, len(state))
	for id, on := range state {
		if on {
			ids = append(ids, id)
		}
	}
	sort.Ints(ids)
	out := make([]tag, 0, len(ids))
	for _, id := range ids {
		if tg, ok := byID[id]; ok {
			out = append(out, tg)
		}
	}
	return out
}

func diffTagSets(before, after map[int]bool) (added []int, removed []int) {
	for id, on := range after {
		if on && !before[id] {
			added = append(added, id)
		}
	}
	for id, on := range before {
		if on && !after[id] {
			removed = append(removed, id)
		}
	}
	sort.Ints(added)
	sort.Ints(removed)
	return added, removed
}

func categoryNameByID(categories []category) map[int]string {
	out := make(map[int]string, len(categories))
	for _, cat := range categories {
		out[cat.id] = cat.name
	}
	return out
}

func tagByIDMap(tags []tag) map[int]tag {
	out := make(map[int]tag, len(tags))
	for _, tg := range tags {
		out[tg.id] = tg
	}
	return out
}

func categoryNameForPtr(id *int, names map[int]string) string {
	if id == nil {
		return "Uncategorised"
	}
	if name, ok := names[*id]; ok && strings.TrimSpace(name) != "" {
		return name
	}
	return fmt.Sprintf("Category %d", *id)
}

func applyResolvedRulesV2ToRows(db *sql.DB, rules []resolvedRuleV2, txnTags map[int][]tag, rows []transaction) (updatedTxns, catChanges, tagChanges int, err error) {
	if len(rows) == 0 || len(rules) == 0 {
		return 0, 0, 0, nil
	}
	categories, err := loadCategories(db)
	if err != nil {
		return 0, 0, 0, err
	}
	tags, err := loadTags(db)
	if err != nil {
		return 0, 0, 0, err
	}
	catNames := categoryNameByID(categories)
	tagByID := tagByIDMap(tags)

	tx, err := db.Begin()
	if err != nil {
		return 0, 0, 0, fmt.Errorf("begin apply rules_v2: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	for _, row := range rows {
		currentCat := copyIntPtr(row.categoryID)
		currentTagSet := tagIDSet(txnTags[row.id])
		workCat := copyIntPtr(currentCat)
		workTagSet := make(map[int]bool, len(currentTagSet))
		for id, on := range currentTagSet {
			workTagSet[id] = on
		}

		workTxn := row
		workTxn.categoryID = copyIntPtr(workCat)
		workTxn.categoryName = categoryNameForPtr(workCat, catNames)

		for _, rule := range rules {
			if rule.parsed == nil {
				continue
			}
			if !evalFilter(rule.parsed, workTxn, tagStateToSlice(workTagSet, tagByID)) {
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

		rowUpdated := false
		if !intPtrEqual(currentCat, workCat) {
			if _, err := tx.Exec(`UPDATE transactions SET category_id = ? WHERE id = ?`, workCat, row.id); err != nil {
				return 0, 0, 0, fmt.Errorf("update txn %d category: %w", row.id, err)
			}
			catChanges++
			rowUpdated = true
		}
		added, removed := diffTagSets(currentTagSet, workTagSet)
		for _, tagID := range added {
			res, execErr := tx.Exec(`
				INSERT INTO transaction_tags (transaction_id, tag_id)
				VALUES (?, ?)
				ON CONFLICT(transaction_id, tag_id) DO NOTHING
			`, row.id, tagID)
			if execErr != nil {
				return 0, 0, 0, fmt.Errorf("add tag %d to txn %d: %w", tagID, row.id, execErr)
			}
			n, _ := res.RowsAffected()
			if n > 0 {
				tagChanges += int(n)
				rowUpdated = true
			}
		}
		for _, tagID := range removed {
			res, execErr := tx.Exec(`
				DELETE FROM transaction_tags
				WHERE transaction_id = ? AND tag_id = ?
			`, row.id, tagID)
			if execErr != nil {
				return 0, 0, 0, fmt.Errorf("remove tag %d from txn %d: %w", tagID, row.id, execErr)
			}
			n, _ := res.RowsAffected()
			if n > 0 {
				tagChanges += int(n)
				rowUpdated = true
			}
		}
		if rowUpdated {
			updatedTxns++
		}
	}

	if err := tx.Commit(); err != nil {
		return 0, 0, 0, fmt.Errorf("commit apply rules_v2: %w", err)
	}
	return updatedTxns, catChanges, tagChanges, nil
}

func applyRulesV2ToScope(db *sql.DB, rules []ruleV2, txnTags map[int][]tag, accountFilter map[int]bool, savedFilters []savedFilter) (updatedTxns, catChanges, tagChanges, failedRules int, err error) {
	rows, err := loadRowsForAccountScope(db, accountFilter)
	if err != nil {
		return 0, 0, 0, 0, err
	}
	resolvedRules, failed := resolveRulesV2(rules, savedFilters)
	updatedTxns, catChanges, tagChanges, err = applyResolvedRulesV2ToRows(db, resolvedRules, txnTags, rows)
	if err != nil {
		return 0, 0, 0, len(failed), err
	}
	return updatedTxns, catChanges, tagChanges, len(failed), nil
}

func applyRulesV2ToTxnIDs(db *sql.DB, rules []ruleV2, txnTags map[int][]tag, txnIDs []int, savedFilters []savedFilter) (updatedTxns, catChanges, tagChanges, failedRules int, err error) {
	rows, err := loadRowsByTxnIDs(db, txnIDs)
	if err != nil {
		return 0, 0, 0, 0, err
	}
	resolvedRules, failed := resolveRulesV2(rules, savedFilters)
	updatedTxns, catChanges, tagChanges, err = applyResolvedRulesV2ToRows(db, resolvedRules, txnTags, rows)
	if err != nil {
		return 0, 0, 0, len(failed), err
	}
	return updatedTxns, catChanges, tagChanges, len(failed), nil
}

func dryRunRulesV2(db *sql.DB, rules []ruleV2, rows []transaction, txnTags map[int][]tag, savedFilters []savedFilter) ([]dryRunRuleResult, dryRunSummary) {
	if len(rows) == 0 || len(rules) == 0 {
		return nil, dryRunSummary{}
	}
	resolvedRules, failed := resolveRulesV2(rules, savedFilters)
	categories, _ := loadCategories(db)
	tags, _ := loadTags(db)
	catNames := categoryNameByID(categories)
	tagByID := tagByIDMap(tags)

	results := make([]dryRunRuleResult, len(resolvedRules))
	for i, r := range resolvedRules {
		results[i].rule = r.rule
		results[i].filterExpr = r.filterExpr
		results[i].filterName = r.filterName
	}

	summary := dryRunSummary{failedRules: len(failed)}
	for _, row := range rows {
		currentCat := copyIntPtr(row.categoryID)
		currentTagSet := tagIDSet(txnTags[row.id])
		workCat := copyIntPtr(currentCat)
		workTagSet := make(map[int]bool, len(currentTagSet))
		for id, on := range currentTagSet {
			workTagSet[id] = on
		}

		workTxn := row
		workTxn.categoryID = copyIntPtr(workCat)
		workTxn.categoryName = categoryNameForPtr(workCat, catNames)

		for i, rule := range resolvedRules {
			if rule.parsed == nil || !evalFilter(rule.parsed, workTxn, tagStateToSlice(workTagSet, tagByID)) {
				continue
			}
			results[i].matchCount++

			beforeCat := copyIntPtr(workCat)
			beforeTags := make(map[int]bool, len(workTagSet))
			for id, on := range workTagSet {
				beforeTags[id] = on
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

			catChanged := !intPtrEqual(beforeCat, workCat)
			if catChanged {
				results[i].catChanges++
			}
			added, _ := diffTagSets(beforeTags, workTagSet)
			results[i].tagChanges += len(added)

			if len(results[i].samples) < 3 && (catChanged || len(added) > 0) {
				addedNames := make([]string, 0, len(added))
				for _, id := range added {
					if tg, ok := tagByID[id]; ok {
						addedNames = append(addedNames, tg.name)
					}
				}
				results[i].samples = append(results[i].samples, dryRunSample{
					txn:        row,
					currentCat: categoryNameForPtr(beforeCat, catNames),
					newCat:     categoryNameForPtr(workCat, catNames),
					addedTags:  addedNames,
				})
			}
		}

		catChanged := !intPtrEqual(currentCat, workCat)
		addedFinal, _ := diffTagSets(currentTagSet, workTagSet)
		if catChanged || len(addedFinal) > 0 {
			summary.totalModified++
		}
		if catChanged {
			summary.totalCatChange++
		}
		summary.totalTagChange += len(addedFinal)
	}
	return results, summary
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
	catID := categoryID
	return insertRuleV2(db, ruleV2{
		name:          fmt.Sprintf("Legacy category rule: %s", strings.TrimSpace(pattern)),
		savedFilterID: legacyRuleExprPrefix + legacyPatternExpr(pattern),
		setCategoryID: &catID,
		enabled:       true,
	})
}

// updateCategoryRule modifies a rule's pattern and target category.
func updateCategoryRule(db *sql.DB, id int, pattern string, categoryID int) error {
	rules, err := loadRulesV2(db)
	if err != nil {
		return err
	}
	for _, r := range rules {
		if r.id != id {
			continue
		}
		catID := categoryID
		r.name = fmt.Sprintf("Legacy category rule: %s", strings.TrimSpace(pattern))
		r.savedFilterID = legacyRuleExprPrefix + legacyPatternExpr(pattern)
		r.setCategoryID = &catID
		r.addTagIDs = nil
		return updateRuleV2(db, r)
	}
	return fmt.Errorf("rule %d not found", id)
}

// deleteCategoryRule removes a rule by ID.
func deleteCategoryRule(db *sql.DB, id int) error {
	return deleteRuleV2(db, id)
}

// applyCategoryRules runs all rules against uncategorised transactions.
// It uses case-insensitive LIKE matching. Returns the number of rows updated.
func applyCategoryRules(db *sql.DB) (int, error) {
	rules, err := loadRulesV2(db)
	if err != nil {
		return 0, err
	}
	legacy := make([]ruleV2, 0)
	for _, r := range rules {
		if r.setCategoryID == nil || len(r.addTagIDs) > 0 {
			continue
		}
		legacy = append(legacy, r)
	}
	rows, err := loadRows(db)
	if err != nil {
		return 0, err
	}
	uncategorized := make([]transaction, 0, len(rows))
	for _, row := range rows {
		if row.categoryID == nil {
			uncategorized = append(uncategorized, row)
		}
	}
	resolved, _ := resolveRulesV2(legacy, nil)
	_, catChanges, _, err := applyResolvedRulesV2ToRows(db, resolved, loadTransactionTagsOrEmpty(db), uncategorized)
	if err != nil {
		return 0, err
	}
	return catChanges, nil
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
		t.name = normalizeTagName(t.name)
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
	t.name = normalizeTagName(t.name)
	return &t, nil
}

func insertTag(db *sql.DB, name, color string, categoryID *int) (int, error) {
	name = normalizeTagName(name)
	if name == "" {
		return 0, fmt.Errorf("insert tag: name is required")
	}
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

func updateTag(db *sql.DB, id int, name, color string, categoryID *int) error {
	name = normalizeTagName(name)
	if name == "" {
		return fmt.Errorf("update tag: name is required")
	}
	if strings.TrimSpace(color) == "" {
		color = autoTagColor(name)
	}
	if _, err := db.Exec(`UPDATE tags SET name = ?, color = ?, category_id = ? WHERE id = ?`, name, color, categoryID, id); err != nil {
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
	rules, err := loadRulesV2(db)
	if err != nil {
		return nil, err
	}
	out := make([]tagRule, 0)
	for _, r := range rules {
		if r.setCategoryID != nil {
			continue
		}
		if len(r.addTagIDs) != 1 || !strings.HasPrefix(strings.TrimSpace(r.savedFilterID), legacyRuleExprPrefix) {
			continue
		}
		out = append(out, tagRule{
			id:       r.id,
			pattern:  legacyPatternFromExpr(strings.TrimSpace(strings.TrimPrefix(r.savedFilterID, legacyRuleExprPrefix))),
			tagID:    r.addTagIDs[0],
			priority: r.sortOrder,
		})
	}
	return out, nil
}

func insertTagRule(db *sql.DB, pattern string, tagID int) (int, error) {
	return insertRuleV2(db, ruleV2{
		name:          fmt.Sprintf("Legacy tag rule: %s", strings.TrimSpace(pattern)),
		savedFilterID: legacyRuleExprPrefix + legacyPatternExpr(pattern),
		addTagIDs:     []int{tagID},
		enabled:       true,
	})
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
		t.name = normalizeTagName(t.name)
		out[txnID] = append(out[txnID], t)
	}
	return out, rows.Err()
}

func loadTransactionTagsOrEmpty(db *sql.DB) map[int][]tag {
	tags, err := loadTransactionTags(db)
	if err != nil || tags == nil {
		return make(map[int][]tag)
	}
	return tags
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
	rules, err := loadRulesV2(db)
	if err != nil {
		return 0, err
	}
	legacy := make([]ruleV2, 0)
	for _, r := range rules {
		if r.setCategoryID != nil {
			continue
		}
		if len(r.addTagIDs) == 0 {
			continue
		}
		legacy = append(legacy, r)
	}
	_, _, tagChanges, _, err := applyRulesV2ToScope(db, legacy, loadTransactionTagsOrEmpty(db), nil, nil)
	if err != nil {
		return 0, err
	}
	return tagChanges, nil
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
	txnCount  int
}

func loadAccounts(db *sql.DB) ([]account, error) {
	rows, err := db.Query(`
		SELECT
			a.id,
			a.name,
			a.type,
			a.sort_order,
			a.is_active,
			COALESCE(tx.txn_count, 0) AS txn_count
		FROM accounts a
		LEFT JOIN (
			SELECT account_id, COUNT(*) AS txn_count
			FROM transactions
			GROUP BY account_id
		) tx ON tx.account_id = a.id
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
		if err := rows.Scan(&a.id, &a.name, &a.acctType, &a.sortOrder, &active, &a.txnCount); err != nil {
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

type filterUsageState struct {
	filterID     string
	lastUsedUnix int64
	useCount     int
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
	if err := db.QueryRow("SELECT COUNT(*) FROM rules_v2").Scan(&info.ruleCount); err != nil {
		return info, fmt.Errorf("rule count: %w", err)
	}
	if err := db.QueryRow("SELECT COUNT(*) FROM tags").Scan(&info.tagCount); err != nil {
		return info, fmt.Errorf("tag count: %w", err)
	}
	if err := db.QueryRow(`
		SELECT COUNT(*)
		FROM rules_v2
		WHERE set_category_id IS NULL
		  AND add_tag_ids <> '[]'
	`).Scan(&info.tagRuleCount); err != nil {
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

func ensureFilterUsageStateTable(db *sql.DB) error {
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS filter_usage_state (
			filter_id      TEXT PRIMARY KEY,
			last_used_unix INTEGER NOT NULL DEFAULT (unixepoch()),
			use_count      INTEGER NOT NULL DEFAULT 0
		)`,
		`CREATE INDEX IF NOT EXISTS idx_filter_usage_last_used ON filter_usage_state(last_used_unix DESC)`,
	}
	for _, stmt := range stmts {
		if _, err := db.Exec(stmt); err != nil {
			return fmt.Errorf("ensure filter usage state table statement failed: %w", err)
		}
	}
	return nil
}

func loadFilterUsageState(db *sql.DB) (map[string]filterUsageState, error) {
	if err := ensureFilterUsageStateTable(db); err != nil {
		return nil, err
	}
	rows, err := db.Query(`
		SELECT filter_id, COALESCE(last_used_unix, 0), COALESCE(use_count, 0)
		FROM filter_usage_state
	`)
	if err != nil {
		return nil, fmt.Errorf("query filter usage state: %w", err)
	}
	defer rows.Close()

	out := make(map[string]filterUsageState)
	for rows.Next() {
		var state filterUsageState
		if err := rows.Scan(&state.filterID, &state.lastUsedUnix, &state.useCount); err != nil {
			return nil, fmt.Errorf("scan filter usage state: %w", err)
		}
		out[state.filterID] = state
	}
	return out, rows.Err()
}

func touchFilterUsageState(db *sql.DB, filterID string, incrementUseCount bool) error {
	id := strings.TrimSpace(filterID)
	if id == "" {
		return fmt.Errorf("filter id is required")
	}
	if err := ensureFilterUsageStateTable(db); err != nil {
		return err
	}
	increment := 0
	if incrementUseCount {
		increment = 1
	}
	_, err := db.Exec(`
		INSERT INTO filter_usage_state (filter_id, last_used_unix, use_count)
		VALUES (?, unixepoch(), ?)
		ON CONFLICT(filter_id) DO UPDATE SET
			last_used_unix = unixepoch(),
			use_count = filter_usage_state.use_count + ?
	`, id, increment, increment)
	if err != nil {
		return fmt.Errorf("touch filter usage state %q: %w", id, err)
	}
	return nil
}

func deleteFilterUsageState(db *sql.DB, filterID string) error {
	id := strings.TrimSpace(filterID)
	if id == "" {
		return nil
	}
	if err := ensureFilterUsageStateTable(db); err != nil {
		return err
	}
	if _, err := db.Exec(`DELETE FROM filter_usage_state WHERE filter_id = ?`, id); err != nil {
		return fmt.Errorf("delete filter usage state %q: %w", id, err)
	}
	return nil
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
		rules, err := loadRulesV2(db)
		if err != nil {
			return refreshDoneMsg{err: err}
		}
		tags, err := loadTags(db)
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
		filterUsage, err := loadFilterUsageState(db)
		if err != nil {
			return refreshDoneMsg{err: err}
		}
		return refreshDoneMsg{
			rows:             rows,
			categories:       cats,
			rules:            rules,
			tags:             tags,
			txnTags:          txnTags,
			imports:          imports,
			accounts:         accounts,
			selectedAccounts: selectedAccounts,
			info:             info,
			filterUsage:      filterUsage,
		}
	}
}
