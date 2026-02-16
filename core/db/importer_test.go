package db

import (
	"database/sql"
	"os"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
)

func TestImportFromDirImportsCSVAndSkipsOnSecondRun(t *testing.T) {
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := InitSchema(db); err != nil {
		t.Fatal(err)
	}

	root := t.TempDir()
	importsDir := filepath.Join(root, "imports")
	if err := os.MkdirAll(importsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	csv := "Date,Amount,Description\n3/02/2026,-20.00,WOOLWORTHS\n4/02/2026,1200.00,PAY\n"
	if err := os.WriteFile(filepath.Join(importsDir, "anz-1.csv"), []byte(csv), 0o644); err != nil {
		t.Fatal(err)
	}

	active := true
	accounts := AccountsConfigFile{
		Version: 1,
		Account: map[string]AccountConfig{
			"ANZ": {
				Name:         "ANZ",
				Type:         "credit",
				Active:       &active,
				ImportPrefix: "anz",
				DateFormat:   "2/01/2006",
				HasHeader:    true,
				Delimiter:    ",",
				DateCol:      0,
				AmountCol:    1,
				DescCol:      2,
				DescJoin:     true,
				AmountStrip:  ",",
			},
		},
	}

	summary, err := ImportFromDir(db, importsDir, accounts)
	if err != nil {
		t.Fatalf("ImportFromDir() error = %v", err)
	}
	if summary.FilesSeen != 1 || summary.FilesImported != 1 {
		t.Fatalf("unexpected summary: %+v", summary)
	}
	if summary.RowsImported != 2 || summary.RowsDuplicates != 0 {
		t.Fatalf("unexpected row summary: %+v", summary)
	}

	txns, err := GetTransactions(db)
	if err != nil {
		t.Fatal(err)
	}
	if len(txns) != 2 {
		t.Fatalf("len(transactions) = %d, want 2", len(txns))
	}

	summary2, err := ImportFromDir(db, importsDir, accounts)
	if err != nil {
		t.Fatalf("second ImportFromDir() error = %v", err)
	}
	if summary2.FilesSkipped != 1 || summary2.FilesImported != 0 || summary2.RowsImported != 0 {
		t.Fatalf("expected second run to skip existing file, got %+v", summary2)
	}
}

func TestImportFromDirOnlyChecksDupesAgainstPriorImportFiles(t *testing.T) {
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := InitSchema(db); err != nil {
		t.Fatal(err)
	}

	active := true
	accounts := AccountsConfigFile{
		Version: 1,
		Account: map[string]AccountConfig{
			"ANZ": {
				Name:         "ANZ",
				Type:         "credit",
				Active:       &active,
				ImportPrefix: "anz",
				DateFormat:   "2/01/2006",
				HasHeader:    true,
				Delimiter:    ",",
				DateCol:      0,
				AmountCol:    1,
				DescCol:      2,
				DescJoin:     true,
				AmountStrip:  ",",
			},
		},
	}
	accountID, err := ensureAccount(db, accounts.Account["ANZ"])
	if err != nil {
		t.Fatal(err)
	}

	// Same txn inserted manually should not be considered an import duplicate.
	if _, err := db.Exec(
		`INSERT INTO transactions(account_id, date_iso, amount, description, category_id, notes)
		 VALUES(?, ?, ?, ?, NULL, '')`,
		accountID, "2026-02-03", -20.00, "WOOLWORTHS",
	); err != nil {
		t.Fatal(err)
	}

	root := t.TempDir()
	importsDir := filepath.Join(root, "imports")
	if err := os.MkdirAll(importsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	file1 := "Date,Amount,Description\n3/02/2026,-20.00,WOOLWORTHS\n"
	file2 := "Date,Amount,Description\n3/02/2026,-20.00,WOOLWORTHS\n"
	if err := os.WriteFile(filepath.Join(importsDir, "anz-a.csv"), []byte(file1), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(importsDir, "anz-b.csv"), []byte(file2), 0o644); err != nil {
		t.Fatal(err)
	}

	summary, err := ImportFromDir(db, importsDir, accounts)
	if err != nil {
		t.Fatalf("ImportFromDir() error = %v", err)
	}
	// First imported file inserts row, second imported file is duplicate against first import file only.
	if summary.FilesImported != 2 || summary.RowsImported != 1 || summary.RowsDuplicates != 1 {
		t.Fatalf("unexpected import summary: %+v", summary)
	}
}
