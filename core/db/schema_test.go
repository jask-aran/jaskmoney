package db

import (
	"database/sql"
	"testing"

	_ "modernc.org/sqlite"
)

func TestSchemaAndSeedCounts(t *testing.T) {
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := InitSchema(db); err != nil {
		t.Fatal(err)
	}
	if err := SeedTestData(db); err != nil {
		t.Fatal(err)
	}
	accounts, _ := GetAccounts(db)
	cats, _ := GetCategories(db)
	tags, _ := GetTags(db)
	txns, _ := GetTransactions(db)
	if len(accounts) != 3 || len(cats) != 10 || len(tags) != 5 || len(txns) < 100 {
		t.Fatalf("unexpected seed counts: a=%d c=%d t=%d x=%d", len(accounts), len(cats), len(tags), len(txns))
	}
}
