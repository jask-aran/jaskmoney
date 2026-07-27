package main

import (
	"strings"
	"testing"
)

func TestSettingsRulesEnterOpensRuleEditor(t *testing.T) {
	m := newModel()
	m.ready = true
	m.activeTab = tabSettings
	m.settSection = settSecRules
	m.settActive = true
	m.rules = []ruleV2{{id: 7, name: "Groceries", savedFilterID: "filter-grocery", enabled: true}}

	next, _ := m.updateSettings(keyMsg("enter"))
	got := next.(model)

	if !got.ruleEditorOpen {
		t.Fatal("expected rule editor to open on enter")
	}
	if got.ruleEditorID != 7 {
		t.Fatalf("ruleEditorID = %d, want 7", got.ruleEditorID)
	}
	if got.ruleEditorName != "Groceries" {
		t.Fatalf("ruleEditorName = %q, want Groceries", got.ruleEditorName)
	}
}

func TestRulesDryRunMsgOpensModal(t *testing.T) {
	m := newModel()
	m.ready = true

	next, _ := m.Update(rulesDryRunMsg{
		results: []dryRunRuleResult{{matchCount: 2}},
		summary: dryRunSummary{totalModified: 2, totalCatChange: 1, totalTagChange: 2},
		scope:   "1 selected accounts",
	})
	got := next.(model)

	if !got.dryRunOpen {
		t.Fatal("expected dry-run modal to open")
	}
	if len(got.dryRunResults) != 1 {
		t.Fatalf("dryRunResults len = %d, want 1", len(got.dryRunResults))
	}
	if got.dryRunScopeLabel != "1 selected accounts" {
		t.Fatalf("scope label = %q, want %q", got.dryRunScopeLabel, "1 selected accounts")
	}
}

func TestUpdateSettingsRulesToggleEnableUsesSpace(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	ruleID, err := insertRuleV2(db, ruleV2{name: "Toggle", savedFilterID: "filter-test", enabled: true})
	if err != nil {
		t.Fatalf("insert rule: %v", err)
	}
	rules, err := loadRulesV2(db)
	if err != nil {
		t.Fatalf("load rules: %v", err)
	}

	m := newModel()
	m.db = db
	m.ready = true
	m.activeTab = tabSettings
	m.settSection = settSecRules
	m.settActive = true
	m.rules = rules
	m.settItemCursor = 0

	toggleKey := m.primaryActionKey(scopeSettingsActiveRules, actionRuleToggleEnabled, "space")
	next, cmd := m.updateSettings(keyMsg(toggleKey))
	if cmd == nil {
		t.Fatal("expected toggle command")
	}
	msg := cmd()
	updated, cmd2 := next.(model).Update(msg)
	if cmd2 != nil {
		_ = cmd2()
	}
	_ = updated

	rulesAfter, err := loadRulesV2(db)
	if err != nil {
		t.Fatalf("load rules after toggle: %v", err)
	}
	if len(rulesAfter) != 1 || rulesAfter[0].id != ruleID {
		t.Fatalf("unexpected rules after toggle: %+v", rulesAfter)
	}
	if rulesAfter[0].enabled {
		t.Fatal("rule should be disabled after pressing space")
	}
}

func TestRulesApplyStatusIncludesScopeLabel(t *testing.T) {
	m := newModel()
	m.filterAccounts = map[int]bool{1: true, 2: true}

	next, _ := m.Update(rulesAppliedMsg{updatedTxns: 4, catChanges: 3, tagChanges: 5, failedRules: 1, scope: "2 selected accounts"})
	got := next.(model)
	if got.status == "" {
		t.Fatal("status should be set")
	}
	if got.statusErr {
		t.Fatal("status should not be error")
	}
	if !strings.Contains(got.status, "4 transactions updated") {
		t.Fatalf("status should include updated txn count, got %q", got.status)
	}
	if !strings.Contains(got.status, "1 failed rules") {
		t.Fatalf("status should include failed rules count, got %q", got.status)
	}
}

func TestRuleEditorEnterOnFilterStepOpensPickerAndSelectsID(t *testing.T) {
	m := newModel()
	m.ruleEditorOpen = true
	m.ruleEditorStep = 1
	m.savedFilters = []savedFilter{{ID: "groceries", Name: "Groceries", Expr: "cat:Groceries"}}

	next, _ := m.updateRuleEditor(keyMsg("enter"))
	got := next.(model)
	if got.filterApplyPicker == nil {
		t.Fatal("expected saved-filter picker to open")
	}
	if !got.ruleEditorPickingFilter {
		t.Fatal("expected ruleEditorPickingFilter flag")
	}

	next2, _ := got.updateFilterApplyPicker(keyMsg("enter"))
	got2 := next2.(model)
	if got2.filterApplyPicker != nil {
		t.Fatal("expected picker to close after selection")
	}
	if got2.ruleEditorFilterID != "groceries" {
		t.Fatalf("ruleEditorFilterID = %q, want groceries", got2.ruleEditorFilterID)
	}
	if got2.ruleEditorStep != 2 {
		t.Fatalf("ruleEditorStep = %d, want 2", got2.ruleEditorStep)
	}
}

func TestRuleEditorCategoryAndTagPickersRoundTrip(t *testing.T) {
	m := newModel()
	m.ruleEditorOpen = true
	m.ruleEditorStep = 2
	m.categories = []category{{id: 1, name: "Groceries"}}
	m.tags = []tag{{id: 7, name: "WEEKLY"}}

	next, _ := m.updateRuleEditor(keyMsg("enter"))
	got := next.(model)
	if got.catPicker == nil || !got.ruleEditorPickingCategory {
		t.Fatal("expected category picker open for rule editor")
	}
	next2, _ := got.updateCatPicker(keyMsg("down"))
	got2 := next2.(model)
	next3, _ := got2.updateCatPicker(keyMsg("enter"))
	got3 := next3.(model)
	if got3.ruleEditorCatID == nil || *got3.ruleEditorCatID != 1 {
		t.Fatalf("ruleEditorCatID = %v, want 1", got3.ruleEditorCatID)
	}
	if got3.ruleEditorStep != 3 {
		t.Fatalf("ruleEditorStep = %d, want 3", got3.ruleEditorStep)
	}

	next4, _ := got3.updateRuleEditor(keyMsg("enter"))
	got4 := next4.(model)
	if got4.tagPicker == nil || !got4.ruleEditorPickingTags {
		t.Fatal("expected tag picker open for rule editor")
	}
	next5, _ := got4.updateTagPicker(keyMsg("down"))
	got5 := next5.(model)
	next6, _ := got5.updateTagPicker(keyMsg("enter"))
	got6 := next6.(model)
	if len(got6.ruleEditorAddTags) != 1 || got6.ruleEditorAddTags[0] != 7 {
		t.Fatalf("ruleEditorAddTags = %v, want [7]", got6.ruleEditorAddTags)
	}
	if got6.ruleEditorStep != 4 {
		t.Fatalf("ruleEditorStep = %d, want 4", got6.ruleEditorStep)
	}
}

func TestRuleEditorVimNavOverrideStillTypesLiteral(t *testing.T) {
	m := newModel()
	m.ruleEditorOpen = true
	m.ruleEditorStep = 0
	m.ruleEditorName = ""
	m.ruleEditorNameCur = 0
	if err := m.keys.ApplyOverrides([]shortcutOverride{
		{Scope: scopeRuleEditor, Action: string(actionDown), Keys: []string{"j"}},
		{Scope: scopeRuleEditor, Action: string(actionUp), Keys: []string{"k"}},
		{Scope: scopeRuleEditor, Action: string(actionLeft), Keys: []string{"h"}},
		{Scope: scopeRuleEditor, Action: string(actionRight), Keys: []string{"l"}},
	}); err != nil {
		t.Fatalf("ApplyOverrides: %v", err)
	}

	next, _ := m.updateRuleEditor(keyMsg("j"))
	got := next.(model)
	if got.ruleEditorStep != 0 {
		t.Fatalf("step changed from literal j, got %d want 0", got.ruleEditorStep)
	}
	if got.ruleEditorName != "j" {
		t.Fatalf("name after j = %q, want %q", got.ruleEditorName, "j")
	}
}

func TestRuleReorderCursorFollowsMovedRule(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	_, err := insertRuleV2(db, ruleV2{name: "R1", savedFilterID: "f1", enabled: true})
	if err != nil {
		t.Fatalf("insert rule1: %v", err)
	}
	_, err = insertRuleV2(db, ruleV2{name: "R2", savedFilterID: "f2", enabled: true})
	if err != nil {
		t.Fatalf("insert rule2: %v", err)
	}
	rules, err := loadRulesV2(db)
	if err != nil {
		t.Fatalf("load rules: %v", err)
	}

	m := newModel()
	m.db = db
	m.ready = true
	m.activeTab = tabSettings
	m.settSection = settSecRules
	m.settActive = true
	m.rules = rules
	m.settItemCursor = 0

	next, cmd := m.updateSettings(keyMsg("J"))
	got := next.(model)
	if cmd == nil {
		t.Fatal("expected reorder command")
	}
	if got.settItemCursor != 1 {
		t.Fatalf("cursor after move should follow rule, got %d want 1", got.settItemCursor)
	}
	msg := cmd()
	next2, cmd2 := got.Update(msg)
	got2 := next2.(model)
	if got2.settItemCursor != 1 {
		t.Fatalf("cursor after ruleSavedMsg should stay on moved item, got %d", got2.settItemCursor)
	}
	if cmd2 != nil {
		next3, _ := got2.Update(cmd2())
		got3 := next3.(model)
		if got3.settItemCursor != 1 {
			t.Fatalf("cursor after refresh should stay on moved item, got %d", got3.settItemCursor)
		}
	}
}

func TestRuleTagPickerEnterNoPendingTogglesAndCloses(t *testing.T) {
	m := newModel()
	m.ruleEditorOpen = true
	m.ruleEditorStep = 3
	m.tags = []tag{{id: 7, name: "WEEKLY"}}

	next, _ := m.updateRuleEditor(keyMsg("enter"))
	got := next.(model)
	if got.tagPicker == nil || !got.ruleEditorPickingTags {
		t.Fatal("expected rule tag picker open")
	}
	next2, _ := got.updateTagPicker(keyMsg("enter"))
	got2 := next2.(model)
	if got2.tagPicker != nil {
		t.Fatal("expected picker to close after single-enter toggle")
	}
	if len(got2.ruleEditorAddTags) != 1 || got2.ruleEditorAddTags[0] != 7 {
		t.Fatalf("ruleEditorAddTags = %v, want [7]", got2.ruleEditorAddTags)
	}
}

func TestRuleTagPickerEnterWithPendingChangesSubmitsWithoutExtraToggle(t *testing.T) {
	m := newModel()
	m.ruleEditorOpen = true
	m.ruleEditorStep = 3
	m.tags = []tag{
		{id: 7, name: "WEEKLY"},
		{id: 8, name: "DINING"},
	}
	m.ruleEditorAddTags = []int{7}

	next, _ := m.updateRuleEditor(keyMsg("enter"))
	got := next.(model)
	if got.tagPicker == nil || !got.ruleEditorPickingTags {
		t.Fatal("expected rule tag picker open")
	}

	// Move to second tag and toggle it on via space.
	next2, _ := got.updateTagPicker(keyMsg("down"))
	got2 := next2.(model)
	next3, _ := got2.updateTagPicker(keyMsg("space"))
	got3 := next3.(model)

	// Enter should submit [7,8] and close, without toggling focused tag back off.
	next4, _ := got3.updateTagPicker(keyMsg("enter"))
	got4 := next4.(model)
	if got4.tagPicker != nil {
		t.Fatal("expected picker to close on submit")
	}
	if len(got4.ruleEditorAddTags) != 2 || got4.ruleEditorAddTags[0] != 7 || got4.ruleEditorAddTags[1] != 8 {
		t.Fatalf("ruleEditorAddTags = %v, want [7 8]", got4.ruleEditorAddTags)
	}
}
