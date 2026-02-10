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
	"github.com/charmbracelet/x/ansi"
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

	cursorStyle         = lipgloss.NewStyle().Foreground(colorAccent).Bold(true)
	txnRowSelectedStyle = lipgloss.NewStyle().
				Background(colorSurface0)
	txnRowHighlightedStyle = lipgloss.NewStyle().
				Background(colorMantle)
	txnRowSelectedHighlightedStyle = lipgloss.NewStyle().
					Background(colorSurface1)
	txnRowCursorStyle = lipgloss.NewStyle().
				Background(colorSurface2).
				Bold(true)
	txnRowCursorSelectedStyle = lipgloss.NewStyle().
					Background(colorSurface2).
					Bold(true)
	txnRowCursorHighlightedStyle = lipgloss.NewStyle().
					Background(colorSurface2).
					Bold(true)
	txnRowCursorSelectedHighlightedStyle = lipgloss.NewStyle().
						Background(colorAccent).
						Foreground(colorBase).
						Bold(true)

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

var tabNames = []string{"Manager", "Dashboard", "Settings"}

// ---------------------------------------------------------------------------
// Section & chrome rendering
// ---------------------------------------------------------------------------

func renderHeader(appName string, activeTab, width int, accountLabel string) string {
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
	if strings.TrimSpace(accountLabel) != "" {
		acct := lipgloss.NewStyle().Foreground(colorSubtext0).Render(accountLabel)
		line1Content += "  " + acct
	}

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
	section := renderTitledSectionBox(title, content, sectionWidth, withSeparator)
	if m.width == 0 {
		return section
	}
	return lipgloss.Place(m.width, lipgloss.Height(section), align, lipgloss.Top, section)
}

func renderTitledSectionBox(title, content string, sectionWidth int, withSeparator bool) string {
	if sectionWidth < 4 {
		sectionWidth = 4
	}
	innerWidth := sectionWidth - 2 // excludes vertical borders
	contentWidth := innerWidth - 2 // excludes horizontal padding inside borders
	if contentWidth < 1 {          // guard small terminals
		contentWidth = 1
		innerWidth = contentWidth + 2
		sectionWidth = innerWidth + 2
	}

	borderStyle := lipgloss.NewStyle().Foreground(colorSurface1)
	sepStyle := lipgloss.NewStyle().Foreground(colorSurface2)
	v := borderStyle.Render("│")
	tl := borderStyle.Render("╭")
	tr := borderStyle.Render("╮")
	bl := borderStyle.Render("╰")
	br := borderStyle.Render("╯")

	titleText := " " + strings.TrimSpace(title) + " "
	if ansi.StringWidth(titleText) > innerWidth {
		titleText = " " + truncate(strings.TrimSpace(title), max(1, innerWidth-2)) + " "
	}
	titleRendered := titleStyle.Render(titleText)
	titleW := ansi.StringWidth(titleText)
	dashes := innerWidth - titleW
	if dashes < 0 {
		dashes = 0
	}
	leftDash := 1
	if dashes == 0 {
		leftDash = 0
	} else if leftDash > dashes {
		leftDash = dashes
	}
	rightDash := dashes - leftDash
	top := tl + borderStyle.Render(strings.Repeat("─", leftDash)) + titleRendered + borderStyle.Render(strings.Repeat("─", rightDash)) + tr

	lines := splitLines(content)
	if len(lines) == 0 {
		lines = []string{""}
	}

	out := []string{top}
	if withSeparator {
		sep := v + " " + sepStyle.Render(strings.Repeat("─", contentWidth)) + " " + v
		out = append(out, sep)
	}
	for _, line := range lines {
		row := v + " " + padRight(truncate(line, contentWidth), contentWidth) + " " + v
		out = append(out, row)
	}
	bottom := bl + borderStyle.Render(strings.Repeat("─", innerWidth)) + br
	out = append(out, bottom)
	return strings.Join(out, "\n")
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
		parts = append(parts, keyStyle.Render(prettyHelpKey(help.Key))+space+descStyle.Render(help.Desc))
	}
	content := strings.Join(parts, sep)

	if m.width == 0 {
		return footerStyle.Render(content)
	}
	return footerStyle.Width(m.width).Render(content)
}

func prettyHelpKey(k string) string {
	s := strings.TrimSpace(strings.ToLower(k))
	switch s {
	case "j/k":
		return "↑/↓"
	case "h/l":
		return "←/→"
	case "up/down":
		return "↑/↓"
	case "left/right":
		return "←/→"
	case "shift+up/down":
		return "⇧↑/⇧↓"
	case "ctrl+p", "ctrl+n":
		return "↑/↓"
	}
	s = strings.ReplaceAll(s, "up", "↑")
	s = strings.ReplaceAll(s, "down", "↓")
	s = strings.ReplaceAll(s, "left", "←")
	s = strings.ReplaceAll(s, "right", "→")
	return s
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

func renderDashboardControlsLine(chips, dateRange string, width int) string {
	if strings.TrimSpace(dateRange) == "" {
		return chips
	}
	labelSty := lipgloss.NewStyle().Foreground(colorSubtext0)
	valueSty := lipgloss.NewStyle().Foreground(colorPeach)
	rangeChunk := labelSty.Render("Date Range ") + valueSty.Render(dateRange)
	if width <= 0 {
		return chips + "  " + rangeChunk
	}
	chipsW := ansi.StringWidth(chips)
	rangeW := ansi.StringWidth(rangeChunk)
	if chipsW+2+rangeW <= width {
		gap := width - chipsW - rangeW
		if gap < 2 {
			gap = 2
		}
		return chips + strings.Repeat(" ", gap) + rangeChunk
	}
	return chips + "  " + rangeChunk
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
func renderTransactionTable(
	rows []transaction,
	categories []category,
	txnTags map[int][]tag,
	selectedRows map[int]bool,
	highlightedRows map[int]bool,
	cursorTxnID int,
	topIndex,
	visible,
	width int,
	sortCol int,
	sortAsc bool,
) string {
	dateW := 9 // dd-mm-yy = 8 chars + 1 pad
	amountW := 11
	catW := 0
	accountW := 0
	tagsW := 0
	descTargetW := 40
	showCats := categories != nil
	showTags := categories != nil
	showAccounts := hasMultipleAccountNames(rows)
	if showCats {
		catW = 14
	}
	if showAccounts {
		accountW = 14
	}
	sep := " "   // single-space column separator
	numCols := 3 // date amount desc
	if showAccounts {
		numCols++
	}
	if showCats {
		numCols++
	}
	if showTags {
		numCols++
	}
	numSeps := max(0, numCols-1)
	fixedWithoutTags := dateW + amountW + catW + accountW + numSeps
	avail := width - fixedWithoutTags
	descW := min(descTargetW, avail)
	if descW < 5 {
		descW = max(5, avail)
	}
	if showTags {
		tagsW = width - fixedWithoutTags - descW
		if tagsW < 1 {
			tagsW = 1
		}
	}

	// Build header with sort indicator
	dateLbl := addSortIndicator("Date", sortByDate, sortCol, sortAsc)
	amtLbl := addSortIndicator("Amount", sortByAmount, sortCol, sortAsc)
	descLbl := addSortIndicator("Description", sortByDescription, sortCol, sortAsc)

	var header string
	if showCats && showTags && showAccounts {
		catLbl := addSortIndicator("Category", sortByCategory, sortCol, sortAsc)
		header = fmt.Sprintf("%-*s"+sep+"%-*s"+sep+"%-*s"+sep+"%-*s"+sep+"%-*s"+sep+"%-*s", dateW, dateLbl, amountW, amtLbl, accountW, "Account", descW, descLbl, catW, catLbl, tagsW, "Tags")
	} else if showCats && showTags {
		catLbl := addSortIndicator("Category", sortByCategory, sortCol, sortAsc)
		header = fmt.Sprintf("%-*s"+sep+"%-*s"+sep+"%-*s"+sep+"%-*s"+sep+"%-*s", dateW, dateLbl, amountW, amtLbl, descW, descLbl, catW, catLbl, tagsW, "Tags")
	} else if showCats && showAccounts {
		catLbl := addSortIndicator("Category", sortByCategory, sortCol, sortAsc)
		header = fmt.Sprintf("%-*s"+sep+"%-*s"+sep+"%-*s"+sep+"%-*s"+sep+"%-*s", dateW, dateLbl, amountW, amtLbl, accountW, "Account", descW, descLbl, catW, catLbl)
	} else if showCats {
		catLbl := addSortIndicator("Category", sortByCategory, sortCol, sortAsc)
		header = fmt.Sprintf("%-*s"+sep+"%-*s"+sep+"%-*s"+sep+"%-*s", dateW, dateLbl, amountW, amtLbl, descW, descLbl, catW, catLbl)
	} else if showAccounts {
		header = fmt.Sprintf("%-*s"+sep+"%-*s"+sep+"%-*s"+sep+"%-*s", dateW, dateLbl, amountW, amtLbl, accountW, "Account", descW, descLbl)
	} else {
		header = fmt.Sprintf("%-*s"+sep+"%-*s"+sep+"%-*s", dateW, dateLbl, amountW, amtLbl, descW, descLbl)
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

		// Row state style with separate cursor overlay.
		selected := selectedRows != nil && selectedRows[row.id]
		highlighted := highlightedRows != nil && highlightedRows[row.id]
		isCursor := cursorTxnID != 0 && row.id == cursorTxnID
		rowBg, cursorStrong := rowStateBackgroundAndCursor(selected, highlighted, isCursor)
		cellStyle := lipgloss.NewStyle().Background(rowBg)
		if cursorStrong {
			cellStyle = cellStyle.Bold(true)
		}
		sepField := cellStyle.Render(sep)

		dateField := padRight(formatDateShort(row.dateISO), dateW)
		desc := truncateTxnDescription(row.description, descW)
		descField := padRight(desc, descW)

		var line string
		amountStyle := lipgloss.NewStyle().Background(rowBg)
		if cursorStrong {
			amountStyle = amountStyle.Bold(true)
		}
		if row.amount > 0 {
			amountStyle = amountStyle.Foreground(colorSuccess)
		} else if row.amount < 0 {
			amountStyle = amountStyle.Foreground(colorError)
		}
		amountField = amountStyle.Render(amountField)

		if showCats && showTags && showAccounts {
			catField := renderCategoryTagOnBackground(row.categoryName, row.categoryColor, catW, rowBg, cursorStrong)
			tagField := renderTagsOnBackground(txnTags[row.id], tagsW, rowBg, cursorStrong)
			accountField := cellStyle.Render(padRight(truncate(row.accountName, accountW), accountW))
			line = cellStyle.Render(dateField) + sepField + amountField + sepField + accountField + sepField + cellStyle.Render(descField) + sepField + catField + sepField + tagField
		} else if showCats && showTags {
			catField := renderCategoryTagOnBackground(row.categoryName, row.categoryColor, catW, rowBg, cursorStrong)
			tagField := renderTagsOnBackground(txnTags[row.id], tagsW, rowBg, cursorStrong)
			line = cellStyle.Render(dateField) + sepField + amountField + sepField + cellStyle.Render(descField) + sepField + catField + sepField + tagField
		} else if showCats && showAccounts {
			catField := renderCategoryTagOnBackground(row.categoryName, row.categoryColor, catW, rowBg, cursorStrong)
			accountField := cellStyle.Render(padRight(truncate(row.accountName, accountW), accountW))
			line = cellStyle.Render(dateField) + sepField + amountField + sepField + accountField + sepField + cellStyle.Render(descField) + sepField + catField
		} else if showCats {
			catField := renderCategoryTagOnBackground(row.categoryName, row.categoryColor, catW, rowBg, cursorStrong)
			line = cellStyle.Render(dateField) + sepField + amountField + sepField + cellStyle.Render(descField) + sepField + catField
		} else if showAccounts {
			accountField := cellStyle.Render(padRight(truncate(row.accountName, accountW), accountW))
			line = cellStyle.Render(dateField) + sepField + amountField + sepField + accountField + sepField + cellStyle.Render(descField)
		} else {
			line = cellStyle.Render(dateField) + sepField + amountField + sepField + cellStyle.Render(descField)
		}
		line = ansi.Truncate(line, width, "")
		// Ensure row backgrounds span the full table width.
		line = line + cellStyle.Render(strings.Repeat(" ", max(0, width-ansi.StringWidth(line))))
		lines = append(lines, line)
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

func hasMultipleAccountNames(rows []transaction) bool {
	seen := make(map[string]bool)
	for _, r := range rows {
		name := strings.TrimSpace(r.accountName)
		if name == "" {
			continue
		}
		seen[strings.ToLower(name)] = true
		if len(seen) > 1 {
			return true
		}
	}
	return false
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

func renderCategoryTagOnBackground(name, color string, width int, bg lipgloss.Color, bold bool) string {
	display := truncate(name, width-1)
	style := lipgloss.NewStyle().Background(bg)
	if bold {
		style = style.Bold(true)
	}
	if color == "" || color == "#7f849c" {
		style = style.Foreground(colorOverlay1)
	} else {
		style = style.Foreground(lipgloss.Color(color))
	}
	return style.Render(padRight(display, width))
}

func renderTagsOnBackground(tags []tag, width int, bg lipgloss.Color, bold bool) string {
	base := lipgloss.NewStyle().Background(bg)
	if bold {
		base = base.Bold(true)
	}
	if len(tags) == 0 {
		return base.Foreground(colorOverlay1).Render(padRight("-", width))
	}

	var parts []string
	for _, tg := range tags {
		s := base
		if strings.TrimSpace(tg.color) != "" {
			s = s.Foreground(lipgloss.Color(tg.color))
		} else {
			s = s.Foreground(colorSubtext0)
		}
		parts = append(parts, s.Render(tg.name))
	}
	joined := strings.Join(parts, base.Foreground(colorOverlay1).Render(","))
	if ansi.StringWidth(joined) > width {
		joined = ansi.Truncate(joined, width, "")
	}
	rem := width - ansi.StringWidth(joined)
	if rem > 0 {
		joined += base.Render(strings.Repeat(" ", rem))
	}
	return joined
}

func rowStateBackgroundAndCursor(selected, highlighted, isCursor bool) (lipgloss.Color, bool) {
	switch {
	case isCursor && selected && highlighted:
		return colorAccent, true
	case isCursor && selected:
		return colorSurface2, true
	case isCursor && highlighted:
		return colorSurface2, true
	case isCursor:
		return colorSurface2, true
	case selected && highlighted:
		return colorSurface1, false
	case selected:
		return colorSurface0, false
	case highlighted:
		return colorMantle, false
	default:
		return "", false
	}
}

// ---------------------------------------------------------------------------
// Dashboard widgets
// ---------------------------------------------------------------------------

// renderSummaryCards renders the summary cards: balance, income, expenses,
// transaction count, uncategorised count/amount.
func renderSummaryCards(rows []transaction, categories []category, width int) string {
	var income, expenses float64
	var uncatCount int
	var uncatTotal float64
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
	}
	balance := income + expenses

	_ = categories
	labelSty := lipgloss.NewStyle().Foreground(colorSubtext0)
	valSty := lipgloss.NewStyle().Foreground(colorPeach)
	greenSty := lipgloss.NewStyle().Foreground(colorSuccess)
	redSty := lipgloss.NewStyle().Foreground(colorError)

	// 3 rows, 2 columns
	col1W := 32
	col2W := width - col1W
	if col2W < 16 {
		col2W = 16
	}

	debits := math.Abs(expenses)
	credits := income

	row1 := padRight(labelSty.Render("Balance      ")+balanceStyle(balance, greenSty, redSty), col1W) +
		padRight(labelSty.Render("Uncat ")+valSty.Render(fmt.Sprintf("%d (%s)", uncatCount, formatMoney(uncatTotal))), col2W)

	row2 := padRight(labelSty.Render("Debits       ")+redSty.Render(formatMoney(debits)), col1W) +
		padRight(labelSty.Render("Transactions ")+valSty.Render(fmt.Sprintf("%d", len(rows))), col2W)

	row3 := padRight(labelSty.Render("Credits      ")+greenSty.Render(formatMoney(credits)), col1W) +
		padRight("", col2W)

	return row1 + "\n" + row2 + "\n" + row3
}

func dashboardDateRange(rows []transaction) string {
	var minDate, maxDate string
	for _, r := range rows {
		if minDate == "" || r.dateISO < minDate {
			minDate = r.dateISO
		}
		if maxDate == "" || r.dateISO > maxDate {
			maxDate = r.dateISO
		}
	}
	if minDate == "" {
		return "—"
	}
	return formatMonth(minDate) + " – " + formatMonth(maxDate)
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
// All known categories are shown, sorted by spend descending.
func renderCategoryBreakdown(rows []transaction, categories []category, width int) string {
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

	// Ensure every known category appears, even if absent in the current period.
	for _, c := range categories {
		name := strings.TrimSpace(c.name)
		if name == "" {
			continue
		}
		if _, ok := spendMap[name]; !ok {
			spendMap[name] = &categorySpend{name: name, color: c.color, amount: 0}
		}
	}
	if _, ok := spendMap["Uncategorised"]; !ok {
		spendMap["Uncategorised"] = &categorySpend{name: "Uncategorised", color: "", amount: 0}
	}

	if len(spendMap) == 0 {
		return lipgloss.NewStyle().Foreground(colorOverlay1).Render("No category data to display.")
	}

	// Sort by amount descending
	var sorted []categorySpend
	for _, s := range spendMap {
		sorted = append(sorted, *s)
	}
	sort.Slice(sorted, func(i, j int) bool {
		if sorted[i].amount != sorted[j].amount {
			return sorted[i].amount > sorted[j].amount
		}
		return strings.ToLower(sorted[i].name) < strings.ToLower(sorted[j].name)
	})

	display := sorted
	maxAmount := 0.0
	for _, s := range display {
		if s.amount > maxAmount {
			maxAmount = s.amount
		}
	}
	if maxAmount <= 0 {
		maxAmount = 1
	}

	// Render bars: give more width to names while keeping the bar useful.
	if width < 24 {
		width = 24
	}
	pctW := 4 // e.g. " 42%"
	amtW := 0
	for _, s := range display {
		w := len("$" + formatWholeNumber(s.amount))
		if w > amtW {
			amtW = w
		}
	}
	if amtW < 2 {
		amtW = 2
	}
	// columns: [name][bar][ ][pct][ ][amount]
	minBarW := 1
	available := width - (1 + pctW + 1 + amtW)
	if available < 0 {
		available = 0
	}
	maxNameW := 26 // cap so very long custom names don't consume the chart
	longestNameW := 0
	for _, s := range display {
		if w := len(s.name); w > longestNameW {
			longestNameW = w
		}
	}
	nameW := longestNameW + 2 // a little breathing room before bars
	if nameW > maxNameW {
		nameW = maxNameW
	}
	minNameW := 4
	if nameW < minNameW {
		nameW = minNameW
	}
	maxNameForBar := available - minBarW
	if nameW > maxNameForBar {
		nameW = maxNameForBar
	}
	if nameW < 0 {
		nameW = 0
	}
	barW := available - nameW
	if barW < minBarW {
		need := minBarW - barW
		if nameW >= need {
			nameW -= need
			barW = minBarW
		} else {
			barW = 0
			nameW = available
		}
	}

	var lines []string
	for _, s := range display {
		pct := 0.0
		if totalExpenses > 0 {
			pct = s.amount / totalExpenses * 100
		}
		pctText := fmt.Sprintf("%4.0f%%", pct)
		amtText := fmt.Sprintf("%*s", amtW, "$"+formatWholeNumber(s.amount))
		reservedRight := 1 + ansi.StringWidth(pctText) + 1 + ansi.StringWidth(amtText)
		availableLeft := width - reservedRight
		if availableLeft < 0 {
			availableLeft = 0
		}

		rowNameW := nameW
		if rowNameW > availableLeft-minBarW {
			rowNameW = availableLeft - minBarW
		}
		if rowNameW < 0 {
			rowNameW = 0
		}
		rowBarW := availableLeft - rowNameW
		if rowBarW < 0 {
			rowBarW = 0
		}

		ratio := s.amount / maxAmount
		filled := int(math.Round(float64(rowBarW) * ratio))
		if ratio >= 0.999999 {
			filled = rowBarW
		}
		if filled < 1 && s.amount > 0 && rowBarW > 0 {
			filled = 1
		}
		if filled > rowBarW {
			filled = rowBarW
		}
		if filled < 0 {
			filled = 0
		}
		empty := rowBarW - filled

		catColor := lipgloss.Color(s.color)
		if s.color == "" {
			catColor = colorOverlay1
		}

		nameSty := lipgloss.NewStyle().Foreground(catColor)
		barFilled := lipgloss.NewStyle().Foreground(catColor).Render(strings.Repeat("█", filled))
		barEmpty := lipgloss.NewStyle().Foreground(colorSurface2).Render(strings.Repeat("░", empty))
		pctStr := lipgloss.NewStyle().Foreground(colorSubtext0).Render(pctText)
		amtStr := lipgloss.NewStyle().Foreground(colorPeach).Render(amtText)

		nameText := ""
		if rowNameW > 0 {
			nameText = padRight(nameSty.Render(truncate(s.name, rowNameW)), rowNameW)
		}
		line := nameText +
			barFilled + barEmpty + " " + pctStr + " " + amtStr
		for ansi.StringWidth(line) > width {
			if rowBarW > 0 {
				rowBarW--
				if filled > rowBarW {
					filled = rowBarW
				}
				empty = rowBarW - filled
				barFilled = lipgloss.NewStyle().Foreground(catColor).Render(strings.Repeat("█", filled))
				barEmpty = lipgloss.NewStyle().Foreground(colorSurface2).Render(strings.Repeat("░", empty))
			} else if rowNameW > 0 {
				rowNameW--
				nameText = padRight(nameSty.Render(truncate(s.name, rowNameW)), rowNameW)
			} else {
				break
			}
			line = nameText + barFilled + barEmpty + " " + pctStr + " " + amtStr
		}
		line = padRight(line, width)
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

func truncateTxnDescription(desc string, cellWidth int) string {
	return truncate(desc, min(cellWidth, 40))
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

	// Left column: Categories + Tags + Rules (stacked)
	catContent := renderSettingsCategories(m, leftWidth-4)
	catBox := renderSettingsSectionBox("Categories", settSecCategories, m, leftWidth, catContent)

	tagsContent := renderSettingsTags(m, leftWidth-4)
	tagsBox := renderSettingsSectionBox("Tags", settSecTags, m, leftWidth, tagsContent)

	rulesContent := renderSettingsRules(m, leftWidth-4)
	rulesBox := renderSettingsSectionBox("Rules", settSecRules, m, leftWidth, rulesContent)

	leftCol := catBox + "\n" + tagsBox + "\n" + rulesBox

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

func renderManagerSectionBox(title string, isFocused, isActive bool, width int, content string) string {
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
	body := header + "\n" + content
	return style.Width(width).Render(body)
}

func renderManagerAccountStrip(m model, showCursor bool, width int) string {
	if len(m.accounts) == 0 {
		return lipgloss.NewStyle().Foreground(colorOverlay1).Render("No accounts yet. Press 'a' to create one.")
	}
	focused := m.managerFocusedIndex()
	parts := make([]string, 0, len(m.accounts))
	for i, acc := range m.accounts {
		name := truncate(acc.name, 18)
		typeColor := colorSubtext1
		if acc.acctType == "credit" {
			typeColor = colorPeach
		}
		scopeOn := len(m.filterAccounts) == 0 || m.filterAccounts[acc.id]
		scopeText := "Off"
		scopeColor := colorOverlay1
		if scopeOn {
			scopeText = "On"
			scopeColor = colorSuccess
		}
		chip := lipgloss.NewStyle().
			Foreground(colorText).
			Render(name) + " " +
			lipgloss.NewStyle().Foreground(typeColor).Render(strings.ToUpper(acc.acctType)) + " " +
			lipgloss.NewStyle().Foreground(scopeColor).Render("Scope:"+scopeText)
		if showCursor && i == focused {
			chip = cursorStyle.Render("▸ ") + chip
		} else {
			chip = "  " + chip
		}
		parts = append(parts, chip)
	}
	line := strings.Join(parts, "   ")
	return ansi.Truncate(line, width, "")
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

func renderSettingsTags(m model, width int) string {
	var lines []string

	if m.settMode == settModeAddTag || m.settMode == settModeEditTag {
		label := "Add Tag"
		if m.settMode == settModeEditTag {
			label = "Edit Tag"
		}
		lines = append(lines, detailActiveStyle.Render(label))
		lines = append(lines, detailLabelStyle.Render("Name: ")+detailValueStyle.Render(m.settInput+"_"))
		colors := TagAccentColors()
		var colorRow string
		for i, c := range colors {
			swatch := lipgloss.NewStyle().Foreground(c).Render("■")
			if i == m.settColorIdx {
				swatch = lipgloss.NewStyle().Foreground(c).Bold(true).Render("[■]")
			}
			colorRow += swatch + " "
		}
		lines = append(lines, detailLabelStyle.Render("Color: ")+colorRow)
		_ = width
		return strings.Join(lines, "\n")
	}

	showCursor := m.settSection == settSecTags && m.settActive
	for i, tg := range m.tags {
		prefix := "  "
		if showCursor && i == m.settItemCursor {
			prefix = cursorStyle.Render("> ")
		}
		swatch := lipgloss.NewStyle().Foreground(lipgloss.Color(tg.color)).Render("■")
		nameStyle := lipgloss.NewStyle().Foreground(colorText)
		lines = append(lines, prefix+swatch+" "+nameStyle.Render(tg.name))
	}
	if len(lines) == 0 {
		lines = append(lines, lipgloss.NewStyle().Foreground(colorOverlay1).Render("No tags. Activate to add."))
	}
	_ = width
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
	lines = append(lines, labelSty.Render("Tags:            ")+valSty.Render(fmt.Sprintf("%d", info.tagCount)))
	lines = append(lines, labelSty.Render("Tag Rules:       ")+valSty.Render(fmt.Sprintf("%d", info.tagRuleCount)))
	lines = append(lines, labelSty.Render("Imports:         ")+valSty.Render(fmt.Sprintf("%d", info.importCount)))
	lines = append(lines, labelSty.Render("Accounts:        ")+valSty.Render(fmt.Sprintf("%d", info.accountCount)))
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

func renderManagerContent(m model, showCursor bool) string {
	if len(m.accounts) == 0 {
		return lipgloss.NewStyle().Foreground(colorOverlay1).Render("No accounts yet. Press 'a' to create one.")
	}

	cardStyle := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(colorSurface1).
		Padding(0, 1)
	activeCardStyle := cardStyle.Copy().BorderForeground(colorAccent)
	focused := m.managerFocusedIndex()

	var cards []string
	for i, acc := range m.accounts {
		style := cardStyle
		if showCursor && i == focused {
			style = activeCardStyle
		}
		isSelected := len(m.filterAccounts) == 0 || m.filterAccounts[acc.id]
		sel := "Scope: Off"
		selColor := colorOverlay1
		if isSelected {
			sel = "Scope: On"
			selColor = colorSuccess
		}
		typeColor := colorSubtext1
		if acc.acctType == "credit" {
			typeColor = colorPeach
		}
		headerPrefix := "  "
		if showCursor && i == focused {
			headerPrefix = "> "
		}
		header := lipgloss.NewStyle().Bold(true).Foreground(colorText).Render(headerPrefix + acc.name)
		meta := lipgloss.NewStyle().Foreground(typeColor).Render(strings.ToUpper(acc.acctType))
		activePill := lipgloss.NewStyle().Foreground(selColor).Render(sel)
		body := header + "  " + meta + "  " + activePill
		cards = append(cards, style.Render(body))
	}
	return strings.Join(cards, "\n")
}

func renderManagerAccountModal(m model) string {
	label := "Edit Account"
	if m.managerModalIsNew {
		label = "Create Account"
	}

	var lines []string
	lines = append(lines, detailActiveStyle.Render(label))
	if len(m.accounts) == 0 {
		// keep lint happy for zero-account new flow; modal itself still renders fields
	}

	nameVal := m.managerEditName
	if m.managerEditFocus == 0 {
		nameVal += "_"
	}
	typeVal := strings.ToUpper(m.managerEditType)
	activeVal := "false"
	if m.managerEditActive {
		activeVal = "true"
	}
	prefixVal := m.managerEditPrefix
	if m.managerEditFocus == 2 {
		prefixVal += "_"
	}

	pfx0 := "  "
	pfx1 := "  "
	pfx2 := "  "
	pfx3 := "  "
	if m.managerEditFocus == 0 {
		pfx0 = cursorStyle.Render("> ")
	}
	if m.managerEditFocus == 1 {
		pfx1 = cursorStyle.Render("> ")
	}
	if m.managerEditFocus == 2 {
		pfx2 = cursorStyle.Render("> ")
	}
	if m.managerEditFocus == 3 {
		pfx3 = cursorStyle.Render("> ")
	}

	lines = append(lines, pfx0+detailLabelStyle.Render("Name:         ")+detailValueStyle.Render(nameVal))
	lines = append(lines, pfx1+detailLabelStyle.Render("Type:         ")+detailValueStyle.Render(typeVal))
	lines = append(lines, pfx2+detailLabelStyle.Render("Import Prefix:")+detailValueStyle.Render(" "+prefixVal))
	lines = append(lines, pfx3+detailLabelStyle.Render("Is Active:    ")+detailValueStyle.Render(activeVal))
	lines = append(lines, "")
	lines = append(lines, scrollStyle.Render("j/k field  h/l or space toggle  enter save  esc cancel"))
	return strings.Join(lines, "\n")
}

// renderDetail renders the transaction detail modal content.
func renderDetail(txn transaction, categories []category, tags []tag, catCursor int, notes string, editing string) string {
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

	if len(tags) > 0 {
		var names []string
		for _, tg := range tags {
			names = append(names, tg.name)
		}
		lines = append(lines, detailLabelStyle.Render("Tags:       ")+detailValueStyle.Render(strings.Join(names, " ")))
		lines = append(lines, "")
	}

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
