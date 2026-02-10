package main

import "testing"

func TestSettingsConfirmSpecFor(t *testing.T) {
	tests := []struct {
		name     string
		action   settingsConfirmAction
		wantOK   bool
		wantSpec settingsConfirmSpec
	}{
		{
			name:   "delete category",
			action: confirmActionDeleteCategory,
			wantOK: true,
			wantSpec: settingsConfirmSpec{
				scope:    scopeSettingsActiveCategories,
				action:   actionDelete,
				fallback: "d",
			},
		},
		{
			name:   "delete tag",
			action: confirmActionDeleteTag,
			wantOK: true,
			wantSpec: settingsConfirmSpec{
				scope:    scopeSettingsActiveTags,
				action:   actionDelete,
				fallback: "d",
			},
		},
		{
			name:   "delete rule",
			action: confirmActionDeleteRule,
			wantOK: true,
			wantSpec: settingsConfirmSpec{
				scope:    scopeSettingsActiveRules,
				action:   actionDelete,
				fallback: "d",
			},
		},
		{
			name:   "clear db",
			action: confirmActionClearDB,
			wantOK: true,
			wantSpec: settingsConfirmSpec{
				scope:    scopeSettingsActiveDBImport,
				action:   actionClearDB,
				fallback: "c",
			},
		},
		{name: "none", action: confirmActionNone, wantOK: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, ok := settingsConfirmSpecFor(tt.action)
			if ok != tt.wantOK {
				t.Fatalf("ok = %v, want %v", ok, tt.wantOK)
			}
			if !ok {
				return
			}
			if got != tt.wantSpec {
				t.Fatalf("spec = %+v, want %+v", got, tt.wantSpec)
			}
		})
	}
}

func TestMoveSettingsSectionByColumn(t *testing.T) {
	tests := []struct {
		name    string
		start   int
		delta   int
		wantSec int
	}{
		{name: "left forward", start: settSecCategories, delta: 1, wantSec: settSecTags},
		{name: "left wrap forward", start: settSecRules, delta: 1, wantSec: settSecCategories},
		{name: "left backward", start: settSecCategories, delta: -1, wantSec: settSecRules},
		{name: "right forward", start: settSecChart, delta: 1, wantSec: settSecDBImport},
		{name: "right wrap backward", start: settSecChart, delta: -1, wantSec: settSecDBImport},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := moveSettingsSection(tt.start, tt.delta); got != tt.wantSec {
				t.Fatalf("moveSettingsSection(%d, %d) = %d, want %d", tt.start, tt.delta, got, tt.wantSec)
			}
		})
	}
}

func TestASCIITextHelpers(t *testing.T) {
	s := "ab"
	if !deleteLastASCIIByte(&s) {
		t.Fatal("deleteLastASCIIByte should return true for non-empty input")
	}
	if s != "a" {
		t.Fatalf("after delete, got %q want %q", s, "a")
	}
	if !deleteLastASCIIByte(&s) || s != "" {
		t.Fatalf("delete second byte failed, got %q", s)
	}
	if deleteLastASCIIByte(&s) {
		t.Fatal("deleteLastASCIIByte should return false for empty input")
	}

	out := ""
	if !appendPrintableASCII(&out, "A") || out != "A" {
		t.Fatalf("append printable failed, got %q", out)
	}
	if appendPrintableASCII(&out, "backspace") {
		t.Fatal("appendPrintableASCII should reject non-single-char keys")
	}
	if appendPrintableASCII(&out, "\n") {
		t.Fatal("appendPrintableASCII should reject control characters")
	}
	if out != "A" {
		t.Fatalf("out changed unexpectedly, got %q", out)
	}
}

func TestSettingsEditModeHelpers(t *testing.T) {
	m := newModel()
	m.categories = []category{
		{id: 1, name: "Income"},
		{id: 2, name: "Groceries"},
	}

	m.beginSettingsCategoryMode(nil)
	if m.settMode != settModeAddCat {
		t.Fatalf("category add mode = %q, want %q", m.settMode, settModeAddCat)
	}
	if m.settEditID != 0 || m.settInput != "" || m.settColorIdx != 0 {
		t.Fatalf("category add state unexpected: editID=%d input=%q colorIdx=%d", m.settEditID, m.settInput, m.settColorIdx)
	}

	cat := category{id: 9, name: "Bills", color: string(colorBlue)}
	m.beginSettingsCategoryMode(&cat)
	if m.settMode != settModeEditCat {
		t.Fatalf("category edit mode = %q, want %q", m.settMode, settModeEditCat)
	}
	if m.settEditID != 9 || m.settInput != "Bills" {
		t.Fatalf("category edit state unexpected: editID=%d input=%q", m.settEditID, m.settInput)
	}
	if m.settColorIdx != categoryColorIndex(string(colorBlue)) {
		t.Fatalf("category color idx = %d, want %d", m.settColorIdx, categoryColorIndex(string(colorBlue)))
	}

	m.beginSettingsTagMode(nil)
	if m.settMode != settModeAddTag {
		t.Fatalf("tag add mode = %q, want %q", m.settMode, settModeAddTag)
	}

	tg := tag{id: 6, name: "Recurring", color: string(colorSky)}
	m.beginSettingsTagMode(&tg)
	if m.settMode != settModeEditTag {
		t.Fatalf("tag edit mode = %q, want %q", m.settMode, settModeEditTag)
	}
	if m.settEditID != 6 || m.settInput != "Recurring" {
		t.Fatalf("tag edit state unexpected: editID=%d input=%q", m.settEditID, m.settInput)
	}
	if m.settColorIdx != tagColorIndex(string(colorSky)) {
		t.Fatalf("tag color idx = %d, want %d", m.settColorIdx, tagColorIndex(string(colorSky)))
	}
}

func TestBeginSettingsRuleMode(t *testing.T) {
	m := newModel()
	m.categories = []category{
		{id: 1, name: "Income"},
		{id: 2, name: "Groceries"},
	}

	m.beginSettingsRuleMode(nil)
	if m.settMode != settModeAddRule {
		t.Fatalf("rule add mode = %q, want %q", m.settMode, settModeAddRule)
	}
	if m.settEditID != 0 || m.settInput != "" || m.settRuleCatIdx != 0 {
		t.Fatalf("rule add state unexpected: editID=%d input=%q catIdx=%d", m.settEditID, m.settInput, m.settRuleCatIdx)
	}

	rule := categoryRule{id: 3, pattern: "WOOLIES", categoryID: 2}
	m.beginSettingsRuleMode(&rule)
	if m.settMode != settModeEditRule {
		t.Fatalf("rule edit mode = %q, want %q", m.settMode, settModeEditRule)
	}
	if m.settEditID != 3 || m.settInput != "WOOLIES" {
		t.Fatalf("rule edit state unexpected: editID=%d input=%q", m.settEditID, m.settInput)
	}
	if m.settRuleCatIdx != 1 {
		t.Fatalf("rule category idx = %d, want 1", m.settRuleCatIdx)
	}
}

func TestCategoryIndexByIDFallback(t *testing.T) {
	cats := []category{
		{id: 10, name: "A"},
		{id: 11, name: "B"},
	}
	if got := categoryIndexByID(cats, 11); got != 1 {
		t.Fatalf("categoryIndexByID existing = %d, want 1", got)
	}
	if got := categoryIndexByID(cats, 999); got != 0 {
		t.Fatalf("categoryIndexByID fallback = %d, want 0", got)
	}
}

func TestRowsPerPageDeltaFromKeyName(t *testing.T) {
	tests := []struct {
		key  string
		want int
	}{
		{key: "+", want: 1},
		{key: "=", want: 1},
		{key: "-", want: -1},
		{key: "j", want: 1},
		{key: "k", want: -1},
		{key: "ctrl+j", want: 1},
		{key: "ctrl+k", want: -1},
		{key: "ctrl+n", want: 1},
		{key: "ctrl+p", want: -1},
		{key: "ctrl+=", want: 1},
		{key: "ctrl+-", want: -1},
		{key: "x", want: 0},
	}

	for _, tt := range tests {
		t.Run(tt.key, func(t *testing.T) {
			if got := rowsPerPageDeltaFromKeyName(tt.key); got != tt.want {
				t.Fatalf("rowsPerPageDeltaFromKeyName(%q) = %d, want %d", tt.key, got, tt.want)
			}
		})
	}
}

func TestBeginImportFlowResetsState(t *testing.T) {
	m := newModel()
	m.basePath = "."
	m.importPicking = false
	m.importFiles = []string{"old.csv"}
	m.importCursor = 3

	cmd := m.beginImportFlow()
	if !m.importPicking {
		t.Fatal("beginImportFlow should enable import picker")
	}
	if m.importFiles != nil {
		t.Fatalf("beginImportFlow should reset files, got %v", m.importFiles)
	}
	if m.importCursor != 0 {
		t.Fatalf("beginImportFlow cursor = %d, want 0", m.importCursor)
	}
	if cmd == nil {
		t.Fatal("beginImportFlow should return load command")
	}
}
