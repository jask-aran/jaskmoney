package main

import (
	"path/filepath"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
)

func TestSettingsConfirmDeleteFilterUsesCapturedFilterID(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())

	dbPath := filepath.Join(t.TempDir(), "test.db")
	db, err := openDB(dbPath)
	if err != nil {
		t.Fatalf("openDB: %v", err)
	}
	defer db.Close()

	m := newModel()
	m.db = db
	m.savedFilters = []savedFilter{{ID: "groceries", Name: "Groceries", Expr: "cat:Groceries"}}
	if err := saveSavedFilters(m.savedFilters); err != nil {
		t.Fatalf("saveSavedFilters: %v", err)
	}

	m.confirmAction = confirmActionDeleteFilter
	m.confirmFilterID = "groceries"

	next, _ := m.updateSettingsConfirm(keyMsg("del"))
	got := next.(model)

	if got.statusErr {
		t.Fatalf("expected delete success, got error status=%q", got.status)
	}
	if len(got.savedFilters) != 0 {
		t.Fatalf("saved filters = %d, want 0 after delete", len(got.savedFilters))
	}
	if got.status != "Deleted filter \"groceries\"." {
		t.Fatalf("status = %q, want delete confirmation", got.status)
	}
}

func TestSaveFilterEditorAllowsRenamingFilterID(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())

	m := newModel()
	m.savedFilters = []savedFilter{{ID: "groceries", Name: "Groceries", Expr: "cat:Groceries"}}
	if err := saveSavedFilters(m.savedFilters); err != nil {
		t.Fatalf("saveSavedFilters: %v", err)
	}

	existing := m.savedFilters[0]
	m.openFilterEditor(&existing, "")
	m.filterEditID = "food"
	m.filterEditName = "Food"
	m.filterEditExpr = "cat:Food"

	next, err := m.saveFilterEditor()
	if err != nil {
		t.Fatalf("saveFilterEditor rename failed: %v", err)
	}

	if len(next.savedFilters) != 1 {
		t.Fatalf("saved filters = %d, want 1", len(next.savedFilters))
	}
	if next.savedFilters[0].ID != "food" {
		t.Fatalf("saved filter ID = %q, want %q", next.savedFilters[0].ID, "food")
	}
	if next.savedFilters[0].Name != "Food" {
		t.Fatalf("saved filter name = %q, want %q", next.savedFilters[0].Name, "Food")
	}
}

func TestOpenFilterEditorNewUsesAutoIDAndBlankName(t *testing.T) {
	m := newModel()
	m.savedFilters = []savedFilter{{ID: "filter", Name: "Existing", Expr: "cat:Groceries"}}
	m.filterInput = "cat:Food AND amt:<0"

	m.openFilterEditor(nil, "")

	if !m.filterEditIsNew {
		t.Fatal("expected new filter editor mode")
	}
	if m.filterEditID != "filter-2" {
		t.Fatalf("new filter ID = %q, want %q", m.filterEditID, "filter-2")
	}
	if m.filterEditName != "" {
		t.Fatalf("new filter name = %q, want empty", m.filterEditName)
	}
	if m.filterEditExpr != "cat:Food AND amt:<0" {
		t.Fatalf("new filter expr = %q, want current filter input", m.filterEditExpr)
	}
}

func TestFilterEditorPrintableJKAreLiteralText(t *testing.T) {
	m := newModel()
	m.filterEditOpen = true
	m.filterEditFocus = 1 // name field
	m.filterEditName = "a"
	m.filterEditNameCur = len(m.filterEditName)

	nextModel, _ := m.updateFilterEdit(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'j'}})
	got := nextModel.(model)
	if got.filterEditFocus != 1 {
		t.Fatalf("focus changed on printable j: got %d, want 1", got.filterEditFocus)
	}
	if got.filterEditName != "aj" {
		t.Fatalf("name after j = %q, want %q", got.filterEditName, "aj")
	}

	nextModel, _ = got.updateFilterEdit(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'k'}})
	got2 := nextModel.(model)
	if got2.filterEditFocus != 1 {
		t.Fatalf("focus changed on printable k: got %d, want 1", got2.filterEditFocus)
	}
	if got2.filterEditName != "ajk" {
		t.Fatalf("name after k = %q, want %q", got2.filterEditName, "ajk")
	}
}

func TestApplyPickerPreservesRecencyOrder(t *testing.T) {
	m := newModel()
	m.savedFilters = []savedFilter{
		{ID: "alpha", Name: "Alpha", Expr: "cat:A"},
		{ID: "beta", Name: "Beta", Expr: "cat:B"},
	}
	m.filterUsage = map[string]filterUsageState{
		"alpha": {filterID: "alpha", lastUsedUnix: 1},
		"beta":  {filterID: "beta", lastUsedUnix: 2},
	}

	m.openFilterApplyPicker("")
	if m.filterApplyPicker == nil {
		t.Fatal("expected filter apply picker")
	}
	if len(m.filterApplyPicker.filtered) < 2 {
		t.Fatalf("filtered count = %d, want at least 2", len(m.filterApplyPicker.filtered))
	}
	if got := m.filterApplyPicker.filtered[0].Label; got != "beta" {
		t.Fatalf("first picker item = %q, want recency-first %q", got, "beta")
	}
}
