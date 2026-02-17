package db

import (
	"database/sql"
	"testing"

	_ "modernc.org/sqlite"
)

func TestRulesEngineScopedDryRunAndApply(t *testing.T) {
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := InitSchema(db); err != nil {
		t.Fatal(err)
	}

	accountA, err := UpsertManagedAccount(db, ManagedAccount{Name: "A", Type: "debit", Active: true})
	if err != nil {
		t.Fatal(err)
	}
	accountB, err := UpsertManagedAccount(db, ManagedAccount{Name: "B", Type: "debit", Active: true})
	if err != nil {
		t.Fatal(err)
	}

	catID, err := insertCategoryForRulesTest(db, "Groceries", "#89b4fa")
	if err != nil {
		t.Fatal(err)
	}
	tagID, err := insertTagForRulesTest(db, "food")
	if err != nil {
		t.Fatal(err)
	}

	txnA, err := insertTxnForRulesTest(db, accountA, "2026-02-01", -12.50, "WOOLWORTHS MARKET")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := insertTxnForRulesTest(db, accountB, "2026-02-02", -45.00, "WOOLWORTHS MARKET"); err != nil {
		t.Fatal(err)
	}

	if err := UpsertSavedFilter(db, SavedFilter{
		ID:   "woolies",
		Name: "Woolworths",
		Expr: "desc:woolworths",
	}); err != nil {
		t.Fatal(err)
	}

	if _, err := UpsertRuleV2(db, RuleV2{
		Name:         "Groceries rule",
		SavedFilter:  "woolies",
		SetCategory:  sql.NullInt64{Int64: int64(catID), Valid: true},
		AddTagIDsRaw: EncodeRuleTagIDs([]int{tagID}),
		Enabled:      true,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := UpsertRuleV2(db, RuleV2{
		Name:         "Broken rule",
		SavedFilter:  "missing-filter",
		AddTagIDsRaw: "[]",
		Enabled:      true,
	}); err != nil {
		t.Fatal(err)
	}

	outcomes, drySummary, err := DryRunRulesV2Scoped(db, []int{accountA})
	if err != nil {
		t.Fatalf("dry-run failed: %v", err)
	}
	if drySummary.TransactionsScoped != 1 {
		t.Fatalf("dry-run scoped rows = %d, want 1", drySummary.TransactionsScoped)
	}
	if drySummary.TotalModified != 1 || drySummary.TotalCategoryChanges != 1 || drySummary.TotalTagChanges != 1 {
		t.Fatalf("dry-run summary mismatch: %+v", drySummary)
	}
	if drySummary.FailedRules != 1 {
		t.Fatalf("dry-run failed rules = %d, want 1", drySummary.FailedRules)
	}
	if len(outcomes) != 2 {
		t.Fatalf("outcomes len = %d, want 2", len(outcomes))
	}
	if outcomes[0].RuleName != "Groceries rule" || outcomes[0].Matched != 1 || outcomes[0].CategoryChanges != 1 || outcomes[0].TagChanges != 1 {
		t.Fatalf("unexpected first outcome: %+v", outcomes[0])
	}
	if outcomes[1].Error == "" {
		t.Fatalf("expected second outcome error, got: %+v", outcomes[1])
	}

	applySummary, err := ApplyRulesV2Scoped(db, []int{accountA})
	if err != nil {
		t.Fatalf("apply failed: %v", err)
	}
	if applySummary.TotalModified != 1 || applySummary.TotalCategoryChanges != 1 || applySummary.TotalTagChanges != 1 {
		t.Fatalf("apply summary mismatch: %+v", applySummary)
	}
	if applySummary.FailedRules != 1 {
		t.Fatalf("apply failed rules = %d, want 1", applySummary.FailedRules)
	}

	var categoryID sql.NullInt64
	if err := db.QueryRow(`SELECT category_id FROM transactions WHERE id = ?`, txnA).Scan(&categoryID); err != nil {
		t.Fatal(err)
	}
	if !categoryID.Valid || int(categoryID.Int64) != catID {
		t.Fatalf("txnA category = %+v, want %d", categoryID, catID)
	}
	var tagCount int
	if err := db.QueryRow(`SELECT COUNT(*) FROM transaction_tags WHERE transaction_id = ? AND tag_id = ?`, txnA, tagID).Scan(&tagCount); err != nil {
		t.Fatal(err)
	}
	if tagCount != 1 {
		t.Fatalf("txnA tag count = %d, want 1", tagCount)
	}

	var accountBTagged int
	if err := db.QueryRow(`
		SELECT COUNT(*)
		FROM transaction_tags tt
		JOIN transactions t ON t.id = tt.transaction_id
		WHERE t.account_id = ?
	`, accountB).Scan(&accountBTagged); err != nil {
		t.Fatal(err)
	}
	if accountBTagged != 0 {
		t.Fatalf("account B tags updated unexpectedly: %d", accountBTagged)
	}
}

func insertCategoryForRulesTest(db *sql.DB, name, color string) (int, error) {
	res, err := db.Exec(`INSERT INTO categories(name, color, sort_order, is_default) VALUES(?, ?, 1, 0)`, name, color)
	if err != nil {
		return 0, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return 0, err
	}
	return int(id), nil
}

func insertTagForRulesTest(db *sql.DB, name string) (int, error) {
	res, err := db.Exec(`INSERT INTO tags(name, color, scope_id, sort_order) VALUES(?, '#94e2d5', NULL, 1)`, name)
	if err != nil {
		return 0, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return 0, err
	}
	return int(id), nil
}

func insertTxnForRulesTest(db *sql.DB, accountID int, dateISO string, amount float64, description string) (int, error) {
	res, err := db.Exec(`
		INSERT INTO transactions(account_id, import_index, date_iso, amount, description, category_id, notes)
		VALUES(?, 1, ?, ?, ?, NULL, '')
	`, accountID, dateISO, amount, description)
	if err != nil {
		return 0, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return 0, err
	}
	return int(id), nil
}
