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
	m.activeTab = tabTransactions
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

func TestPhase3EscClearsHighlightThenSelectionThenSearch(t *testing.T) {
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

	// 1st esc clears highlight only.
	m4, _ := got2.updateNavigation(keyMsg("esc"))
	got3 := m4.(model)
	if got3.rangeSelecting {
		t.Fatal("range highlight should be cleared on first esc")
	}
	if got3.selectedCount() == 0 {
		t.Fatal("selection should remain after clearing highlight")
	}

	// 2nd esc clears selected rows.
	m5, _ := got3.updateNavigation(keyMsg("esc"))
	got4 := m5.(model)
	if got4.selectedCount() != 0 {
		t.Fatalf("expected selections cleared, got %d", got4.selectedCount())
	}
	if got4.searchQuery != "wool" {
		t.Fatalf("search query should remain after second esc, got %q", got4.searchQuery)
	}

	// 3rd esc clears search query.
	m6, _ := got4.updateNavigation(keyMsg("esc"))
	got5 := m6.(model)
	if got5.searchQuery != "" {
		t.Fatalf("search query should clear on third esc, got %q", got5.searchQuery)
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

func TestPhase3TransactionsTitleShowsSelectionCount(t *testing.T) {
	m := testPhase3Model()
	m.selectedRows = map[int]bool{1: true, 3: true}

	view := m.transactionsView()
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
