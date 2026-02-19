package main

import (
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// testDB creates a temporary SQLite database via openDB and returns it along
// with a cleanup function.
func testDB(t *testing.T) (*sql.DB, func()) {
	t.Helper()
	f, err := os.CreateTemp("", "jaskmoney-test-*.db")
	if err != nil {
		t.Fatalf("create temp file: %v", err)
	}
	path := f.Name()
	f.Close()

	db, err := openDB(path)
	if err != nil {
		os.Remove(path)
		t.Fatalf("openDB: %v", err)
	}
	return db, func() {
		db.Close()
		os.Remove(path)
	}
}

// ---- Schema creation tests ----

func TestOpenDBCreatesCurrentSchema(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	// Verify schema_meta has correct version
	var ver int
	err := db.QueryRow("SELECT version FROM schema_meta LIMIT 1").Scan(&ver)
	if err != nil {
		t.Fatalf("query schema_meta: %v", err)
	}
	if ver != schemaVersion {
		t.Errorf("schema version = %d, want %d", ver, schemaVersion)
	}

	// Verify all tables exist
	tables := []string{
		"schema_meta", "categories", "transactions", "imports",
		"accounts", "account_selection", "tags", "transaction_tags", "rules_v2",
		"category_budgets", "category_budget_overrides", "spending_targets",
		"spending_target_overrides", "transaction_allocations", "transaction_allocation_tags",
	}
	for _, table := range tables {
		var count int
		err := db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?`, table).Scan(&count)
		if err != nil {
			t.Fatalf("check table %s: %v", table, err)
		}
		if count != 1 {
			t.Errorf("table %s not found", table)
		}
	}
}

func TestDefaultCategoriesSeeded(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	cats, err := loadCategories(db)
	if err != nil {
		t.Fatalf("loadCategories: %v", err)
	}

	if len(cats) != len(defaultCategories) {
		t.Fatalf("got %d categories, want %d", len(cats), len(defaultCategories))
	}

	// Verify order and content
	for i, want := range defaultCategories {
		got := cats[i]
		if got.name != want.name {
			t.Errorf("category[%d].name = %q, want %q", i, got.name, want.name)
		}
		if got.color != want.color {
			t.Errorf("category[%d].color = %q, want %q", i, got.color, want.color)
		}
		if got.sortOrder != want.sortOrder {
			t.Errorf("category[%d].sortOrder = %d, want %d", i, got.sortOrder, want.sortOrder)
		}
		wantDefault := want.isDefault == 1
		if got.isDefault != wantDefault {
			t.Errorf("category[%d].isDefault = %v, want %v", i, got.isDefault, wantDefault)
		}
	}
}

func TestUncategorisedIsDefault(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	cats, err := loadCategories(db)
	if err != nil {
		t.Fatalf("loadCategories: %v", err)
	}

	found := false
	for _, c := range cats {
		if c.name == "Uncategorised" {
			found = true
			if !c.isDefault {
				t.Error("Uncategorised should have is_default = true")
			}
		}
	}
	if !found {
		t.Error("Uncategorised category not found")
	}
}

func TestMandatoryIgnoreTagSeeded(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	tags, err := loadTags(db)
	if err != nil {
		t.Fatalf("loadTags: %v", err)
	}
	found := false
	for _, tg := range tags {
		if strings.EqualFold(tg.name, mandatoryIgnoreTagName) {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("mandatory tag %q not found in %+v", mandatoryIgnoreTagName, tags)
	}
}

// ---- Schema migration tests ----

func TestOpenDBRecreatesOutdatedSchema(t *testing.T) {
	// Create an outdated v2-style database; openDB should recreate it fresh.
	f, err := os.CreateTemp("", "jaskmoney-v2-*.db")
	if err != nil {
		t.Fatalf("create temp: %v", err)
	}
	path := f.Name()
	f.Close()
	defer os.Remove(path)

	// Create minimal v2-style schema manually
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	_, err = db.Exec(`
		CREATE TABLE schema_meta (version INTEGER NOT NULL);
		INSERT INTO schema_meta (version) VALUES (2);
		CREATE TABLE transactions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			date_raw TEXT NOT NULL,
			date_iso TEXT NOT NULL,
			amount REAL NOT NULL,
			description TEXT NOT NULL,
			notes TEXT NOT NULL DEFAULT ''
		)
	`)
	if err != nil {
		db.Close()
		t.Fatalf("create v2 schema: %v", err)
	}
	// Insert a legacy row that should be removed by fresh recreate.
	_, err = db.Exec(`INSERT INTO transactions (date_raw, date_iso, amount, description)
		VALUES ('03/02/2026', '2026-02-03', -20.00, 'DAN MURPHYS')`)
	if err != nil {
		db.Close()
		t.Fatalf("insert legacy row: %v", err)
	}
	db.Close()

	// Now open with openDB; outdated schema is rebuilt from scratch.
	db2, err := openDB(path)
	if err != nil {
		t.Fatalf("openDB on outdated db: %v", err)
	}
	defer db2.Close()

	// Verify version is now latest schema.
	var ver int
	if err := db2.QueryRow("SELECT version FROM schema_meta LIMIT 1").Scan(&ver); err != nil {
		t.Fatalf("query version: %v", err)
	}
	if ver != schemaVersion {
		t.Errorf("version = %d, want %d", ver, schemaVersion)
	}

	// Legacy transactions should not be preserved in fresh-schema mode.
	rows, err := loadRows(db2)
	if err != nil {
		t.Fatalf("loadRows: %v", err)
	}
	if len(rows) != 0 {
		t.Fatalf("expected 0 rows after recreate, got %d", len(rows))
	}

	// ANZ is no longer auto-seeded.
	anz, err := loadAccountByNameCI(db2, "ANZ")
	if err != nil {
		t.Fatalf("loadAccountByNameCI: %v", err)
	}
	if anz != nil {
		t.Fatalf("expected no implicit ANZ seed account, got %+v", *anz)
	}
}

func TestMigrationFromV3ToV4PreservesTransactions(t *testing.T) {
	f, err := os.CreateTemp("", "jaskmoney-v3-*.db")
	if err != nil {
		t.Fatalf("create temp: %v", err)
	}
	path := f.Name()
	f.Close()
	defer os.Remove(path)

	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	_, err = db.Exec(`
		CREATE TABLE schema_meta (version INTEGER NOT NULL);
		INSERT INTO schema_meta (version) VALUES (3);

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
			category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
			priority INTEGER NOT NULL DEFAULT 0,
			UNIQUE(pattern)
		);

		CREATE TABLE accounts (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL UNIQUE,
			type TEXT NOT NULL CHECK(type IN ('debit','credit')) DEFAULT 'debit',
			sort_order INTEGER NOT NULL DEFAULT 0,
			is_active INTEGER NOT NULL DEFAULT 1
		);

		CREATE TABLE account_selection (
			account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE
		);

		CREATE TABLE transactions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			date_raw TEXT NOT NULL,
			date_iso TEXT NOT NULL,
			amount REAL NOT NULL,
			description TEXT NOT NULL,
			category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
			notes TEXT NOT NULL DEFAULT '',
			import_id INTEGER REFERENCES imports(id),
			account_id INTEGER REFERENCES accounts(id),
			created_at TEXT NOT NULL DEFAULT (datetime('now'))
		);

		CREATE TABLE imports (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			filename TEXT NOT NULL,
			row_count INTEGER NOT NULL,
			imported_at TEXT NOT NULL DEFAULT (datetime('now'))
		);

		INSERT INTO transactions (date_raw, date_iso, amount, description, notes)
		VALUES ('03/02/2026', '2026-02-03', -20.00, 'PRESERVE-ME', '');
	`)
	if err != nil {
		db.Close()
		t.Fatalf("create v3 schema: %v", err)
	}
	db.Close()

	db2, err := openDB(path)
	if err != nil {
		t.Fatalf("openDB on v3 db: %v", err)
	}
	defer db2.Close()

	var ver int
	if err := db2.QueryRow("SELECT version FROM schema_meta LIMIT 1").Scan(&ver); err != nil {
		t.Fatalf("query version: %v", err)
	}
	if ver != schemaVersion {
		t.Fatalf("version = %d, want %d", ver, schemaVersion)
	}

	rows, err := loadRows(db2)
	if err != nil {
		t.Fatalf("loadRows: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("expected preserved transaction row, got %d", len(rows))
	}
	if rows[0].description != "PRESERVE-ME" {
		t.Fatalf("description = %q, want PRESERVE-ME", rows[0].description)
	}
}

func TestOpenDBIdempotent(t *testing.T) {
	f, err := os.CreateTemp("", "jaskmoney-idem-*.db")
	if err != nil {
		t.Fatalf("create temp: %v", err)
	}
	path := f.Name()
	f.Close()
	defer os.Remove(path)

	// Open once
	db1, err := openDB(path)
	if err != nil {
		t.Fatalf("first openDB: %v", err)
	}
	db1.Close()

	// Open again — should not error or re-migrate
	db2, err := openDB(path)
	if err != nil {
		t.Fatalf("second openDB: %v", err)
	}
	defer db2.Close()

	var ver int
	if err := db2.QueryRow("SELECT version FROM schema_meta LIMIT 1").Scan(&ver); err != nil {
		t.Fatalf("query version: %v", err)
	}
	if ver != schemaVersion {
		t.Errorf("version = %d, want %d", ver, schemaVersion)
	}

	cats, err := loadCategories(db2)
	if err != nil {
		t.Fatalf("loadCategories: %v", err)
	}
	if len(cats) != len(defaultCategories) {
		t.Errorf("got %d categories, want %d", len(cats), len(defaultCategories))
	}
}

func TestOpenDBReconcilesLegacySpendingTargetsAndBudgetColumns(t *testing.T) {
	f, err := os.CreateTemp("", "jaskmoney-v6-legacy-targets-*.db")
	if err != nil {
		t.Fatalf("create temp: %v", err)
	}
	path := f.Name()
	f.Close()
	defer os.Remove(path)

	db, err := openDB(path)
	if err != nil {
		t.Fatalf("seed v6 db with openDB: %v", err)
	}
	db.Close()

	raw, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("open raw sqlite db: %v", err)
	}
	if _, err := raw.Exec(`ALTER TABLE spending_targets RENAME COLUMN saved_filter_id TO filter_expr`); err != nil {
		raw.Close()
		t.Fatalf("rename spending_targets column to legacy name: %v", err)
	}
	raw.Close()

	db2, err := openDB(path)
	if err != nil {
		t.Fatalf("openDB should reconcile legacy spending_targets schema: %v", err)
	}
	defer db2.Close()

	spendingColumns, err := tableColumns(db2, "spending_targets")
	if err != nil {
		t.Fatalf("tableColumns(spending_targets): %v", err)
	}
	if !spendingColumns["saved_filter_id"] {
		t.Fatalf("expected spending_targets.saved_filter_id after reconciliation; got columns: %+v", spendingColumns)
	}
	if spendingColumns["filter_expr"] {
		t.Fatalf("unexpected legacy spending_targets.filter_expr after reconciliation; got columns: %+v", spendingColumns)
	}

	categoryBudgetColumns, err := tableColumns(db2, "category_budgets")
	if err != nil {
		t.Fatalf("tableColumns(category_budgets): %v", err)
	}
	for _, col := range []string{"id", "category_id", "amount"} {
		if !categoryBudgetColumns[col] {
			t.Fatalf("category_budgets missing required column %q; got columns: %+v", col, categoryBudgetColumns)
		}
	}

	_, err = insertSpendingTarget(db2, spendingTarget{
		name:          "Smoke test target",
		savedFilterID: "filter-1",
		amount:        100,
		periodType:    "monthly",
	})
	if err != nil {
		t.Fatalf("insertSpendingTarget after reconciliation: %v", err)
	}
}

func TestOpenDBCreatesMissingParentDirectory(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "nested", "deeper", "transactions.db")
	db, err := openDB(path)
	if err != nil {
		t.Fatalf("openDB: %v", err)
	}
	defer db.Close()

	if _, err := os.Stat(path); err != nil {
		t.Fatalf("expected db file at %s: %v", path, err)
	}
}

func TestEnsureCategoryBudgetRowsBackfillsMissingRows(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	catID, err := insertCategory(db, "Misc Test", "#123456")
	if err != nil {
		t.Fatalf("insertCategory: %v", err)
	}
	if _, err := db.Exec(`DELETE FROM category_budgets WHERE category_id = ?`, catID); err != nil {
		t.Fatalf("delete category budget row: %v", err)
	}

	if err := ensureCategoryBudgetRows(db); err != nil {
		t.Fatalf("ensureCategoryBudgetRows: %v", err)
	}

	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM category_budgets WHERE category_id = ?`, catID).Scan(&count); err != nil {
		t.Fatalf("count category budget row: %v", err)
	}
	if count != 1 {
		t.Fatalf("category budget row count = %d, want 1", count)
	}
}

func tableColumns(db *sql.DB, table string) (map[string]bool, error) {
	rows, err := db.Query("PRAGMA table_info(" + table + ")")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	cols := make(map[string]bool)
	for rows.Next() {
		var cid int
		var name, typ string
		var notNull, pk int
		var dflt sql.NullString
		if err := rows.Scan(&cid, &name, &typ, &notNull, &dflt, &pk); err != nil {
			return nil, err
		}
		cols[name] = true
	}
	return cols, rows.Err()
}

// ---- Category CRUD tests ----

func TestLoadCategoriesOrder(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	cats, err := loadCategories(db)
	if err != nil {
		t.Fatalf("loadCategories: %v", err)
	}

	for i := 1; i < len(cats); i++ {
		if cats[i].sortOrder < cats[i-1].sortOrder {
			t.Errorf("categories not sorted: %q (order %d) before %q (order %d)",
				cats[i-1].name, cats[i-1].sortOrder, cats[i].name, cats[i].sortOrder)
		}
	}
}

// ---- Category rules tests ----

func TestLoadCategoryRulesEmpty(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	rules, err := loadCategoryRules(db)
	if err != nil {
		t.Fatalf("loadCategoryRules: %v", err)
	}
	if len(rules) != 0 {
		t.Errorf("expected 0 rules, got %d", len(rules))
	}
}

func TestInsertAndLoadCategoryRule(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	// Get a category ID
	cats, err := loadCategories(db)
	if err != nil {
		t.Fatalf("loadCategories: %v", err)
	}
	groceryID := cats[1].id // "Groceries" is second

	// Insert a rule
	_, err = insertCategoryRule(db, "WOOLWORTHS", groceryID)
	if err != nil {
		t.Fatalf("insert rule: %v", err)
	}

	rules, err := loadCategoryRules(db)
	if err != nil {
		t.Fatalf("loadCategoryRules: %v", err)
	}
	if len(rules) != 1 {
		t.Fatalf("expected 1 rule, got %d", len(rules))
	}
	if rules[0].pattern != "WOOLWORTHS" {
		t.Errorf("rule pattern = %q, want %q", rules[0].pattern, "WOOLWORTHS")
	}
	if rules[0].categoryID != groceryID {
		t.Errorf("rule categoryID = %d, want %d", rules[0].categoryID, groceryID)
	}
}

// ---- Import records tests ----

func TestLoadImportsEmpty(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	imports, err := loadImports(db)
	if err != nil {
		t.Fatalf("loadImports: %v", err)
	}
	if len(imports) != 0 {
		t.Errorf("expected 0 imports, got %d", len(imports))
	}
}

func TestInsertAndLoadImport(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	_, err := db.Exec(`INSERT INTO imports (filename, row_count) VALUES ('test.csv', 42)`)
	if err != nil {
		t.Fatalf("insert import: %v", err)
	}

	imports, err := loadImports(db)
	if err != nil {
		t.Fatalf("loadImports: %v", err)
	}
	if len(imports) != 1 {
		t.Fatalf("expected 1 import, got %d", len(imports))
	}
	if imports[0].filename != "test.csv" {
		t.Errorf("filename = %q, want %q", imports[0].filename, "test.csv")
	}
	if imports[0].rowCount != 42 {
		t.Errorf("rowCount = %d, want %d", imports[0].rowCount, 42)
	}
}

// ---- Transaction tests ----

func TestInsertAndLoadTransactions(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	_, err := db.Exec(`
		INSERT INTO transactions (date_raw, date_iso, amount, description, notes)
		VALUES ('03/02/2026', '2026-02-03', -20.00, 'DAN MURPHYS', '')
	`)
	if err != nil {
		t.Fatalf("insert: %v", err)
	}
	_, err = db.Exec(`
		INSERT INTO transactions (date_raw, date_iso, amount, description, notes)
		VALUES ('04/02/2026', '2026-02-04', 100.00, 'PAYMENT', '')
	`)
	if err != nil {
		t.Fatalf("insert: %v", err)
	}

	rows, err := loadRows(db)
	if err != nil {
		t.Fatalf("loadRows: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("expected 2 rows, got %d", len(rows))
	}

	// Should be ordered by date_iso DESC (most recent first)
	if rows[0].dateISO != "2026-02-04" {
		t.Errorf("first row dateISO = %q, want %q", rows[0].dateISO, "2026-02-04")
	}
	if rows[1].dateISO != "2026-02-03" {
		t.Errorf("second row dateISO = %q, want %q", rows[1].dateISO, "2026-02-03")
	}

	// Uncategorised transactions should get fallback name
	if rows[0].categoryName != "Uncategorised" {
		t.Errorf("expected categoryName 'Uncategorised', got %q", rows[0].categoryName)
	}
	if rows[0].id == 0 {
		t.Error("expected non-zero transaction ID")
	}
}

func TestClearTransactions(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	_, err := db.Exec(`
		INSERT INTO transactions (date_raw, date_iso, amount, description, notes)
		VALUES ('03/02/2026', '2026-02-03', -20.00, 'TEST', '')
	`)
	if err != nil {
		t.Fatalf("insert: %v", err)
	}

	// Clear
	_, err = db.Exec("DELETE FROM transactions")
	if err != nil {
		t.Fatalf("clear: %v", err)
	}

	rows, err := loadRows(db)
	if err != nil {
		t.Fatalf("loadRows: %v", err)
	}
	if len(rows) != 0 {
		t.Errorf("expected 0 rows after clear, got %d", len(rows))
	}
}

// ---- Update transaction tests ----

func TestUpdateTransactionCategory(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	// Insert a transaction
	res, err := db.Exec(`
		INSERT INTO transactions (date_raw, date_iso, amount, description, notes)
		VALUES ('03/02/2026', '2026-02-03', -20.00, 'TEST', '')
	`)
	if err != nil {
		t.Fatalf("insert: %v", err)
	}
	txnID, _ := res.LastInsertId()

	// Get a category
	cats, _ := loadCategories(db)
	catID := cats[0].id

	// Update category
	if err := updateTransactionCategory(db, int(txnID), &catID); err != nil {
		t.Fatalf("updateTransactionCategory: %v", err)
	}

	// Verify
	rows, err := loadRows(db)
	if err != nil {
		t.Fatalf("loadRows: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("expected 1 row, got %d", len(rows))
	}
	if rows[0].categoryName != cats[0].name {
		t.Errorf("category = %q, want %q", rows[0].categoryName, cats[0].name)
	}
}

func TestUpdateTransactionNotes(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	res, err := db.Exec(`
		INSERT INTO transactions (date_raw, date_iso, amount, description, notes)
		VALUES ('03/02/2026', '2026-02-03', -20.00, 'TEST', '')
	`)
	if err != nil {
		t.Fatalf("insert: %v", err)
	}
	txnID, _ := res.LastInsertId()

	if err := updateTransactionNotes(db, int(txnID), "my note"); err != nil {
		t.Fatalf("updateTransactionNotes: %v", err)
	}

	rows, err := loadRows(db)
	if err != nil {
		t.Fatalf("loadRows: %v", err)
	}
	if rows[0].notes != "my note" {
		t.Errorf("notes = %q, want %q", rows[0].notes, "my note")
	}
}

func TestUpdateTransactionDetailAtomicSuccess(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	res, err := db.Exec(`
		INSERT INTO transactions (date_raw, date_iso, amount, description, notes)
		VALUES ('03/02/2026', '2026-02-03', -20.00, 'TEST', 'seed')
	`)
	if err != nil {
		t.Fatalf("insert txn: %v", err)
	}
	txnID, _ := res.LastInsertId()

	cats, err := loadCategories(db)
	if err != nil {
		t.Fatalf("loadCategories: %v", err)
	}
	catID := cats[1].id

	if err := updateTransactionDetail(db, int(txnID), &catID, "updated"); err != nil {
		t.Fatalf("updateTransactionDetail: %v", err)
	}

	rows, err := loadRows(db)
	if err != nil {
		t.Fatalf("loadRows: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("rows = %d, want 1", len(rows))
	}
	if rows[0].notes != "updated" {
		t.Fatalf("notes = %q, want %q", rows[0].notes, "updated")
	}
	if rows[0].categoryID == nil || *rows[0].categoryID != catID {
		t.Fatalf("categoryID = %v, want %d", rows[0].categoryID, catID)
	}
}

func TestUpdateTransactionDetailAtomicRollbackOnInvalidCategory(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	res, err := db.Exec(`
		INSERT INTO transactions (date_raw, date_iso, amount, description, notes)
		VALUES ('03/02/2026', '2026-02-03', -20.00, 'TEST', 'seed')
	`)
	if err != nil {
		t.Fatalf("insert txn: %v", err)
	}
	txnID, _ := res.LastInsertId()
	invalidCatID := 999999

	err = updateTransactionDetail(db, int(txnID), &invalidCatID, "should-not-stick")
	if err == nil {
		t.Fatal("expected foreign-key failure for invalid category")
	}

	rows, loadErr := loadRows(db)
	if loadErr != nil {
		t.Fatalf("loadRows: %v", loadErr)
	}
	if len(rows) != 1 {
		t.Fatalf("rows = %d, want 1", len(rows))
	}
	if rows[0].notes != "seed" {
		t.Fatalf("notes changed despite rollback: %q", rows[0].notes)
	}
	if rows[0].categoryID != nil {
		t.Fatalf("categoryID changed despite rollback: %v", rows[0].categoryID)
	}
}

// ---- Category CRUD tests (Phase 4) ----

func TestInsertCategory(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	id, err := insertCategory(db, "Custom", "#f5c2e7")
	if err != nil {
		t.Fatalf("insertCategory: %v", err)
	}
	if id == 0 {
		t.Error("expected non-zero ID")
	}

	cats, err := loadCategories(db)
	if err != nil {
		t.Fatalf("loadCategories: %v", err)
	}
	// Should have default + 1 custom
	if len(cats) != len(defaultCategories)+1 {
		t.Errorf("got %d categories, want %d", len(cats), len(defaultCategories)+1)
	}
	// Last one should be ours (highest sort_order)
	last := cats[len(cats)-1]
	if last.name != "Custom" {
		t.Errorf("last category name = %q, want %q", last.name, "Custom")
	}
	if last.color != "#f5c2e7" {
		t.Errorf("last category color = %q, want %q", last.color, "#f5c2e7")
	}
	if last.isDefault {
		t.Error("custom category should not be default")
	}
}

func TestUpdateCategoryNameAndColor(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	id, err := insertCategory(db, "Old Name", "#aaa")
	if err != nil {
		t.Fatalf("insertCategory: %v", err)
	}
	if err := updateCategory(db, id, "New Name", "#bbb"); err != nil {
		t.Fatalf("updateCategory: %v", err)
	}

	cats, err := loadCategories(db)
	if err != nil {
		t.Fatalf("loadCategories: %v", err)
	}
	found := false
	for _, c := range cats {
		if c.id == id {
			found = true
			if c.name != "New Name" {
				t.Errorf("name = %q, want %q", c.name, "New Name")
			}
			if c.color != "#bbb" {
				t.Errorf("color = %q, want %q", c.color, "#bbb")
			}
		}
	}
	if !found {
		t.Error("updated category not found")
	}
}

func TestDeleteCategory(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	id, err := insertCategory(db, "ToDelete", "#abc")
	if err != nil {
		t.Fatalf("insertCategory: %v", err)
	}
	before, _ := loadCategories(db)

	if err := deleteCategory(db, id); err != nil {
		t.Fatalf("deleteCategory: %v", err)
	}
	after, _ := loadCategories(db)
	if len(after) != len(before)-1 {
		t.Errorf("got %d categories after delete, want %d", len(after), len(before)-1)
	}
	for _, c := range after {
		if c.id == id {
			t.Error("deleted category still found")
		}
	}
}

func TestDeleteDefaultCategoryFails(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	cats, err := loadCategories(db)
	if err != nil {
		t.Fatalf("loadCategories: %v", err)
	}
	// Find "Uncategorised" (is_default = true)
	var defID int
	for _, c := range cats {
		if c.isDefault {
			defID = c.id
			break
		}
	}
	if defID == 0 {
		t.Fatal("no default category found")
	}
	err = deleteCategory(db, defID)
	if err == nil {
		t.Error("expected error when deleting default category")
	}
}

func TestDeleteCategoryNullsTransactions(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	id, err := insertCategory(db, "Temp", "#abc")
	if err != nil {
		t.Fatalf("insertCategory: %v", err)
	}

	// Insert a transaction with this category
	_, err = db.Exec(`
		INSERT INTO transactions (date_raw, date_iso, amount, description, notes, category_id)
		VALUES ('03/02/2026', '2026-02-03', -10.00, 'TEST', '', ?)
	`, id)
	if err != nil {
		t.Fatalf("insert txn: %v", err)
	}

	// Delete category
	if err := deleteCategory(db, id); err != nil {
		t.Fatalf("deleteCategory: %v", err)
	}

	// Transaction should now have NULL category
	rows, _ := loadRows(db)
	if len(rows) != 1 {
		t.Fatalf("expected 1 row, got %d", len(rows))
	}
	if rows[0].categoryID != nil {
		t.Errorf("expected nil category_id, got %v", rows[0].categoryID)
	}
	if rows[0].categoryName != "Uncategorised" {
		t.Errorf("expected fallback name, got %q", rows[0].categoryName)
	}
}

// ---- Category rule CRUD tests (Phase 4) ----

func TestInsertCategoryRule(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	cats, _ := loadCategories(db)
	id, err := insertCategoryRule(db, "WOOLWORTHS", cats[1].id)
	if err != nil {
		t.Fatalf("insertCategoryRule: %v", err)
	}
	if id == 0 {
		t.Error("expected non-zero ID")
	}

	rules, _ := loadCategoryRules(db)
	if len(rules) != 1 {
		t.Fatalf("expected 1 rule, got %d", len(rules))
	}
	if rules[0].pattern != "WOOLWORTHS" {
		t.Errorf("pattern = %q, want %q", rules[0].pattern, "WOOLWORTHS")
	}
}

func TestUpdateCategoryRule(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	cats, _ := loadCategories(db)
	id, _ := insertCategoryRule(db, "OLD", cats[0].id)

	if err := updateCategoryRule(db, id, "NEW", cats[1].id); err != nil {
		t.Fatalf("updateCategoryRule: %v", err)
	}

	rules, _ := loadCategoryRules(db)
	if rules[0].pattern != "NEW" {
		t.Errorf("pattern = %q, want %q", rules[0].pattern, "NEW")
	}
	if rules[0].categoryID != cats[1].id {
		t.Errorf("categoryID = %d, want %d", rules[0].categoryID, cats[1].id)
	}
}

func TestDeleteCategoryRule(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	cats, _ := loadCategories(db)
	id, _ := insertCategoryRule(db, "TEST", cats[0].id)

	if err := deleteCategoryRule(db, id); err != nil {
		t.Fatalf("deleteCategoryRule: %v", err)
	}
	rules, _ := loadCategoryRules(db)
	if len(rules) != 0 {
		t.Errorf("expected 0 rules, got %d", len(rules))
	}
}

func TestDuplicateRulePatternAllowed(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	cats, _ := loadCategories(db)
	_, err := insertCategoryRule(db, "DUP", cats[0].id)
	if err != nil {
		t.Fatalf("first insert: %v", err)
	}
	_, err = insertCategoryRule(db, "DUP", cats[1].id)
	if err != nil {
		t.Fatalf("second insert duplicate pattern: %v", err)
	}
	rules, err := loadCategoryRules(db)
	if err != nil {
		t.Fatalf("loadCategoryRules: %v", err)
	}
	if len(rules) != 2 {
		t.Fatalf("rules len = %d, want 2", len(rules))
	}
}

func TestApplyCategoryRules(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	cats, _ := loadCategories(db)
	groceryID := cats[1].id // Groceries

	// Add rule
	_, _ = insertCategoryRule(db, "WOOLWORTHS", groceryID)

	// Insert transactions (uncategorised)
	_, _ = db.Exec(`
		INSERT INTO transactions (date_raw, date_iso, amount, description, notes)
		VALUES ('03/02/2026', '2026-02-03', -55.30, 'WOOLWORTHS 1234', '')
	`)
	_, _ = db.Exec(`
		INSERT INTO transactions (date_raw, date_iso, amount, description, notes)
		VALUES ('03/02/2026', '2026-02-03', -20.00, 'DAN MURPHYS', '')
	`)

	count, err := applyCategoryRules(db)
	if err != nil {
		t.Fatalf("applyCategoryRules: %v", err)
	}
	if count != 1 {
		t.Errorf("expected 1 updated, got %d", count)
	}

	rows, _ := loadRows(db)
	for _, r := range rows {
		if r.description == "WOOLWORTHS 1234" {
			if r.categoryName != "Groceries" {
				t.Errorf("WOOLWORTHS should be Groceries, got %q", r.categoryName)
			}
		}
		if r.description == "DAN MURPHYS" {
			if r.categoryName != "Uncategorised" {
				t.Errorf("DAN MURPHYS should remain Uncategorised, got %q", r.categoryName)
			}
		}
	}
}

func TestApplyCategoryRulesSkipsCategorised(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	cats, _ := loadCategories(db)
	diningID := cats[2].id  // Dining & Drinks
	groceryID := cats[1].id // Groceries

	// Rule says WOOLWORTHS -> Groceries
	_, _ = insertCategoryRule(db, "WOOLWORTHS", groceryID)

	// Insert transaction already categorised as Dining
	_, _ = db.Exec(`
		INSERT INTO transactions (date_raw, date_iso, amount, description, notes, category_id)
		VALUES ('03/02/2026', '2026-02-03', -55.30, 'WOOLWORTHS 1234', '', ?)
	`, diningID)

	count, _ := applyCategoryRules(db)
	if count != 0 {
		t.Errorf("expected 0 updated (already categorised), got %d", count)
	}

	rows, _ := loadRows(db)
	if rows[0].categoryName != "Dining & Drinks" {
		t.Errorf("should still be Dining, got %q", rows[0].categoryName)
	}
}

func TestApplyCategoryRulesCaseInsensitive(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	cats, _ := loadCategories(db)
	_, _ = insertCategoryRule(db, "woolworths", cats[1].id)

	_, _ = db.Exec(`
		INSERT INTO transactions (date_raw, date_iso, amount, description, notes)
		VALUES ('03/02/2026', '2026-02-03', -55.30, 'WOOLWORTHS 1234', '')
	`)

	count, _ := applyCategoryRules(db)
	if count != 1 {
		t.Errorf("expected case-insensitive match, got %d", count)
	}
}

// ---- Import recording tests (Phase 4) ----

func TestInsertImportRecord(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	id, err := insertImportRecord(db, "test.csv", 42)
	if err != nil {
		t.Fatalf("insertImportRecord: %v", err)
	}
	if id == 0 {
		t.Error("expected non-zero ID")
	}

	imports, _ := loadImports(db)
	if len(imports) != 1 {
		t.Fatalf("expected 1 import, got %d", len(imports))
	}
	if imports[0].filename != "test.csv" {
		t.Errorf("filename = %q, want %q", imports[0].filename, "test.csv")
	}
	if imports[0].rowCount != 42 {
		t.Errorf("rowCount = %d, want %d", imports[0].rowCount, 42)
	}
}

// ---- DB info tests (Phase 4) ----

func TestLoadDBInfo(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	info, err := loadDBInfo(db)
	if err != nil {
		t.Fatalf("loadDBInfo: %v", err)
	}
	if info.schemaVersion != schemaVersion {
		t.Errorf("schemaVersion = %d, want %d", info.schemaVersion, schemaVersion)
	}
	if info.categoryCount != len(defaultCategories) {
		t.Errorf("categoryCount = %d, want %d", info.categoryCount, len(defaultCategories))
	}
	if info.transactionCount != 0 {
		t.Errorf("transactionCount = %d, want 0", info.transactionCount)
	}
	if info.ruleCount != 0 {
		t.Errorf("ruleCount = %d, want 0", info.ruleCount)
	}
	if info.importCount != 0 {
		t.Errorf("importCount = %d, want 0", info.importCount)
	}
}

func TestLoadDBInfoAfterInserts(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	_, _ = db.Exec(`INSERT INTO transactions (date_raw, date_iso, amount, description, notes)
		VALUES ('03/02/2026', '2026-02-03', -20.00, 'TEST', '')`)
	cats, _ := loadCategories(db)
	_, _ = insertCategoryRule(db, "TEST", cats[0].id)
	_, _ = insertImportRecord(db, "test.csv", 1)

	info, err := loadDBInfo(db)
	if err != nil {
		t.Fatalf("loadDBInfo: %v", err)
	}
	if info.transactionCount != 1 {
		t.Errorf("transactionCount = %d, want 1", info.transactionCount)
	}
	if info.ruleCount != 1 {
		t.Errorf("ruleCount = %d, want 1", info.ruleCount)
	}
	if info.importCount != 1 {
		t.Errorf("importCount = %d, want 1", info.importCount)
	}
}

// ---- Clear all data tests (Phase 4) ----

func TestClearAllData(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	// Add some data
	_, _ = db.Exec(`INSERT INTO transactions (date_raw, date_iso, amount, description, notes)
		VALUES ('03/02/2026', '2026-02-03', -20.00, 'TEST', '')`)
	_, _ = insertImportRecord(db, "test.csv", 1)

	if err := clearAllData(db); err != nil {
		t.Fatalf("clearAllData: %v", err)
	}

	rows, _ := loadRows(db)
	if len(rows) != 0 {
		t.Errorf("expected 0 transactions, got %d", len(rows))
	}
	imports, _ := loadImports(db)
	if len(imports) != 0 {
		t.Errorf("expected 0 imports, got %d", len(imports))
	}
	// Categories should be preserved
	cats, _ := loadCategories(db)
	if len(cats) != len(defaultCategories) {
		t.Errorf("expected %d categories preserved, got %d", len(defaultCategories), len(cats))
	}
}

// ---- Foreign key tests ----

func TestTransactionCategoryForeignKey(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	cats, err := loadCategories(db)
	if err != nil {
		t.Fatalf("loadCategories: %v", err)
	}

	// Insert transaction with valid category
	_, err = db.Exec(`
		INSERT INTO transactions (date_raw, date_iso, amount, description, notes, category_id)
		VALUES ('03/02/2026', '2026-02-03', -20.00, 'TEST', '', ?)
	`, cats[0].id)
	if err != nil {
		t.Fatalf("insert with category: %v", err)
	}

	// Verify it's there
	var catID sql.NullInt64
	err = db.QueryRow("SELECT category_id FROM transactions WHERE description='TEST'").Scan(&catID)
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	if !catID.Valid || int(catID.Int64) != cats[0].id {
		t.Errorf("category_id = %v, want %d", catID, cats[0].id)
	}
}

// ---- Account tests (Phase 6) ----

func TestFreshDBHasNoSeedAccounts(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	accounts, err := loadAccounts(db)
	if err != nil {
		t.Fatalf("loadAccounts: %v", err)
	}
	if len(accounts) != 0 {
		t.Fatalf("expected no auto-seeded accounts, got %d", len(accounts))
	}
}

func TestLoadAccountsIncludesTransactionCounts(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	primaryID, err := insertAccount(db, "Primary", "debit", true)
	if err != nil {
		t.Fatalf("insertAccount primary: %v", err)
	}
	emptyID, err := insertAccount(db, "Empty", "debit", true)
	if err != nil {
		t.Fatalf("insertAccount empty: %v", err)
	}

	if _, err := db.Exec(`
		INSERT INTO transactions (date_raw, date_iso, amount, description, notes, account_id)
		VALUES ('03/02/2026', '2026-02-03', -20.00, 'A', '', ?),
		       ('04/02/2026', '2026-02-04', -10.00, 'B', '', ?)
	`, primaryID, primaryID); err != nil {
		t.Fatalf("insert transactions: %v", err)
	}

	accounts, err := loadAccounts(db)
	if err != nil {
		t.Fatalf("loadAccounts: %v", err)
	}
	countByID := make(map[int]int, len(accounts))
	for _, acc := range accounts {
		countByID[acc.id] = acc.txnCount
	}
	if countByID[primaryID] != 2 {
		t.Fatalf("primary txnCount = %d, want 2", countByID[primaryID])
	}
	if countByID[emptyID] != 0 {
		t.Fatalf("empty txnCount = %d, want 0", countByID[emptyID])
	}
}

func TestAccountCRUDAndDeleteGuards(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	accountID, err := insertAccount(db, "Primary", "debit", true)
	if err != nil {
		t.Fatalf("insertAccount: %v", err)
	}

	if err := updateAccount(db, accountID, "Primary Updated", "credit", false); err != nil {
		t.Fatalf("updateAccount: %v", err)
	}

	loaded, err := loadAccountByNameCI(db, "Primary Updated")
	if err != nil {
		t.Fatalf("loadAccountByNameCI: %v", err)
	}
	if loaded == nil {
		t.Fatal("expected updated account to be present")
	}
	if loaded.acctType != "credit" {
		t.Fatalf("acctType = %q, want %q", loaded.acctType, "credit")
	}
	if loaded.isActive {
		t.Fatal("expected account to be inactive after update")
	}

	_, err = db.Exec(`
		INSERT INTO transactions (date_raw, date_iso, amount, description, notes, account_id)
		VALUES ('03/02/2026', '2026-02-03', -20.00, 'ACC-TXN', '', ?)
	`, loaded.id)
	if err != nil {
		t.Fatalf("insert txn with account: %v", err)
	}

	if err := deleteAccountIfEmpty(db, loaded.id); err == nil {
		t.Fatal("expected deleteAccountIfEmpty to fail for non-empty account")
	}

	if n, err := clearTransactionsForAccount(db, loaded.id); err != nil {
		t.Fatalf("clearTransactionsForAccount: %v", err)
	} else if n != 1 {
		t.Fatalf("cleared %d transactions, want 1", n)
	}

	if err := deleteAccountIfEmpty(db, loaded.id); err != nil {
		t.Fatalf("deleteAccountIfEmpty after clear: %v", err)
	}
}

func TestSelectedAccountsRoundTrip(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	a1, err := insertAccount(db, "A1", "debit", true)
	if err != nil {
		t.Fatalf("insertAccount A1: %v", err)
	}
	a2, err := insertAccount(db, "A2", "credit", true)
	if err != nil {
		t.Fatalf("insertAccount A2: %v", err)
	}

	if err := saveSelectedAccounts(db, []int{a1, a2}); err != nil {
		t.Fatalf("saveSelectedAccounts: %v", err)
	}
	selected, err := loadSelectedAccounts(db)
	if err != nil {
		t.Fatalf("loadSelectedAccounts: %v", err)
	}
	if !selected[a1] || !selected[a2] || len(selected) != 2 {
		t.Fatalf("selected accounts = %+v, want {%d:true, %d:true}", selected, a1, a2)
	}

	if err := saveSelectedAccounts(db, nil); err != nil {
		t.Fatalf("clear selected accounts: %v", err)
	}
	selected, err = loadSelectedAccounts(db)
	if err != nil {
		t.Fatalf("loadSelectedAccounts after clear: %v", err)
	}
	if len(selected) != 0 {
		t.Fatalf("expected empty selected accounts after clear, got %+v", selected)
	}
}

func TestTagCRUDAndRuleApplication(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	tagID, err := insertTag(db, "groceries", "#94e2d5", nil)
	if err != nil {
		t.Fatalf("insertTag: %v", err)
	}
	tags, err := loadTags(db)
	if err != nil {
		t.Fatalf("loadTags: %v", err)
	}
	foundInserted := false
	for _, tg := range tags {
		if tg.id == tagID {
			foundInserted = true
			break
		}
	}
	if !foundInserted {
		t.Fatalf("tags = %+v, expected inserted id=%d", tags, tagID)
	}
	categories, err := loadCategories(db)
	if err != nil {
		t.Fatalf("loadCategories: %v", err)
	}
	if len(categories) == 0 {
		t.Fatal("expected seeded categories")
	}
	scopeCatID := categories[0].id
	if err := updateTag(db, tagID, "groceries", "#94e2d5", &scopeCatID); err != nil {
		t.Fatalf("updateTag with scope: %v", err)
	}
	updatedTag, err := loadTagByNameCI(db, "groceries")
	if err != nil {
		t.Fatalf("loadTagByNameCI after update: %v", err)
	}
	if updatedTag == nil || updatedTag.categoryID == nil || *updatedTag.categoryID != scopeCatID {
		t.Fatalf("updated tag scope = %+v, want category_id=%d", updatedTag, scopeCatID)
	}

	if _, err := insertTagRule(db, "WOOLWORTHS", tagID); err != nil {
		t.Fatalf("insertTagRule: %v", err)
	}
	if _, err := db.Exec(`
		INSERT INTO transactions (date_raw, date_iso, amount, description, notes)
		VALUES ('03/02/2026', '2026-02-03', -10.00, 'WOOLWORTHS 123', '')
	`); err != nil {
		t.Fatalf("insert transaction: %v", err)
	}

	if _, err := applyTagRules(db); err != nil {
		t.Fatalf("applyTagRules: %v", err)
	}
	txnTags, err := loadTransactionTags(db)
	if err != nil {
		t.Fatalf("loadTransactionTags: %v", err)
	}
	if len(txnTags) != 1 {
		t.Fatalf("expected tags on one transaction, got %+v", txnTags)
	}
}

func TestTagNamesNormalizeToUppercase(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	tagID, err := insertTag(db, "groceries", "#94e2d5", nil)
	if err != nil {
		t.Fatalf("insertTag: %v", err)
	}
	stored, err := loadTagByNameCI(db, "groceries")
	if err != nil {
		t.Fatalf("loadTagByNameCI: %v", err)
	}
	if stored == nil || stored.id != tagID {
		t.Fatalf("stored tag = %+v, want id=%d", stored, tagID)
	}
	if stored.name != "GROCERIES" {
		t.Fatalf("stored name = %q, want %q", stored.name, "GROCERIES")
	}

	if err := updateTag(db, tagID, "weekly spend", "#89b4fa", nil); err != nil {
		t.Fatalf("updateTag: %v", err)
	}
	stored, err = loadTagByNameCI(db, "weekly spend")
	if err != nil {
		t.Fatalf("loadTagByNameCI after update: %v", err)
	}
	if stored == nil {
		t.Fatal("expected updated tag")
	}
	if stored.name != "WEEKLY SPEND" {
		t.Fatalf("updated name = %q, want %q", stored.name, "WEEKLY SPEND")
	}
}

func TestNormalizeExistingTagNamesMergesCaseDuplicates(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	res, err := db.Exec(`INSERT INTO tags (name, color, category_id, sort_order) VALUES ('mixed', '#89b4fa', NULL, 100)`)
	if err != nil {
		t.Fatalf("insert mixed tag: %v", err)
	}
	firstID64, err := res.LastInsertId()
	if err != nil {
		t.Fatalf("last id first tag: %v", err)
	}
	firstID := int(firstID64)

	res, err = db.Exec(`INSERT INTO tags (name, color, category_id, sort_order) VALUES ('MIXED', '#94e2d5', NULL, 101)`)
	if err != nil {
		t.Fatalf("insert duplicate-case tag: %v", err)
	}
	secondID64, err := res.LastInsertId()
	if err != nil {
		t.Fatalf("last id second tag: %v", err)
	}
	secondID := int(secondID64)

	res, err = db.Exec(`
		INSERT INTO transactions (date_raw, date_iso, amount, description, notes)
		VALUES ('03/02/2026', '2026-02-03', -10.00, 'MERGE CASE TAGS', '')
	`)
	if err != nil {
		t.Fatalf("insert transaction: %v", err)
	}
	txnID64, err := res.LastInsertId()
	if err != nil {
		t.Fatalf("last id txn: %v", err)
	}
	txnID := int(txnID64)

	if _, err := db.Exec(`INSERT INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)`, txnID, firstID); err != nil {
		t.Fatalf("insert transaction tag first: %v", err)
	}
	if _, err := db.Exec(`INSERT INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)`, txnID, secondID); err != nil {
		t.Fatalf("insert transaction tag second: %v", err)
	}
	if _, err := insertTagRule(db, "MERGECASE", secondID); err != nil {
		t.Fatalf("insert tag rule duplicate: %v", err)
	}

	if err := normalizeExistingTagNames(db); err != nil {
		t.Fatalf("normalizeExistingTagNames: %v", err)
	}

	rows, err := db.Query(`SELECT id, name FROM tags WHERE LOWER(name) = LOWER('MIXED')`)
	if err != nil {
		t.Fatalf("query merged tags: %v", err)
	}
	defer rows.Close()
	ids := []int{}
	names := []string{}
	for rows.Next() {
		var id int
		var name string
		if err := rows.Scan(&id, &name); err != nil {
			t.Fatalf("scan merged tag: %v", err)
		}
		ids = append(ids, id)
		names = append(names, name)
	}
	if len(ids) != 1 {
		t.Fatalf("merged tag rows = %v names=%v, want single uppercase tag", ids, names)
	}
	if names[0] != "MIXED" {
		t.Fatalf("merged tag name = %q, want %q", names[0], "MIXED")
	}

	var txnTagCount int
	if err := db.QueryRow(`SELECT COUNT(*) FROM transaction_tags WHERE transaction_id = ?`, txnID).Scan(&txnTagCount); err != nil {
		t.Fatalf("count transaction tags after merge: %v", err)
	}
	if txnTagCount != 1 {
		t.Fatalf("transaction tag count = %d, want 1 after merge", txnTagCount)
	}

	tagRules, err := loadTagRules(db)
	if err != nil {
		t.Fatalf("load tag rules after merge: %v", err)
	}
	mappedRuleTagID := 0
	for _, rule := range tagRules {
		if rule.pattern == "MERGECASE" {
			mappedRuleTagID = rule.tagID
		}
	}
	if mappedRuleTagID == 0 {
		t.Fatalf("expected MERGECASE tag rule after merge, got %+v", tagRules)
	}
	if mappedRuleTagID != ids[0] {
		t.Fatalf("tag rule mapped to %d, want %d", mappedRuleTagID, ids[0])
	}
}

func TestDeleteMandatoryIgnoreTagBlocked(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	tags, err := loadTags(db)
	if err != nil {
		t.Fatalf("loadTags: %v", err)
	}
	ignoreID := 0
	for _, tg := range tags {
		if strings.EqualFold(tg.name, mandatoryIgnoreTagName) {
			ignoreID = tg.id
			break
		}
	}
	if ignoreID == 0 {
		t.Fatalf("missing mandatory tag %q", mandatoryIgnoreTagName)
	}

	if err := deleteTag(db, ignoreID); err == nil {
		t.Fatalf("expected deleting mandatory tag %q to fail", mandatoryIgnoreTagName)
	}
}

func TestTransactionAllocationCapacityValidation(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	accountID, err := insertAccount(db, "Alloc Test", "debit", true)
	if err != nil {
		t.Fatalf("insertAccount: %v", err)
	}
	res, err := db.Exec(`
		INSERT INTO transactions (date_raw, date_iso, amount, description, notes, account_id)
		VALUES ('01/02/2026', '2026-02-01', -50, 'ALLOC PARENT', '', ?)
	`, accountID)
	if err != nil {
		t.Fatalf("insert parent txn: %v", err)
	}
	parentID64, err := res.LastInsertId()
	if err != nil {
		t.Fatalf("last insert id: %v", err)
	}
	parentID := int(parentID64)

	allocationID, err := insertTransactionAllocation(db, parentID, 20, nil, "split", nil)
	if err != nil {
		t.Fatalf("insertTransactionAllocation: %v", err)
	}
	var amount float64
	if err := db.QueryRow(`SELECT amount FROM transaction_allocations WHERE id = ?`, allocationID).Scan(&amount); err != nil {
		t.Fatalf("load allocation amount: %v", err)
	}
	if amount != -20 {
		t.Fatalf("allocation amount = %.2f, want -20", amount)
	}

	if _, err := insertTransactionAllocation(db, parentID, 40, nil, "too much", nil); err == nil {
		t.Fatal("expected over-capacity allocation to fail")
	}
}
