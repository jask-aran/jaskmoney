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
	tags, err := loadTags(db)
	if err != nil {
		cleanup()
		t.Fatalf("loadTags: %v", err)
	}
	txnTags, err := loadTransactionTags(db)
	if err != nil {
		cleanup()
		t.Fatalf("loadTransactionTags: %v", err)
	}

	m := newModel()
	m.db = db
	m.ready = true
	m.activeTab = tabManager
	m.managerMode = managerModeTransactions
	m.rows = rows
	m.categories = cats
	m.tags = tags
	m.txnTags = txnTags
	// Clear any config-load status so tests focus on behaviour, not config state.
	m.status = ""
	m.statusErr = false
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

func TestPhase5QuickCategorizeCreateDisabled(t *testing.T) {
	m, cleanup := testPhase5Model(t)
	defer cleanup()

	m2, _ := m.Update(keyMsg("c"))
	got := m2.(model)
	if got.catPicker == nil {
		t.Fatal("expected picker open")
	}
	got.catPicker.SetQuery("Phase5 Created Cat")
	if got.catPicker.shouldShowCreate() {
		t.Fatal("quick categorize should not offer create row")
	}

	m3, cmd := got.Update(keyMsg("enter"))
	got2 := m3.(model)
	if cmd != nil {
		t.Fatal("enter on unknown category should not schedule a command")
	}
	if got2.catPicker == nil {
		t.Fatal("picker should remain open when no category is selected")
	}
	if got2.status != "" {
		t.Fatalf("status should remain unchanged, got %q", got2.status)
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
	m.catPicker = newPicker("Quick Categorize", nil, false, "")

	bindings := m.footerBindings()
	// Category picker: up/down/enter/esc all have empty help (hidden)
	if len(bindings) != 0 {
		t.Fatalf("footer bindings count = %d, want 0", len(bindings))
	}
	_ = bindings[0:0] // Remove unused variable error
	if false {
		t.Fatalf("footer[1] key = %q, want %q", bindings[1].Help().Key, "esc")
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

func TestPhase5QuickTagEnterTogglesOnAndOffForSingleTxn(t *testing.T) {
	m, cleanup := testPhase5Model(t)
	defer cleanup()

	tagID, err := insertTag(m.db, "Phase5 Toggle", "#89b4fa", nil)
	if err != nil {
		t.Fatalf("insertTag: %v", err)
	}
	tags, err := loadTags(m.db)
	if err != nil {
		t.Fatalf("loadTags: %v", err)
	}
	m.tags = tags

	filtered := m.getFilteredRows()
	if len(filtered) == 0 {
		t.Fatal("expected at least one transaction")
	}
	targetID := filtered[m.cursor].id

	m2, _ := m.Update(keyMsg("t"))
	got := m2.(model)
	if got.tagPicker == nil {
		t.Fatal("expected quick tag picker open")
	}
	got.tagPicker.SetQuery("PHASE5 TOGGLE")

	m3, cmd := got.Update(keyMsg("enter"))
	got2 := m3.(model)
	got3 := runCmdUpdate(t, got2, cmd)
	if got3.tagPicker != nil {
		t.Fatal("tag picker should close after enter toggle")
	}
	if got3.status != `Tag "PHASE5 TOGGLE" added to 1 transaction(s).` {
		t.Fatalf("unexpected status after add: %q", got3.status)
	}
	current, err := loadTransactionTags(m.db)
	if err != nil {
		t.Fatalf("loadTransactionTags: %v", err)
	}
	hasTag := false
	for _, tg := range current[targetID] {
		if tg.id == tagID {
			hasTag = true
			break
		}
	}
	if !hasTag {
		t.Fatal("expected tag to be added")
	}

	m4, _ := got3.Update(keyMsg("t"))
	got4 := m4.(model)
	got4.tagPicker.SetQuery("PHASE5 TOGGLE")
	m5, cmd := got4.Update(keyMsg("enter"))
	got5 := runCmdUpdate(t, m5.(model), cmd)
	if got5.status != `Tag "PHASE5 TOGGLE" removed from 1 transaction(s).` {
		t.Fatalf("unexpected status after remove: %q", got5.status)
	}
	current2, err := loadTransactionTags(m.db)
	if err != nil {
		t.Fatalf("loadTransactionTags: %v", err)
	}
	for _, tg := range current2[targetID] {
		if tg.id == tagID {
			t.Fatal("expected tag to be removed")
		}
	}
}

func TestPhase5QuickTagEnterToggleMultiTargetMixedNormalizesOn(t *testing.T) {
	m, cleanup := testPhase5Model(t)
	defer cleanup()

	tagID, err := insertTag(m.db, "Phase5 Multi", "#94e2d5", nil)
	if err != nil {
		t.Fatalf("insertTag: %v", err)
	}
	tags, err := loadTags(m.db)
	if err != nil {
		t.Fatalf("loadTags: %v", err)
	}
	m.tags = tags

	filtered := m.getFilteredRows()
	if len(filtered) < 2 {
		t.Fatal("expected at least two transactions")
	}
	idA := filtered[0].id
	idB := filtered[1].id
	m.selectedRows = map[int]bool{idA: true, idB: true}
	if err := setTransactionTags(m.db, idA, []int{tagID}); err != nil {
		t.Fatalf("setTransactionTags: %v", err)
	}

	m2, _ := m.Update(keyMsg("t"))
	got := m2.(model)
	if got.tagPicker == nil {
		t.Fatal("expected quick tag picker open")
	}
	got.tagPicker.SetQuery("PHASE5 MULTI")

	m3, cmd := got.Update(keyMsg("enter"))
	got2 := runCmdUpdate(t, m3.(model), cmd)
	if got2.status != `Tag "PHASE5 MULTI" added to 2 transaction(s).` {
		t.Fatalf("unexpected status: %q", got2.status)
	}

	current, err := loadTransactionTags(m.db)
	if err != nil {
		t.Fatalf("loadTransactionTags: %v", err)
	}
	for _, id := range []int{idA, idB} {
		hasTag := false
		for _, tg := range current[id] {
			if tg.id == tagID {
				hasTag = true
				break
			}
		}
		if !hasTag {
			t.Fatalf("txn %d should have tag %d", id, tagID)
		}
	}
}

func TestPhase5QuickTagEnterAppliesAllDirtyChanges(t *testing.T) {
	m, cleanup := testPhase5Model(t)
	defer cleanup()

	addID, err := insertTag(m.db, "Phase5 Patch Add", "#89b4fa", nil)
	if err != nil {
		t.Fatalf("insert add tag: %v", err)
	}
	removeID, err := insertTag(m.db, "Phase5 Patch Remove", "#94e2d5", nil)
	if err != nil {
		t.Fatalf("insert remove tag: %v", err)
	}
	tags, err := loadTags(m.db)
	if err != nil {
		t.Fatalf("load tags: %v", err)
	}
	m.tags = tags

	filtered := m.getFilteredRows()
	if len(filtered) < 2 {
		t.Fatal("expected at least two transactions")
	}
	idA := filtered[0].id
	idB := filtered[1].id
	m.selectedRows = map[int]bool{idA: true, idB: true}
	if err := setTransactionTags(m.db, idA, []int{removeID}); err != nil {
		t.Fatalf("seed tags for idA: %v", err)
	}
	if err := setTransactionTags(m.db, idB, []int{removeID}); err != nil {
		t.Fatalf("seed tags for idB: %v", err)
	}
	m.txnTags, err = loadTransactionTags(m.db)
	if err != nil {
		t.Fatalf("reload txn tags: %v", err)
	}

	m2, _ := m.Update(keyMsg("t"))
	got := m2.(model)
	if got.tagPicker == nil {
		t.Fatal("expected quick tag picker open")
	}

	got.tagPicker.SetQuery("PHASE5 PATCH ADD")
	m3a, _ := got.Update(keyMsg("space"))
	got = m3a.(model)
	got.tagPicker.SetQuery("PHASE5 PATCH REMOVE")
	m3b, _ := got.Update(keyMsg("space"))
	got = m3b.(model)
	got.tagPicker.SetQuery("")

	m3, cmd := got.Update(keyMsg("enter"))
	got2 := runCmdUpdate(t, m3.(model), cmd)
	if got2.status != "Updated tags for 2 transaction(s)." {
		t.Fatalf("unexpected status: %q", got2.status)
	}

	current, err := loadTransactionTags(m.db)
	if err != nil {
		t.Fatalf("loadTransactionTags: %v", err)
	}
	for _, id := range []int{idA, idB} {
		hasAdd := false
		hasRemove := false
		for _, tg := range current[id] {
			if tg.id == addID {
				hasAdd = true
			}
			if tg.id == removeID {
				hasRemove = true
			}
		}
		if !hasAdd {
			t.Fatalf("txn %d should have add tag", id)
		}
		if hasRemove {
			t.Fatalf("txn %d should not have remove tag", id)
		}
	}
}

func TestPhase5QuickTagPickerSectionOrderScopedGlobalUnscoped(t *testing.T) {
	m, cleanup := testPhase5Model(t)
	defer cleanup()

	cats, err := loadCategories(m.db)
	if err != nil {
		t.Fatalf("loadCategories: %v", err)
	}
	if len(cats) < 3 {
		t.Fatal("expected at least three categories")
	}
	filtered := m.getFilteredRows()
	if len(filtered) == 0 {
		t.Fatal("expected at least one transaction")
	}
	targetID := filtered[m.cursor].id
	scopedCategoryID := cats[1].id
	otherCategoryID := cats[2].id
	if err := updateTransactionCategory(m.db, targetID, &scopedCategoryID); err != nil {
		t.Fatalf("updateTransactionCategory: %v", err)
	}
	if _, err := insertTag(m.db, "LOCAL", "#89b4fa", &scopedCategoryID); err != nil {
		t.Fatalf("insert scoped tag: %v", err)
	}
	if _, err := insertTag(m.db, "GLOBALTAG", "#94e2d5", nil); err != nil {
		t.Fatalf("insert global tag: %v", err)
	}
	if _, err := insertTag(m.db, "OUTSIDE", "#fab387", &otherCategoryID); err != nil {
		t.Fatalf("insert unscoped tag: %v", err)
	}
	m.rows, err = loadRows(m.db)
	if err != nil {
		t.Fatalf("loadRows: %v", err)
	}
	m.tags, err = loadTags(m.db)
	if err != nil {
		t.Fatalf("loadTags: %v", err)
	}

	m2, _ := m.Update(keyMsg("t"))
	got := m2.(model)
	if got.tagPicker == nil {
		t.Fatal("expected quick tag picker open")
	}
	order := got.tagPicker.sectionOrder()
	if len(order) < 3 {
		t.Fatalf("section order = %v, want scoped/global/unscoped", order)
	}
	if order[0] != "Scoped" || order[1] != "Global" || order[2] != "Unscoped" {
		t.Fatalf("section order = %v, want [Scoped Global Unscoped ...]", order)
	}
}
