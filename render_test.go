package main

import (
	"fmt"
	"math"
	"sort"
	"strings"
	"testing"
	"time"

	tslc "github.com/NimbleMarkets/ntcharts/linechart/timeserieslinechart"
	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/x/ansi"
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

func TestRenderCategoryBreakdownStableOrderOnTies(t *testing.T) {
	rows := []transaction{
		{amount: -10.0, categoryName: "B"},
		{amount: -10.0, categoryName: "A"},
	}

	first := renderCategoryBreakdown(rows, nil, 80)
	for i := 0; i < 20; i++ {
		next := renderCategoryBreakdown(rows, nil, 80)
		if next != first {
			t.Fatalf("category breakdown output changed between renders on tie amounts")
		}
	}
}

func TestRenderDashboardCompareBarsBudgetVsActualScalesBars(t *testing.T) {
	m := model{
		budgetLines: []budgetLine{
			{categoryName: "Total", budgeted: 1000},
		},
	}
	rows := []transaction{
		{dateISO: "2026-02-03", amount: -500},
	}

	out := renderDashboardCompareBarsMode(m, widgetMode{id: "budget_vs_actual"}, rows, 20)
	lines := strings.Split(out, "\n")
	if len(lines) != 2 {
		t.Fatalf("expected 2 lines, got %d", len(lines))
	}

	if got := strings.Count(lines[0], "█"); got != 10 {
		t.Fatalf("budget filled bars=%d want 10; line=%q", got, lines[0])
	}
	if got := strings.Count(lines[1], "█"); got != 5 {
		t.Fatalf("actual filled bars=%d want 5; line=%q", got, lines[1])
	}
}

func TestRenderBudgetAnalyticsStripIncludesMonthOverMonthSpend(t *testing.T) {
	m := model{
		budgetMonth: "2026-03",
		rows: []transaction{
			{dateISO: "2026-01-12", amount: -500, accountName: "ANZ"},
			{dateISO: "2026-03-05", amount: -100, accountName: "ANZ"},
			{dateISO: "2026-02-18", amount: -40, accountName: "ANZ"},
			{dateISO: "2026-03-10", amount: -50, accountName: "ANZ"},
			{dateISO: "2026-03-11", amount: 250, accountName: "ANZ"},
		},
	}
	out := renderBudgetAnalyticsStrip(m, 80)
	if !strings.Contains(out, "MoM Spend") {
		t.Fatalf("missing MoM spend line in budget analytics: %q", out)
	}
	if !strings.Contains(out, "$150.00") {
		t.Fatalf("current month spend should be $150.00, got: %q", out)
	}
	if !strings.Contains(out, "$40.00") {
		t.Fatalf("previous month spend should be $40.00, got: %q", out)
	}
}

func TestRenderBudgetTableIncludesCompareBarsSection(t *testing.T) {
	m := model{
		budgetMonth: "2026-03",
		budgetLines: []budgetLine{{categoryName: "Groceries", budgeted: 500}},
		rows: []transaction{
			{dateISO: "2026-03-05", amount: -100, accountName: "ANZ"},
			{dateISO: "2026-03-06", amount: 200, accountName: "ANZ"},
			{dateISO: "2026-02-10", amount: -40, accountName: "ANZ"},
		},
	}
	out := renderBudgetTable(m)
	if !strings.Contains(out, "Compare Bars") {
		t.Fatalf("budget table should include compare bars section: %q", out)
	}
	if !strings.Contains(out, "Budget:") || !strings.Contains(out, "Income:") {
		t.Fatalf("expected compare bar meter labels in budget table: %q", out)
	}
}

func TestSpendingYLabelFormatterFixedWidthAcrossPositiveAndSignedRanges(t *testing.T) {
	pos := spendingYLabelFormatter(100, 0, 500)
	signed := spendingYLabelFormatter(100, -500, 500)
	if got := pos(0, 100); len(got) != chartYAxisLabelWidth {
		t.Fatalf("positive y-label width = %d, want %d", len(got), chartYAxisLabelWidth)
	}
	if got := signed(0, -100); len(got) != chartYAxisLabelWidth {
		t.Fatalf("signed y-label width = %d, want %d", len(got), chartYAxisLabelWidth)
	}
	if got := signed(0, 0); strings.TrimSpace(got) != "0" {
		t.Fatalf("zero tick label = %q, want 0", got)
	}
	if got := signed(0, -100); got[0] == ' ' {
		t.Fatalf("signed y-label should start at first column, got %q", got)
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
	if last != 175.00 {
		t.Errorf("daily spend = %.2f, want 175.00", last)
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

func TestNetCashflowModesKeepYAxisColumnAligned(t *testing.T) {
	start := time.Date(2026, time.January, 1, 0, 0, 0, 0, time.Local)
	end := start.AddDate(0, 0, 29)
	rows := []transaction{
		{dateISO: "2026-01-02", amount: -80},
		{dateISO: "2026-01-05", amount: -20},
		{dateISO: "2026-01-10", amount: 200},
		{dateISO: "2026-01-14", amount: -40},
		{dateISO: "2026-01-20", amount: 150},
	}

	spending := renderSpendingTrackerWithRangeSized(rows, 84, time.Monday, start, end, 16)
	netWorth := renderNetWorthTrackerWithRange(rows, 84, time.Monday, start, end, 16)
	spendingCol := firstChartVerticalColumn(spending)
	netWorthCol := firstChartVerticalColumn(netWorth)
	if spendingCol < 0 || netWorthCol < 0 {
		t.Fatalf("expected y-axis columns in both charts (spending=%d networth=%d)", spendingCol, netWorthCol)
	}
	if spendingCol != netWorthCol {
		t.Fatalf("y-axis column mismatch: spending=%d networth=%d\nspending:\n%s\nnetworth:\n%s", spendingCol, netWorthCol, spending, netWorth)
	}
}

func TestNetCashflowModesKeepYAxisColumnAlignedWithEmptyRows(t *testing.T) {
	start := time.Date(2026, time.January, 1, 0, 0, 0, 0, time.Local)
	end := start.AddDate(0, 0, 29)
	spending := renderSpendingTrackerWithRangeSized(nil, 84, time.Monday, start, end, 16)
	netWorth := renderNetWorthTrackerWithRange(nil, 84, time.Monday, start, end, 16)
	spendingCol := firstChartVerticalColumn(spending)
	netWorthCol := firstChartVerticalColumn(netWorth)
	if spendingCol != netWorthCol {
		t.Fatalf("empty-data y-axis mismatch: spending=%d networth=%d\nspending:\n%s\nnetworth:\n%s", spendingCol, netWorthCol, spending, netWorth)
	}
}

func TestDashboardNetCashflowPaneModesKeepYAxisColumnAligned(t *testing.T) {
	m := newModel()
	rows := []transaction(nil)
	modeSpending := widgetMode{id: "spending", label: "Spending", viewType: "line"}
	modeNetWorth := widgetMode{id: "net_worth", label: "Net Worth", viewType: "line"}

	spending := renderDashboardNetCashflowMode(m, modeSpending, rows, 81, 16)
	netWorth := renderDashboardNetCashflowMode(m, modeNetWorth, rows, 81, 16)
	spendingCol := firstChartVerticalColumn(spending)
	netWorthCol := firstChartVerticalColumn(netWorth)
	if spendingCol != netWorthCol {
		t.Fatalf("dashboard pane y-axis mismatch: spending=%d networth=%d\nspending:\n%s\nnetworth:\n%s", spendingCol, netWorthCol, spending, netWorth)
	}
}

func TestDashboardNetCashflowModeTrimsTrailingBlankLine(t *testing.T) {
	m := newModel()
	mode := widgetMode{id: "net_worth", label: "Net Worth", viewType: "line"}
	out := renderDashboardNetCashflowMode(m, mode, nil, 81, 16)
	lines := splitLines(ansi.Strip(out))
	if len(lines) == 0 {
		t.Fatal("expected chart output lines")
	}
	if strings.TrimSpace(lines[len(lines)-1]) == "" {
		t.Fatalf("expected last chart line to be non-empty, got trailing blank line:\n%s", ansi.Strip(out))
	}
}

func TestDashboardNetCashflowModeSpendingUsesRawTrackerOutput(t *testing.T) {
	m := newModel()
	mode := widgetMode{id: "spending", label: "Spending", viewType: "line"}
	start, end := m.dashboardChartRange(time.Now())
	rows := []transaction{
		{dateISO: start.AddDate(0, 0, 1).Format("2006-01-02"), amount: -80},
		{dateISO: start.AddDate(0, 0, 6).Format("2006-01-02"), amount: -20},
		{dateISO: start.AddDate(0, 0, 10).Format("2006-01-02"), amount: -40},
	}
	width := 84
	height := 16
	got := renderDashboardNetCashflowMode(m, mode, rows, width, height)
	want := trimTrailingBlankChartLine(renderSpendingTrackerWithRangeSized(rows, width, m.spendingWeekAnchor, start, end, height))
	if got != want {
		t.Fatalf("spending mode output diverged from raw tracker renderer\n--- got ---\n%s\n--- want ---\n%s", got, want)
	}
}

func TestShiftChartLeftRemovesCommonLeadingWhitespace(t *testing.T) {
	in := "    1 │ a\n    │ b\n"
	got := shiftChartLeft(in, 4)
	if !strings.HasPrefix(got, "1 │ a\n│ b") {
		t.Fatalf("shiftChartLeft did not shift as expected:\n%q", got)
	}
}

func TestDashboardAnalyticsPaneWidthsUsesDedicated7030Split(t *testing.T) {
	left, right := dashboardAnalyticsPaneWidths(139)
	if left != 97 || right != 42 {
		t.Fatalf("dashboardAnalyticsPaneWidths(139) = (%d,%d), want (97,42)", left, right)
	}
}

func TestDashboardAnalyticsPaneWidthsHonorsMinimums(t *testing.T) {
	left, right := dashboardAnalyticsPaneWidths(50)
	if left != 34 || right != 16 {
		t.Fatalf("dashboardAnalyticsPaneWidths(50) = (%d,%d), want (34,16)", left, right)
	}
}

func TestDashboardAnalyticsRegionUsesDedicated7030Split(t *testing.T) {
	m := newModel()
	m.ready = true
	m.width = 140
	m.height = 44
	m.activeTab = tabDashboard
	m.rows = testDashboardRows()
	if len(m.dashWidgets) != dashboardPaneCount {
		m.dashWidgets = newDashboardWidgets(m.customPaneModes)
	}

	out := renderDashboardAnalyticsRegion(m)
	var line string
	for _, ln := range splitLines(out) {
		if strings.Contains(ln, "Net/Cashflow [N]") {
			line = ln
			break
		}
	}
	if line == "" {
		t.Fatalf("could not find Net/Cashflow title line in analytics region:\n%s", out)
	}
	parts := strings.SplitN(line, "╮ ╭", 2)
	if len(parts) != 2 {
		t.Fatalf("analytics title line missing pane separator: %q", ansi.Strip(line))
	}
	leftPane := parts[0] + "╮"
	rightPane := "╭" + parts[1]
	wantLeft, wantRight := dashboardAnalyticsPaneWidths(m.sectionWidth() - 1)
	if got := ansi.StringWidth(leftPane); got != wantLeft {
		t.Fatalf("left pane width = %d, want %d\nline=%q", got, wantLeft, ansi.Strip(line))
	}
	if got := ansi.StringWidth(rightPane); got != wantRight {
		t.Fatalf("right pane width = %d, want %d\nline=%q", got, wantRight, ansi.Strip(line))
	}
}

func firstChartVerticalColumn(chart string) int {
	lines := splitLines(ansi.Strip(chart))
	minCol := -1
	for _, line := range lines {
		col := strings.IndexRune(line, '│')
		if col < 0 {
			continue
		}
		if minCol < 0 || col < minCol {
			minCol = col
		}
	}
	return minCol
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

func TestRenderCommandLinesWindowRespectsOffsetAndCursorVisibility(t *testing.T) {
	matches := make([]CommandMatch, 12)
	for i := range matches {
		matches[i] = CommandMatch{
			Command: Command{
				Label:       "Cmd",
				Description: "Desc",
			},
			Enabled: true,
		}
	}
	lines, hasAbove, hasBelow := renderCommandLinesWindow(matches, 10, 6, 40, 5)
	if len(lines) != 5 {
		t.Fatalf("lines=%d want 5", len(lines))
	}
	if !hasAbove || !hasBelow {
		t.Fatalf("expected both overflow indicators, hasAbove=%v hasBelow=%v", hasAbove, hasBelow)
	}
	selectedFound := false
	for _, line := range lines {
		if strings.Contains(ansi.Strip(line), "> ") {
			selectedFound = true
			break
		}
	}
	if !selectedFound {
		t.Fatal("selected cursor row not rendered in visible window")
	}
}

func TestRenderCommandPaletteHasSpacingBetweenCommands(t *testing.T) {
	matches := []CommandMatch{
		{Command: Command{Label: "One", Description: "First"}, Enabled: true},
		{Command: Command{Label: "Two", Description: "Second"}, Enabled: true},
		{Command: Command{Label: "Three", Description: "Third"}, Enabled: false},
	}
	out := renderCommandPalette("", matches, 1, 0, 10, 48, NewKeyRegistry())
	plain := ansi.Strip(out)
	if !strings.Contains(plain, "│                                                │\n│> Two · Second") {
		t.Fatalf("expected framed blank line separation before next command row:\n%s", plain)
	}
}

func TestRenderCommandPaletteRespectsModalWidthCap(t *testing.T) {
	matches := make([]CommandMatch, 0, 12)
	for i := 0; i < 12; i++ {
		matches = append(matches, CommandMatch{
			Command: Command{
				Label:       fmt.Sprintf("Command %d", i+1),
				Description: "Description",
			},
			Enabled: true,
		})
	}
	out := renderCommandPalette("", matches, 9, 0, 10, 72, NewKeyRegistry())
	lines := splitLines(out)
	if len(lines) == 0 {
		t.Fatal("expected command palette output")
	}
	for i, line := range lines {
		if got := ansi.StringWidth(line); got > 74 {
			t.Fatalf("line %d width=%d exceeds modal frame width cap: %q", i, got, ansi.Strip(line))
		}
	}
}

func TestRenderCommandLinesWindowWrapsLongDescriptionsWithContinuation(t *testing.T) {
	matches := []CommandMatch{
		{
			Command: Command{
				Label:       "Toggle Selection",
				Description: "Toggle selection for current row or highlighted range and keep clear visual separation from the next command entry.",
			},
			Enabled: true,
		},
		{
			Command: Command{
				Label:       "Go to Budget",
				Description: "Switch to Budget tab",
			},
			Enabled: false,
		},
	}

	lines, _, _ := renderCommandLinesWindow(matches, 0, 0, 56, 10)
	if len(lines) < 3 {
		t.Fatalf("expected wrapped output lines, got %d", len(lines))
	}

	joined := strings.Join(lines, "\n")
	plain := ansi.Strip(joined)
	if !strings.Contains(plain, "↳ ") {
		t.Fatalf("expected continuation marker in wrapped command output:\n%s", plain)
	}

	for i, line := range lines {
		if got := ansi.StringWidth(line); got > 56 {
			t.Fatalf("line %d width = %d exceeds content width 56: %q", i, got, ansi.Strip(line))
		}
	}
}

func TestRenderCommandSuggestionsUseAvailableWidthWithoutHardCap(t *testing.T) {
	matches := []CommandMatch{
		{
			Command: Command{
				Label:       "Long Row",
				Description: "A description long enough to exceed the old fixed popup width while still fitting comfortably in a wider viewport.",
			},
			Enabled: true,
		},
	}

	out := renderCommandSuggestions(matches, 0, 0, 120, 5)
	lines := splitLines(out)
	if len(lines) == 0 {
		t.Fatal("expected command suggestions output")
	}
	maxW := 0
	for _, line := range lines {
		maxW = max(maxW, ansi.StringWidth(line))
	}
	if maxW <= 74 {
		t.Fatalf("expected suggestions popup wider than previous cap, got width %d", maxW)
	}
}

func TestRenderWrappedCommandMatchLinesCursorBoldsFirstAndContinuation(t *testing.T) {
	boldProbe := lipgloss.NewStyle().Bold(true).Render("X")
	if !strings.Contains(boldProbe, "\x1b[1m") {
		t.Skip("terminal style renderer in test env does not emit ANSI bold")
	}
	match := CommandMatch{
		Command: Command{
			Label:       "Toggle Selection",
			Description: "Toggle selection for current row or highlighted range and keep clear visual separation from the next command entry.",
		},
		Enabled: true,
	}
	lines := renderWrappedCommandMatchLines(match, true, 56)
	if len(lines) < 2 {
		t.Fatalf("expected wrapped lines, got %d", len(lines))
	}
	if !strings.Contains(lines[0], "\x1b[1m") {
		t.Fatalf("expected first cursor line to be bold, got %q", ansi.Strip(lines[0]))
	}
	if !strings.Contains(lines[1], "\x1b[1m") {
		t.Fatalf("expected continuation cursor line to be bold, got %q", ansi.Strip(lines[1]))
	}
}

func TestRowStateBackgroundAndCursorKeepsDistinctBaseStates(t *testing.T) {
	cursorBg, _ := rowStateBackgroundAndCursor(false, false, true)
	selectedBg, _ := rowStateBackgroundAndCursor(true, false, false)
	highlightedBg, _ := rowStateBackgroundAndCursor(false, true, false)
	if cursorBg == selectedBg {
		t.Fatalf("cursor and selected backgrounds must differ: %q", cursorBg)
	}
	if cursorBg == highlightedBg {
		t.Fatalf("cursor and highlighted backgrounds must differ: %q", cursorBg)
	}
	if selectedBg == highlightedBg {
		t.Fatalf("selected and highlighted backgrounds must differ: %q", selectedBg)
	}
}

func TestRowStateBackgroundAndCursorKeepsDistinctCursorOverlays(t *testing.T) {
	cursorBg, _ := rowStateBackgroundAndCursor(false, false, true)
	cursorSelectedBg, _ := rowStateBackgroundAndCursor(true, false, true)
	cursorHighlightedBg, _ := rowStateBackgroundAndCursor(false, true, true)
	if cursorBg == cursorSelectedBg {
		t.Fatalf("cursor and cursor+selected backgrounds must differ: %q", cursorBg)
	}
	if cursorBg == cursorHighlightedBg {
		t.Fatalf("cursor and cursor+highlighted backgrounds must differ: %q", cursorBg)
	}
	if cursorSelectedBg == cursorHighlightedBg {
		t.Fatalf("cursor+selected and cursor+highlighted backgrounds must differ: %q", cursorSelectedBg)
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

func TestBuildGridlineColumnsIncludesTodayMarker(t *testing.T) {
	start := time.Now().In(time.Local).AddDate(0, 0, -10)
	start = time.Date(start.Year(), start.Month(), start.Day(), 0, 0, 0, 0, time.Local)
	end := start.AddDate(0, 0, 20)
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
	plan := planSpendingAxes(&chart, dates, 100)
	plan.minorStepDays = spendingMinorGridStep(len(dates), graphCols)
	columns := buildGridlineColumns(&chart, dates, plan, time.Monday, time.Now().In(time.Local))

	hasToday := false
	for _, kind := range columns {
		if kind == chartGridlineToday {
			hasToday = true
			break
		}
	}
	if !hasToday {
		t.Fatal("expected today gridline marker within in-range dates")
	}
}

func TestBuildGridlineColumnsTodayOverridesMajor(t *testing.T) {
	today := time.Now().In(time.Local)
	today = time.Date(today.Year(), today.Month(), today.Day(), 0, 0, 0, 0, time.Local)
	start := today.AddDate(0, 0, -5)
	end := today.AddDate(0, 0, 5)
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

	plan := spendingAxisPlan{
		minorStepDays: 1,
		majorMode:     spendingMajorWeek,
	}
	columns := buildGridlineColumns(&chart, dates, plan, today.Weekday(), today)
	todayX := chartColumnX(&chart, today)
	kind, ok := columns[todayX]
	if !ok {
		t.Fatalf("expected column for today x=%d", todayX)
	}
	if kind != chartGridlineToday {
		t.Fatalf("today column kind = %v, want chartGridlineToday", kind)
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
	// Verify header still includes expected tab labels for current nav set.
	h0 := renderHeader("App", 0, 80, "")
	h1 := renderHeader("App", 1, 80, "")
	if !strings.Contains(h0, "Dashboard") {
		t.Error("tab 0 header missing Dashboard")
	}
	if !strings.Contains(h1, "Settings") {
		t.Error("tab 1 header missing Settings")
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
	output := renderTransactionTable(rows, cats, nil, nil, nil, 0, 0, 5, 80, sortByDate, false)
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
	output := renderTransactionTable(rows, nil, nil, nil, nil, 0, 0, 5, 80, sortByDate, false)
	if strings.Contains(output, "Category") {
		t.Error("Category column should be hidden when categories is nil")
	}
}

func TestRenderTransactionTableSortIndicator(t *testing.T) {
	rows := testDashboardRows()
	output := renderTransactionTable(rows, nil, nil, nil, nil, 0, 0, 5, 80, sortByDate, true)
	if !strings.Contains(output, "▲") {
		t.Error("missing ascending sort indicator")
	}
	output2 := renderTransactionTable(rows, nil, nil, nil, nil, 0, 0, 5, 80, sortByDate, false)
	if !strings.Contains(output2, "▼") {
		t.Error("missing descending sort indicator")
	}
}

func TestRenderTransactionTableScrollIndicator(t *testing.T) {
	rows := testDashboardRows()
	output := renderTransactionTable(rows, nil, nil, nil, nil, 0, 0, 3, 80, sortByDate, false)
	if !strings.Contains(output, "showing") {
		t.Error("missing scroll indicator")
	}
	if !strings.Contains(output, "(3)") {
		t.Error("scroll indicator should include rendered row count")
	}
}

func TestRenderTransactionTableEmpty(t *testing.T) {
	output := renderTransactionTable(nil, nil, nil, nil, nil, 0, 0, 10, 80, sortByDate, false)
	if !strings.Contains(output, "Date") {
		t.Error("empty table should still show column headers")
	}
}

func TestRenderTransactionTableDescriptionDisplayLimit40(t *testing.T) {
	rows := []transaction{
		{
			id:          1,
			dateISO:     "2026-02-10",
			amount:      -12.34,
			description: "123456789012345678901234567890123456789012345678901234567890",
		},
	}

	output := renderTransactionTable(rows, nil, nil, nil, nil, 1, 0, 5, 120, sortByDate, false)
	if strings.Contains(output, "12345678901234567890123456789012345678901") {
		t.Fatal("description should not render past 40 chars in table")
	}
	if !strings.Contains(output, "123456789012345678901234567890123456789…") {
		t.Fatal("expected 40-char capped description with ellipsis")
	}
}

func TestRenderTransactionTableAccountColumnAfterDescription(t *testing.T) {
	catID := 1
	rows := []transaction{
		{
			id:            1,
			dateISO:       "2026-02-10",
			amount:        -12.34,
			description:   "DESC_TOKEN",
			categoryID:    &catID,
			categoryName:  "Groceries",
			categoryColor: "#94e2d5",
			accountName:   "ACC_TOKEN",
		},
		{
			id:            2,
			dateISO:       "2026-02-11",
			amount:        -56.78,
			description:   "Other row",
			categoryID:    &catID,
			categoryName:  "Groceries",
			categoryColor: "#94e2d5",
			accountName:   "Other account",
		},
	}
	cats := []category{{id: 1, name: "Groceries", color: "#94e2d5"}}
	out := renderTransactionTable(rows, cats, nil, nil, nil, rows[0].id, 0, 5, 140, sortByDate, false)
	lines := strings.Split(out, "\n")
	if len(lines) < 2 {
		t.Fatalf("expected at least 2 lines, got %d", len(lines))
	}
	rowLine := lines[1]
	descIdx := strings.Index(rowLine, "DESC_TOKEN")
	accIdx := strings.Index(rowLine, "ACC_TOKEN")
	if descIdx < 0 || accIdx < 0 {
		t.Fatalf("missing expected tokens in row: %q", rowLine)
	}
	if accIdx < descIdx {
		t.Fatalf("account column rendered before description: row=%q", rowLine)
	}
}

func TestRenderTransactionTableAllocationRowUsesRowPrefix(t *testing.T) {
	catID := 1
	rows := []transaction{
		{
			id:            1,
			dateISO:       "2026-02-10",
			amount:        -100.00,
			fullAmount:    -100.00,
			description:   "Parent",
			categoryID:    &catID,
			categoryName:  "Groceries",
			categoryColor: "#94e2d5",
			accountName:   "ACC1",
		},
		{
			id:            -42,
			isAllocation:  true,
			parentTxnID:   1,
			allocationID:  42,
			dateISO:       "2026-02-10",
			amount:        -25.00,
			description:   "Child split",
			categoryID:    &catID,
			categoryName:  "Groceries",
			categoryColor: "#94e2d5",
			accountName:   "ACC1",
		},
	}
	cats := []category{{id: 1, name: "Groceries", color: "#94e2d5"}}
	out := renderTransactionTable(rows, cats, nil, nil, nil, 0, 0, 5, 140, sortByDate, false)
	lines := strings.Split(ansi.Strip(out), "\n")
	if len(lines) < 3 {
		t.Fatalf("expected header + 2 rows, got %d lines", len(lines))
	}
	child := lines[2]
	if !strings.HasPrefix(child, "↳   ") {
		t.Fatalf("expected allocation row prefix, got: %q", child)
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
// File picker and import preview rendering tests
// ---------------------------------------------------------------------------

func TestRenderFilePicker(t *testing.T) {
	files := []string{"ANZ.csv", "CBA.csv", "test.csv"}
	output := renderFilePicker(files, 1, NewKeyRegistry())
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
	output := renderFilePicker(nil, 0, NewKeyRegistry())
	if !strings.Contains(output, "Loading") {
		t.Error("empty file list should show loading message")
	}
}

func TestRenderImportPreviewCompact(t *testing.T) {
	snapshot := &importPreviewSnapshot{
		fileName:   "ANZ.csv",
		totalRows:  3,
		newCount:   1,
		dupeCount:  2,
		errorCount: 0,
		rows: []importPreviewRow{
			{index: 1, sourceLine: 1, dateISO: "2026-02-03", amount: -10, description: "FIRST", isDupe: true},
			{index: 2, sourceLine: 2, dateISO: "2026-02-04", amount: -11, description: "SECOND", isDupe: true},
			{index: 3, sourceLine: 3, dateISO: "2026-02-05", amount: -12, description: "THIRD", isDupe: false},
		},
	}
	output := renderImportPreview(snapshot, true, false, 0, 0, 20, 140, NewKeyRegistry())
	if !strings.Contains(output, "Import Preview") {
		t.Error("missing compact title")
	}
	if !strings.Contains(output, "ANZ.csv") {
		t.Error("missing filename")
	}
	if !strings.Contains(output, "Dupes:") {
		t.Error("missing summary section")
	}
	if !strings.Contains(output, "FIRST") || !strings.Contains(output, "SECOND") {
		t.Error("missing duplicate rows in compact view")
	}
}

func TestRenderImportPreviewPostRulesShowsCategoryAndTags(t *testing.T) {
	snapshot := &importPreviewSnapshot{
		fileName:   "ANZ.csv",
		totalRows:  2,
		newCount:   1,
		dupeCount:  1,
		errorCount: 0,
		rows: []importPreviewRow{
			{index: 1, sourceLine: 1, dateISO: "2026-02-03", amount: -10, description: "GROCERY", isDupe: false, previewCat: "Groceries", previewTags: []string{"essentials", "weekly"}},
			{index: 2, sourceLine: 2, dateISO: "2026-02-04", amount: -11, description: "DUPLICATE", isDupe: true, previewCat: "Dining", previewTags: []string{"takeaway"}},
		},
	}
	output := renderImportPreview(snapshot, true, true, 0, 0, 20, 140, NewKeyRegistry())
	if !strings.Contains(output, "Import Preview") {
		t.Error("missing preview title")
	}
	if !strings.Contains(output, "Groceries") || !strings.Contains(output, "essentials,weekly") {
		t.Error("missing post-rules category/tags")
	}
}

func TestRenderImportPreviewCompactUsesConfiguredPageSize(t *testing.T) {
	rows := make([]importPreviewRow, 0, 120)
	for i := 0; i < 120; i++ {
		rows = append(rows, importPreviewRow{
			index:       i + 1,
			sourceLine:  i + 1,
			dateISO:     "2026-02-03",
			amount:      -1,
			description: "ROW",
			isDupe:      true,
		})
	}
	snapshot := &importPreviewSnapshot{
		fileName:   "ANZ.csv",
		totalRows:  120,
		dupeCount:  120,
		errorCount: 0,
		rows:       rows,
	}
	output := renderImportPreview(snapshot, true, true, 0, 0, 20, 140, NewKeyRegistry())
	if !strings.Contains(output, "showing 20 rows/page") {
		t.Fatal("missing compact page-size hint")
	}
}

func TestRenderImportPreviewShowsParseErrorBannerAndBlockedHint(t *testing.T) {
	snapshot := &importPreviewSnapshot{
		fileName:   "ANZ.csv",
		totalRows:  2,
		newCount:   1,
		errorCount: 1,
		parseErrors: []importPreviewParseError{
			{rowIndex: 2, sourceLine: 2, field: "date", message: "invalid date"},
		},
		rows: []importPreviewRow{
			{index: 1, sourceLine: 1, dateISO: "2026-02-03", amount: -10, description: "VALID"},
		},
	}
	output := renderImportPreview(snapshot, true, false, 0, 0, 20, 140, NewKeyRegistry())
	if !strings.Contains(output, "Errors:") {
		t.Fatal("missing parse error summary")
	}
	if !strings.Contains(output, "Import blocked") {
		t.Fatal("missing blocked import hint")
	}
	if !strings.Contains(output, "line 2") {
		t.Fatal("missing row-level parse error reference")
	}
}

func TestRenderManagerAccountModalShowsFooter(t *testing.T) {
	m := newModel()
	m.keys = NewKeyRegistry()
	if err := m.keys.ApplyKeybindingConfig([]keybindingConfig{
		{Scope: scopeManagerModal, Action: string(actionConfirm), Keys: []string{"ctrl+s"}},
		{Scope: scopeManagerModal, Action: string(actionClose), Keys: []string{"c"}},
	}); err != nil {
		t.Fatalf("ApplyKeybindingConfig: %v", err)
	}
	m.managerModalIsNew = true
	m.managerEditName = "Everyday Account"
	m.managerEditType = "transaction"
	m.managerEditPrefix = "ANZ"
	m.managerEditPrefixCur = 3 // cursor at end of "ANZ"
	m.managerEditActive = true
	m.managerEditFocus = 2

	output := renderManagerAccountModal(m)
	if !strings.Contains(output, "Create Account") {
		t.Fatal("missing modal title")
	}
	if !strings.Contains(output, "Import Prefix") {
		t.Fatal("missing import prefix field")
	}
	if !strings.Contains(output, "ANZ_") {
		t.Fatal("focused input should include cursor suffix")
	}
	// Footer should render key hints for save and cancel using configured keys.
	if !strings.Contains(output, "save") {
		t.Fatal("manager modal footer should show save hint")
	}
	if !strings.Contains(output, "cancel") {
		t.Fatal("manager modal footer should show cancel hint")
	}
	// The configured keys (ctrl+s, c) should appear in the footer.
	if !strings.Contains(output, "ctrl+s") {
		t.Fatal("manager modal footer should reflect configured save key (ctrl+s)")
	}
}

func TestRenderDetailUsesConfiguredEditKey(t *testing.T) {
	keys := NewKeyRegistry()
	if err := keys.ApplyKeybindingConfig([]keybindingConfig{
		{Scope: scopeDetailModal, Action: string(actionEdit), Keys: []string{"e"}},
	}); err != nil {
		t.Fatalf("ApplyKeybindingConfig: %v", err)
	}
	txn := transaction{
		dateISO:      "2026-02-10",
		amount:       -12.34,
		description:  "Coffee",
		categoryName: "Dining",
	}
	output := renderDetail(txn, nil, "", 0, "", keys)
	if !strings.Contains(output, "press e to edit") {
		t.Fatal("expected configured edit key in empty-notes hint")
	}
	if !strings.Contains(output, "e notes") {
		t.Fatal("expected configured edit key in modal footer")
	}
}

func TestRenderDetailUsesFixedWidthAndWrapsLongNotes(t *testing.T) {
	keys := NewKeyRegistry()
	txn := transaction{
		dateISO:      "2026-02-10",
		amount:       -12.34,
		description:  "Coffee and breakfast",
		categoryName: "Dining",
	}
	short := renderDetail(txn, nil, "short note", 0, "", keys)
	long := renderDetail(txn, nil, "this-is-a-very-long-unbroken-note-token-without-spaces-1234567890abcdefghijklmnopqrstuvwxyz", 0, "notes", keys)

	maxWidth := func(s string) int {
		w := 0
		for _, line := range splitLines(s) {
			w = max(w, ansi.StringWidth(line))
		}
		return w
	}

	shortW := maxWidth(short)
	longW := maxWidth(long)
	if shortW != longW {
		t.Fatalf("detail modal width should stay fixed: short=%d long=%d", shortW, longW)
	}
	if !strings.Contains(long, "Notes:") {
		t.Fatal("expected notes label in long output")
	}
	if strings.Contains(long, "this-is-a-very-long-unbroken-note-token-without-spaces-1234567890abcdefghijklmnopqrstuvwxyz_") {
		t.Fatal("long unbroken notes token should be wrapped, not rendered on one line")
	}
}

func TestRenderDetailMetadataOrderAndSingleLineDateAmount(t *testing.T) {
	keys := NewKeyRegistry()
	txn := transaction{
		dateISO:      "2026-02-10",
		amount:       -12.34,
		description:  "PAYMENT THANKYOU 551646",
		categoryName: "Transport",
	}
	tags := []tag{
		{name: "CARMAINTAINENCE"},
		{name: "LONGTAGNAME1234567890"},
	}
	out := renderDetail(txn, tags, "note", 0, "", keys)
	lines := splitLines(out)

	dateAmountFound := false
	for _, line := range lines {
		if strings.Contains(line, "Date:") && strings.Contains(line, "Amount:") {
			dateAmountFound = true
			break
		}
	}
	if !dateAmountFound {
		t.Fatal("expected Date and Amount metadata on one line")
	}

	idxCategory := strings.Index(out, "Category:")
	idxTags := strings.Index(out, "Tags:")
	idxDescription := strings.Index(out, "Description")
	if idxCategory < 0 || idxTags < 0 || idxDescription < 0 {
		t.Fatalf("missing required metadata blocks in output:\n%s", out)
	}
	if !(idxCategory < idxTags && idxTags < idxDescription) {
		t.Fatalf("expected Category then Tags then Description order, got:\n%s", out)
	}
}

func TestRenderManagerSectionBoxTitleInTopBorder(t *testing.T) {
	out := renderManagerSectionBox("Accounts", true, true, 56, "row")
	lines := splitLines(out)
	if len(lines) < 2 {
		t.Fatalf("expected multi-line section box, got %q", out)
	}
	if !strings.Contains(lines[0], "Accounts") {
		t.Fatalf("expected title in top border line, got %q", lines[0])
	}
	if strings.Contains(lines[1], "Accounts") {
		t.Fatalf("title should not be on body line, got %q", lines[1])
	}
}

func TestViewKeepsHeaderVisibleWhenManagerBodyOverflows(t *testing.T) {
	m := newModel()
	m.ready = true
	m.width = 220
	m.height = 12
	m.activeTab = tabManager
	m.accounts = []account{{id: 1, name: "Main", acctType: "transaction", isActive: true}}

	rows := make([]transaction, 0, 80)
	for i := 0; i < 80; i++ {
		rows = append(rows, transaction{
			id:          i + 1,
			dateISO:     "2026-02-10",
			amount:      -10.0 - float64(i),
			description: "Txn",
		})
	}
	m.rows = rows

	out := m.View()
	lines := splitLines(out)
	if len(lines) != m.height {
		t.Fatalf("view line count = %d, want %d", len(lines), m.height)
	}
	if !strings.Contains(lines[0], "Jaskmoney") || !strings.Contains(lines[0], "Manager") {
		t.Fatalf("expected header line at top of viewport, got %q", lines[0])
	}
}

func TestViewKeepsHeaderVisibleWhenManagerModalOpen(t *testing.T) {
	m := newModel()
	m.ready = true
	m.width = 120
	m.height = 16
	m.activeTab = tabManager
	m.accounts = []account{{id: 1, name: "Main", acctType: "transaction", isActive: true}}
	m.managerModalOpen = true
	m.managerModalIsNew = true
	m.managerEditName = "Everyday"
	m.managerEditType = "debit"

	out := m.View()
	lines := splitLines(out)
	if len(lines) != m.height {
		t.Fatalf("view line count = %d, want %d", len(lines), m.height)
	}
	if !strings.Contains(lines[0], "Jaskmoney") || !strings.Contains(lines[0], "Manager") {
		t.Fatalf("expected header line at top of viewport, got %q", lines[0])
	}
}

func TestViewManagerBodyUsesFullViewportWidth(t *testing.T) {
	m := newModel()
	m.ready = true
	m.width = 90
	m.height = 16
	m.activeTab = tabManager
	m.accounts = []account{{id: 1, name: "Main", acctType: "transaction", isActive: true}}
	m.rows = []transaction{{id: 1, dateISO: "2026-02-10", amount: -10, description: "Txn"}}

	out := m.View()
	lines := splitLines(out)
	if len(lines) < 3 {
		t.Fatalf("expected at least 3 lines, got %d", len(lines))
	}
	bodyTop := ansi.Strip(lines[2])
	if !strings.HasPrefix(bodyTop, "╭") {
		t.Fatalf("expected box to start at left viewport edge, got %q", bodyTop)
	}
	if !strings.HasSuffix(bodyTop, "╮") {
		t.Fatalf("expected box to end at right viewport edge, got %q", bodyTop)
	}
}

func TestViewAllLinesMatchViewportWidth(t *testing.T) {
	m := newModel()
	m.ready = true
	m.width = 100
	m.height = 14
	m.activeTab = tabDashboard
	m.rows = testDashboardRows()

	out := m.View()
	lines := splitLines(out)
	if len(lines) != m.height {
		t.Fatalf("view line count = %d, want %d", len(lines), m.height)
	}
	for i, line := range lines {
		if got := ansi.StringWidth(line); got != m.width {
			t.Fatalf("line %d width = %d, want %d", i, got, m.width)
		}
	}
}

func TestDashboardChartWidthsUsesExactAvailableWidth(t *testing.T) {
	for _, total := range []int{40, 60, 96, 120} {
		gap := 2
		tracker, breakdown := dashboardChartWidths(total, gap)
		if tracker+gap+breakdown != total {
			t.Fatalf("total=%d tracker=%d breakdown=%d gap=%d sum=%d", total, tracker, breakdown, gap, tracker+gap+breakdown)
		}
		if tracker < 1 || breakdown < 1 {
			t.Fatalf("widths must stay positive: tracker=%d breakdown=%d", tracker, breakdown)
		}
	}
}

func TestDashboardOverviewBoxUsesFullViewportWidth(t *testing.T) {
	m := newModel()
	m.ready = true
	m.width = 120
	m.height = 20
	m.activeTab = tabDashboard
	m.rows = testDashboardRows()

	out := m.View()
	lines := splitLines(out)
	found := false
	for _, line := range lines {
		plain := ansi.Strip(line)
		if !strings.Contains(plain, "Overview") {
			continue
		}
		found = true
		if !strings.HasPrefix(plain, "╭") {
			t.Fatalf("expected overview box to start at left viewport edge, got %q", plain)
		}
		if !strings.HasSuffix(plain, "╮") {
			t.Fatalf("expected overview box to end at right viewport edge, got %q", plain)
		}
		break
	}
	if !found {
		t.Fatal("could not find Overview box top border in dashboard view")
	}
}

func TestDashboardOverviewRowsDoNotClipAtRightEdge(t *testing.T) {
	m := newModel()
	m.ready = true
	m.width = 140
	m.height = 20
	m.activeTab = tabDashboard
	m.rows = testDashboardRows()

	out := m.View()
	lines := splitLines(out)
	for _, line := range lines {
		plain := ansi.Strip(line)
		if !(strings.Contains(plain, "Balance") || strings.Contains(plain, "Debits") || strings.Contains(plain, "Credits")) {
			continue
		}
		if strings.Contains(plain, "… │") {
			t.Fatalf("overview row is clipping before border: %q", plain)
		}
	}
}

func TestDashboardChartRowsDoNotClipAtRightEdge(t *testing.T) {
	m := newModel()
	m.ready = true
	m.width = 160
	m.height = 24
	m.activeTab = tabDashboard
	m.rows = testDashboardRows()

	out := m.View()
	lines := splitLines(out)
	for _, line := range lines {
		plain := ansi.Strip(line)
		if !(strings.Contains(plain, "│  │") || strings.Contains(plain, "Dining & Drinks")) {
			continue
		}
		if strings.Contains(plain, "… │") {
			t.Fatalf("chart row is clipping before border: %q", plain)
		}
	}
}

func TestViewManagerTransactionsNeverExceedsViewportWidthWithLongContent(t *testing.T) {
	catID := 1
	m := newModel()
	m.ready = true
	m.width = 120
	m.height = 20
	m.activeTab = tabManager
	m.managerMode = managerModeTransactions
	m.accounts = []account{{id: 1, name: "ANZ CREDIT", acctType: "credit", isActive: true}}
	m.categories = []category{{id: 1, name: "Dining & Drinks", color: "#fab387"}}
	m.rows = []transaction{
		{
			id:           1,
			dateISO:      "2026-02-03",
			amount:       -20.00,
			description:  "DAN MURPHY'S / 580 MELBOURN SPOTSWOOD EXTREMELY LONG DESCRIPTION",
			categoryID:   &catID,
			categoryName: "Dining & Drinks",
			accountName:  "MELBOURNE",
		},
	}
	m.txnTags = map[int][]tag{
		1: {
			{id: 1, name: "IGNORE"},
			{id: 2, name: "CARMAINTAINENCE"},
			{id: 3, name: "FASTFOOD"},
		},
	}

	out := m.View()
	lines := splitLines(out)
	if len(lines) != m.height {
		t.Fatalf("view line count = %d, want %d", len(lines), m.height)
	}
	for i, line := range lines {
		if got := ansi.StringWidth(line); got > m.width {
			t.Fatalf("line %d width = %d, exceeds viewport width %d: %q", i, got, m.width, ansi.Strip(line))
		}
	}
}

func TestRenderSettingsDBAndImportHistoryCards(t *testing.T) {
	m := newModel()
	m.dbInfo = dbInfo{
		schemaVersion:    2,
		transactionCount: 10,
		categoryCount:    4,
		ruleCount:        2,
		tagCount:         3,
		tagRuleCount:     1,
		importCount:      1,
		accountCount:     2,
	}
	m.maxVisibleRows = 25
	m.imports = []importRecord{
		{filename: "ANZ.csv", rowCount: 120, importedAt: "2026-02-10"},
	}

	output := renderSettingsDBImport(m, 24)
	if !strings.Contains(output, "Schema version") {
		t.Fatal("missing DB summary block")
	}
	if strings.Contains(output, "Import History") {
		t.Fatal("database card should not include import history heading")
	}

	history := renderSettingsImportHistory(m, 24)
	if !strings.Contains(history, "ANZ.csv") {
		t.Fatal("missing import history row")
	}
}

func TestRenderSettingsSectionBoxUsesBorderTitleStyle(t *testing.T) {
	m := newModel()
	m.settSection = settSecCategories
	out := renderSettingsSectionBox("Categories", settSecCategories, m, 32, "content")
	if !strings.Contains(out, "╭") || !strings.Contains(out, "╯") {
		t.Fatal("settings card should render as a bordered box")
	}
	if !strings.Contains(out, "content") {
		t.Fatal("missing content")
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

func TestPrettyHelpKeyShiftPreservation(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"K", "S-k"},
		{"J", "S-j"},
		{"A", "S-a"},
		{"D", "S-d"},
		{"S", "S-s"},
		{"G", "S-g"},
		// Lowercase should NOT get S- prefix
		{"k", "k"},
		{"j", "j"},
		{"a", "a"},
		// Arrow keys should still get symbols
		{"up", "↑"},
		{"down", "↓"},
		{"left", "←"},
		{"right", "→"},
		// Multi-char combos
		{"ctrl+p", "↑/↓"},
		{"shift+up/down", "⇧↑/⇧↓"},
		{"enter", "enter"},
		{"esc", "esc"},
		{"space", "space"},
		{"tab", "tab"},
		{"del", "del"},
	}
	for _, tc := range cases {
		got := prettyHelpKey(tc.in)
		if got != tc.want {
			t.Errorf("prettyHelpKey(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}
