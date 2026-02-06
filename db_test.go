package main

import (
	"database/sql"
	"os"
	"testing"
)

// testDB creates a temporary SQLite database via openDB and returns it along
// with a cleanup function. The DB has the full v2 schema and default categories.
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

func TestOpenDBCreatesV2Schema(t *testing.T) {
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
	tables := []string{"schema_meta", "categories", "category_rules", "transactions", "imports"}
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

// ---- Schema migration tests ----

func TestMigrationFromV1Schema(t *testing.T) {
	// Create a v1-style database (just the transactions table, no schema_meta)
	f, err := os.CreateTemp("", "jaskmoney-v1-*.db")
	if err != nil {
		t.Fatalf("create temp: %v", err)
	}
	path := f.Name()
	f.Close()
	defer os.Remove(path)

	// Create v1 schema manually
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	_, err = db.Exec(`
		CREATE TABLE transactions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			date_raw TEXT NOT NULL,
			date_iso TEXT NOT NULL,
			amount REAL NOT NULL,
			description TEXT NOT NULL
		)
	`)
	if err != nil {
		db.Close()
		t.Fatalf("create v1 schema: %v", err)
	}
	// Insert a v1 row
	_, err = db.Exec(`INSERT INTO transactions (date_raw, date_iso, amount, description)
		VALUES ('03/02/2026', '2026-02-03', -20.00, 'DAN MURPHYS')`)
	if err != nil {
		db.Close()
		t.Fatalf("insert v1 row: %v", err)
	}
	db.Close()

	// Now open with openDB which should detect v0 and migrate
	db2, err := openDB(path)
	if err != nil {
		t.Fatalf("openDB on v1 db: %v", err)
	}
	defer db2.Close()

	// Verify version is now v2
	var ver int
	if err := db2.QueryRow("SELECT version FROM schema_meta LIMIT 1").Scan(&ver); err != nil {
		t.Fatalf("query version: %v", err)
	}
	if ver != schemaVersion {
		t.Errorf("version = %d, want %d", ver, schemaVersion)
	}

	// Verify categories were seeded
	cats, err := loadCategories(db2)
	if err != nil {
		t.Fatalf("loadCategories: %v", err)
	}
	if len(cats) != len(defaultCategories) {
		t.Errorf("got %d categories, want %d", len(cats), len(defaultCategories))
	}

	// Existing v1 transactions should be preserved with category_id = NULL
	rows, err := loadRows(db2)
	if err != nil {
		t.Fatalf("loadRows: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("expected 1 preserved row after migration, got %d", len(rows))
	}
	if rows[0].description != "DAN MURPHYS" {
		t.Errorf("preserved row description = %q, want %q", rows[0].description, "DAN MURPHYS")
	}
	if rows[0].categoryID != nil {
		t.Errorf("preserved row should have nil category_id, got %v", rows[0].categoryID)
	}
	if rows[0].categoryName != "Uncategorised" {
		t.Errorf("preserved row categoryName = %q, want %q", rows[0].categoryName, "Uncategorised")
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
	_, err = db.Exec(`INSERT INTO category_rules (pattern, category_id, priority)
		VALUES ('WOOLWORTHS', ?, 10)`, groceryID)
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

func TestDuplicateRulePatternFails(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	cats, _ := loadCategories(db)
	_, err := insertCategoryRule(db, "DUP", cats[0].id)
	if err != nil {
		t.Fatalf("first insert: %v", err)
	}
	_, err = insertCategoryRule(db, "DUP", cats[1].id)
	if err == nil {
		t.Error("expected error for duplicate pattern")
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
