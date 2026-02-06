package main

import (
	"strings"
	"testing"
	"time"
)

func TestFilterByTimeframePresets(t *testing.T) {
	now := time.Date(2026, time.February, 6, 12, 0, 0, 0, time.Local)
	rows := []transaction{
		{id: 1, dateISO: "2026-02-03"},
		{id: 2, dateISO: "2026-01-15"},
		{id: 3, dateISO: "2025-12-20"},
		{id: 4, dateISO: "2025-02-05"},
	}

	thisMonth := filterByTimeframe(rows, dashTimeframeThisMonth, "", "", now)
	if len(thisMonth) != 1 || thisMonth[0].id != 1 {
		t.Fatalf("this month ids = %v, want [1]", txnIDs(thisMonth))
	}

	lastMonth := filterByTimeframe(rows, dashTimeframeLastMonth, "", "", now)
	if len(lastMonth) != 1 || lastMonth[0].id != 2 {
		t.Fatalf("last month ids = %v, want [2]", txnIDs(lastMonth))
	}

	oneMonth := filterByTimeframe(rows, dashTimeframe1Month, "", "", now)
	if got := txnIDs(oneMonth); !equalIntSlices(got, []int{1, 2}) {
		t.Fatalf("1m ids = %v, want [1 2]", got)
	}

	twoMonths := filterByTimeframe(rows, dashTimeframe2Months, "", "", now)
	if got := txnIDs(twoMonths); !equalIntSlices(got, []int{1, 2, 3}) {
		t.Fatalf("2m ids = %v, want [1 2 3]", got)
	}

	ytd := filterByTimeframe(rows, dashTimeframeYTD, "", "", now)
	if got := txnIDs(ytd); !equalIntSlices(got, []int{1, 2}) {
		t.Fatalf("ytd ids = %v, want [1 2]", got)
	}

	oneYear := filterByTimeframe(rows, dashTimeframe1Year, "", "", now)
	if got := txnIDs(oneYear); !equalIntSlices(got, []int{1, 2, 3}) {
		t.Fatalf("1y ids = %v, want [1 2 3]", got)
	}
}

func TestFilterByTimeframeCustom(t *testing.T) {
	now := time.Date(2026, time.February, 6, 12, 0, 0, 0, time.Local)
	rows := []transaction{
		{id: 1, dateISO: "2026-02-01"},
		{id: 2, dateISO: "2026-02-10"},
		{id: 3, dateISO: "2026-01-31"},
	}

	custom := filterByTimeframe(rows, dashTimeframeCustom, "2026-02-01", "2026-02-05", now)
	if got := txnIDs(custom); !equalIntSlices(got, []int{1}) {
		t.Fatalf("custom ids = %v, want [1]", got)
	}
}

func TestRenderDashboardTimeframeChips(t *testing.T) {
	output := renderDashboardTimeframeChips(dashTimeframeLabels, dashTimeframeThisMonth, dashTimeframe3Months, true)
	if !strings.Contains(output, "[This Month]") {
		t.Fatal("chips should include This Month")
	}
	if !strings.Contains(output, "[1M]") || !strings.Contains(output, "[2M]") {
		t.Fatal("chips should include 1M and 2M")
	}
	if !strings.Contains(output, "[Custom]") {
		t.Fatal("chips should include Custom")
	}
	if !strings.Contains(output, ">") {
		t.Fatal("focused chips should include cursor marker")
	}
}

func TestTransactionsTabDateFilterRemoved(t *testing.T) {
	m := newModel()
	m.activeTab = tabTransactions
	m.status = "unchanged"

	m2, _ := m.updateNavigation(keyMsg("d"))
	got := m2.(model)
	if got.status != "unchanged" {
		t.Fatalf("status changed by transactions d-key: %q", got.status)
	}

	help := got.keys.HelpBindings(scopeTransactions)
	for _, b := range help {
		if b.Help().Key == "d" {
			t.Fatal("transactions footer should not expose date-range key")
		}
	}
}

func txnIDs(rows []transaction) []int {
	ids := make([]int, 0, len(rows))
	for _, r := range rows {
		ids = append(ids, r.id)
	}
	return ids
}

func equalIntSlices(a, b []int) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
