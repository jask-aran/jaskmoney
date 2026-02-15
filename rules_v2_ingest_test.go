package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestIngestCmdRulesV2TargetsImportedRowsOnly(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	accountID, err := insertAccount(db, "ANZ", "debit", true)
	if err != nil {
		t.Fatalf("insert account: %v", err)
	}
	cats, err := loadCategories(db)
	if err != nil {
		t.Fatalf("load categories: %v", err)
	}
	groceries := cats[1].id
	tagID, err := insertTag(db, "WEEKLY", "#89b4fa", nil)
	if err != nil {
		t.Fatalf("insert tag: %v", err)
	}

	if _, err := db.Exec(`
		INSERT INTO transactions (date_raw, date_iso, amount, description, notes, account_id)
		VALUES ('1/01/2026', '2026-01-01', -12.50, 'WOOLWORTHS EXISTING', '', ?)
	`, accountID); err != nil {
		t.Fatalf("insert existing txn: %v", err)
	}

	_, err = insertRuleV2(db, ruleV2{
		name:          "Groceries",
		filterExpr:    `desc:woolworths`,
		setCategoryID: &groceries,
		addTagIDs:     []int{tagID},
		enabled:       true,
	})
	if err != nil {
		t.Fatalf("insert rule: %v", err)
	}

	dir := t.TempDir()
	file := "anz-rulesv2.csv"
	path := filepath.Join(dir, file)
	csv := "3/02/2026,-20.00,WOOLWORTHS IMPORTED\n"
	if err := os.WriteFile(path, []byte(csv), 0o644); err != nil {
		t.Fatalf("write csv: %v", err)
	}

	formats := []csvFormat{testANZFormat()}
	formats[0].Account = "ANZ"
	formats[0].ImportPrefix = "anz"

	msg := ingestCmd(db, file, dir, formats, true)()
	done, ok := msg.(ingestDoneMsg)
	if !ok {
		t.Fatalf("unexpected message type: %T", msg)
	}
	if done.err != nil {
		t.Fatalf("ingest failed: %v", done.err)
	}

	rows, err := loadRows(db)
	if err != nil {
		t.Fatalf("load rows: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("rows len = %d, want 2", len(rows))
	}

	var existing transaction
	var imported transaction
	for _, row := range rows {
		switch row.description {
		case "WOOLWORTHS EXISTING":
			existing = row
		case "WOOLWORTHS IMPORTED":
			imported = row
		}
	}
	if existing.id == 0 || imported.id == 0 {
		t.Fatalf("missing expected rows existing=%+v imported=%+v", existing, imported)
	}

	if existing.categoryID != nil {
		t.Fatalf("existing txn category changed unexpectedly: %v", existing.categoryID)
	}
	if imported.categoryID == nil || *imported.categoryID != groceries {
		t.Fatalf("imported txn category = %v, want groceries id=%d", imported.categoryID, groceries)
	}

	txnTags, err := loadTransactionTags(db)
	if err != nil {
		t.Fatalf("load txn tags: %v", err)
	}
	if len(txnTags[existing.id]) != 0 {
		t.Fatalf("existing txn tags changed unexpectedly: %+v", txnTags[existing.id])
	}
	if len(txnTags[imported.id]) != 1 || txnTags[imported.id][0].id != tagID {
		t.Fatalf("imported txn tags = %+v, want WEEKLY", txnTags[imported.id])
	}
}
