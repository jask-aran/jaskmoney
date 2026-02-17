package main

import (
	"strings"
	"testing"
	"time"
)

func TestDashboardJumpTargetsIncludeDateAndAnalyticsPanes(t *testing.T) {
	m := newModel()
	m.keys = NewKeyRegistry()
	m.commands = NewCommandRegistry(m.keys, m.savedFilters)
	m.activeTab = tabDashboard

	targets := m.jumpTargetsForActiveTab()
	if len(targets) != 3 {
		t.Fatalf("dashboard jump target count = %d, want 3", len(targets))
	}
	byKey := make(map[string]jumpTarget, len(targets))
	for _, target := range targets {
		byKey[strings.ToLower(target.Key)] = target
	}
	if _, ok := byKey["d"]; !ok {
		t.Fatal("missing date-range jump target d")
	}
	if got, ok := byKey["n"]; !ok || got.Section != sectionDashboardNetCashflow {
		t.Fatalf("n target = %+v, want net cashflow section", got)
	}
	if got, ok := byKey["c"]; !ok || got.Section != sectionDashboardComposition {
		t.Fatalf("c target = %+v, want composition section", got)
	}
}

func TestDashboardFocusedPaneCyclesModesAndEscUnfocuses(t *testing.T) {
	m := newModel()
	m.keys = NewKeyRegistry()
	m.commands = NewCommandRegistry(m.keys, m.savedFilters)
	m.ready = true
	m.activeTab = tabDashboard
	m.customPaneModes = []customPaneMode{{Pane: "net_cashflow", Name: "Renovation", Expr: "cat:Home AND amt:<0", ViewType: "line"}}
	m.dashWidgets = newDashboardWidgets(m.customPaneModes)

	next, _ := m.Update(keyMsg("v"))
	got := next.(model)
	if !got.jumpModeActive {
		t.Fatal("expected jump mode active")
	}

	next, _ = got.Update(keyMsg("n"))
	got = next.(model)
	if got.focusedSection != sectionDashboardNetCashflow {
		t.Fatalf("focusedSection = %d, want net cashflow", got.focusedSection)
	}
	if got.dashTimeframeFocus {
		t.Fatal("dashTimeframeFocus should be false for analytics pane focus")
	}
	if len(got.dashWidgets) == 0 || len(got.dashWidgets[0].modes) < 2 {
		t.Fatal("expected net widget to have multiple modes")
	}

	initialMode := got.dashWidgets[0].activeMode
	modeNextKey := got.primaryActionKey(scopeDashboardFocused, actionDashboardModeNext, ".")
	next, _ = got.Update(keyMsg(modeNextKey))
	got2 := next.(model)
	if got2.dashWidgets[0].activeMode == initialMode {
		t.Fatalf("mode did not advance from %d", initialMode)
	}

	modePrevKey := got2.primaryActionKey(scopeDashboardFocused, actionDashboardModePrev, ",")
	next, _ = got2.Update(keyMsg(modePrevKey))
	got3 := next.(model)
	if got3.dashWidgets[0].activeMode != initialMode {
		t.Fatalf("mode did not move back to initial index %d", initialMode)
	}

	next, _ = got3.Update(keyMsg("shift+."))
	gotShiftNext := next.(model)
	if gotShiftNext.dashWidgets[0].activeMode == initialMode {
		t.Fatal("shift+. should map to dashboard mode next")
	}

	next, _ = gotShiftNext.Update(keyMsg("shift+,"))
	got3 = next.(model)
	if got3.dashWidgets[0].activeMode != initialMode {
		t.Fatal("shift+, should map to dashboard mode prev")
	}

	next, _ = got3.Update(keyMsg(modePrevKey))
	got4 := next.(model)
	if got4.dashWidgets[0].activeMode != len(got4.dashWidgets[0].modes)-1 {
		t.Fatalf("mode wrap = %d, want %d", got4.dashWidgets[0].activeMode, len(got4.dashWidgets[0].modes)-1)
	}

	next, _ = got4.Update(keyMsg("esc"))
	got7 := next.(model)
	if got7.focusedSection != sectionUnfocused {
		t.Fatalf("focusedSection after esc = %d, want unfocused", got7.focusedSection)
	}
}

func TestDashboardFocusedPaneBracketsDoNotCycleModes(t *testing.T) {
	m := newModel()
	m.keys = NewKeyRegistry()
	m.commands = NewCommandRegistry(m.keys, m.savedFilters)
	m.ready = true
	m.activeTab = tabDashboard
	m.focusedSection = sectionDashboardNetCashflow
	m.dashWidgets = newDashboardWidgets(nil)
	beforeMode := m.dashWidgets[0].activeMode

	nextMonthKey := m.primaryActionKey(scopeDashboardFocused, actionBudgetNextMonth, "]")
	next, _ := m.Update(keyMsg(nextMonthKey))
	got := next.(model)
	if got.dashWidgets[0].activeMode != beforeMode {
		t.Fatalf("activeMode changed on ] in focused pane: got %d want %d", got.dashWidgets[0].activeMode, beforeMode)
	}
	if got.dashMonthMode {
		t.Fatal("focused analytics pane should not month-step on ]")
	}
}

func TestDashboardMonthStepWorksAtTopLevelWithoutFocusBootstrap(t *testing.T) {
	m := newModel()
	m.keys = NewKeyRegistry()
	m.commands = NewCommandRegistry(m.keys, m.savedFilters)
	m.ready = true
	m.activeTab = tabDashboard
	m.focusedSection = sectionUnfocused
	m.dashTimeframeFocus = false
	m.dashMonthMode = false
	base, _, err := parseMonthKey(m.budgetMonth)
	if err != nil {
		t.Fatalf("parseMonthKey(%q): %v", m.budgetMonth, err)
	}
	m.dashAnchorMonth = m.budgetMonth
	m.syncBudgetMonthFromDashboard()

	prevKey := m.primaryActionKey(scopeDashboard, actionBudgetPrevMonth, "[")
	next, _ := m.Update(keyMsg(prevKey))
	got := next.(model)
	if !got.dashMonthMode {
		t.Fatal("expected month-step to activate month mode at dashboard top-level")
	}
	want := base.AddDate(0, -1, 0).Format("2006-01")
	if got.budgetMonth != want {
		t.Fatalf("budgetMonth after top-level month-step = %q, want %q", got.budgetMonth, want)
	}
}

func TestDashboardResetThisMonthWorksAtTopLevelWithoutFocusBootstrap(t *testing.T) {
	m := newModel()
	m.keys = NewKeyRegistry()
	m.commands = NewCommandRegistry(m.keys, m.savedFilters)
	m.ready = true
	m.activeTab = tabDashboard
	m.focusedSection = sectionUnfocused
	m.dashTimeframeFocus = false
	m.dashMonthMode = true
	m.dashAnchorMonth = "2024-01"
	m.budgetMonth = "2024-01"

	resetKey := m.primaryActionKey(scopeDashboard, actionTimeframeThisMonth, "0")
	before := time.Now().Format("2006-01")
	next, _ := m.Update(keyMsg(resetKey))
	after := time.Now().Format("2006-01")
	got := next.(model)
	if got.dashMonthMode {
		t.Fatal("expected top-level reset to leave month mode")
	}
	if got.dashTimeframe != dashTimeframeThisMonth {
		t.Fatalf("dashTimeframe = %d, want this month", got.dashTimeframe)
	}
	if got.budgetMonth != before && got.budgetMonth != after {
		t.Fatalf("budgetMonth = %q, want %q or %q", got.budgetMonth, before, after)
	}
	if got.budgetMonth != got.dashAnchorMonth {
		t.Fatalf("budgetMonth/dashAnchorMonth mismatch: %q vs %q", got.budgetMonth, got.dashAnchorMonth)
	}
}

func TestDashboardDrillDownSetsManagerFilterAndDrillReturn(t *testing.T) {
	m := newModel()
	m.keys = NewKeyRegistry()
	m.commands = NewCommandRegistry(m.keys, m.savedFilters)
	m.ready = true
	m.activeTab = tabDashboard
	m.focusedSection = sectionDashboardNetCashflow
	m.dashMonthMode = true
	m.dashAnchorMonth = "2026-01"
	m.dashWidgets = newDashboardWidgets(nil)
	m.filterInput = "cat:Legacy"
	m.reparseFilterInput()
	m.rows = []transaction{{id: 1, dateISO: "2026-01-10", amount: -10, categoryName: "Groceries", description: "A"}}
	m.dashWidgets[0].activeMode = findWidgetModeIndexByID(m.dashWidgets[0], "spending")

	next, _ := m.Update(keyMsg("enter"))
	got := next.(model)

	if got.activeTab != tabManager {
		t.Fatalf("activeTab = %d, want manager", got.activeTab)
	}
	if got.managerMode != managerModeTransactions {
		t.Fatalf("managerMode = %d, want transactions", got.managerMode)
	}
	if got.focusedSection != sectionManagerTransactions {
		t.Fatalf("focusedSection = %d, want manager transactions", got.focusedSection)
	}
	if !got.filterInputMode {
		t.Fatal("expected manager filter input mode after drill")
	}
	if got.drillReturn == nil {
		t.Fatal("expected drillReturn state")
	}
	if got.drillReturn.prevFilterInput != "cat:Legacy" {
		t.Fatalf("prevFilterInput = %q, want cat:Legacy", got.drillReturn.prevFilterInput)
	}
	if !strings.Contains(got.filterInput, "date:2026-01-01..2026-01-31") {
		t.Fatalf("drill filter missing timeframe bounds: %q", got.filterInput)
	}
	if !strings.Contains(strings.ToLower(got.filterInput), "type:debit") {
		t.Fatalf("drill filter missing mode predicate: %q", got.filterInput)
	}
}

func TestDashboardDrillReturnEscRestoresDashboardAndManagerFilterState(t *testing.T) {
	drilled := drilledDashboardModel(t)

	next, _ := drilled.Update(keyMsg("esc"))
	got := next.(model)
	if got.activeTab != tabDashboard {
		t.Fatalf("activeTab = %d, want dashboard", got.activeTab)
	}
	if got.focusedSection != sectionDashboardNetCashflow {
		t.Fatalf("focusedSection = %d, want net cashflow", got.focusedSection)
	}
	if got.drillReturn != nil {
		t.Fatal("drillReturn should clear after ESC return")
	}
	if got.filterInput != "cat:Legacy" {
		t.Fatalf("filterInput restored = %q, want cat:Legacy", got.filterInput)
	}
	modeIdx := findWidgetModeIndexByID(got.dashWidgets[0], "spending")
	if got.dashWidgets[0].activeMode != modeIdx {
		t.Fatalf("restored widget mode = %d, want spending index %d", got.dashWidgets[0].activeMode, modeIdx)
	}
}

func TestManagerTabSwitchClearsDrillReturnContext(t *testing.T) {
	drilled := drilledDashboardModel(t)
	drilled.filterInputMode = false

	next, _ := drilled.Update(keyMsg("tab"))
	got := next.(model)
	if got.drillReturn != nil {
		t.Fatal("drillReturn should clear on non-ESC manager navigation")
	}
}

func TestManagerJumpActivateClearsDrillReturnContext(t *testing.T) {
	drilled := drilledDashboardModel(t)
	drilled.filterInputMode = false

	next, _ := drilled.Update(keyMsg("v"))
	got := next.(model)
	if !got.jumpModeActive {
		t.Fatal("expected jump mode to activate")
	}
	if got.drillReturn != nil {
		t.Fatal("drillReturn should clear when activating jump mode from Manager")
	}
}

func TestDashboardCustomModeEditUsesSavedFilterPicker(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())

	m := newModel()
	m.keys = NewKeyRegistry()
	m.commands = NewCommandRegistry(m.keys, m.savedFilters)
	m.ready = true
	m.activeTab = tabDashboard
	m.focusedSection = sectionDashboardNetCashflow
	m.savedFilters = []savedFilter{{ID: "renovation", Name: "Renovation", Expr: "cat:Home AND amt:<0"}}
	m.dashWidgets = newDashboardWidgets(nil)

	editKey := m.primaryActionKey(scopeDashboardFocused, actionDashboardCustomModeEdit, "e")
	next, _ := m.Update(keyMsg(editKey))
	got := next.(model)
	if got.filterApplyPicker == nil {
		t.Fatal("expected saved-filter picker to open for custom mode edit")
	}

	next, _ = got.Update(keyMsg("enter"))
	got2 := next.(model)
	if got2.filterApplyPicker != nil {
		t.Fatal("expected picker to close after selecting a saved filter")
	}
	if len(got2.customPaneModes) != 1 {
		t.Fatalf("customPaneModes = %d, want 1", len(got2.customPaneModes))
	}
	if got2.customPaneModes[0].Pane != "net_cashflow" {
		t.Fatalf("custom pane = %q, want net_cashflow", got2.customPaneModes[0].Pane)
	}
	net := got2.dashWidgets[0]
	customIdx := len(net.modes) - 1
	if !net.modes[customIdx].custom {
		t.Fatalf("expected final net mode custom, got %+v", net.modes[customIdx])
	}
	if net.activeMode != customIdx {
		t.Fatalf("net activeMode = %d, want %d (selected custom mode)", net.activeMode, customIdx)
	}
}

func drilledDashboardModel(t *testing.T) model {
	t.Helper()
	m := newModel()
	m.keys = NewKeyRegistry()
	m.commands = NewCommandRegistry(m.keys, m.savedFilters)
	m.ready = true
	m.activeTab = tabDashboard
	m.focusedSection = sectionDashboardNetCashflow
	m.dashMonthMode = true
	m.dashAnchorMonth = "2026-01"
	m.dashWidgets = newDashboardWidgets(nil)
	m.filterInput = "cat:Legacy"
	m.reparseFilterInput()
	m.rows = []transaction{{id: 1, dateISO: "2026-01-10", amount: -10, categoryName: "Groceries", description: "A"}}
	m.dashWidgets[0].activeMode = findWidgetModeIndexByID(m.dashWidgets[0], "spending")

	next, _ := m.Update(keyMsg("enter"))
	out := next.(model)
	if out.drillReturn == nil {
		t.Fatal("expected drillReturn after drill-down")
	}
	return out
}
