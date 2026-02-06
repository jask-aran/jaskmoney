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

	// Note: the old v1 transaction data is lost (expected — we drop and recreate)
	rows, err := loadRows(db2)
	if err != nil {
		t.Fatalf("loadRows: %v", err)
	}
	if len(rows) != 0 {
		t.Errorf("expected 0 rows after migration, got %d", len(rows))
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
	if rows[0].dateRaw != "04/02/2026" {
		t.Errorf("first row date = %q, want %q", rows[0].dateRaw, "04/02/2026")
	}
	if rows[1].dateRaw != "03/02/2026" {
		t.Errorf("second row date = %q, want %q", rows[1].dateRaw, "03/02/2026")
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
