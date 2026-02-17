package main

import (
	"math"
	"testing"
	"time"
)

func almostEqual(a, b float64) bool {
	return math.Abs(a-b) < 0.0001
}

func TestComputeBudgetLinesUsesDebitsAndOffsetsWithOverride(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()
	now := time.Now().UTC()
	monthKey := now.Format("2006-01")
	monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
	nextMonthStart := monthStart.AddDate(0, 1, 0)

	var groceries category
	cats, err := loadCategories(db)
	if err != nil {
		t.Fatalf("loadCategories: %v", err)
	}
	for _, c := range cats {
		if c.name == "Groceries" {
			groceries = c
			break
		}
	}
	if groceries.id == 0 {
		t.Fatal("missing groceries category")
	}

	budgets, err := loadCategoryBudgets(db)
	if err != nil {
		t.Fatalf("loadCategoryBudgets: %v", err)
	}
	var groceryBudget categoryBudget
	for _, b := range budgets {
		if b.categoryID == groceries.id {
			groceryBudget = b
			break
		}
	}
	if groceryBudget.id == 0 {
		t.Fatal("missing grocery budget row")
	}
	if err := upsertCategoryBudget(db, groceries.id, 100); err != nil {
		t.Fatalf("upsertCategoryBudget: %v", err)
	}
	if err := upsertBudgetOverride(db, groceryBudget.id, monthKey, 80); err != nil {
		t.Fatalf("upsertBudgetOverride: %v", err)
	}
	accountID, err := insertAccount(db, "Budget Test", "debit", true)
	if err != nil {
		t.Fatalf("insertAccount: %v", err)
	}

	res, err := db.Exec(`
		INSERT INTO transactions (date_raw, date_iso, amount, description, notes, category_id, account_id)
		VALUES
			(?,?,?,?,?,?,?),
			(?,?,?,?,?,?,?),
			(?,?,?,?,?,?,?)
	`,
		monthStart.Format("02/01/2006"), monthStart.Format("2006-01-02"), -50, "A", "", groceries.id, accountID,
		nextMonthStart.AddDate(0, 0, -2).Format("02/01/2006"), nextMonthStart.AddDate(0, 0, -2).Format("2006-01-02"), 20, "refund", "", groceries.id, accountID,
		nextMonthStart.AddDate(0, 0, -1).Format("02/01/2006"), nextMonthStart.AddDate(0, 0, -1).Format("2006-01-02"), -10, "B", "", groceries.id, accountID,
	)
	if err != nil {
		t.Fatalf("insert transactions: %v", err)
	}
	lastID, _ := res.LastInsertId()
	debit1 := int(lastID - 2)
	credit := int(lastID - 1)
	if err := insertCreditOffset(db, credit, debit1, 20); err != nil {
		t.Fatalf("insertCreditOffset: %v", err)
	}

	offsets, err := loadCreditOffsets(db)
	if err != nil {
		t.Fatalf("loadCreditOffsets: %v", err)
	}
	byDebit, _ := indexCreditOffsets(offsets)

	budgets, _ = loadCategoryBudgets(db)
	overrides, err := loadBudgetOverrides(db)
	if err != nil {
		t.Fatalf("loadBudgetOverrides: %v", err)
	}

	lines, err := computeBudgetLines(db, budgets, overrides, byDebit, monthKey, nil)
	if err != nil {
		t.Fatalf("computeBudgetLines: %v", err)
	}
	var got *budgetLine
	for i := range lines {
		if lines[i].categoryID == groceries.id {
			got = &lines[i]
			break
		}
	}
	if got == nil {
		t.Fatal("missing groceries line")
	}
	if !almostEqual(got.budgeted, 80) {
		t.Fatalf("budgeted = %.2f, want 80", got.budgeted)
	}
	if !almostEqual(got.spent, 60) {
		t.Fatalf("spent = %.2f, want 60", got.spent)
	}
	if !almostEqual(got.offsets, 20) {
		t.Fatalf("offsets = %.2f, want 20", got.offsets)
	}
	if !almostEqual(got.netSpent, 40) {
		t.Fatalf("netSpent = %.2f, want 40", got.netSpent)
	}
	if !almostEqual(got.remaining, 40) {
		t.Fatalf("remaining = %.2f, want 40", got.remaining)
	}
	if got.overBudget {
		t.Fatal("overBudget = true, want false")
	}

}

func TestComputeTargetLinesUsesSavedFilterIDAndPeriodKeys(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()
	now := time.Now().UTC()
	monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
	prevMonth := monthStart.AddDate(0, -1, 0)
	quarter := (int(now.Month())-1)/3 + 1
	accountID, err := insertAccount(db, "Target Test", "debit", true)
	if err != nil {
		t.Fatalf("insertAccount: %v", err)
	}

	cats, err := loadCategories(db)
	if err != nil {
		t.Fatalf("loadCategories: %v", err)
	}
	groceries := cats[1]

	if _, err := db.Exec(`
		INSERT INTO transactions (date_raw, date_iso, amount, description, notes, category_id, account_id)
		VALUES
			(?,?,?,?,?,?,?),
			(?,?,?,?,?,?,?),
			(?,?,?,?,?,?,?)
		`,
		monthStart.AddDate(0, 0, 9).Format("02/01/2006"), monthStart.AddDate(0, 0, 9).Format("2006-01-02"), -40, "woolies", "", groceries.id, accountID,
		monthStart.AddDate(0, 0, 10).Format("02/01/2006"), monthStart.AddDate(0, 0, 10).Format("2006-01-02"), +10, "refund", "", groceries.id, accountID,
		prevMonth.AddDate(0, 0, 9).Format("02/01/2006"), prevMonth.AddDate(0, 0, 9).Format("2006-01-02"), -30, "woolies prev", "", groceries.id, accountID,
	); err != nil {
		t.Fatalf("insert txns: %v", err)
	}

	rows, err := loadRows(db)
	if err != nil {
		t.Fatalf("loadRows: %v", err)
	}
	var febDebitID, febCreditID int
	for _, r := range rows {
		if r.dateISO == monthStart.AddDate(0, 0, 9).Format("2006-01-02") {
			febDebitID = r.id
		}
		if r.dateISO == monthStart.AddDate(0, 0, 10).Format("2006-01-02") {
			febCreditID = r.id
		}
	}
	if febDebitID == 0 || febCreditID == 0 {
		t.Fatal("missing feb txn ids")
	}
	if err := insertCreditOffset(db, febCreditID, febDebitID, 10); err != nil {
		t.Fatalf("insertCreditOffset: %v", err)
	}
	offsets, _ := loadCreditOffsets(db)
	byDebit, _ := indexCreditOffsets(offsets)

	targets := []spendingTarget{
		{id: 1, name: "Grocery Q1", savedFilterID: "grocery", amount: 200, periodType: "quarterly"},
	}
	saved := []savedFilter{
		{ID: "grocery", Name: "Grocery", Expr: "cat:Groceries"},
	}
	targetLines, err := computeTargetLines(db, targets, nil, byDebit, nil, saved, nil)
	if err != nil {
		t.Fatalf("computeTargetLines: %v", err)
	}
	if len(targetLines) != 1 {
		t.Fatalf("lines=%d want 1", len(targetLines))
	}
	line := targetLines[0]
	wantPeriod := monthStart.Format("2006") + "-Q" + string(rune('0'+quarter))
	if line.periodKey != wantPeriod {
		t.Fatalf("periodKey=%q want %s", line.periodKey, wantPeriod)
	}
	if !almostEqual(line.spent, 70) {
		t.Fatalf("spent=%.2f want 70", line.spent)
	}
	if !almostEqual(line.offsets, 10) {
		t.Fatalf("offsets=%.2f want 10", line.offsets)
	}
	if !almostEqual(line.netSpent, 60) {
		t.Fatalf("netSpent=%.2f want 60", line.netSpent)
	}
}
