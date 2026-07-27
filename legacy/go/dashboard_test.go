package main

import (
	"strings"
	"testing"

	"github.com/charmbracelet/x/ansi"
)

func TestDashboardDefaultScopeUsesTimeframeAndAccountsOnly(t *testing.T) {
	m := newModel()
	m.activeTab = tabDashboard
	m.accounts = []account{
		{id: 1, name: "ANZ"},
		{id: 2, name: "CBA"},
	}
	m.filterAccounts = map[int]bool{1: true}
	m.dashMonthMode = true
	m.dashAnchorMonth = "2026-01"
	m.filterInput = "cat:Transport"
	m.reparseFilterInput()
	m.rows = []transaction{
		{id: 1, dateISO: "2026-01-10", amount: -10, categoryName: "Groceries", accountName: "ANZ"},
		{id: 2, dateISO: "2026-01-11", amount: -20, categoryName: "Transport", accountName: "CBA"},
		{id: 3, dateISO: "2026-02-01", amount: -30, categoryName: "Groceries", accountName: "ANZ"},
	}

	rows := m.getDashboardRows()
	if len(rows) != 1 || rows[0].id != 1 {
		t.Fatalf("dashboard rows ids = %v, want [1]", idsFromRows(rows))
	}
}

func TestDashboardCustomModeFilterComposesViaAST(t *testing.T) {
	m := newModel()
	m.activeTab = tabDashboard
	m.dashMonthMode = true
	m.dashAnchorMonth = "2026-01"
	m.rows = []transaction{
		{id: 1, dateISO: "2026-01-10", amount: -10, categoryName: "Groceries", accountName: "ANZ"},
		{id: 2, dateISO: "2026-01-11", amount: -20, categoryName: "Dining", accountName: "ANZ"},
		{id: 3, dateISO: "2026-01-12", amount: -30, categoryName: "Utilities", accountName: "ANZ"},
		{id: 4, dateISO: "2026-02-01", amount: -40, categoryName: "Groceries", accountName: "ANZ"},
	}
	mode := widgetMode{filterExpr: "cat:Groceries OR cat:Dining", custom: true}

	got := m.buildDashboardModeFilter(mode)
	want := andFilterNodes(
		m.buildDashboardScopeFilter(),
		mustParseFilterStrictExpr(t, "cat:Groceries OR cat:Dining"),
	)
	if filterExprString(got) != filterExprString(want) {
		t.Fatalf("composed filter = %q, want %q", filterExprString(got), filterExprString(want))
	}

	rows := m.dashboardRowsForMode(mode)
	ids := idsFromRows(rows)
	if len(ids) != 2 || !containsInt(ids, 1) || !containsInt(ids, 2) {
		t.Fatalf("dashboard custom mode rows ids = %v, want [1 2]", ids)
	}
}

func TestManagerFilterPillShowsDashboardDrillPrefix(t *testing.T) {
	m := newModel()
	m.activeTab = tabManager
	m.filterInput = "cat:Groceries"
	m.reparseFilterInput()
	m.drillReturn = &drillReturnState{returnTab: tabDashboard}

	pill := ansi.Strip(m.activeFilterPill())
	if !strings.Contains(pill, "[Dashboard >]") {
		t.Fatalf("expected dashboard drill prefix, got %q", pill)
	}
	if !strings.Contains(pill, "[cat:Groceries]") {
		t.Fatalf("expected rendered filter expr in pill, got %q", pill)
	}
}

func idsFromRows(rows []transaction) []int {
	ids := make([]int, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.id)
	}
	return ids
}

func containsInt(vals []int, want int) bool {
	for _, v := range vals {
		if v == want {
			return true
		}
	}
	return false
}
