package main

import (
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/NimbleMarkets/ntcharts/canvas"
	"github.com/NimbleMarkets/ntcharts/linechart"
	tslc "github.com/NimbleMarkets/ntcharts/linechart/timeserieslinechart"
	"github.com/charmbracelet/bubbles/key"
	"github.com/charmbracelet/lipgloss"
)

// ---------------------------------------------------------------------------
// Styles — Catppuccin Mocha themed
// ---------------------------------------------------------------------------

var (
	// Section titles
	titleStyle = lipgloss.NewStyle().Foreground(colorBrand).Bold(true)

	// Header bar (spans full width)
	headerBarStyle = lipgloss.NewStyle().
			Foreground(colorText).
			Background(colorMantle).
			Padding(0, 2)

	// App name in header
	headerAppStyle = lipgloss.NewStyle().
			Foreground(colorBrand).
			Bold(true)

	// Tab styles
	activeTabStyle = lipgloss.NewStyle().
			Foreground(colorAccent).
			Background(colorSurface0).
			Bold(true).
			Padding(0, 1)

	inactiveTabStyle = lipgloss.NewStyle().
				Foreground(colorOverlay1).
				Background(colorMantle).
				Padding(0, 1)

	tabSepStyle = lipgloss.NewStyle().
			Foreground(colorOverlay0).
			Background(colorMantle)

	// Loading / status text
	statusStyle = lipgloss.NewStyle().Foreground(colorSubtext0)

	// Footer bar
	footerStyle = lipgloss.NewStyle().
			Foreground(colorSubtext0).
			Background(colorMantle).
			Padding(0, 2)

	// Status bar (above footer)
	statusBarStyle = lipgloss.NewStyle().
			Foreground(colorSubtext1).
			Background(colorSurface0).
			Padding(0, 2)

	// Error status bar
	statusBarErrStyle = lipgloss.NewStyle().
				Foreground(colorError).
				Background(colorSurface0).
				Padding(0, 2)

	// Section containers
	listBoxStyle = lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(colorSurface1).
			Padding(0, 1)

	// Modal overlay
	modalStyle = lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(colorAccent).
			Padding(0, 1)

	// Help key styling — these inherit footer background via Inherit()
	helpKeyStyle = lipgloss.NewStyle().
			Foreground(colorAccent).
			Bold(true)

	helpDescStyle = lipgloss.NewStyle().
			Foreground(colorSubtext0)

	// Table styles
	tableHeaderStyle = lipgloss.NewStyle().
				Foreground(colorSubtext0).
				Bold(true)

	creditStyle = lipgloss.NewStyle().Foreground(colorSuccess)
	debitStyle  = lipgloss.NewStyle().Foreground(colorError)

	cursorStyle = lipgloss.NewStyle().Foreground(colorAccent).Bold(true)

	// Scroll indicator
	scrollStyle = lipgloss.NewStyle().Foreground(colorOverlay1)

	// Search styles
	searchPromptStyle = lipgloss.NewStyle().Foreground(colorAccent).Bold(true)
	searchInputStyle  = lipgloss.NewStyle().Foreground(colorText)

	// Category tag
	categoryTagUncategorised = lipgloss.NewStyle().Foreground(colorOverlay1)

	// Detail modal
	detailLabelStyle  = lipgloss.NewStyle().Foreground(colorSubtext0)
	detailValueStyle  = lipgloss.NewStyle().Foreground(colorText)
	detailActiveStyle = lipgloss.NewStyle().Foreground(colorAccent).Bold(true)
)

// ---------------------------------------------------------------------------
// Tab names
// ---------------------------------------------------------------------------

var tabNames = []string{"Dashboard", "Transactions", "Settings"}

// ---------------------------------------------------------------------------
// Section & chrome rendering
// ---------------------------------------------------------------------------

func renderHeader(appName string, activeTab, width int) string {
	// Line 1: App name + tab bar
	name := headerAppStyle.Render(appName)

	// Build tab bar
	var tabs []string
	for i, tab := range tabNames {
		if i == activeTab {
			tabs = append(tabs, activeTabStyle.Render(tab))
		} else {
			tabs = append(tabs, inactiveTabStyle.Render(tab))
		}
	}
	tabBar := tabSepStyle.Render(" ") + strings.Join(tabs, tabSepStyle.Render("│"))

	line1Content := name + "  " + tabBar

	if width <= 0 {
		return headerBarStyle.Render(line1Content)
	}
	style := headerBarStyle.Width(width)
	return style.Render(line1Content)
}

func (m model) renderSection(title, content string) string {
	return m.renderSectionSizedAligned(title, content, m.sectionWidth(), true, lipgloss.Center)
}

func (m model) renderSectionNoSeparator(title, content string) string {
	return m.renderSectionSizedAligned(title, content, m.sectionWidth(), false, lipgloss.Center)
}

func (m model) renderSectionSized(title, content string, sectionWidth int, withSeparator bool) string {
	return m.renderSectionSizedAligned(title, content, sectionWidth, withSeparator, lipgloss.Center)
}

func (m model) renderSectionSizedLeft(title, content string, sectionWidth int, withSeparator bool) string {
	return m.renderSectionSizedAligned(title, content, sectionWidth, withSeparator, lipgloss.Left)
}

func (m model) renderSectionSizedAligned(title, content string, sectionWidth int, withSeparator bool, align lipgloss.Position) string {
	if sectionWidth <= 0 {
		sectionWidth = m.sectionWidth()
	}
	frameH := listBoxStyle.GetHorizontalFrameSize()
	contentWidth := sectionWidth - frameH
	if contentWidth < 1 {
		contentWidth = 1
	}
	header := padRight(titleStyle.Render(title), contentWidth)
	sectionContent := header + "\n" + content
	if withSeparator {
		sepStyle := lipgloss.NewStyle().Foreground(colorSurface2)
		separator := sepStyle.Render(strings.Repeat("─", contentWidth))
		sectionContent = header + "\n" + separator + "\n" + content
	}
	section := listBoxStyle.Width(sectionWidth).Render(sectionContent)
	if m.width == 0 {
		return section
	}
	return lipgloss.Place(m.width, lipgloss.Height(section), align, lipgloss.Top, section)
}

func (m model) renderFooter(bindings []key.Binding) string {
	// Build help text where every character carries the footer background.
	bg := colorMantle
	keyStyle := helpKeyStyle.Background(bg)
	descStyle := helpDescStyle.Background(bg)
	space := lipgloss.NewStyle().Background(bg).Render(" ")
	sep := lipgloss.NewStyle().Background(bg).Render("  ")

	parts := make([]string, 0, len(bindings))
	for _, binding := range bindings {
		help := binding.Help()
		if help.Key == "" && help.Desc == "" {
			continue
		}
		parts = append(parts, keyStyle.Render(help.Key)+space+descStyle.Render(help.Desc))
	}
	content := strings.Join(parts, sep)

	if m.width == 0 {
		return footerStyle.Render(content)
	}
	return footerStyle.Width(m.width).Render(content)
}

func (m model) renderStatus(text string, isErr bool) string {
	flat := strings.ReplaceAll(text, "\n", " ")
	style := statusBarStyle
	if isErr {
		style = statusBarErrStyle
	}
	if m.width == 0 {
		return style.Render(flat)
	}
	return style.Width(m.width).Render(flat)
}

func renderDashboardTimeframeChips(labels []string, active, cursor int, focused bool) string {
	baseStyle := lipgloss.NewStyle().Foreground(colorSubtext0)
	activeStyle := lipgloss.NewStyle().Foreground(colorAccent).Bold(true)

	parts := make([]string, 0, len(labels))
	for i, label := range labels {
		chip := "[" + label + "]"
		style := baseStyle
		if i == active {
			style = activeStyle
		}
		text := style.Render(chip)
		if focused && i == cursor {
			text = cursorStyle.Render(">") + text
		}
		parts = append(parts, text)
	}
	return strings.Join(parts, " ")
}

func renderDashboardCustomInput(start, end, input string, editing bool) string {
	if !editing {
		return ""
	}

	startText := start
	if startText == "" {
		startText = "YYYY-MM-DD"
	}
	endText := end
	if endText == "" {
		endText = "YYYY-MM-DD"
	}

	if start == "" {
		startText = input + "_"
	} else {
		endText = input + "_"
	}

	labelStyle := lipgloss.NewStyle().Foreground(colorOverlay1)
	valueStyle := lipgloss.NewStyle().Foreground(colorAccent)
	promptStyle := lipgloss.NewStyle().Foreground(colorSubtext0)

	fields := labelStyle.Render("Custom Range: ") +
		valueStyle.Render("Start ") + valueStyle.Render(startText) + "  " +
		valueStyle.Render("End ") + valueStyle.Render(endText)
	prompt := promptStyle.Render("Enter confirms each field, Esc cancels.")
	return fields + "\n" + prompt
}

// renderFilePicker renders a simple list of CSV files with a cursor.
func renderFilePicker(files []string, cursor int) string {
	if len(files) == 0 {
		return lipgloss.NewStyle().Foreground(colorOverlay1).Render("Loading CSV files...")
	}
	var lines []string
	lines = append(lines, titleStyle.Render("Import CSV File"))
	lines = append(lines, "")
	for i, f := range files {
		prefix := "  "
		if i == cursor {
			prefix = cursorStyle.Render("> ")
		}
		lines = append(lines, prefix+lipgloss.NewStyle().Foreground(colorText).Render(f))
	}
	lines = append(lines, "")
	lines = append(lines, scrollStyle.Render("enter select  esc cancel"))
	return strings.Join(lines, "\n")
}

// renderDupeModal renders the duplicate detection decision modal.
func renderDupeModal(file string, total, dupes int) string {
	var lines []string
	lines = append(lines, titleStyle.Render("Duplicates Detected"))
	lines = append(lines, "")
	lines = append(lines, fmt.Sprintf("File: %s", lipgloss.NewStyle().Foreground(colorText).Render(file)))
	lines = append(lines, fmt.Sprintf("Total rows:  %s", lipgloss.NewStyle().Foreground(colorPeach).Render(fmt.Sprintf("%d", total))))
	lines = append(lines, fmt.Sprintf("Duplicates:  %s", lipgloss.NewStyle().Foreground(colorWarning).Render(fmt.Sprintf("%d", dupes))))
	lines = append(lines, "")
	lines = append(lines, helpKeyStyle.Render("a")+helpDescStyle.Render(" import all (ignore dupes)"))
	lines = append(lines, helpKeyStyle.Render("s")+helpDescStyle.Render(" skip duplicates"))
	lines = append(lines, helpKeyStyle.Render("esc")+helpDescStyle.Render(" cancel import"))
	return strings.Join(lines, "\n")
}

// ---------------------------------------------------------------------------
// Data rendering
// ---------------------------------------------------------------------------

// renderTransactionTable renders the transaction table with optional category column.
// If categories is nil (dashboard mode), the category column is hidden.
func renderTransactionTable(rows []transaction, categories []category, cursor, topIndex, visible, width int, sortCol int, sortAsc bool) string {
	cursorW := 2
	dateW := 9 // dd-mm-yy = 8 chars + 1 pad
	amountW := 11
	catW := 0
	showCats := categories != nil
	if showCats {
		catW = 15
	}
	sep := " " // single-space column separator
	numSeps := 3
	if showCats {
		numSeps = 4
	}
	descW := width - dateW - amountW - catW - cursorW - numSeps
	if descW < 5 {
		descW = 5
	}

	// Build header with sort indicator
	dateLbl := addSortIndicator("Date", sortByDate, sortCol, sortAsc)
	amtLbl := addSortIndicator("Amount", sortByAmount, sortCol, sortAsc)
	descLbl := addSortIndicator("Description", sortByDescription, sortCol, sortAsc)

	var header string
	if showCats {
		catLbl := addSortIndicator("Category", sortByCategory, sortCol, sortAsc)
		header = fmt.Sprintf("  %-*s"+sep+"%-*s"+sep+"%-*s"+sep+"%-*s", dateW, dateLbl, amountW, amtLbl, catW, catLbl, descW, descLbl)
	} else {
		header = fmt.Sprintf("  %-*s"+sep+"%-*s"+sep+"%-*s", dateW, dateLbl, amountW, amtLbl, descW, descLbl)
	}
	headerLine := tableHeaderStyle.Render(header)
	lines := []string{headerLine}

	end := topIndex + visible
	if end > len(rows) {
		end = len(rows)
	}
	for i := topIndex; i < end; i++ {
		row := rows[i]

		// Amount with color
		amountText := fmt.Sprintf("%.2f", row.amount)
		amountField := padRight(amountText, amountW)
		if row.amount > 0 {
			amountField = creditStyle.Render(amountField)
		} else if row.amount < 0 {
			amountField = debitStyle.Render(amountField)
		}

		// Cursor prefix
		prefix := "  "
		if i == cursor {
			prefix = cursorStyle.Render("> ")
		}

		dateField := padRight(formatDateShort(row.dateISO), dateW)
		desc := truncate(row.description, descW)
		descField := padRight(desc, descW)

		if showCats {
			catField := renderCategoryTag(row.categoryName, row.categoryColor, catW)
			lines = append(lines, prefix+dateField+sep+amountField+sep+catField+sep+descField)
		} else {
			lines = append(lines, prefix+dateField+sep+amountField+sep+descField)
		}
	}

	// Scroll indicator
	total := len(rows)
	if total > 0 && visible > 0 {
		start := topIndex + 1
		endIdx := topIndex + visible
		if endIdx > total {
			endIdx = total
		}
		indicator := scrollStyle.Render(fmt.Sprintf("── showing %d-%d of %d ──", start, endIdx, total))
		lines = append(lines, indicator)
	}

	return strings.Join(lines, "\n")
}

func addSortIndicator(label string, col, activeCol int, asc bool) string {
	if col != activeCol {
		return label
	}
	if asc {
		return label + " ▲"
	}
	return label + " ▼"
}

func renderCategoryTag(name, color string, width int) string {
	display := truncate(name, width-1)
	if color == "" || color == "#7f849c" {
		return padRight(categoryTagUncategorised.Render(display), width)
	}
	style := lipgloss.NewStyle().Foreground(lipgloss.Color(color))
	return padRight(style.Render(display), width)
}

// ---------------------------------------------------------------------------
// Dashboard widgets
// ---------------------------------------------------------------------------

// renderSummaryCards renders the summary cards: balance, income, expenses,
// transaction count, category count, date range.
func renderSummaryCards(rows []transaction, categories []category, width int) string {
	var income, expenses float64
	var uncatCount int
	var uncatTotal float64
	var minDate, maxDate string
	for _, r := range rows {
		if r.amount > 0 {
			income += r.amount
		} else {
			expenses += r.amount
		}
		if isUncategorised(r) {
			uncatCount++
			uncatTotal += math.Abs(r.amount)
		}
		if minDate == "" || r.dateISO < minDate {
			minDate = r.dateISO
		}
		if maxDate == "" || r.dateISO > maxDate {
			maxDate = r.dateISO
		}
	}
	balance := income + expenses

	labelSty := lipgloss.NewStyle().Foreground(colorSubtext0)
	valSty := lipgloss.NewStyle().Foreground(colorPeach)
	greenSty := lipgloss.NewStyle().Foreground(colorSuccess)
	redSty := lipgloss.NewStyle().Foreground(colorError)

	dateRange := "—"
	if minDate != "" {
		dateRange = formatMonth(minDate) + " – " + formatMonth(maxDate)
	}

	// Active categories (categories used by at least one transaction)
	activeCats := countActiveCategories(rows)

	// 2 rows, 3 columns
	col1W := 28
	col2W := 28
	col3W := width - col1W - col2W
	if col3W < 20 {
		col3W = 20
	}

	debits := math.Abs(expenses)
	credits := income

	row1 := padRight(labelSty.Render("Balance      ")+balanceStyle(balance, greenSty, redSty), col1W) +
		padRight(labelSty.Render("Uncat ")+valSty.Render(fmt.Sprintf("%d (%s)", uncatCount, formatMoney(uncatTotal))), col2W) +
		padRight(labelSty.Render("Date Range   ")+valSty.Render(dateRange), col3W)

	row2 := padRight(labelSty.Render("Debits       ")+redSty.Render(formatMoney(debits)), col1W) +
		padRight(labelSty.Render("Transactions ")+valSty.Render(fmt.Sprintf("%d", len(rows))), col2W) +
		padRight(labelSty.Render("Categories   ")+valSty.Render(fmt.Sprintf("%d", activeCats)), col3W)

	row3 := padRight(labelSty.Render("Credits      ")+greenSty.Render(formatMoney(credits)), col1W) +
		padRight("", col2W) +
		padRight("", col3W)

	return row1 + "\n" + row2 + "\n" + row3
}

func balanceStyle(amount float64, green, red lipgloss.Style) string {
	s := formatMoney(math.Abs(amount))
	if amount >= 0 {
		return green.Render(s)
	}
	return red.Render("-" + s)
}

func formatMoney(v float64) string {
	neg := v < 0
	if neg {
		v = -v
	}
	// Format with commas
	whole := int64(v)
	frac := v - float64(whole)
	s := fmt.Sprintf("%d", whole)
	// Insert commas
	if len(s) > 3 {
		var parts []string
		for len(s) > 3 {
			parts = append([]string{s[len(s)-3:]}, parts...)
			s = s[:len(s)-3]
		}
		parts = append([]string{s}, parts...)
		s = strings.Join(parts, ",")
	}
	result := fmt.Sprintf("$%s.%02d", s, int(frac*100+0.5))
	if neg {
		return "-" + result
	}
	return result
}

func formatWholeNumber(v float64) string {
	if v < 0 {
		v = -v
	}
	whole := int64(math.Round(v))
	s := fmt.Sprintf("%d", whole)
	if len(s) > 3 {
		var parts []string
		for len(s) > 3 {
			parts = append([]string{s[len(s)-3:]}, parts...)
			s = s[:len(s)-3]
		}
		parts = append([]string{s}, parts...)
		s = strings.Join(parts, ",")
	}
	return s
}

// formatDateShort converts "2006-01-02" to "02-01-06" (dd-mm-yy).
func formatDateShort(dateISO string) string {
	t, err := time.Parse("2006-01-02", dateISO)
	if err != nil {
		return dateISO
	}
	return t.Format("02-01-06")
}

func formatMonth(dateISO string) string {
	t, err := time.Parse("2006-01-02", dateISO)
	if err != nil {
		if len(dateISO) >= 7 {
			return dateISO[:7]
		}
		return dateISO
	}
	return t.Format("Jan 2006")
}

func countActiveCategories(rows []transaction) int {
	seen := make(map[string]bool)
	for _, r := range rows {
		if r.categoryName != "" && r.categoryName != "Uncategorised" {
			seen[r.categoryName] = true
		}
	}
	return len(seen)
}

// categorySpend holds aggregated spend for a category.
type categorySpend struct {
	name   string
	color  string
	amount float64 // absolute value of expenses
}

// renderCategoryBreakdown renders a horizontal bar chart of spending by category.
// Shows top 6 + "Other" bucket. Each bar uses the category's color.
func renderCategoryBreakdown(rows []transaction, width int) string {
	// Aggregate expenses by category
	spendMap := make(map[string]*categorySpend)
	var totalExpenses float64
	for _, r := range rows {
		if r.amount >= 0 {
			continue // skip income
		}
		abs := math.Abs(r.amount)
		totalExpenses += abs
		key := r.categoryName
		if key == "" {
			key = "Uncategorised"
		}
		if s, ok := spendMap[key]; ok {
			s.amount += abs
		} else {
			spendMap[key] = &categorySpend{name: key, color: r.categoryColor, amount: abs}
		}
	}

	if totalExpenses == 0 {
		return lipgloss.NewStyle().Foreground(colorOverlay1).Render("No expense data to display.")
	}

	// Sort by amount descending
	var sorted []categorySpend
	for _, s := range spendMap {
		sorted = append(sorted, *s)
	}
	sort.Slice(sorted, func(i, j int) bool {
		return sorted[i].amount > sorted[j].amount
	})

	// Top 6 + Other
	maxBars := 6
	var display []categorySpend
	var otherAmount float64
	for i, s := range sorted {
		if i < maxBars {
			display = append(display, s)
		} else {
			otherAmount += s.amount
		}
	}
	if otherAmount > 0 {
		display = append(display, categorySpend{name: "Other", color: "#9399b2", amount: otherAmount})
	}

	// Render bars
	nameW := 16
	pctW := 6
	amtW := 12
	barW := width - nameW - pctW - amtW - 4
	if barW < 5 {
		barW = 5
	}

	var lines []string
	for _, s := range display {
		pct := s.amount / totalExpenses * 100
		filled := int(float64(barW) * s.amount / totalExpenses)
		if filled < 1 && s.amount > 0 {
			filled = 1
		}
		empty := barW - filled

		catColor := lipgloss.Color(s.color)
		if s.color == "" {
			catColor = colorOverlay1
		}

		nameSty := lipgloss.NewStyle().Foreground(catColor)
		barFilled := lipgloss.NewStyle().Foreground(catColor).Render(strings.Repeat("█", filled))
		barEmpty := lipgloss.NewStyle().Foreground(colorSurface2).Render(strings.Repeat("░", empty))
		pctStr := lipgloss.NewStyle().Foreground(colorSubtext0).Render(fmt.Sprintf("%5.1f%%", pct))
		amtStr := lipgloss.NewStyle().Foreground(colorPeach).Render(fmt.Sprintf("%10s", formatMoney(s.amount)))

		line := padRight(nameSty.Render(truncate(s.name, nameW-1)), nameW) +
			barFilled + barEmpty + " " + pctStr + " " + amtStr
		lines = append(lines, line)
	}

	return strings.Join(lines, "\n")
}

const spendingTrackerDays = 60
const spendingTrackerHeight = 14
const spendingTrackerYStep = 1

type spendingMajorMode int

const (
	spendingMajorWeek spendingMajorMode = iota
	spendingMajorMonth
	spendingMajorQuarter
)

type spendingAxisPlan struct {
	minorStepDays int
	majorMode     spendingMajorMode
	xLabels       map[string]string // YYYY-MM-DD -> label
	yStep         float64
	yMax          float64
}

func aggregateDailySpend(rows []transaction, days int) ([]float64, []time.Time) {
	if days <= 0 {
		return nil, nil
	}
	now := time.Now()
	end := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.Local)
	start := end.AddDate(0, 0, -(days - 1))
	return aggregateDailySpendForRange(rows, start, end)
}

func aggregateDailySpendForRange(rows []transaction, start, end time.Time) ([]float64, []time.Time) {
	if end.Before(start) {
		return nil, nil
	}
	start = time.Date(start.Year(), start.Month(), start.Day(), 0, 0, 0, 0, time.Local)
	end = time.Date(end.Year(), end.Month(), end.Day(), 0, 0, 0, 0, time.Local)
	startISO := start.Format("2006-01-02")
	endISO := end.Format("2006-01-02")
	days := int(end.Sub(start).Hours()/24) + 1
	if days <= 0 {
		return nil, nil
	}
	byDay := make(map[string]float64)
	for _, r := range rows {
		if r.dateISO < startISO || r.dateISO > endISO {
			continue
		}
		if isUncategorised(r) {
			continue
		}
		if r.amount >= 0 {
			continue
		}
		byDay[r.dateISO] += -r.amount
	}

	values := make([]float64, 0, days)
	dates := make([]time.Time, 0, days)
	for d := start; !d.After(end); d = d.AddDate(0, 0, 1) {
		key := d.Format("2006-01-02")
		values = append(values, byDay[key])
		dates = append(dates, d)
	}
	return values, dates
}

func isUncategorised(r transaction) bool {
	if r.categoryName != "" {
		return r.categoryName == "Uncategorised"
	}
	return r.categoryID == nil
}

func renderSpendingTracker(rows []transaction, width int) string {
	return renderSpendingTrackerWithWeekAnchor(rows, width, time.Sunday)
}

func renderSpendingTrackerWithWeekAnchor(rows []transaction, width int, weekAnchor time.Weekday) string {
	now := time.Now()
	end := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.Local)
	start := end.AddDate(0, 0, -(spendingTrackerDays - 1))
	return renderSpendingTrackerWithRange(rows, width, weekAnchor, start, end)
}

func renderSpendingTrackerWithRange(rows []transaction, width int, weekAnchor time.Weekday, start, end time.Time) string {
	if width <= 0 {
		width = 20
	}
	values, dates := aggregateDailySpendForRange(rows, start, end)
	if len(dates) == 0 {
		return lipgloss.NewStyle().Foreground(colorOverlay1).Render("No data for spending tracker.")
	}

	start = dates[0]
	end = dates[len(dates)-1]
	maxVal := 0.0
	for _, v := range values {
		if v > maxVal {
			maxVal = v
		}
	}
	if maxVal == 0 {
		maxVal = 1
	}

	chart := tslc.New(width, spendingTrackerHeight)
	chart.SetXStep(1)
	chart.SetYStep(spendingTrackerYStep)
	chart.SetStyle(lipgloss.NewStyle().Foreground(colorPeach))
	chart.AxisStyle = lipgloss.NewStyle().Foreground(colorSurface2)
	chart.LabelStyle = lipgloss.NewStyle().Foreground(colorOverlay1)
	chart.SetTimeRange(start, end)
	chart.SetViewTimeRange(start, end)

	plan := planSpendingAxes(&chart, dates, maxVal)
	minVal := -(plan.yMax * 0.08)
	chart.SetYRange(minVal, plan.yMax)
	chart.SetViewYRange(minVal, plan.yMax)
	chart.Model.XLabelFormatter = spendingXLabelFormatter(plan.xLabels)
	chart.Model.YLabelFormatter = spendingYLabelFormatter(plan.yStep, plan.yMax)

	for i, d := range dates {
		chart.Push(tslc.TimePoint{Time: d, Value: values[i]})
	}

	chart.DrawBraille()
	clearAxes(&chart)
	raiseXAxisLabels(&chart)
	drawVerticalGridlines(&chart, dates, plan, weekAnchor)

	return chart.View()
}

func planSpendingAxes(chart *tslc.Model, dates []time.Time, maxVal float64) spendingAxisPlan {
	graphCols := chart.Width() - chart.Origin().X - 1
	if graphCols < 1 {
		graphCols = chart.Width()
	}
	minor := spendingMinorGridStep(len(dates), graphCols)
	mode := spendingMajorModeForDays(len(dates))
	yStep, yMax := spendingYScale(maxVal, chart.GraphHeight())
	return spendingAxisPlan{
		minorStepDays: minor,
		majorMode:     mode,
		xLabels:       spendingXLabels(chart, dates, minor, mode),
		yStep:         yStep,
		yMax:          yMax,
	}
}

func spendingMinorGridStep(days, graphCols int) int {
	if days <= 0 {
		return 1
	}
	if days <= 30 {
		return 1
	}
	if days <= 60 {
		return 2
	}
	if graphCols <= 0 {
		graphCols = days
	}
	maxMinorLines := max(1, graphCols/2)
	base := int(math.Ceil(float64(days) / float64(maxMinorLines)))
	if base < 1 {
		base = 1
	}
	return snapGridStep(base)
}

func snapGridStep(base int) int {
	steps := []int{1, 2, 3, 5, 7, 10, 14, 21, 30, 45, 60, 90}
	for _, s := range steps {
		if base <= s {
			return s
		}
	}
	chunk := 30
	return int(math.Ceil(float64(base)/float64(chunk))) * chunk
}

func spendingMajorModeForDays(days int) spendingMajorMode {
	if days <= 120 {
		return spendingMajorWeek
	}
	if days <= 540 {
		return spendingMajorMonth
	}
	return spendingMajorQuarter
}

func spendingXLabels(chart *tslc.Model, dates []time.Time, minorStep int, majorMode spendingMajorMode) map[string]string {
	labels := make(map[string]string)
	if len(dates) == 0 {
		return labels
	}

	type candidate struct {
		x     int
		iso   string
		label string
		prio  int
	}

	var cands []candidate
	add := func(d time.Time, label string, prio int) {
		x := chartColumnX(chart, d)
		if x <= chart.Origin().X || x >= chart.Width() {
			return
		}
		cands = append(cands, candidate{
			x:     x,
			iso:   d.Format("2006-01-02"),
			label: label,
			prio:  prio,
		})
	}

	start := dates[0]
	end := dates[len(dates)-1]
	startLabel := start.Format("2 Jan")
	endLabel := end.Format("2 Jan")
	if start.Year() != end.Year() {
		startLabel = start.Format("2 Jan 06")
		endLabel = end.Format("2 Jan 06")
	}
	add(start, startLabel, 0)
	add(end, endLabel, 0)

	for i, d := range dates {
		if d.Day() == 1 {
			switch majorMode {
			case spendingMajorQuarter:
				if isQuarterStart(d) {
					label := d.Format("Jan")
					if d.Month() == time.January {
						label = d.Format("Jan 06")
					}
					add(d, label, 1)
				}
			default:
				label := d.Format("Jan")
				if d.Month() == time.January {
					label = d.Format("Jan 06")
				}
				add(d, label, 1)
			}
		}
		if len(dates) <= 90 && minorStep > 0 && i%minorStep == 0 {
			add(d, fmt.Sprintf("%d", d.Day()), 2)
		}
	}

	minGap := 6
	// Place higher-priority labels first, then fill remaining space.
	for prio := 0; prio <= 2; prio++ {
		var tier []candidate
		for _, c := range cands {
			if c.prio == prio {
				tier = append(tier, c)
			}
		}
		sort.Slice(tier, func(i, j int) bool { return tier[i].x < tier[j].x })
		for _, c := range tier {
			if canPlaceXLabel(c, labels, dates, chart, minGap) {
				labels[c.iso] = c.label
			}
		}
	}
	return labels
}

func canPlaceXLabel(c struct {
	x     int
	iso   string
	label string
	prio  int
}, placed map[string]string, dates []time.Time, chart *tslc.Model, minGap int) bool {
	for iso := range placed {
		t, err := time.ParseInLocation("2006-01-02", iso, time.Local)
		if err != nil {
			continue
		}
		x := chartColumnX(chart, t)
		if intAbs(x-c.x) < minGap {
			return false
		}
	}
	return true
}

func intAbs(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

func spendingXLabelFormatter(labels map[string]string) linechart.LabelFormatter {
	return func(_ int, v float64) string {
		t := time.Unix(int64(v), 0).In(time.Local)
		iso := t.Format("2006-01-02")
		return labels[iso]
	}
}

func spendingYScale(maxVal float64, graphHeight int) (float64, float64) {
	if maxVal <= 0 {
		maxVal = 1
	}
	targetTicks := max(3, min(6, graphHeight/3))
	if targetTicks <= 1 {
		targetTicks = 3
	}
	rawStep := maxVal / float64(targetTicks-1)
	step := niceCeil(rawStep)
	if step < 1 {
		step = 1
	}
	yMax := math.Ceil(maxVal/step) * step
	if yMax < step {
		yMax = step
	}
	return step, yMax
}

func niceCeil(v float64) float64 {
	if v <= 0 {
		return 1
	}
	pow := math.Pow(10, math.Floor(math.Log10(v)))
	f := v / pow
	switch {
	case f <= 1:
		return 1 * pow
	case f <= 2:
		return 2 * pow
	case f <= 5:
		return 5 * pow
	default:
		return 10 * pow
	}
}

func spendingYLabelFormatter(step, yMax float64) linechart.LabelFormatter {
	tolerance := step * 0.2
	return func(_ int, v float64) string {
		if v < 0 {
			return ""
		}
		if v < tolerance {
			return "0"
		}
		nearest := math.Round(v/step) * step
		if nearest < 0 || nearest > yMax+step*0.01 {
			return ""
		}
		if math.Abs(v-nearest) > tolerance {
			return ""
		}
		if nearest < 0.5 {
			return "0"
		}
		return formatAxisTick(nearest)
	}
}

func formatAxisTick(v float64) string {
	if v < 0 {
		v = -v
	}
	switch {
	case v >= 1_000_000:
		m := v / 1_000_000
		if m < 10 {
			return trimTrailingDecimal(fmt.Sprintf("%.1fm", m))
		}
		return fmt.Sprintf("%dm", int(m))
	case v >= 1_000:
		k := v / 1_000
		if k < 10 {
			return trimTrailingDecimal(fmt.Sprintf("%.1fk", k))
		}
		return fmt.Sprintf("%dk", int(k))
	default:
		return formatWholeNumber(v)
	}
}

func trimTrailingDecimal(s string) string {
	return strings.Replace(s, ".0", "", 1)
}

func clearAxes(chart *tslc.Model) {
	origin := chart.Origin()
	topY := origin.Y - chart.GraphHeight()
	if topY < 0 {
		topY = 0
	}
	for y := topY; y <= origin.Y; y++ {
		p := canvas.Point{X: origin.X, Y: y}
		chart.Canvas.SetCell(p, canvas.NewCell(0))
	}
	for x := origin.X; x < chart.Width(); x++ {
		p := canvas.Point{X: x, Y: origin.Y}
		chart.Canvas.SetCell(p, canvas.NewCell(0))
	}
}

func raiseXAxisLabels(chart *tslc.Model) {
	origin := chart.Origin()
	labelY := origin.Y + 1
	if labelY < 0 || labelY >= chart.Canvas.Height() {
		return
	}
	for x := 0; x < chart.Width(); x++ {
		from := canvas.Point{X: x, Y: labelY}
		cell := chart.Canvas.Cell(from)
		if cell.Rune == 0 {
			continue
		}
		to := canvas.Point{X: x, Y: origin.Y}
		if chart.Canvas.Cell(to).Rune != 0 {
			continue
		}
		chart.Canvas.SetCell(to, cell)
		chart.Canvas.SetCell(from, canvas.NewCell(0))
	}
}

func drawVerticalGridlines(chart *tslc.Model, dates []time.Time, plan spendingAxisPlan, weekAnchor time.Weekday) {
	if len(dates) == 0 || plan.minorStepDays <= 0 {
		return
	}
	origin := chart.Origin()
	topY := origin.Y - chart.GraphHeight()
	// Keep gridlines inside the graphing area only (like Bagels/plotext vline),
	// so they stop just above the axis/tick-label row.
	bottomY := origin.Y - 1
	if topY < 0 || bottomY < 0 {
		return
	}
	minorStyle := lipgloss.NewStyle().Foreground(colorSurface1)
	majorStyle := lipgloss.NewStyle().Foreground(colorBlue)
	columns := make(map[int]bool) // x -> isMajor
	for i, d := range dates {
		isMajor := isMajorBoundary(d, plan.majorMode, weekAnchor)
		if !isMajor && i%plan.minorStepDays != 0 {
			continue
		}
		x := chartColumnX(chart, d)
		if x <= origin.X || x >= chart.Width() {
			continue
		}
		if isMajor {
			columns[x] = true
			continue
		}
		if _, exists := columns[x]; !exists {
			columns[x] = false
		}
	}
	for x, isMajor := range columns {
		style := minorStyle
		if isMajor {
			style = majorStyle
		}
		for y := topY; y <= bottomY; y++ {
			p := canvas.Point{X: x, Y: y}
			if chart.Canvas.Cell(p).Rune != 0 {
				continue
			}
			chart.Canvas.SetRuneWithStyle(p, '│', style)
		}
	}
}

func isMajorBoundary(d time.Time, mode spendingMajorMode, weekAnchor time.Weekday) bool {
	switch mode {
	case spendingMajorWeek:
		return d.Weekday() == weekAnchor
	case spendingMajorMonth:
		return d.Day() == 1
	case spendingMajorQuarter:
		return d.Day() == 1 && isQuarterStart(d)
	default:
		return false
	}
}

func isQuarterStart(d time.Time) bool {
	switch d.Month() {
	case time.January, time.April, time.July, time.October:
		return true
	default:
		return false
	}
}

func spendingWeekAnchorLabel(weekday time.Weekday) string {
	if weekday == time.Monday {
		return "Monday"
	}
	return "Sunday"
}

func chartColumnX(chart *tslc.Model, ts time.Time) int {
	point := canvas.Float64Point{X: float64(ts.Unix()), Y: chart.ViewMinY()}
	scaled := chart.ScaleFloat64Point(point)
	p := canvas.CanvasPointFromFloat64Point(chart.Origin(), scaled)
	if chart.YStep() > 0 {
		p.X++
	}
	if chart.XStep() > 0 {
		p.Y--
	}
	return p.X
}

// ---------------------------------------------------------------------------
// Settings rendering — 2-column layout
// ---------------------------------------------------------------------------

// settingsActiveBorderStyle is used for the focused section.
var settingsActiveBorderStyle = lipgloss.NewStyle().
	Border(lipgloss.RoundedBorder()).
	BorderForeground(colorAccent).
	Padding(0, 1)

// settingsInactiveBorderStyle is used for unfocused sections.
var settingsInactiveBorderStyle = lipgloss.NewStyle().
	Border(lipgloss.RoundedBorder()).
	BorderForeground(colorSurface1).
	Padding(0, 1)

// renderSettingsContent renders the 2-column settings layout.
func renderSettingsContent(m model) string {
	totalWidth := m.sectionContentWidth()
	gap := 2
	leftWidth := (totalWidth - gap) * 55 / 100
	rightWidth := totalWidth - gap - leftWidth
	if leftWidth < 20 {
		leftWidth = 20
	}
	if rightWidth < 20 {
		rightWidth = 20
	}

	// Left column: Categories + Rules (stacked)
	catContent := renderSettingsCategories(m, leftWidth-4)
	catBox := renderSettingsSectionBox("Categories", settSecCategories, m, leftWidth, catContent)

	rulesContent := renderSettingsRules(m, leftWidth-4)
	rulesBox := renderSettingsSectionBox("Rules", settSecRules, m, leftWidth, rulesContent)

	leftCol := catBox + "\n" + rulesBox

	// Right column: Chart + Database & Imports (stacked)
	chartContent := renderSettingsChart(m, rightWidth-4)
	chartBox := renderSettingsSectionBox("Chart", settSecChart, m, rightWidth, chartContent)

	dbContent := renderSettingsDBImport(m, rightWidth-4)
	dbBox := renderSettingsSectionBox("Database & Imports", settSecDBImport, m, rightWidth, dbContent)

	rightCol := chartBox + "\n" + dbBox

	return lipgloss.JoinHorizontal(lipgloss.Top, leftCol, strings.Repeat(" ", gap), rightCol)
}

// renderSettingsSectionBox wraps content in a bordered box, highlighting if focused.
func renderSettingsSectionBox(title string, sec int, m model, width int, content string) string {
	isFocused := m.settSection == sec
	isActive := isFocused && m.settActive

	style := settingsInactiveBorderStyle
	titleSty := lipgloss.NewStyle().Foreground(colorSubtext0).Bold(true)
	if isFocused {
		style = settingsActiveBorderStyle
		titleSty = lipgloss.NewStyle().Foreground(colorAccent).Bold(true)
	}

	indicator := ""
	if isActive {
		indicator = lipgloss.NewStyle().Foreground(colorAccent).Render(" *")
	}

	header := titleSty.Render(title) + indicator
	sepStyle := lipgloss.NewStyle().Foreground(colorSurface2)
	innerWidth := width - style.GetHorizontalFrameSize()
	if innerWidth < 1 {
		innerWidth = 1
	}
	separator := sepStyle.Render(strings.Repeat("─", innerWidth))
	body := header + "\n" + separator + "\n" + content

	return style.Width(width).Render(body)
}

func renderSettingsCategories(m model, width int) string {
	var lines []string

	// Input mode overlays
	if m.settMode == settModeAddCat || m.settMode == settModeEditCat {
		label := "Add Category"
		if m.settMode == settModeEditCat {
			label = "Edit Category"
		}
		lines = append(lines, detailActiveStyle.Render(label))
		lines = append(lines, detailLabelStyle.Render("Name: ")+detailValueStyle.Render(m.settInput+"_"))
		colors := CategoryAccentColors()
		var colorRow string
		for i, c := range colors {
			swatch := lipgloss.NewStyle().Foreground(c).Render("■")
			if i == m.settColorIdx {
				swatch = lipgloss.NewStyle().Foreground(c).Bold(true).Render("[■]")
			}
			colorRow += swatch + " "
		}
		lines = append(lines, detailLabelStyle.Render("Color: ")+colorRow)
		return strings.Join(lines, "\n")
	}

	showCursor := m.settSection == settSecCategories && m.settActive
	for i, cat := range m.categories {
		prefix := "  "
		if showCursor && i == m.settItemCursor {
			prefix = cursorStyle.Render("> ")
		}
		swatch := lipgloss.NewStyle().Foreground(lipgloss.Color(cat.color)).Render("■")
		nameStyle := lipgloss.NewStyle().Foreground(colorText)
		extra := ""
		if cat.isDefault {
			extra = lipgloss.NewStyle().Foreground(colorOverlay1).Render(" (default)")
		}
		lines = append(lines, prefix+swatch+" "+nameStyle.Render(cat.name)+extra)
	}
	if len(lines) == 0 {
		lines = append(lines, lipgloss.NewStyle().Foreground(colorOverlay1).Render("No categories."))
	}
	return strings.Join(lines, "\n")
}

func renderSettingsRules(m model, width int) string {
	var lines []string

	// Input mode overlays
	if m.settMode == settModeAddRule || m.settMode == settModeEditRule {
		label := "Add Rule"
		if m.settMode == settModeEditRule {
			label = "Edit Rule"
		}
		lines = append(lines, detailActiveStyle.Render(label))
		lines = append(lines, detailLabelStyle.Render("Pattern: ")+detailValueStyle.Render(m.settInput+"_"))
		lines = append(lines, scrollStyle.Render("Enter to pick category, Esc to cancel"))
		return strings.Join(lines, "\n")
	}

	if m.settMode == settModeRuleCat {
		lines = append(lines, detailActiveStyle.Render("Select Category for: ")+detailValueStyle.Render(m.settInput))
		for i, cat := range m.categories {
			prefix := "  "
			if i == m.settRuleCatIdx {
				prefix = cursorStyle.Render("> ")
			}
			style := lipgloss.NewStyle().Foreground(lipgloss.Color(cat.color))
			lines = append(lines, prefix+style.Render(cat.name))
		}
		return strings.Join(lines, "\n")
	}

	if len(m.rules) == 0 {
		return lipgloss.NewStyle().Foreground(colorOverlay1).Render("No rules. Activate to add.")
	}

	showCursor := m.settSection == settSecRules && m.settActive
	for i, rule := range m.rules {
		prefix := "  "
		if showCursor && i == m.settItemCursor {
			prefix = cursorStyle.Render("> ")
		}
		pattern := lipgloss.NewStyle().Foreground(colorPeach).Render(fmt.Sprintf("%q", rule.pattern))
		arrow := lipgloss.NewStyle().Foreground(colorOverlay1).Render(" -> ")
		catName := "?"
		catColor := colorOverlay1
		for _, c := range m.categories {
			if c.id == rule.categoryID {
				catName = c.name
				catColor = lipgloss.Color(c.color)
				break
			}
		}
		target := lipgloss.NewStyle().Foreground(catColor).Render(catName)
		lines = append(lines, prefix+pattern+arrow+target)
	}
	return strings.Join(lines, "\n")
}

func renderSettingsChart(m model, width int) string {
	var lines []string
	labelSty := lipgloss.NewStyle().Foreground(colorSubtext0)
	valSty := lipgloss.NewStyle().Foreground(colorPeach)
	now := time.Now()
	start, end := m.dashboardChartRange(now)
	days := int(end.Sub(start).Hours()/24) + 1
	minor := spendingMinorGridStep(days, 80)
	major := "weekly"
	switch spendingMajorModeForDays(days) {
	case spendingMajorMonth:
		major = "monthly"
	case spendingMajorQuarter:
		major = "quarterly"
	}

	lines = append(lines, labelSty.Render("Week boundary:  ")+valSty.Render(spendingWeekAnchorLabel(m.spendingWeekAnchor)))
	lines = append(lines, labelSty.Render("Timeframe:      ")+valSty.Render(dashTimeframeLabel(m.dashTimeframe)))
	lines = append(lines, labelSty.Render("History window: ")+valSty.Render(fmt.Sprintf("%d days", days)))
	lines = append(lines, labelSty.Render("Minor grid:     ")+valSty.Render(fmt.Sprintf("every %d day(s)", minor)))
	lines = append(lines, labelSty.Render("Major grid:     ")+valSty.Render(major))
	lines = append(lines, "")
	lines = append(lines, scrollStyle.Render("h/l or enter to toggle boundary"))

	_ = width
	return strings.Join(lines, "\n")
}

func renderSettingsDBImport(m model, width int) string {
	var lines []string
	info := m.dbInfo
	labelSty := lipgloss.NewStyle().Foreground(colorSubtext0)
	valSty := lipgloss.NewStyle().Foreground(colorPeach)

	// Database info
	lines = append(lines, labelSty.Render("Schema version:  ")+valSty.Render(fmt.Sprintf("v%d", info.schemaVersion)))
	lines = append(lines, labelSty.Render("Transactions:    ")+valSty.Render(fmt.Sprintf("%d", info.transactionCount)))
	lines = append(lines, labelSty.Render("Categories:      ")+valSty.Render(fmt.Sprintf("%d", info.categoryCount)))
	lines = append(lines, labelSty.Render("Rules:           ")+valSty.Render(fmt.Sprintf("%d", info.ruleCount)))
	lines = append(lines, labelSty.Render("Imports:         ")+valSty.Render(fmt.Sprintf("%d", info.importCount)))
	lines = append(lines, labelSty.Render("Rows per page:   ")+valSty.Render(fmt.Sprintf("%d", m.maxVisibleRows)))
	lines = append(lines, "")

	// Import history
	sepStyle := lipgloss.NewStyle().Foreground(colorSurface2)
	lines = append(lines, lipgloss.NewStyle().Foreground(colorSubtext1).Bold(true).Render("Import History"))
	lines = append(lines, sepStyle.Render(strings.Repeat("─", width)))

	if len(m.imports) == 0 {
		lines = append(lines, lipgloss.NewStyle().Foreground(colorOverlay1).Render("No imports yet."))
	} else {
		for _, imp := range m.imports {
			fname := lipgloss.NewStyle().Foreground(colorText).Render(imp.filename)
			count := valSty.Render(fmt.Sprintf("%d rows", imp.rowCount))
			date := lipgloss.NewStyle().Foreground(colorSubtext0).Render(imp.importedAt)
			lines = append(lines, fname+"  "+count+"  "+date)
		}
	}

	return strings.Join(lines, "\n")
}

// renderDetail renders the transaction detail modal content.
func renderDetail(txn transaction, categories []category, catCursor int, notes string, editing string) string {
	w := 50
	var lines []string

	lines = append(lines, detailLabelStyle.Render("Date:       ")+detailValueStyle.Render(txn.dateISO))
	amtStyle := detailValueStyle
	if txn.amount > 0 {
		amtStyle = creditStyle
	} else if txn.amount < 0 {
		amtStyle = debitStyle
	}
	lines = append(lines, detailLabelStyle.Render("Amount:     ")+amtStyle.Render(fmt.Sprintf("%.2f", txn.amount)))
	lines = append(lines, detailLabelStyle.Render("Description:")+detailValueStyle.Render(" "+truncate(txn.description, w-13)))
	lines = append(lines, "")

	// Category picker
	lines = append(lines, detailLabelStyle.Render("Category:"))
	for i, c := range categories {
		prefix := "  "
		style := lipgloss.NewStyle().Foreground(lipgloss.Color(c.color))
		if i == catCursor {
			prefix = cursorStyle.Render("> ")
			style = style.Bold(true)
		}
		lines = append(lines, prefix+style.Render(c.name))
	}
	lines = append(lines, "")

	// Notes
	notesLabel := detailLabelStyle.Render("Notes: ")
	if editing == "notes" {
		notesLabel = detailActiveStyle.Render("Notes: ")
		lines = append(lines, notesLabel+detailValueStyle.Render(notes+"_"))
	} else {
		display := notes
		if display == "" {
			display = "(empty — press n to edit)"
		}
		lines = append(lines, notesLabel+detailValueStyle.Render(display))
	}
	lines = append(lines, "")

	// Help
	if editing == "notes" {
		lines = append(lines, scrollStyle.Render("esc/enter done"))
	} else {
		lines = append(lines, scrollStyle.Render("j/k category  n notes  enter save  esc cancel"))
	}

	return strings.Join(lines, "\n")
}
