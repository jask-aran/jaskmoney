package main

import (
	"strings"
	"testing"
)

func testKeyForAction(m model, scope string, action Action, fallback string) string {
	bs := m.keys.BindingsForScope(scope)
	for _, b := range bs {
		if b.Action == action && len(b.Keys) > 0 {
			return b.Keys[0]
		}
	}
	return fallback
}

func testPhase3Model() model {
	m := newModel()
	m.ready = true
	m.activeTab = tabManager
	m.managerMode = managerModeTransactions
	m.rows = testTransactions()
	m.categories = []category{
		{id: 2, name: "Groceries", color: "#94e2d5"},
		{id: 3, name: "Dining & Drinks", color: "#fab387"},
		{id: 4, name: "Transport", color: "#89b4fa"},
		{id: 10, name: "Uncategorised", color: "#7f849c", isDefault: true},
	}
	return m
}

func TestPhase3ToggleSelectionSpace(t *testing.T) {
	m := testPhase3Model()
	filtered := m.getFilteredRows()
	if len(filtered) == 0 {
		t.Fatal("expected test transactions")
	}
	selectedID := filtered[m.cursor].id

	toggleKey := testKeyForAction(m, scopeTransactions, actionToggleSelect, "space")
	m2, _ := m.updateNavigation(keyMsg(toggleKey))
	got := m2.(model)
	if !got.selectedRows[selectedID] {
		t.Fatalf("transaction %d should be selected after space", selectedID)
	}

	m3, _ := got.updateNavigation(keyMsg(toggleKey))
	got2 := m3.(model)
	if got2.selectedRows[selectedID] {
		t.Fatalf("transaction %d should be unselected after second space", selectedID)
	}
}

func TestPhase3ShiftMoveCreatesHighlightRange(t *testing.T) {
	m := testPhase3Model()
	if len(m.getFilteredRows()) < 3 {
		t.Fatal("expected at least three rows for range test")
	}

	m2, _ := m.updateNavigation(keyMsg("shift+down"))
	got := m2.(model)
	if !got.rangeSelecting {
		t.Fatal("shift+down should activate range highlight")
	}

	m3, _ := got.updateNavigation(keyMsg("shift+down"))
	got2 := m3.(model)
	highlighted := got2.highlightedRows(got2.getFilteredRows())
	if len(highlighted) != 3 {
		t.Fatalf("highlighted row count = %d, want 3", len(highlighted))
	}
	filtered := got2.getFilteredRows()
	for i := 0; i <= 2; i++ {
		if !highlighted[filtered[i].id] {
			t.Fatalf("row id %d should be highlighted", filtered[i].id)
		}
	}
}

func TestPhase3SpaceTogglesActiveHighlightRange(t *testing.T) {
	m := testPhase3Model()
	m2, _ := m.updateNavigation(keyMsg("shift+down"))
	got := m2.(model)
	m3, _ := got.updateNavigation(keyMsg("shift+down"))
	got2 := m3.(model)

	highlighted := got2.highlightedRows(got2.getFilteredRows())
	if len(highlighted) == 0 {
		t.Fatal("expected active highlighted range")
	}

	// First space selects all highlighted rows.
	toggleKey := testKeyForAction(got2, scopeTransactions, actionToggleSelect, "space")
	m4, _ := got2.updateNavigation(keyMsg(toggleKey))
	got3 := m4.(model)
	for id := range highlighted {
		if !got3.selectedRows[id] {
			t.Fatalf("id %d should be selected after range toggle", id)
		}
	}

	// Second space deselects them all.
	m5, _ := got3.updateNavigation(keyMsg(toggleKey))
	got4 := m5.(model)
	for id := range highlighted {
		if got4.selectedRows[id] {
			t.Fatalf("id %d should be deselected after second range toggle", id)
		}
	}
}

func TestPhase3NonShiftMoveClearsHighlight(t *testing.T) {
	m := testPhase3Model()
	m2, _ := m.updateNavigation(keyMsg("shift+down"))
	got := m2.(model)
	if !got.rangeSelecting {
		t.Fatal("range highlight should be active")
	}

	m3, _ := got.updateNavigation(keyMsg("j"))
	got2 := m3.(model)
	if got2.rangeSelecting {
		t.Fatal("plain movement should clear range highlight")
	}
}

func TestPhase3EscClearsSearchBeforeSelectionAndHighlight(t *testing.T) {
	m := testPhase3Model()
	m.searchQuery = "wool"
	toggleKey := testKeyForAction(m, scopeTransactions, actionToggleSelect, "space")
	m2, _ := m.updateNavigation(keyMsg(toggleKey))
	got := m2.(model)
	m3, _ := got.updateNavigation(keyMsg("shift+down"))
	got2 := m3.(model)

	if got2.selectedCount() == 0 {
		t.Fatal("expected at least one selected row")
	}
	if !got2.rangeSelecting {
		t.Fatal("expected active range highlight")
	}

	// 1st esc clears search and keeps selection/highlight intact.
	m4, _ := got2.updateNavigation(keyMsg("esc"))
	got3 := m4.(model)
	if got3.searchQuery != "" {
		t.Fatalf("search query should clear first, got %q", got3.searchQuery)
	}
	if got3.selectedCount() == 0 {
		t.Fatal("selection should remain when clearing search")
	}
	if !got3.rangeSelecting {
		t.Fatal("range highlight should remain when clearing search")
	}

	// 2nd esc clears highlight.
	m5, _ := got3.updateNavigation(keyMsg("esc"))
	got4 := m5.(model)
	if got4.rangeSelecting {
		t.Fatal("range highlight should clear after search is already empty")
	}
	if got4.selectedCount() == 0 {
		t.Fatal("selection should remain after clearing highlight")
	}

	// 3rd esc clears selected rows.
	m6, _ := got4.updateNavigation(keyMsg("esc"))
	got5 := m6.(model)
	if got5.selectedCount() != 0 {
		t.Fatalf("expected selections cleared, got %d", got5.selectedCount())
	}
}

func TestPhase3SelectionPersistsAcrossSortAndFilterChanges(t *testing.T) {
	m := testPhase3Model()
	m.cursor = 2 // uncategorised row in default date-desc ordering
	filtered := m.getFilteredRows()
	selectedID := filtered[m.cursor].id

	toggleKey := testKeyForAction(m, scopeTransactions, actionToggleSelect, "space")
	m2, _ := m.updateNavigation(keyMsg(toggleKey))
	got := m2.(model)
	if !got.selectedRows[selectedID] {
		t.Fatalf("id %d should be selected", selectedID)
	}

	sortKey := testKeyForAction(got, scopeTransactions, actionSort, "s")
	m3, _ := got.updateNavigation(keyMsg(sortKey))
	got2 := m3.(model)
	if !got2.selectedRows[selectedID] {
		t.Fatalf("id %d selection should persist after sort", selectedID)
	}

	filterKey := testKeyForAction(got2, scopeTransactions, actionFilterCategory, "f")
	m4, _ := got2.updateNavigation(keyMsg(filterKey))
	got3 := m4.(model)
	if !got3.selectedRows[selectedID] {
		t.Fatalf("id %d selection should persist after filter change", selectedID)
	}
}

func TestPhase3ManagerTransactionsTitleShowsSelectionCount(t *testing.T) {
	m := testPhase3Model()
	m.selectedRows = map[int]bool{1: true, 3: true}

	view := m.managerView()
	if !strings.Contains(view, "Transactions (2 selected)") {
		t.Fatalf("transactions title should include selection count, got: %q", view)
	}
}

func TestPhase3RenderSelectionPrefixes(t *testing.T) {
	rows := testTransactions()
	selected := map[int]bool{rows[0].id: true, rows[1].id: true}
	highlighted := map[int]bool{rows[1].id: true}
	out := renderTransactionTable(rows, nil, nil, selected, highlighted, rows[0].id, 0, 5, 80, sortByDate, false)

	if strings.Contains(out, "*>") || strings.Contains(out, "> ") {
		t.Fatalf("table should not render prefix cursor markers: %q", out)
	}
}

func TestPhase3QuickActionTargetsPreferHighlightOverSelection(t *testing.T) {
	m := testPhase3Model()
	filtered := m.getFilteredRows()
	if len(filtered) < 3 {
		t.Fatal("expected at least three rows")
	}
	m.selectedRows = map[int]bool{filtered[len(filtered)-1].id: true}

	m2, _ := m.updateNavigation(keyMsg("shift+down"))
	got := m2.(model)
	highlighted := got.highlightedRows(got.getFilteredRows())
	if len(highlighted) == 0 {
		t.Fatal("expected active highlighted rows")
	}

	m3, _ := got.updateNavigation(keyMsg("c"))
	got2 := m3.(model)
	if got2.catPicker == nil {
		t.Fatal("expected quick category picker open")
	}
	if len(got2.catPickerFor) != len(highlighted) {
		t.Fatalf("cat picker target count = %d, want %d", len(got2.catPickerFor), len(highlighted))
	}
	for _, id := range got2.catPickerFor {
		if !highlighted[id] {
			t.Fatalf("cat picker target id %d should come from active highlight", id)
		}
	}
}

func TestPhase3ClearSelectionHotkeyUClearsHighlightAndSelection(t *testing.T) {
	m := testPhase3Model()
	toggleKey := testKeyForAction(m, scopeTransactions, actionToggleSelect, "space")
	m2, _ := m.updateNavigation(keyMsg(toggleKey))
	got := m2.(model)
	m3, _ := got.updateNavigation(keyMsg("shift+down"))
	got2 := m3.(model)
	if got2.selectedCount() == 0 || !got2.rangeSelecting {
		t.Fatal("expected both selected rows and active highlight")
	}

	m4, _ := got2.updateNavigation(keyMsg("u"))
	got3 := m4.(model)
	if got3.selectedCount() != 0 {
		t.Fatalf("selected count = %d, want 0", got3.selectedCount())
	}
	if got3.rangeSelecting {
		t.Fatal("range highlight should be cleared by u")
	}
}

func TestPhase3ManagerTitleShowsHiddenSelectionCount(t *testing.T) {
	m := testPhase3Model()
	filtered := m.getFilteredRows()
	if len(filtered) < 2 {
		t.Fatal("expected test data")
	}
	selectedID := filtered[0].id
	m.selectedRows = map[int]bool{selectedID: true}
	m.searchQuery = "uber"

	view := m.managerView()
	if !strings.Contains(view, "Transactions (1 selected, 1 hidden)") {
		t.Fatalf("transactions title should include hidden selection count, got: %q", view)
	}
}

func TestPhase3ClearSelectionHotkeyUWorksWhileSearchActive(t *testing.T) {
	m := testPhase3Model()
	m.searchQuery = "uber"
	filtered := m.getFilteredRows()
	if len(filtered) == 0 {
		t.Fatal("expected filtered rows")
	}
	m.selectedRows = map[int]bool{filtered[0].id: true}

	m2, _ := m.updateNavigation(keyMsg("u"))
	got := m2.(model)
	if got.selectedCount() != 0 {
		t.Fatalf("selected count = %d, want 0", got.selectedCount())
	}
	if got.searchQuery != "uber" {
		t.Fatalf("search query should remain after u, got %q", got.searchQuery)
	}
}
