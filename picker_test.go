package main

import (
	"strings"
	"testing"
)

func lineColumnForNeedle(s, needle string) (int, bool) {
	for _, line := range strings.Split(s, "\n") {
		if idx := strings.Index(line, needle); idx >= 0 {
			return idx, true
		}
	}
	return -1, false
}

func testPickerItems() []pickerItem {
	return []pickerItem{
		{ID: 1, Label: "Groceries", Section: "Scoped", Meta: "Food"},
		{ID: 2, Label: "Gas", Section: "Scoped", Meta: "Transport"},
		{ID: 3, Label: "Games", Section: "Global", Meta: "Leisure"},
		{ID: 4, Label: "Gym", Section: "Global", Meta: "Health"},
		{ID: 5, Label: "Rent", Section: "Global", Meta: "Housing"},
	}
}

func TestFuzzyMatchScoreRanking(t *testing.T) {
	tests := []struct {
		name        string
		labelA      string
		labelB      string
		query       string
		wantAHigher bool
	}{
		{
			name:        "exact beats prefix",
			labelA:      "Gas",
			labelB:      "Gas Bill",
			query:       "gas",
			wantAHigher: true,
		},
		{
			name:        "prefix beats non-prefix",
			labelA:      "Games",
			labelB:      "Video Games",
			query:       "ga",
			wantAHigher: true,
		},
		{
			name:        "consecutive beats split",
			labelA:      "Gamma",
			labelB:      "Palm Medium",
			query:       "amm",
			wantAHigher: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			matchA, scoreA := fuzzyMatchScore(tt.labelA, tt.query)
			matchB, scoreB := fuzzyMatchScore(tt.labelB, tt.query)
			if !matchA || !matchB {
				t.Fatalf("both labels should match query %q", tt.query)
			}
			if tt.wantAHigher && scoreA <= scoreB {
				t.Fatalf("scoreA=%d scoreB=%d; expected %q higher than %q", scoreA, scoreB, tt.labelA, tt.labelB)
			}
		})
	}
}

func TestPickerSetQueryDeterministicOrdering(t *testing.T) {
	p := newPicker("Tags", []pickerItem{
		{ID: 10, Label: "Alpha", Section: "A"},
		{ID: 8, Label: "Alpine", Section: "A"},
		{ID: 7, Label: "Alps", Section: "A"},
		{ID: 6, Label: "Beta", Section: "B"},
	}, false, "Create")

	p.SetQuery("al")
	if len(p.filtered) != 3 {
		t.Fatalf("filtered count = %d, want 3", len(p.filtered))
	}

	labels := []string{p.filtered[0].Label, p.filtered[1].Label, p.filtered[2].Label}
	got := strings.Join(labels, ",")
	want := "Alpha,Alpine,Alps"
	if got != want {
		t.Fatalf("order = %q, want %q", got, want)
	}
}

func TestPickerSectionOrderPreservedFromInput(t *testing.T) {
	p := newPicker("Tags", []pickerItem{
		{ID: 1, Label: "One", Section: "Global"},
		{ID: 2, Label: "Two", Section: "Scoped"},
		{ID: 3, Label: "Three", Section: "Global"},
		{ID: 4, Label: "Four", Section: "Scoped"},
	}, false, "Create")

	p.SetQuery("")
	view := renderPicker(p, 0, NewKeyRegistry(), scopeTagPicker)

	idxGlobal := strings.Index(view, "Global:")
	idxScoped := strings.Index(view, "Scoped:")
	if idxGlobal < 0 || idxScoped < 0 {
		t.Fatalf("expected both section headers, got:\n%s", view)
	}
	if idxGlobal > idxScoped {
		t.Fatalf("section order should follow input appearance; view:\n%s", view)
	}
}

func TestPickerCreateOptionVisibility(t *testing.T) {
	p := newPicker("Categories", testPickerItems(), false, "Create")

	p.SetQuery("newcat")
	if !p.shouldShowCreate() {
		t.Fatal("create option should be visible for non-empty query with no exact match")
	}

	p.SetQuery("gRoCeRiEs")
	if p.shouldShowCreate() {
		t.Fatal("create option should be hidden when exact match exists (case-insensitive)")
	}
}

func TestPickerMultiSelectToggleAndSelectedSorted(t *testing.T) {
	p := newPicker("Tags", testPickerItems(), true, "Create")

	p.SetQuery("g")
	if len(p.filtered) == 0 {
		t.Fatal("expected filtered results")
	}

	// Toggle first item.
	res := p.HandleKey("space")
	if res.Action != pickerActionToggled {
		t.Fatalf("action = %v, want %v", res.Action, pickerActionToggled)
	}

	// Move and toggle second item.
	_ = p.HandleKey("down")
	_ = p.HandleKey("space")

	selected := p.Selected()
	if len(selected) != 2 {
		t.Fatalf("selected count = %d, want 2", len(selected))
	}
	if selected[0] >= selected[1] {
		t.Fatalf("selected IDs should be sorted ascending, got %v", selected)
	}
}

func TestPickerHandleKeyEnterSingleSelect(t *testing.T) {
	p := newPicker("Categories", testPickerItems(), false, "Create")
	p.SetQuery("rent")
	if len(p.filtered) != 1 {
		t.Fatalf("filtered count = %d, want 1", len(p.filtered))
	}

	res := p.HandleKey("enter")
	if res.Action != pickerActionSelected {
		t.Fatalf("action = %v, want %v", res.Action, pickerActionSelected)
	}
	if res.ItemID != 5 || res.ItemLabel != "Rent" {
		t.Fatalf("selected item = (%d,%q), want (5,%q)", res.ItemID, res.ItemLabel, "Rent")
	}
}

func TestPickerHandleKeyEnterMultiSelectSubmit(t *testing.T) {
	p := newPicker("Tags", testPickerItems(), true, "Create")

	_ = p.HandleKey("space")
	_ = p.HandleKey("down")
	_ = p.HandleKey("space")

	res := p.HandleKey("enter")
	if res.Action != pickerActionSubmitted {
		t.Fatalf("action = %v, want %v", res.Action, pickerActionSubmitted)
	}
	if len(res.SelectedIDs) != 2 {
		t.Fatalf("submitted selected IDs = %v, want 2 items", res.SelectedIDs)
	}
}

func TestPickerHandleKeyEnterCreateIntent(t *testing.T) {
	p := newPicker("Categories", testPickerItems(), false, "Create")
	p.SetQuery("fresh")

	// Move cursor to create row (after filtered items).
	p.cursor = p.maxCursorIndex()
	res := p.HandleKey("enter")
	if res.Action != pickerActionCreate {
		t.Fatalf("action = %v, want %v", res.Action, pickerActionCreate)
	}
	if res.CreatedQuery != "fresh" {
		t.Fatalf("created query = %q, want %q", res.CreatedQuery, "fresh")
	}
}

func TestRenderPickerIncludesSectionsSearchAndCreate(t *testing.T) {
	p := newPicker("Tags", testPickerItems(), true, "Create")
	p.SetQuery("zz")
	view := renderPicker(p, 0, NewKeyRegistry(), scopeTagPicker)

	if !strings.Contains(view, "Tags") {
		t.Fatalf("expected title in view:\n%s", view)
	}
	if !strings.Contains(view, "Filter: zz") {
		t.Fatalf("expected search line in view:\n%s", view)
	}
	if !strings.Contains(view, `Create "zz"`) {
		t.Fatalf("expected create row in view:\n%s", view)
	}
	if !strings.Contains(view, "navigate") || !strings.Contains(view, "cancel") {
		t.Fatalf("expected action footer in view:\n%s", view)
	}
}

func TestRenderPickerSingleAndMultiUseAlignedLabelColumn(t *testing.T) {
	cat := newPicker("Quick Categorize", []pickerItem{
		{ID: 1, Label: "Groceries"},
	}, false, "Create")
	tag := newPicker("Quick Tags", []pickerItem{
		{ID: 1, Label: "Groceries"},
	}, true, "Create")

	catView := renderPicker(cat, 56, NewKeyRegistry(), scopeCategoryPicker)
	tagView := renderPicker(tag, 56, NewKeyRegistry(), scopeTagPicker)

	catLineIdx, catOK := lineColumnForNeedle(catView, "Groceries")
	tagLineIdx, tagOK := lineColumnForNeedle(tagView, "Groceries")
	if !catOK || !tagOK {
		t.Fatalf("expected label in both pickers:\ncat:\n%s\n\ntag:\n%s", catView, tagView)
	}
	if catLineIdx != tagLineIdx {
		t.Fatalf("label columns should align between pickers: cat=%d tag=%d", catLineIdx, tagLineIdx)
	}
}

func TestPickerEscReturnsCancelled(t *testing.T) {
	p := newPicker("Tags", testPickerItems(), false, "Create")
	res := p.HandleKey("esc")
	if res.Action != pickerActionCancelled {
		t.Fatalf("action = %v, want %v", res.Action, pickerActionCancelled)
	}
}

func TestPickerCursorClampsWithRepeatedNavigation(t *testing.T) {
	p := newPicker("Tags", testPickerItems(), false, "Create")

	for i := 0; i < 50; i++ {
		_ = p.HandleKey("down")
	}
	if p.cursor != p.maxCursorIndex() {
		t.Fatalf("cursor after repeated down = %d, want %d", p.cursor, p.maxCursorIndex())
	}

	for i := 0; i < 50; i++ {
		_ = p.HandleKey("up")
	}
	if p.cursor != 0 {
		t.Fatalf("cursor after repeated up = %d, want 0", p.cursor)
	}
}
