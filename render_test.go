package main

import (
	"strings"
	"testing"
	"time"
)

// ---------------------------------------------------------------------------
// Summary cards tests
// ---------------------------------------------------------------------------

func testDashboardRows() []transaction {
	return []transaction{
		{id: 1, dateISO: "2026-01-15", amount: -55.30, description: "WOOLWORTHS", categoryName: "Groceries", categoryColor: "#94e2d5"},
		{id: 2, dateISO: "2026-01-20", amount: 500.00, description: "SALARY", categoryName: "Income", categoryColor: "#a6e3a1"},
		{id: 3, dateISO: "2026-02-03", amount: -20.00, description: "DAN MURPHYS", categoryName: "Dining & Drinks", categoryColor: "#fab387"},
		{id: 4, dateISO: "2026-02-04", amount: -12.50, description: "UBER", categoryName: "Transport", categoryColor: "#89b4fa"},
		{id: 5, dateISO: "2026-02-05", amount: 203.92, description: "PAYMENT", categoryName: "Uncategorised", categoryColor: "#7f849c"},
	}
}

func TestRenderSummaryCardsContainsValues(t *testing.T) {
	rows := testDashboardRows()
	cats := []category{{id: 1, name: "Groceries"}, {id: 2, name: "Income"}}
	output := renderSummaryCards(rows, cats, 80)

	// Should contain income, expenses, transaction count
	if !strings.Contains(output, "Balance") {
		t.Error("missing Balance label")
	}
	if !strings.Contains(output, "Income") {
		t.Error("missing Income label")
	}
	if !strings.Contains(output, "Expenses") {
		t.Error("missing Expenses label")
	}
	if !strings.Contains(output, "5") { // 5 transactions
		t.Error("missing transaction count")
	}
}

func TestRenderSummaryCardsEmpty(t *testing.T) {
	output := renderSummaryCards(nil, nil, 80)
	if !strings.Contains(output, "Balance") {
		t.Error("empty data should still show labels")
	}
	if !strings.Contains(output, "$0.00") {
		t.Error("empty data should show zero amounts")
	}
}

// ---------------------------------------------------------------------------
// Category breakdown tests
// ---------------------------------------------------------------------------

func TestRenderCategoryBreakdownEmpty(t *testing.T) {
	output := renderCategoryBreakdown(nil, 80)
	if !strings.Contains(output, "No expense data") {
		t.Errorf("expected empty message, got %q", output)
	}
}

func TestRenderCategoryBreakdownIncomeOnly(t *testing.T) {
	rows := []transaction{
		{amount: 500.00, categoryName: "Income"},
	}
	output := renderCategoryBreakdown(rows, 80)
	if !strings.Contains(output, "No expense data") {
		t.Error("income-only should show no expense data message")
	}
}

func TestRenderCategoryBreakdownCorrectCategories(t *testing.T) {
	rows := testDashboardRows()
	output := renderCategoryBreakdown(rows, 80)

	if !strings.Contains(output, "Groceries") {
		t.Error("missing Groceries")
	}
	if !strings.Contains(output, "Dining") {
		t.Error("missing Dining")
	}
	if !strings.Contains(output, "Transport") {
		t.Error("missing Transport")
	}
	// Should contain bar characters
	if !strings.Contains(output, "█") {
		t.Error("missing filled bar characters")
	}
	if !strings.Contains(output, "%") {
		t.Error("missing percentage")
	}
}

func TestRenderCategoryBreakdownTopSixPlusOther(t *testing.T) {
	// Create 8 categories of expenses — should show 6 + Other
	var rows []transaction
	cats := []string{"A", "B", "C", "D", "E", "F", "G", "H"}
	for i, c := range cats {
		rows = append(rows, transaction{
			amount:        float64(-(i + 1) * 10),
			categoryName:  c,
			categoryColor: "#94e2d5",
		})
	}
	output := renderCategoryBreakdown(rows, 80)

	// Top 6 by amount should be H, G, F, E, D, C (largest first)
	// "Other" should aggregate A + B
	if !strings.Contains(output, "Other") {
		t.Error("expected 'Other' bucket for categories beyond top 6")
	}
}

// ---------------------------------------------------------------------------
// Monthly aggregation tests
// ---------------------------------------------------------------------------

func TestAggregateDailyBasic(t *testing.T) {
	now := time.Now()
	today := now.Format("2006-01-02")
	rows := []transaction{
		{dateISO: today, amount: -100.00}, // debit: cumulative += 100
		{dateISO: today, amount: -50.00},  // debit: cumulative += 50
		{dateISO: today, amount: 500.00},  // credit: cumulative -= 500
	}
	data, labels := aggregateDaily(rows, 3)
	if len(data) == 0 {
		t.Fatal("expected non-empty data")
	}
	// Cumulative: debits add (+150), credit subtracts (-500) = -350, clamped to 0.
	last := data[len(data)-1]
	if last != 0.0 {
		t.Errorf("cumulative balance = %.2f, want 0.00 (clamped from net -350)", last)
	}
	// Labels should contain month abbreviations
	if len(labels) == 0 {
		t.Error("expected at least one month label")
	}
}

func TestAggregateDailyExcludesOldData(t *testing.T) {
	rows := []transaction{
		{dateISO: "2020-01-15", amount: -100.00},
	}
	data, _ := aggregateDaily(rows, 3)
	for _, v := range data {
		if v != 0 {
			t.Errorf("old data should be excluded from cumulative, got %.2f", v)
			break
		}
	}
}

func TestAggregateDailyEmpty(t *testing.T) {
	data, _ := aggregateDaily(nil, 3)
	if len(data) == 0 {
		t.Fatal("expected data points even with no transactions")
	}
	for _, v := range data {
		if v != 0 {
			t.Errorf("empty data should have zero values, got %.2f", v)
			break
		}
	}
}

func TestAggregateDailyCreditReducesBalance(t *testing.T) {
	now := time.Now()
	today := now.Format("2006-01-02")
	yesterday := now.AddDate(0, 0, -1).Format("2006-01-02")
	rows := []transaction{
		{dateISO: yesterday, amount: -200.00}, // debit: cumulative += 200
		{dateISO: today, amount: 100.00},      // credit: cumulative -= 100
	}
	data, _ := aggregateDaily(rows, 3)
	if len(data) < 2 {
		t.Fatal("expected at least 2 data points")
	}
	// The last data point should reflect the net: 200 - 100 = 100
	last := data[len(data)-1]
	if last != 100.00 {
		t.Errorf("cumulative balance = %.2f, want 100.00", last)
	}
}

func TestAggregateDailyCreditOnlyClampedToZero(t *testing.T) {
	now := time.Now()
	rows := []transaction{
		{dateISO: now.Format("2006-01-02"), amount: 500.00}, // credit only
	}
	data, _ := aggregateDaily(rows, 3)
	// Net is -500, clamped to 0
	last := data[len(data)-1]
	if last != 0.0 {
		t.Errorf("credit-only cumulative should be clamped to 0, got %.2f", last)
	}
}

// ---------------------------------------------------------------------------
// Formatting tests
// ---------------------------------------------------------------------------

func TestFormatMoney(t *testing.T) {
	tests := []struct {
		input float64
		want  string
	}{
		{0.0, "$0.00"},
		{1234.56, "$1,234.56"},
		{100.00, "$100.00"},
		{999999.99, "$999,999.99"},
		{0.50, "$0.50"},
		{50.10, "$50.10"},
	}
	for _, tt := range tests {
		got := formatMoney(tt.input)
		if got != tt.want {
			t.Errorf("formatMoney(%.2f) = %q, want %q", tt.input, got, tt.want)
		}
	}
}

func TestFormatMonth(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"2026-01-15", "Jan 2026"},
		{"2026-12-01", "Dec 2026"},
	}
	for _, tt := range tests {
		got := formatMonth(tt.input)
		if got != tt.want {
			t.Errorf("formatMonth(%q) = %q, want %q", tt.input, got, tt.want)
		}
	}
}

func TestCountActiveCategories(t *testing.T) {
	rows := testDashboardRows()
	count := countActiveCategories(rows)
	// Groceries, Income, Dining & Drinks, Transport — NOT Uncategorised
	if count != 4 {
		t.Errorf("countActiveCategories = %d, want 4", count)
	}
}

func TestCountActiveCategoriesEmpty(t *testing.T) {
	count := countActiveCategories(nil)
	if count != 0 {
		t.Errorf("expected 0 for nil rows, got %d", count)
	}
}

// ---------------------------------------------------------------------------
// Date format tests
// ---------------------------------------------------------------------------

func TestFormatDateShort(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"2026-02-03", "03-02-26"},
		{"2026-01-15", "15-01-26"},
		{"2025-12-20", "20-12-25"},
		{"bad-date", "bad-date"}, // fallback
	}
	for _, tt := range tests {
		got := formatDateShort(tt.input)
		if got != tt.want {
			t.Errorf("formatDateShort(%q) = %q, want %q", tt.input, got, tt.want)
		}
	}
}

// ---------------------------------------------------------------------------
// Monthly trend rendering tests
// ---------------------------------------------------------------------------

func TestRenderMonthlyTrendEmpty(t *testing.T) {
	output := renderMonthlyTrend(nil, 80)
	if output == "" {
		t.Error("expected non-empty output even with no data")
	}
}

func TestRenderMonthlyTrendContainsCaption(t *testing.T) {
	now := time.Now()
	rows := []transaction{
		{dateISO: now.Format("2006-01-02"), amount: -100.00},
	}
	output := renderMonthlyTrend(rows, 80)
	if !strings.Contains(output, "Cumulative balance") {
		t.Error("missing cumulative balance label in chart caption")
	}
}

func TestRenderMonthlyTrendCreditOnly(t *testing.T) {
	// Credit-only data should produce a flat zero line (clamped)
	now := time.Now()
	rows := []transaction{
		{dateISO: now.Format("2006-01-02"), amount: 500.00},
	}
	output := renderMonthlyTrend(rows, 80)
	// Should still render (all zeros chart)
	if output == "" {
		t.Error("expected non-empty output")
	}
	if !strings.Contains(output, "Cumulative balance") {
		t.Error("missing cumulative balance caption")
	}
}

// ---------------------------------------------------------------------------
// Header rendering tests
// ---------------------------------------------------------------------------

func TestRenderHeaderContainsAppName(t *testing.T) {
	output := renderHeader("Jaskmoney", 0, 80)
	if !strings.Contains(output, "Jaskmoney") {
		t.Error("missing app name in header")
	}
}

func TestRenderHeaderContainsAllTabs(t *testing.T) {
	output := renderHeader("Jaskmoney", 0, 80)
	for _, tab := range tabNames {
		if !strings.Contains(output, tab) {
			t.Errorf("missing tab %q in header", tab)
		}
	}
}

func TestRenderHeaderActiveTabHighlight(t *testing.T) {
	// Verify that tab 0 active contains "Dashboard" and tab 1 active contains "Transactions"
	h0 := renderHeader("App", 0, 80)
	h1 := renderHeader("App", 1, 80)
	if !strings.Contains(h0, "Dashboard") {
		t.Error("tab 0 header missing Dashboard")
	}
	if !strings.Contains(h1, "Transactions") {
		t.Error("tab 1 header missing Transactions")
	}
}

func TestRenderHeaderZeroWidth(t *testing.T) {
	output := renderHeader("Jaskmoney", 0, 0)
	if output == "" {
		t.Error("header should render even with zero width")
	}
}

// ---------------------------------------------------------------------------
// Transaction table rendering tests
// ---------------------------------------------------------------------------

func TestRenderTransactionTableBasic(t *testing.T) {
	rows := testDashboardRows()
	cats := []category{{id: 1, name: "Groceries"}}
	output := renderTransactionTable(rows, cats, 0, 0, 5, 80, sortByDate, false)
	if !strings.Contains(output, "Date") {
		t.Error("missing Date column header")
	}
	if !strings.Contains(output, "Amount") {
		t.Error("missing Amount column header")
	}
	if !strings.Contains(output, "Category") {
		t.Error("missing Category column header")
	}
	if !strings.Contains(output, "Description") {
		t.Error("missing Description column header")
	}
}

func TestRenderTransactionTableNilCategoriesHidesColumn(t *testing.T) {
	rows := testDashboardRows()
	output := renderTransactionTable(rows, nil, 0, 0, 5, 80, sortByDate, false)
	if strings.Contains(output, "Category") {
		t.Error("Category column should be hidden when categories is nil")
	}
}

func TestRenderTransactionTableSortIndicator(t *testing.T) {
	rows := testDashboardRows()
	output := renderTransactionTable(rows, nil, 0, 0, 5, 80, sortByDate, true)
	if !strings.Contains(output, "▲") {
		t.Error("missing ascending sort indicator")
	}
	output2 := renderTransactionTable(rows, nil, 0, 0, 5, 80, sortByDate, false)
	if !strings.Contains(output2, "▼") {
		t.Error("missing descending sort indicator")
	}
}

func TestRenderTransactionTableScrollIndicator(t *testing.T) {
	rows := testDashboardRows()
	output := renderTransactionTable(rows, nil, 0, 0, 3, 80, sortByDate, false)
	if !strings.Contains(output, "showing") {
		t.Error("missing scroll indicator")
	}
}

func TestRenderTransactionTableEmpty(t *testing.T) {
	output := renderTransactionTable(nil, nil, 0, 0, 10, 80, sortByDate, false)
	if !strings.Contains(output, "Date") {
		t.Error("empty table should still show column headers")
	}
}

// ---------------------------------------------------------------------------
// Empty state rendering tests
// ---------------------------------------------------------------------------

func TestRenderCategoryBreakdownEmptyMessage(t *testing.T) {
	output := renderCategoryBreakdown(nil, 80)
	if !strings.Contains(output, "No expense data") {
		t.Error("expected empty message for nil rows")
	}
}

func TestRenderMonthlyTrendAlwaysRenders(t *testing.T) {
	output := renderMonthlyTrend(nil, 80)
	if output == "" {
		t.Error("trend chart should render even with no data (zero line)")
	}
}

// ---------------------------------------------------------------------------
// File picker and dupe modal rendering tests
// ---------------------------------------------------------------------------

func TestRenderFilePicker(t *testing.T) {
	files := []string{"ANZ.csv", "CBA.csv", "test.csv"}
	output := renderFilePicker(files, 1)
	if !strings.Contains(output, "Import CSV") {
		t.Error("missing title")
	}
	if !strings.Contains(output, "ANZ.csv") {
		t.Error("missing file ANZ.csv")
	}
	if !strings.Contains(output, ">") {
		t.Error("missing cursor indicator")
	}
}

func TestRenderFilePickerEmpty(t *testing.T) {
	output := renderFilePicker(nil, 0)
	if !strings.Contains(output, "Loading") {
		t.Error("empty file list should show loading message")
	}
}

func TestRenderDupeModal(t *testing.T) {
	output := renderDupeModal("ANZ.csv", 100, 15)
	if !strings.Contains(output, "Duplicates") {
		t.Error("missing title")
	}
	if !strings.Contains(output, "ANZ.csv") {
		t.Error("missing filename")
	}
	if !strings.Contains(output, "100") {
		t.Error("missing total count")
	}
	if !strings.Contains(output, "15") {
		t.Error("missing dupe count")
	}
}

// ---------------------------------------------------------------------------
// Status bar error styling test
// ---------------------------------------------------------------------------

func TestRenderStatusError(t *testing.T) {
	m := newModel()
	m.width = 80
	normal := m.renderStatus("ok", false)
	errOut := m.renderStatus("fail", true)
	// Both should render non-empty, but they should differ (different styles)
	if normal == "" || errOut == "" {
		t.Error("status should render non-empty")
	}
	if normal == errOut {
		t.Error("error status should look different from normal status")
	}
}
