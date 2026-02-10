package main

import (
	"testing"

	tea "github.com/charmbracelet/bubbletea"
)

func testPhase5Model(t *testing.T) (model, func()) {
	t.Helper()
	db, cleanup := testDB(t)

	_, err := db.Exec(`
		INSERT INTO transactions (date_raw, date_iso, amount, description, notes)
		VALUES
			('03/02/2026', '2026-02-03', -10.00, 'PHASE5 A', ''),
			('03/02/2026', '2026-02-03', -20.00, 'PHASE5 B', ''),
			('03/02/2026', '2026-02-03', -30.00, 'PHASE5 C', '')
	`)
	if err != nil {
		cleanup()
		t.Fatalf("insert txns: %v", err)
	}

	rows, err := loadRows(db)
	if err != nil {
		cleanup()
		t.Fatalf("loadRows: %v", err)
	}
	cats, err := loadCategories(db)
	if err != nil {
		cleanup()
		t.Fatalf("loadCategories: %v", err)
	}

	m := newModel()
	m.db = db
	m.ready = true
	m.activeTab = tabManager
	m.managerMode = managerModeTransactions
	m.rows = rows
	m.categories = cats
	return m, cleanup
}

func runCmdUpdate(t *testing.T, m model, cmd func() tea.Msg) model {
	t.Helper()
	if cmd == nil {
		t.Fatal("expected non-nil command")
	}
	msg := cmd()
	next, nextCmd := m.Update(msg)
	got := next.(model)
	if nextCmd != nil {
		next2, _ := got.Update(nextCmd())
		return next2.(model)
	}
	return got
}

func TestPhase5OpenQuickCategoryPickerOnCursorRow(t *testing.T) {
	m, cleanup := testPhase5Model(t)
	defer cleanup()

	filtered := m.getFilteredRows()
	cursorID := filtered[m.cursor].id

	m2, _ := m.Update(keyMsg("c"))
	got := m2.(model)
	if got.catPicker == nil {
		t.Fatal("expected category picker to open")
	}
	if len(got.catPickerFor) != 1 || got.catPickerFor[0] != cursorID {
		t.Fatalf("picker targets = %v, want [%d]", got.catPickerFor, cursorID)
	}
}

func TestPhase5QuickCategorizeSingleRow(t *testing.T) {
	m, cleanup := testPhase5Model(t)
	defer cleanup()

	m2, _ := m.Update(keyMsg("c"))
	got := m2.(model)
	if got.catPicker == nil {
		t.Fatal("expected picker open")
	}
	got.catPicker.SetQuery("groc")

	m3, cmd := got.Update(keyMsg("enter"))
	got2 := m3.(model)
	got3 := runCmdUpdate(t, got2, cmd)

	targetID := got.catPickerFor[0]
	var target *transaction
	for i := range got3.rows {
		if got3.rows[i].id == targetID {
			target = &got3.rows[i]
			break
		}
	}
	if target == nil {
		t.Fatalf("target txn %d not found after refresh", targetID)
	}
	if target.categoryName != "Groceries" {
		t.Fatalf("category = %q, want %q", target.categoryName, "Groceries")
	}
}

func TestPhase5QuickCategorizeBulkKeepsSelection(t *testing.T) {
	m, cleanup := testPhase5Model(t)
	defer cleanup()

	filtered := m.getFilteredRows()
	if len(filtered) < 2 {
		t.Fatal("need at least two transactions")
	}
	idA := filtered[0].id
	idB := filtered[1].id
	m.selectedRows = map[int]bool{idA: true, idB: true}

	m2, _ := m.Update(keyMsg("c"))
	got := m2.(model)
	if got.catPicker == nil {
		t.Fatal("expected picker open")
	}
	got.catPicker.SetQuery("transport")

	m3, cmd := got.Update(keyMsg("enter"))
	got2 := m3.(model)
	got3 := runCmdUpdate(t, got2, cmd)

	if !got3.selectedRows[idA] || !got3.selectedRows[idB] {
		t.Fatalf("expected selectedRows to persist, got %v", got3.selectedRows)
	}
	for _, id := range []int{idA, idB} {
		var found bool
		for i := range got3.rows {
			if got3.rows[i].id == id {
				found = true
				if got3.rows[i].categoryName != "Transport" {
					t.Fatalf("txn %d category = %q, want %q", id, got3.rows[i].categoryName, "Transport")
				}
			}
		}
		if !found {
			t.Fatalf("txn %d missing", id)
		}
	}
}

func TestPhase5QuickCategorizeCreateInline(t *testing.T) {
	m, cleanup := testPhase5Model(t)
	defer cleanup()

	m2, _ := m.Update(keyMsg("c"))
	got := m2.(model)
	got.catPicker.SetQuery("Phase5 Created Cat")

	m3, cmd := got.Update(keyMsg("enter"))
	got2 := m3.(model)
	got3 := runCmdUpdate(t, got2, cmd)

	targetID := got.catPickerFor[0]
	var found bool
	for i := range got3.rows {
		if got3.rows[i].id == targetID {
			found = true
			if got3.rows[i].categoryName != "Phase5 Created Cat" {
				t.Fatalf("category = %q, want created category", got3.rows[i].categoryName)
			}
		}
	}
	if !found {
		t.Fatalf("target txn %d not found", targetID)
	}
}

func TestPhase5QuickCategorizeEscCancels(t *testing.T) {
	m, cleanup := testPhase5Model(t)
	defer cleanup()

	m2, _ := m.Update(keyMsg("c"))
	got := m2.(model)
	if got.catPicker == nil {
		t.Fatal("picker should be open")
	}

	m3, _ := got.Update(keyMsg("esc"))
	got2 := m3.(model)
	if got2.catPicker != nil {
		t.Fatal("picker should be closed after esc")
	}
}

func TestPhase5FooterBindingsUseCategoryPickerScope(t *testing.T) {
	m := newModel()
	m.catPicker = newPicker("Quick Categorize", nil, false, "Create")

	bindings := m.footerBindings()
	if len(bindings) != 3 {
		t.Fatalf("footer bindings count = %d, want 3", len(bindings))
	}
	if bindings[0].Help().Key != "j/k" {
		t.Fatalf("footer[0] key = %q, want %q", bindings[0].Help().Key, "j/k")
	}
	if bindings[1].Help().Key != "enter" {
		t.Fatalf("footer[1] key = %q, want %q", bindings[1].Help().Key, "enter")
	}
	if bindings[2].Help().Key != "esc" {
		t.Fatalf("footer[2] key = %q, want %q", bindings[2].Help().Key, "esc")
	}
}

func TestUpdateTransactionsCategoryBulk(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	res, err := db.Exec(`
		INSERT INTO transactions (date_raw, date_iso, amount, description, notes)
		VALUES ('03/02/2026', '2026-02-03', -10.00, 'BULK A', ''),
		       ('03/02/2026', '2026-02-03', -20.00, 'BULK B', '')
	`)
	if err != nil {
		t.Fatalf("insert txns: %v", err)
	}
	lastID, err := res.LastInsertId()
	if err != nil {
		t.Fatalf("last insert id: %v", err)
	}
	idB := int(lastID)
	idA := idB - 1

	cats, err := loadCategories(db)
	if err != nil {
		t.Fatalf("load categories: %v", err)
	}
	catID := cats[1].id // Groceries

	n, err := updateTransactionsCategory(db, []int{idA, idB}, &catID)
	if err != nil {
		t.Fatalf("updateTransactionsCategory: %v", err)
	}
	if n != 2 {
		t.Fatalf("rows affected = %d, want 2", n)
	}

	rows, err := loadRows(db)
	if err != nil {
		t.Fatalf("loadRows: %v", err)
	}
	seen := 0
	for _, r := range rows {
		if r.id == idA || r.id == idB {
			seen++
			if r.categoryName != "Groceries" {
				t.Fatalf("txn %d category = %q, want %q", r.id, r.categoryName, "Groceries")
			}
		}
	}
	if seen != 2 {
		t.Fatalf("found %d updated txns, want 2", seen)
	}
}
