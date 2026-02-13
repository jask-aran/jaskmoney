package main

import (
	"path/filepath"
	"testing"
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
