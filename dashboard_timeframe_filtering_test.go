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
	output := renderDatePresetChips(dashTimeframeLabels, dashTimeframeThisMonth, dashTimeframe3Months, true)
	if !strings.Contains(output, "[This]") {
		t.Fatal("chips should include This")
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

func TestDashboardDateRangeUsesPresetBoundsEvenWithSparseData(t *testing.T) {
	now := time.Date(2026, time.February, 11, 9, 0, 0, 0, time.Local)
	rows := []transaction{
		{id: 1, dateISO: "2026-02-10"},
	}

	twoMonths := dashboardDateRange(rows, dashTimeframe2Months, "", "", now)
	threeMonths := dashboardDateRange(rows, dashTimeframe3Months, "", "", now)
	sixMonths := dashboardDateRange(rows, dashTimeframe6Months, "", "", now)

	if twoMonths != "Dec 2025 – Feb 2026" {
		t.Fatalf("2M preview = %q, want %q", twoMonths, "Dec 2025 – Feb 2026")
	}
	if threeMonths != "Nov 2025 – Feb 2026" {
		t.Fatalf("3M preview = %q, want %q", threeMonths, "Nov 2025 – Feb 2026")
	}
	if sixMonths != "Aug 2025 – Feb 2026" {
		t.Fatalf("6M preview = %q, want %q", sixMonths, "Aug 2025 – Feb 2026")
	}
}

func TestDashboardTimeframeRelationshipsWithPanels(t *testing.T) {
	now := time.Date(2026, time.February, 11, 9, 0, 0, 0, time.Local)
	rows := []transaction{
		{id: 1, dateISO: "2026-02-10", amount: -10, categoryName: "Groceries"},
		{id: 2, dateISO: "2026-01-10", amount: -20, categoryName: "Transport"},
		{id: 3, dateISO: "2025-12-12", amount: -30, categoryName: "Dining"},
		{id: 4, dateISO: "2025-11-12", amount: -40, categoryName: "Utilities"},
		{id: 5, dateISO: "2025-08-12", amount: -50, categoryName: "Travel"},
		{id: 6, dateISO: "2025-07-10", amount: -60, categoryName: "Old"},
		{id: 7, dateISO: "2026-02-08", amount: 1000, categoryName: "Income"},
		{id: 8, dateISO: "2026-02-07", amount: -5, categoryName: "Uncategorised"},
		{id: 9, dateISO: "2026-02-06", amount: -7, categoryName: "Groceries"},
	}
	txnTags := map[int][]tag{
		9: {{id: 1, name: "IGNORE"}},
	}

	cases := []struct {
		name        string
		timeframe   int
		wantRows    []int
		wantSpend   []int
		wantStart   string
		wantEnd     string
		wantPreview string
	}{
		{
			name:        "2M",
			timeframe:   dashTimeframe2Months,
			wantRows:    []int{1, 2, 3, 7, 8, 9},
			wantSpend:   []int{1, 2, 3, 7, 8},
			wantStart:   "2025-12-11",
			wantEnd:     "2026-02-11",
			wantPreview: "Dec 2025 – Feb 2026",
		},
		{
			name:        "3M",
			timeframe:   dashTimeframe3Months,
			wantRows:    []int{1, 2, 3, 4, 7, 8, 9},
			wantSpend:   []int{1, 2, 3, 4, 7, 8},
			wantStart:   "2025-11-11",
			wantEnd:     "2026-02-11",
			wantPreview: "Nov 2025 – Feb 2026",
		},
		{
			name:        "6M",
			timeframe:   dashTimeframe6Months,
			wantRows:    []int{1, 2, 3, 4, 5, 7, 8, 9},
			wantSpend:   []int{1, 2, 3, 4, 5, 7, 8},
			wantStart:   "2025-08-11",
			wantEnd:     "2026-02-11",
			wantPreview: "Aug 2025 – Feb 2026",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			filtered := filterByTimeframe(rows, tc.timeframe, "", "", now)
			if got := txnIDs(filtered); !equalIntSlices(got, tc.wantRows) {
				t.Fatalf("dashboard rows = %v, want %v", got, tc.wantRows)
			}

			spendRows := dashboardSpendRows(filtered, txnTags)
			if got := txnIDs(spendRows); !equalIntSlices(got, tc.wantSpend) {
				t.Fatalf("spending rows = %v, want %v", got, tc.wantSpend)
			}

			m := newModel()
			m.dashTimeframe = tc.timeframe
			start, end := m.dashboardChartRange(now)
			if got := start.Format("2006-01-02"); got != tc.wantStart {
				t.Fatalf("chart start = %s, want %s", got, tc.wantStart)
			}
			if got := end.Format("2006-01-02"); got != tc.wantEnd {
				t.Fatalf("chart end = %s, want %s", got, tc.wantEnd)
			}

			if got := dashboardDateRange(filtered, tc.timeframe, "", "", now); got != tc.wantPreview {
				t.Fatalf("date preview = %q, want %q", got, tc.wantPreview)
			}
		})
	}
}

func TestManagerTransactionsDateFilterRemoved(t *testing.T) {
	m := newModel()
	m.activeTab = tabManager
	m.managerMode = managerModeTransactions
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
