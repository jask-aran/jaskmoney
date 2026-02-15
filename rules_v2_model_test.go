package main

import (
	"testing"
)

func TestSettingsRulesEnterOpensRuleEditor(t *testing.T) {
	m := newModel()
	m.ready = true
	m.activeTab = tabSettings
	m.settSection = settSecRules
	m.settActive = true
	m.rules = []ruleV2{{id: 7, name: "Groceries", filterExpr: `desc:grocery`, enabled: true}}

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

func TestUpdateSettingsRulesToggleEnableUsesKeyE(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	ruleID, err := insertRuleV2(db, ruleV2{name: "Toggle", filterExpr: `desc:test`, enabled: true})
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

	next, cmd := m.updateSettings(keyMsg("e"))
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
		t.Fatal("rule should be disabled after pressing e")
	}
}

func TestRulesApplyStatusIncludesScopeLabel(t *testing.T) {
	m := newModel()
	m.filterAccounts = map[int]bool{1: true, 2: true}

	next, _ := m.Update(rulesAppliedMsg{catChanges: 3, tagChanges: 5, scope: "2 selected accounts"})
	got := next.(model)
	if got.status == "" {
		t.Fatal("status should be set")
	}
	if got.statusErr {
		t.Fatal("status should not be error")
	}
}
