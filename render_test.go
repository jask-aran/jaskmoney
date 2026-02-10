package main

import (
	"math"
	"sort"
	"strings"
	"testing"
	"time"

	tslc "github.com/NimbleMarkets/ntcharts/linechart/timeserieslinechart"
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

	// Should contain balance, debits, credits, transaction count
	if !strings.Contains(output, "Balance") {
		t.Error("missing Balance label")
	}
	if !strings.Contains(output, "Debits") {
		t.Error("missing Debits label")
	}
	if !strings.Contains(output, "Credits") {
		t.Error("missing Credits label")
	}
	if !strings.Contains(output, "Transactions") {
		t.Error("missing transaction label")
	}
	if !strings.Contains(output, "Uncat") {
		t.Error("missing Uncat label")
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
	output := renderCategoryBreakdown(nil, nil, 80)
	if !strings.Contains(output, "Uncategorised") {
		t.Errorf("expected empty message, got %q", output)
	}
}

func TestRenderCategoryBreakdownIncomeOnly(t *testing.T) {
	rows := []transaction{
		{amount: 500.00, categoryName: "Income"},
	}
	output := renderCategoryBreakdown(rows, nil, 80)
	if !strings.Contains(output, "Uncategorised") {
		t.Error("income-only should still show category rows")
	}
}

func TestRenderCategoryBreakdownCorrectCategories(t *testing.T) {
	rows := testDashboardRows()
	output := renderCategoryBreakdown(rows, nil, 80)

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
	if strings.Contains(output, "…") {
		t.Error("unexpected truncation ellipsis in category breakdown output")
	}
}

func TestRenderCategoryBreakdownShowsAllCategories(t *testing.T) {
	// Create 8 categories of expenses — all should be shown.
	var rows []transaction
	cats := []string{"A", "B", "C", "D", "E", "F", "G", "H"}
	for i, c := range cats {
		rows = append(rows, transaction{
			amount:        float64(-(i + 1) * 10),
			categoryName:  c,
			categoryColor: "#94e2d5",
		})
	}
	output := renderCategoryBreakdown(rows, nil, 80)

	for _, c := range cats {
		if !strings.Contains(output, c) {
			t.Errorf("expected category %q in output", c)
		}
	}
}

func TestRenderCategoryBreakdownIncludesKnownZeroSpendCategories(t *testing.T) {
	rows := []transaction{
		{amount: -25.0, categoryName: "Groceries", categoryColor: "#94e2d5"},
	}
	allCats := []category{
		{id: 1, name: "Groceries", color: "#94e2d5"},
		{id: 2, name: "Dining", color: "#fab387"},
		{id: 3, name: "Transport", color: "#89b4fa"},
	}
	output := renderCategoryBreakdown(rows, allCats, 80)
	if !strings.Contains(output, "Groceries") {
		t.Fatal("expected Groceries in output")
	}
	if !strings.Contains(output, "Dining") {
		t.Fatal("expected zero-spend category Dining in output")
	}
	if !strings.Contains(output, "Transport") {
		t.Fatal("expected zero-spend category Transport in output")
	}
}

// ---------------------------------------------------------------------------
// Daily spend aggregation tests
// ---------------------------------------------------------------------------

func TestAggregateDailySpendBasic(t *testing.T) {
	now := time.Now()
	today := now.Format("2006-01-02")
	rows := []transaction{
		{dateISO: today, amount: -100.00, categoryName: "Groceries"},
		{dateISO: today, amount: -50.00, categoryName: "Dining"},
		{dateISO: today, amount: 500.00, categoryName: "Income"},
		{dateISO: today, amount: -25.00, categoryName: "Uncategorised"},
	}
	data, dates := aggregateDailySpend(rows, spendingTrackerDays)
	if len(data) != spendingTrackerDays {
		t.Fatalf("expected %d data points, got %d", spendingTrackerDays, len(data))
	}
	if len(dates) != spendingTrackerDays {
		t.Fatalf("expected %d dates, got %d", spendingTrackerDays, len(dates))
	}
	last := data[len(data)-1]
	if last != 150.00 {
		t.Errorf("daily spend = %.2f, want 150.00", last)
	}
}

func TestAggregateDailySpendExcludesOldData(t *testing.T) {
	old := time.Now().AddDate(0, 0, -(spendingTrackerDays + 5)).Format("2006-01-02")
	rows := []transaction{
		{dateISO: old, amount: -100.00},
	}
	data, _ := aggregateDailySpend(rows, spendingTrackerDays)
	for _, v := range data {
		if v != 0 {
			t.Errorf("old data should be excluded from daily spend, got %.2f", v)
			break
		}
	}
}

func TestAggregateDailySpendEmpty(t *testing.T) {
	data, _ := aggregateDailySpend(nil, spendingTrackerDays)
	if len(data) != spendingTrackerDays {
		t.Fatalf("expected %d data points, got %d", spendingTrackerDays, len(data))
	}
	for _, v := range data {
		if v != 0 {
			t.Errorf("empty data should have zero values, got %.2f", v)
			break
		}
	}
}

func TestAggregateDailySpendCreditOnly(t *testing.T) {
	now := time.Now()
	rows := []transaction{
		{dateISO: now.Format("2006-01-02"), amount: 500.00},
	}
	data, _ := aggregateDailySpend(rows, spendingTrackerDays)
	last := data[len(data)-1]
	if last != 0.0 {
		t.Errorf("credit-only daily spend should be 0, got %.2f", last)
	}
}

func TestRenderSpendingTrackerShowsYAxisLabels(t *testing.T) {
	now := time.Now()
	rows := []transaction{
		{dateISO: now.Format("2006-01-02"), amount: -123.45},
	}
	output := renderSpendingTracker(rows, 80)
	if strings.Contains(output, "$") {
		t.Error("did not expect currency symbol in Y-axis labels")
	}
}

func TestRenderSpendingTrackerShowsGridlines(t *testing.T) {
	now := time.Now()
	rows := []transaction{
		{dateISO: now.Format("2006-01-02"), amount: -123.45, categoryName: "Groceries"},
	}
	output := renderSpendingTrackerWithWeekAnchor(rows, 80, time.Sunday)
	if !strings.Contains(output, "│") {
		t.Error("expected vertical gridline glyph")
	}
}

func TestSpendingMinorGridStep(t *testing.T) {
	if got := spendingMinorGridStep(60, 80); got != 2 {
		t.Errorf("spendingMinorGridStep(60, 80) = %d, want 2", got)
	}
	if got := spendingMinorGridStep(30, 80); got != 1 {
		t.Errorf("spendingMinorGridStep(30, 80) = %d, want 1", got)
	}
	if got := spendingMinorGridStep(365, 80); got <= 2 {
		t.Errorf("spendingMinorGridStep(365, 80) = %d, want >2", got)
	}
	if got := spendingMinorGridStep(730, 80); got < 14 {
		t.Errorf("spendingMinorGridStep(730, 80) = %d, want >=14", got)
	}
}

func TestSpendingMajorModeForDays(t *testing.T) {
	if got := spendingMajorModeForDays(90); got != spendingMajorWeek {
		t.Errorf("spendingMajorModeForDays(90) = %v, want week", got)
	}
	if got := spendingMajorModeForDays(180); got != spendingMajorMonth {
		t.Errorf("spendingMajorModeForDays(180) = %v, want month", got)
	}
	if got := spendingMajorModeForDays(730); got != spendingMajorQuarter {
		t.Errorf("spendingMajorModeForDays(730) = %v, want quarter", got)
	}
}

func TestSpendingYScale(t *testing.T) {
	step, maxY := spendingYScale(1234.0, 14)
	if step <= 0 {
		t.Fatalf("step = %.2f, want > 0", step)
	}
	if maxY < 1234.0 {
		t.Fatalf("maxY = %.2f, want >= 1234", maxY)
	}
	if math.Mod(maxY, step) != 0 {
		t.Fatalf("maxY %.2f should be multiple of step %.2f", maxY, step)
	}
}

func TestSpendingXLabelsRespectSpacing(t *testing.T) {
	start := time.Date(2025, time.January, 1, 0, 0, 0, 0, time.Local)
	end := start.AddDate(0, 0, 364)
	var dates []time.Time
	for d := start; !d.After(end); d = d.AddDate(0, 0, 1) {
		dates = append(dates, d)
	}

	chart := tslc.New(80, spendingTrackerHeight)
	chart.SetTimeRange(start, end)
	chart.SetViewTimeRange(start, end)
	chart.SetYRange(0, 100)
	chart.SetViewYRange(0, 100)
	chart.SetXStep(1)
	chart.SetYStep(1)

	graphCols := chart.Width() - chart.Origin().X - 1
	labels := spendingXLabels(&chart, dates, spendingMinorGridStep(len(dates), graphCols), spendingMajorModeForDays(len(dates)))
	if len(labels) == 0 {
		t.Fatal("expected at least one x-axis label")
	}

	var xs []int
	for iso := range labels {
		d, err := time.ParseInLocation("2006-01-02", iso, time.Local)
		if err != nil {
			t.Fatalf("invalid label date key %q: %v", iso, err)
		}
		xs = append(xs, chartColumnX(&chart, d))
	}
	sort.Ints(xs)
	for i := 1; i < len(xs); i++ {
		if xs[i]-xs[i-1] < 6 {
			t.Fatalf("label columns too close: %d and %d", xs[i-1], xs[i])
		}
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

func TestFormatAxisTick(t *testing.T) {
	tests := []struct {
		in   float64
		want string
	}{
		{500, "500"},
		{1000, "1k"},
		{1500, "1.5k"},
		{12_500, "12k"},
		{1_200_000, "1.2m"},
		{15_100_000, "15m"},
	}
	for _, tt := range tests {
		if got := formatAxisTick(tt.in); got != tt.want {
			t.Errorf("formatAxisTick(%.2f) = %q, want %q", tt.in, got, tt.want)
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
// Spending tracker rendering tests
// ---------------------------------------------------------------------------

func TestRenderSpendingTrackerEmpty(t *testing.T) {
	output := renderSpendingTracker(nil, 80)
	if output == "" {
		t.Error("expected non-empty output even with no data")
	}
}

func TestRenderSpendingTrackerCreditOnly(t *testing.T) {
	now := time.Now()
	rows := []transaction{
		{dateISO: now.Format("2006-01-02"), amount: 500.00},
	}
	output := renderSpendingTracker(rows, 80)
	if output == "" {
		t.Error("expected non-empty output")
	}
}

func TestDashboardViewSpendingTrackerTitle(t *testing.T) {
	m := newModel()
	output := m.dashboardView()
	if !strings.Contains(output, "Spending Tracker") {
		t.Error("missing Spending Tracker title in dashboard")
	}
}

// ---------------------------------------------------------------------------
// Header rendering tests
// ---------------------------------------------------------------------------

func TestRenderHeaderContainsAppName(t *testing.T) {
	output := renderHeader("Jaskmoney", 0, 80, "")
	if !strings.Contains(output, "Jaskmoney") {
		t.Error("missing app name in header")
	}
}

func TestRenderHeaderContainsAllTabs(t *testing.T) {
	output := renderHeader("Jaskmoney", 0, 80, "")
	for _, tab := range tabNames {
		if !strings.Contains(output, tab) {
			t.Errorf("missing tab %q in header", tab)
		}
	}
}

func TestRenderHeaderActiveTabHighlight(t *testing.T) {
	// Verify that tab 0 active contains "Dashboard" and tab 1 active contains "Transactions"
	h0 := renderHeader("App", 0, 80, "")
	h1 := renderHeader("App", 1, 80, "")
	if !strings.Contains(h0, "Dashboard") {
		t.Error("tab 0 header missing Dashboard")
	}
	if !strings.Contains(h1, "Transactions") {
		t.Error("tab 1 header missing Transactions")
	}
}

func TestRenderHeaderZeroWidth(t *testing.T) {
	output := renderHeader("Jaskmoney", 0, 0, "")
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
	output := renderTransactionTable(rows, cats, nil, nil, 0, 0, 5, 80, sortByDate, false)
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
	output := renderTransactionTable(rows, nil, nil, nil, 0, 0, 5, 80, sortByDate, false)
	if strings.Contains(output, "Category") {
		t.Error("Category column should be hidden when categories is nil")
	}
}

func TestRenderTransactionTableSortIndicator(t *testing.T) {
	rows := testDashboardRows()
	output := renderTransactionTable(rows, nil, nil, nil, 0, 0, 5, 80, sortByDate, true)
	if !strings.Contains(output, "▲") {
		t.Error("missing ascending sort indicator")
	}
	output2 := renderTransactionTable(rows, nil, nil, nil, 0, 0, 5, 80, sortByDate, false)
	if !strings.Contains(output2, "▼") {
		t.Error("missing descending sort indicator")
	}
}

func TestRenderTransactionTableScrollIndicator(t *testing.T) {
	rows := testDashboardRows()
	output := renderTransactionTable(rows, nil, nil, nil, 0, 0, 3, 80, sortByDate, false)
	if !strings.Contains(output, "showing") {
		t.Error("missing scroll indicator")
	}
}

func TestRenderTransactionTableEmpty(t *testing.T) {
	output := renderTransactionTable(nil, nil, nil, nil, 0, 0, 10, 80, sortByDate, false)
	if !strings.Contains(output, "Date") {
		t.Error("empty table should still show column headers")
	}
}

// ---------------------------------------------------------------------------
// Empty state rendering tests
// ---------------------------------------------------------------------------

func TestRenderCategoryBreakdownEmptyMessage(t *testing.T) {
	output := renderCategoryBreakdown(nil, nil, 80)
	if !strings.Contains(output, "Uncategorised") {
		t.Error("expected uncategorised row for nil rows")
	}
}

func TestRenderSpendingTrackerAlwaysRenders(t *testing.T) {
	output := renderSpendingTracker(nil, 80)
	if output == "" {
		t.Error("spending tracker should render even with no data")
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
