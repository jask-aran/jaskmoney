package core

import "testing"

func TestPickerTriStatePendingPatch(t *testing.T) {
	p := NewPicker("tags", []PickerItem{
		{ID: "1", Label: "One"},
		{ID: "2", Label: "Two"},
	})
	p.SetMultiSelect(true)
	p.SetTriState(map[string]PickerCheckState{
		"1": PickerCheckStateAll,
		"2": PickerCheckStateSome,
	})

	if p.HasPendingChanges() {
		t.Fatalf("expected no pending changes at baseline")
	}

	_ = p.HandleKey("space") // cursor starts at item 1: All -> None
	addIDs, removeIDs := p.PendingPatch()
	if len(addIDs) != 0 || len(removeIDs) != 1 || removeIDs[0] != "1" {
		t.Fatalf("unexpected patch after first toggle: add=%v remove=%v", addIDs, removeIDs)
	}

	_ = p.HandleKey("j")
	_ = p.HandleKey("space") // item 2: Some -> All
	addIDs, removeIDs = p.PendingPatch()
	if len(addIDs) != 1 || addIDs[0] != "2" || len(removeIDs) != 1 || removeIDs[0] != "1" {
		t.Fatalf("unexpected patch after second toggle: add=%v remove=%v", addIDs, removeIDs)
	}
}

func TestPickerCreateRowSelection(t *testing.T) {
	p := NewPicker("tags", []PickerItem{{ID: "1", Label: "Food"}})
	p.SetMultiSelect(true)
	p.SetCreateLabel("Create")

	_ = p.HandleKey("x")
	if !p.ShouldShowCreate() {
		t.Fatalf("expected create row with non-empty unmatched query")
	}

	res := p.HandleKey("enter")
	if res.Action != PickerActionCreate {
		t.Fatalf("action = %v, want %v", res.Action, PickerActionCreate)
	}
	if res.CreatedQuery != "x" {
		t.Fatalf("created query = %q, want %q", res.CreatedQuery, "x")
	}
}
