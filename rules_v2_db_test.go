package main

import (
	"database/sql"
	"fmt"
	"os"
	"testing"
)

func TestOpenDBCreatesV6SchemaRulesV2(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	var ver int
	if err := db.QueryRow("SELECT version FROM schema_meta LIMIT 1").Scan(&ver); err != nil {
		t.Fatalf("query schema version: %v", err)
	}
	if ver != 6 {
		t.Fatalf("schema version = %d, want 6", ver)
	}

	tables := []string{
		"schema_meta",
		"categories",
		"transactions",
		"imports",
		"accounts",
		"account_selection",
		"tags",
		"transaction_tags",
		"rules_v2",
		"category_budgets",
		"category_budget_overrides",
		"spending_targets",
		"spending_target_overrides",
		"credit_offsets",
		"manual_offsets",
	}
	for _, table := range tables {
		var count int
		if err := db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?`, table).Scan(&count); err != nil {
			t.Fatalf("check table %s: %v", table, err)
		}
		if count != 1 {
			t.Fatalf("expected table %q to exist", table)
		}
	}

	for _, removed := range []string{"category_rules", "tag_rules"} {
		var count int
		if err := db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?`, removed).Scan(&count); err != nil {
			t.Fatalf("check removed table %s: %v", removed, err)
		}
		if count != 0 {
			t.Fatalf("legacy table %q should be removed", removed)
		}
	}
}

func TestMigrateFromV4ToV6PreservesDataAndDropsLegacyRules(t *testing.T) {
	f, err := os.CreateTemp("", "jaskmoney-v4-*.db")
	if err != nil {
		t.Fatalf("create temp: %v", err)
	}
	path := f.Name()
	_ = f.Close()
	defer os.Remove(path)

	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("open legacy db: %v", err)
	}
	if _, err := db.Exec(`PRAGMA foreign_keys = ON`); err != nil {
		t.Fatalf("enable fk: %v", err)
	}

	legacy := `
	CREATE TABLE schema_meta (version INTEGER NOT NULL);
	INSERT INTO schema_meta (version) VALUES (4);

	CREATE TABLE categories (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL UNIQUE,
		color TEXT NOT NULL,
		sort_order INTEGER NOT NULL DEFAULT 0,
		is_default INTEGER NOT NULL DEFAULT 0
	);
	CREATE TABLE category_rules (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		pattern TEXT NOT NULL,
		category_id INTEGER NOT NULL,
		priority INTEGER NOT NULL DEFAULT 0
	);
	CREATE TABLE tags (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL UNIQUE,
		color TEXT NOT NULL DEFAULT '#94e2d5',
		category_id INTEGER,
		sort_order INTEGER NOT NULL DEFAULT 0
	);
	CREATE TABLE tag_rules (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		pattern TEXT NOT NULL,
		tag_id INTEGER NOT NULL,
		priority INTEGER NOT NULL DEFAULT 0
	);
	CREATE TABLE accounts (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL UNIQUE,
		type TEXT NOT NULL DEFAULT 'debit',
		sort_order INTEGER NOT NULL DEFAULT 0,
		is_active INTEGER NOT NULL DEFAULT 1
	);
	CREATE TABLE account_selection (
		account_id INTEGER NOT NULL
	);
	CREATE TABLE transactions (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		date_raw TEXT NOT NULL,
		date_iso TEXT NOT NULL,
		amount REAL NOT NULL,
		description TEXT NOT NULL,
		category_id INTEGER,
		notes TEXT NOT NULL DEFAULT '',
		import_id INTEGER,
		account_id INTEGER,
		created_at TEXT NOT NULL DEFAULT (datetime('now'))
	);
	CREATE TABLE transaction_tags (
		transaction_id INTEGER NOT NULL,
		tag_id INTEGER NOT NULL,
		PRIMARY KEY (transaction_id, tag_id)
	);
	CREATE TABLE imports (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		filename TEXT NOT NULL,
		row_count INTEGER NOT NULL,
		imported_at TEXT NOT NULL DEFAULT (datetime('now'))
	);
	`
	if _, err := db.Exec(legacy); err != nil {
		t.Fatalf("create v4 schema: %v", err)
	}

	if _, err := db.Exec(`
		INSERT INTO categories (name, color, sort_order, is_default) VALUES
			('Groceries', '#94e2d5', 1, 0),
			('Uncategorised', '#7f849c', 2, 1);
		INSERT INTO tags (name, color, sort_order) VALUES ('WEEKLY', '#89b4fa', 1);
		INSERT INTO accounts (name, type, sort_order, is_active) VALUES ('A1', 'debit', 1, 1);
		INSERT INTO transactions (date_raw, date_iso, amount, description, category_id, notes, account_id)
			VALUES ('1/01/2026', '2026-01-01', -12.30, 'LEGACY TXN', NULL, '', 1);
		INSERT INTO imports (filename, row_count) VALUES ('legacy.csv', 1);
		INSERT INTO category_rules (pattern, category_id, priority) VALUES ('legacy', 1, 0);
		INSERT INTO tag_rules (pattern, tag_id, priority) VALUES ('legacy', 1, 0);
	`); err != nil {
		t.Fatalf("seed legacy rows: %v", err)
	}
	if err := db.Close(); err != nil {
		t.Fatalf("close legacy db: %v", err)
	}

	upgraded, err := openDB(path)
	if err != nil {
		t.Fatalf("openDB upgrade: %v", err)
	}
	defer upgraded.Close()

	var ver int
	if err := upgraded.QueryRow("SELECT version FROM schema_meta LIMIT 1").Scan(&ver); err != nil {
		t.Fatalf("query version after migrate: %v", err)
	}
	if ver != 6 {
		t.Fatalf("schema version after migrate = %d, want 6", ver)
	}

	var txnCount, tagCount, accountCount, importCount int
	if err := upgraded.QueryRow("SELECT COUNT(*) FROM transactions").Scan(&txnCount); err != nil {
		t.Fatalf("count transactions: %v", err)
	}
	if err := upgraded.QueryRow("SELECT COUNT(*) FROM tags").Scan(&tagCount); err != nil {
		t.Fatalf("count tags: %v", err)
	}
	if err := upgraded.QueryRow("SELECT COUNT(*) FROM accounts").Scan(&accountCount); err != nil {
		t.Fatalf("count accounts: %v", err)
	}
	if err := upgraded.QueryRow("SELECT COUNT(*) FROM imports").Scan(&importCount); err != nil {
		t.Fatalf("count imports: %v", err)
	}
	if txnCount != 1 || tagCount != 2 || accountCount != 1 || importCount != 1 {
		t.Fatalf("preservation mismatch txn=%d tag=%d account=%d import=%d", txnCount, tagCount, accountCount, importCount)
	}

	for _, removed := range []string{"category_rules", "tag_rules"} {
		var count int
		if err := upgraded.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?`, removed).Scan(&count); err != nil {
			t.Fatalf("check removed table %s: %v", removed, err)
		}
		if count != 0 {
			t.Fatalf("legacy table %q should be removed after migration", removed)
		}
	}
}

func TestRulesV2CRUDReorderToggle(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	cats, err := loadCategories(db)
	if err != nil {
		t.Fatalf("load categories: %v", err)
	}
	groceries := cats[1].id

	r1 := ruleV2{name: "grocery", savedFilterID: "filter-grocery", setCategoryID: &groceries, enabled: true}
	r2 := ruleV2{name: "transfer", savedFilterID: "filter-transfer", enabled: true}

	id1, err := insertRuleV2(db, r1)
	if err != nil {
		t.Fatalf("insert rule1: %v", err)
	}
	id2, err := insertRuleV2(db, r2)
	if err != nil {
		t.Fatalf("insert rule2: %v", err)
	}

	rules, err := loadRulesV2(db)
	if err != nil {
		t.Fatalf("load rules: %v", err)
	}
	if len(rules) != 2 {
		t.Fatalf("rules len = %d, want 2", len(rules))
	}
	if rules[0].id != id1 || rules[1].id != id2 {
		t.Fatalf("unexpected initial order: %+v", rules)
	}

	if err := reorderRuleV2(db, id2, 0); err != nil {
		t.Fatalf("reorder: %v", err)
	}
	rules, err = loadRulesV2(db)
	if err != nil {
		t.Fatalf("load rules after reorder: %v", err)
	}
	if rules[0].id != id2 || rules[1].id != id1 {
		t.Fatalf("unexpected order after reorder: %+v", rules)
	}

	if err := toggleRuleV2Enabled(db, id1, false); err != nil {
		t.Fatalf("toggle disabled: %v", err)
	}
	rules, err = loadRulesV2(db)
	if err != nil {
		t.Fatalf("load rules after toggle: %v", err)
	}
	if rules[1].enabled {
		t.Fatalf("expected rule id=%d to be disabled", id1)
	}

	rule := rules[0]
	rule.name = "transfer updated"
	if err := updateRuleV2(db, rule); err != nil {
		t.Fatalf("update rule: %v", err)
	}
	rules, err = loadRulesV2(db)
	if err != nil {
		t.Fatalf("load rules after update: %v", err)
	}
	if rules[0].name != "transfer updated" {
		t.Fatalf("rule name = %q, want transfer updated", rules[0].name)
	}

	if err := deleteRuleV2(db, id1); err != nil {
		t.Fatalf("delete rule: %v", err)
	}
	rules, err = loadRulesV2(db)
	if err != nil {
		t.Fatalf("load rules after delete: %v", err)
	}
	if len(rules) != 1 || rules[0].id != id2 {
		t.Fatalf("rules after delete = %+v", rules)
	}
}

func TestApplyRulesV2ToScope_OrderCategoryAndTagSemantics(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	acctA, err := insertAccount(db, "A", "debit", true)
	if err != nil {
		t.Fatalf("insert account A: %v", err)
	}
	acctB, err := insertAccount(db, "B", "debit", true)
	if err != nil {
		t.Fatalf("insert account B: %v", err)
	}

	cats, err := loadCategories(db)
	if err != nil {
		t.Fatalf("load categories: %v", err)
	}
	groceries := cats[1].id
	dining := cats[2].id
	transfers := cats[8].id

	oneTagID, err := insertTag(db, "ONE", "#89b4fa", nil)
	if err != nil {
		t.Fatalf("insert tag one: %v", err)
	}
	twoTagID, err := insertTag(db, "TWO", "#94e2d5", nil)
	if err != nil {
		t.Fatalf("insert tag two: %v", err)
	}

	insertTxn := func(accountID int, desc string) int {
		t.Helper()
		res, execErr := db.Exec(`
			INSERT INTO transactions (date_raw, date_iso, amount, description, notes, account_id)
			VALUES ('1/01/2026', '2026-01-01', -10.00, ?, '', ?)
		`, desc, accountID)
		if execErr != nil {
			t.Fatalf("insert txn %q: %v", desc, execErr)
		}
		id, lastErr := res.LastInsertId()
		if lastErr != nil {
			t.Fatalf("last insert id: %v", lastErr)
		}
		return int(id)
	}

	txnA := insertTxn(acctA, "GROCERY STORE")
	txnB := insertTxn(acctB, "GROCERY STORE")
	txnTransfer := insertTxn(acctA, "TRANSFER SAV")

	savedFilters := []savedFilter{
		{ID: "filter-grocery", Name: "Grocery", Expr: `desc:grocery`},
		{ID: "filter-transfer", Name: "Transfer", Expr: `desc:transfer`},
	}
	rules := []ruleV2{
		{name: "r1", savedFilterID: "filter-grocery", setCategoryID: &groceries, addTagIDs: []int{oneTagID}, sortOrder: 0, enabled: true},
		{name: "r2", savedFilterID: "filter-grocery", setCategoryID: &dining, addTagIDs: []int{twoTagID}, sortOrder: 1, enabled: true},
		{name: "r3", savedFilterID: "filter-transfer", setCategoryID: &transfers, sortOrder: 2, enabled: false},
	}

	txnTags, err := loadTransactionTags(db)
	if err != nil {
		t.Fatalf("load txn tags: %v", err)
	}
	updatedTxns, catChanges, tagChanges, failedRules, err := applyRulesV2ToScope(db, rules, txnTags, map[int]bool{acctA: true}, savedFilters)
	if err != nil {
		t.Fatalf("apply rules: %v", err)
	}
	if updatedTxns != 1 {
		t.Fatalf("updatedTxns = %d, want 1", updatedTxns)
	}
	if catChanges != 1 {
		t.Fatalf("catChanges = %d, want 1", catChanges)
	}
	if tagChanges != 2 {
		t.Fatalf("tagChanges = %d, want 2", tagChanges)
	}
	if failedRules != 0 {
		t.Fatalf("failedRules = %d, want 0", failedRules)
	}

	rows, err := loadRows(db)
	if err != nil {
		t.Fatalf("load rows: %v", err)
	}
	rowsByID := make(map[int]transaction, len(rows))
	for _, row := range rows {
		rowsByID[row.id] = row
	}

	if rowsByID[txnA].categoryID == nil || *rowsByID[txnA].categoryID != dining {
		t.Fatalf("txnA category = %+v, want dining id=%d", rowsByID[txnA].categoryID, dining)
	}
	if rowsByID[txnB].categoryID != nil {
		t.Fatalf("txnB should be untouched by account scope")
	}
	if rowsByID[txnTransfer].categoryID != nil {
		t.Fatalf("disabled transfer rule should not run")
	}

	tagsAfter, err := loadTransactionTags(db)
	if err != nil {
		t.Fatalf("load txn tags after apply: %v", err)
	}
	if len(tagsAfter[txnA]) != 2 {
		t.Fatalf("txnA tags = %+v, want TWO tags", tagsAfter[txnA])
	}
}

func TestDryRunRulesV2MatchesApplyAndDoesNotWrite(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	acctID, err := insertAccount(db, "A", "debit", true)
	if err != nil {
		t.Fatalf("insert account: %v", err)
	}
	cats, err := loadCategories(db)
	if err != nil {
		t.Fatalf("load categories: %v", err)
	}
	groceries := cats[1].id
	weeklyTagID, err := insertTag(db, "WEEKLY", "#89b4fa", nil)
	if err != nil {
		t.Fatalf("insert tag: %v", err)
	}

	for i := 0; i < 2; i++ {
		desc := fmt.Sprintf("GROCERY %d", i)
		if _, err := db.Exec(`
			INSERT INTO transactions (date_raw, date_iso, amount, description, notes, account_id)
			VALUES ('1/01/2026', '2026-01-01', -20.00, ?, '', ?)
		`, desc, acctID); err != nil {
			t.Fatalf("insert txn %d: %v", i, err)
		}
	}

	rules := []ruleV2{
		{
			name:          "Groceries",
			savedFilterID: "filter-grocery",
			setCategoryID: &groceries,
			addTagIDs:     []int{weeklyTagID},
			enabled:       true,
		},
	}
	savedFilters := []savedFilter{
		{ID: "filter-grocery", Name: "Groceries", Expr: `desc:grocery`},
	}

	beforeRows, err := loadRows(db)
	if err != nil {
		t.Fatalf("load rows before dry-run: %v", err)
	}
	beforeTags, err := loadTransactionTags(db)
	if err != nil {
		t.Fatalf("load tags before dry-run: %v", err)
	}

	dryResults, drySummary := dryRunRulesV2(db, rules, beforeRows, beforeTags, savedFilters)
	if len(dryResults) != 1 {
		t.Fatalf("dry-run results len = %d, want 1", len(dryResults))
	}
	if dryResults[0].matchCount != 2 {
		t.Fatalf("dry-run matchCount = %d, want 2", dryResults[0].matchCount)
	}

	afterDryRows, err := loadRows(db)
	if err != nil {
		t.Fatalf("load rows after dry-run: %v", err)
	}
	for _, row := range afterDryRows {
		if row.categoryID != nil {
			t.Fatalf("dry-run must not mutate category, txn=%d category=%v", row.id, row.categoryID)
		}
	}

	updatedTxns, catChanges, tagChanges, failedRules, err := applyRulesV2ToScope(db, rules, beforeTags, map[int]bool{acctID: true}, savedFilters)
	if err != nil {
		t.Fatalf("apply rules: %v", err)
	}
	if updatedTxns != drySummary.totalModified {
		t.Fatalf("updated txns mismatch apply=%d dry=%d", updatedTxns, drySummary.totalModified)
	}
	if catChanges != drySummary.totalCatChange {
		t.Fatalf("cat changes mismatch apply=%d dry=%d", catChanges, drySummary.totalCatChange)
	}
	if tagChanges != drySummary.totalTagChange {
		t.Fatalf("tag changes mismatch apply=%d dry=%d", tagChanges, drySummary.totalTagChange)
	}
	if failedRules != 0 {
		t.Fatalf("failedRules = %d, want 0", failedRules)
	}
}

func TestApplyRulesV2ToScopeSkipsMissingSavedFilters(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	acctID, err := insertAccount(db, "A", "debit", true)
	if err != nil {
		t.Fatalf("insert account: %v", err)
	}
	cats, err := loadCategories(db)
	if err != nil {
		t.Fatalf("load categories: %v", err)
	}
	groceries := cats[1].id
	if _, err := db.Exec(`
		INSERT INTO transactions (date_raw, date_iso, amount, description, notes, account_id)
		VALUES ('1/01/2026', '2026-01-01', -9.99, 'WOOLWORTHS', '', ?)
	`, acctID); err != nil {
		t.Fatalf("insert txn: %v", err)
	}
	txnTags, err := loadTransactionTags(db)
	if err != nil {
		t.Fatalf("load txn tags: %v", err)
	}
	rules := []ruleV2{
		{name: "Missing", savedFilterID: "missing-filter", setCategoryID: &groceries, enabled: true},
	}

	updatedTxns, catChanges, tagChanges, failedRules, err := applyRulesV2ToScope(db, rules, txnTags, nil, nil)
	if err != nil {
		t.Fatalf("apply rules: %v", err)
	}
	if updatedTxns != 0 || catChanges != 0 || tagChanges != 0 {
		t.Fatalf("unexpected changes updated=%d cat=%d tag=%d", updatedTxns, catChanges, tagChanges)
	}
	if failedRules != 1 {
		t.Fatalf("failedRules = %d, want 1", failedRules)
	}
}
