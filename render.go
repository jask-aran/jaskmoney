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

	// Generic informational pairs and section chrome
	infoLabelStyle      = lipgloss.NewStyle().Foreground(colorSubtext0)
	infoValueStyle      = lipgloss.NewStyle().Foreground(colorPeach)
	sectionDividerStyle = lipgloss.NewStyle().Foreground(colorSurface2)
	sectionTitleStyle   = lipgloss.NewStyle().Foreground(colorSubtext1).Bold(true)

	// Footer bar
	footerStyle = lipgloss.NewStyle().
			Foreground(colorSubtext0).
			Background(colorMantle).
			Padding(0, 1)

	// Status bar (above footer)
	statusBarStyle = lipgloss.NewStyle().
			Foreground(colorSubtext1).
			Background(colorSurface0).
			Padding(0, 1)

	// Error status bar
	statusBarErrStyle = lipgloss.NewStyle().
				Foreground(colorError).
				Background(colorSurface0).
				Padding(0, 1)

	// Section containers
	listBoxStyle = lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(colorSurface1).
			Padding(0, 0)

	// Modal overlay
	modalStyle = lipgloss.NewStyle().
			Foreground(colorRosewater).
			Padding(0, 0)

	modalBorderStyle = lipgloss.NewStyle().
				Foreground(colorPink)

	modalBodyStyle = lipgloss.NewStyle().
			Foreground(colorRosewater)

	// Help key styling — these inherit footer background via Inherit()
	helpKeyStyle = lipgloss.NewStyle().
			Foreground(colorAccent).
			Bold(true)

	helpDescStyle = lipgloss.NewStyle().
			Foreground(colorSubtext0)

	modalTitleStyle = lipgloss.NewStyle().
			Foreground(colorAccent).
			Bold(true)

	modalFooterStyle = lipgloss.NewStyle().
				Foreground(colorOverlay1)

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

	// Detail modal
	detailLabelStyle  = lipgloss.NewStyle().Foreground(colorSubtext0)
	detailValueStyle  = lipgloss.NewStyle().Foreground(colorText)
	detailActiveStyle = lipgloss.NewStyle().Foreground(colorAccent).Bold(true)

	commandLabelStyle        = lipgloss.NewStyle().Foreground(colorText)
	commandDescStyle         = lipgloss.NewStyle().Foreground(colorOverlay1)
	commandDisabledStyle     = lipgloss.NewStyle().Foreground(colorOverlay0)
	commandSelectedLineStyle = lipgloss.NewStyle().Background(colorSurface1)
)

// ---------------------------------------------------------------------------
// Tab names
// ---------------------------------------------------------------------------

var tabNames = []string{"Dashboard", "Budget", "Manager", "Settings"}

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
	innerWidth := width - headerBarStyle.GetHorizontalFrameSize()
	if innerWidth < 1 {
		innerWidth = 1
	}
	line1Content = ansi.Truncate(line1Content, innerWidth, "")
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
	return renderSectionBox(title, content, sectionWidth, withSeparator, colorSurface1, titleStyle)
}

func renderSectionBox(title, content string, sectionWidth int, withSeparator bool, borderColor lipgloss.Color, titleSty lipgloss.Style) string {
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

	borderStyle := lipgloss.NewStyle().Foreground(borderColor)
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
	titleRendered := titleSty.Render(titleText)
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
	innerWidth := m.width - footerStyle.GetHorizontalFrameSize()
	if innerWidth < 1 {
		innerWidth = 1
	}
	content = ansi.Truncate(content, innerWidth, "")
	return footerStyle.Width(m.width).Render(content)
}

func (m model) renderCommandFooter() string {
	query := m.commandQuery
	if query == "" {
		query = ""
	}
	content := searchPromptStyle.Render(":") + " " + searchInputStyle.Render(query+"_")
	if m.width == 0 {
		return footerStyle.Render(content)
	}
	innerWidth := m.width - footerStyle.GetHorizontalFrameSize()
	if innerWidth < 1 {
		innerWidth = 1
	}
	content = ansi.Truncate(content, innerWidth, "")
	return footerStyle.Width(m.width).Render(content)
}

func commandModalContentWidth(width, maxWidth int) int {
	if width <= 0 {
		return 0
	}
	if maxWidth > 0 {
		width = min(width, maxWidth)
	}
	width = max(width, 18)
	return width
}

func renderCommandPalette(query string, matches []CommandMatch, cursor, offset, limit, width int, keys *KeyRegistry) string {
	contentWidth := commandModalContentWidth(width, 76)
	lines := make([]string, 0, 14)
	searchValue := lipgloss.NewStyle().Foreground(colorOverlay1).Render("(type to filter)")
	if strings.TrimSpace(query) != "" {
		searchValue = searchInputStyle.Render(query)
	}
	search := infoLabelStyle.Render("Filter: ") + searchValue
	if contentWidth > 0 {
		search = padStyledLine(search, contentWidth)
	}
	lines = append(lines, search)
	visibleRows, hasAbove, hasBelow := renderCommandRowsWindow(matches, cursor, offset, contentWidth, limit)
	if hasAbove {
		lines = append(lines, modalFooterStyle.Render("↑ more"))
	}
	for i := range visibleRows {
		lines = append(lines, visibleRows[i]...)
		if i < len(visibleRows)-1 {
			lines = append(lines, "")
		}
	}
	if hasBelow {
		lines = append(lines, modalFooterStyle.Render("↓ more"))
	}
	footer := strings.Join([]string{
		renderActionHint(keys, scopeCommandPalette, actionDown, "j", "move"),
		renderActionHint(keys, scopeCommandPalette, actionSelect, "enter", "select"),
		renderActionHint(keys, scopeCommandPalette, actionClose, "esc", "close"),
	}, "  ")
	return renderModalContentWithWidth("Commands", lines, footer, contentWidth)
}

func renderCommandSuggestions(matches []CommandMatch, cursor, offset, width, limit int) string {
	if limit <= 0 {
		limit = 5
	}
	contentWidth := commandModalContentWidth(width-2, 0)
	lines, _, _ := renderCommandLinesWindow(matches, cursor, offset, contentWidth, limit)
	if len(lines) == 0 {
		return ""
	}
	return renderModalContentWithWidth("Commands", lines, "", contentWidth)
}

func renderJumpOverlay(targets []jumpTarget) string {
	lines := make([]string, 0, len(targets)+1)
	lines = append(lines, lipgloss.NewStyle().Foreground(colorSubtext0).Render("Select a target:"))
	for _, target := range targets {
		badge := lipgloss.NewStyle().
			Foreground(colorBase).
			Background(colorAccent).
			Bold(true).
			Render("[" + strings.ToLower(target.Key) + "]")
		label := lipgloss.NewStyle().Foreground(colorText).Render(target.Label)
		lines = append(lines, badge+" "+label)
	}
	footer := "Jump: press key to focus. ESC cancel."
	return renderModalContent("Jump Mode", lines, footer)
}

func renderCommandLinesWindow(matches []CommandMatch, cursor, offset, width, limit int) ([]string, bool, bool) {
	rows, hasAbove, hasBelow := renderCommandRowsWindow(matches, cursor, offset, width, limit)
	lines := make([]string, 0, len(rows))
	for i := range rows {
		lines = append(lines, rows[i]...)
	}
	return lines, hasAbove, hasBelow
}

func renderCommandRowsWindow(matches []CommandMatch, cursor, offset, width, limit int) ([][]string, bool, bool) {
	if len(matches) == 0 {
		line := commandDisabledStyle.Render("No matching commands")
		if width > 0 {
			line = padStyledLine(line, width)
		}
		return [][]string{{line}}, false, false
	}
	start, end, hasAbove, hasBelow := pickerWindowBounds(len(matches), cursor, offset, limit)
	rows := make([][]string, 0, end-start)
	for i := start; i < end; i++ {
		match := matches[i]
		rows = append(rows, renderWrappedCommandMatchLines(match, i == cursor, width))
	}
	return rows, hasAbove, hasBelow
}

func renderWrappedCommandMatchLines(match CommandMatch, isCursor bool, width int) []string {
	prefix := modalCursor(isCursor)
	labelText := strings.TrimSpace(match.Command.Label)
	if !match.Enabled {
		labelText += " (disabled)"
	}
	labelStyle := commandLabelStyle
	if !match.Enabled {
		labelStyle = commandDisabledStyle
	}
	descStyle := commandDescStyle
	if isCursor {
		labelStyle = labelStyle.Bold(true)
		descStyle = descStyle.Bold(true)
	}
	label := labelStyle.Render(labelText)
	desc := strings.TrimSpace(match.Command.Description)

	rowLines := make([]string, 0, 4)
	if desc == "" || width <= 0 {
		row := stylePickerRow(prefix+label, false, isCursor, width, true)
		return []string{row}
	}

	sep := " · "
	firstAvail := width - ansi.StringWidth(prefix) - ansi.StringWidth(labelText) - ansi.StringWidth(sep)
	contPrefix := strings.Repeat(" ", ansi.StringWidth(prefix))
	contMarker := "↳ "
	contAvail := width - ansi.StringWidth(contPrefix) - ansi.StringWidth(contMarker)
	if contAvail < 1 {
		contAvail = 1
	}

	// Render first-line description segment when it fits; otherwise carry the full
	// description to continuation lines to keep visual boundaries clean.
	if firstAvail > 0 {
		firstDesc, contDesc := wrapWordsWithFirstWidth(desc, firstAvail, contAvail)
		if firstDesc != "" {
			firstRow := prefix + label + descStyle.Render(sep+firstDesc)
			rowLines = append(rowLines, stylePickerRow(firstRow, false, isCursor, width, true))
		} else {
			firstRow := prefix + label
			rowLines = append(rowLines, stylePickerRow(firstRow, false, isCursor, width, true))
		}
		for i := range contDesc {
			marker := "  "
			if i == 0 {
				marker = contMarker
			}
			line := contPrefix + descStyle.Render(marker+contDesc[i])
			rowLines = append(rowLines, stylePickerRow(line, false, isCursor, width, true))
		}
		return rowLines
	}

	firstRow := prefix + label
	rowLines = append(rowLines, stylePickerRow(firstRow, false, isCursor, width, true))
	descLines := splitLines(wrapText(desc, contAvail))
	for i := range descLines {
		marker := "  "
		if i == 0 {
			marker = contMarker
		}
		line := contPrefix + descStyle.Render(marker+descLines[i])
		rowLines = append(rowLines, stylePickerRow(line, false, isCursor, width, true))
	}
	return rowLines
}

func wrapWordsWithFirstWidth(text string, firstWidth, contWidth int) (first string, cont []string) {
	text = strings.TrimSpace(text)
	if text == "" {
		return "", nil
	}
	if firstWidth < 1 {
		firstWidth = 1
	}
	if contWidth < 1 {
		contWidth = 1
	}

	words := strings.Fields(text)
	if len(words) == 0 {
		return "", nil
	}

	lines := make([]string, 0, len(words))
	limit := firstWidth
	current := ""
	appendCurrent := func() {
		if current == "" {
			return
		}
		lines = append(lines, current)
		current = ""
	}

	for _, rawWord := range words {
		word := rawWord
		for {
			if current == "" {
				if ansi.StringWidth(word) <= limit {
					current = word
					break
				}
				part, rest := splitWordAtWidth(word, limit)
				if part == "" {
					break
				}
				lines = append(lines, part)
				word = rest
				limit = contWidth
				if strings.TrimSpace(word) == "" {
					break
				}
				continue
			}
			candidate := current + " " + word
			if ansi.StringWidth(candidate) <= limit {
				current = candidate
				break
			}
			appendCurrent()
			limit = contWidth
		}
		if strings.TrimSpace(word) == "" {
			limit = contWidth
		}
	}
	appendCurrent()
	if len(lines) == 0 {
		return "", nil
	}
	return lines[0], lines[1:]
}

func splitWordAtWidth(word string, width int) (fit string, rest string) {
	if width < 1 || strings.TrimSpace(word) == "" {
		return "", word
	}
	currentWidth := 0
	splitAt := -1
	for idx, r := range word {
		rw := ansi.StringWidth(string(r))
		if currentWidth+rw > width {
			splitAt = idx
			break
		}
		currentWidth += rw
	}
	if splitAt == -1 {
		return word, ""
	}
	return word[:splitAt], word[splitAt:]
}

func prettyHelpKey(k string) string {
	s := strings.TrimSpace(k)
	// Single uppercase letter = Shift+letter (e.g. "K" means Shift+K).
	// Display as "S-k" to distinguish from lowercase.
	if len(s) == 1 && s[0] >= 'A' && s[0] <= 'Z' {
		return "S-" + strings.ToLower(s)
	}
	s = strings.ToLower(s)
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
	innerWidth := m.width - style.GetHorizontalFrameSize()
	if innerWidth < 1 {
		innerWidth = 1
	}
	flat = ansi.Truncate(flat, innerWidth, "")
	return style.Width(m.width).Render(flat)
}

func renderDatePresetChips(labels []string, active, cursor int, focused bool) string {
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

func renderDashboardTimeframeValue(m model, rows []transaction, now time.Time) string {
	if m.dashMonthMode {
		month := m.dashboardBudgetMonth()
		if start, _, err := parseMonthKey(month); err == nil {
			return start.Format("January 2006")
		}
		return month
	}
	start, endExcl, ok := m.dashboardTimeframeBounds(now)
	return dashboardDateRangeFromBounds(rows, start, endExcl, ok)
}

func renderDashboardDatePane(m model, rows []transaction, width int) string {
	now := time.Now()
	activePreset := m.dashTimeframe
	if m.dashMonthMode {
		activePreset = -1
	}
	presets := infoLabelStyle.Render("Presets  ") + renderDatePresetChips(dashTimeframeLabels, activePreset, m.dashTimeframeCursor, m.dashTimeframeFocus)
	timeframe := infoLabelStyle.Render("Timeframe  ") + infoValueStyle.Render(renderDashboardTimeframeValue(m, rows, now))
	lines := []string{renderDatePaneInline(presets, timeframe, width-4)}
	if custom := renderDashboardCustomInputInline(m.dashCustomStart, m.dashCustomEnd, m.dashCustomInput, m.dashCustomEditing); custom != "" {
		lines = append(lines, custom)
	}
	return renderManagerSectionBox("Date Range", m.dashTimeframeFocus, m.dashCustomEditing, width, strings.Join(lines, "\n"))
}

func renderBudgetDatePane(m model, width int) string {
	timeframeValue := m.budgetMonth
	if start, _, err := parseMonthKey(m.budgetMonth); err == nil {
		timeframeValue = start.Format("January 2006")
	}
	line := infoLabelStyle.Render("Timeframe  ") + infoValueStyle.Render(timeframeValue)
	return renderManagerSectionBox("Date Range", false, false, width, line)
}

func renderDatePaneInline(left, right string, width int) string {
	if strings.TrimSpace(right) == "" {
		return left
	}
	if width <= 0 {
		return left + "  " + right
	}
	leftW := ansi.StringWidth(left)
	rightW := ansi.StringWidth(right)
	if leftW+2+rightW <= width {
		gap := width - leftW - rightW
		if gap < 2 {
			gap = 2
		}
		return left + strings.Repeat(" ", gap) + right
	}
	return left + "  " + right
}

func renderDashboardCustomInputInline(start, end, input string, editing bool) string {
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
	fields := labelStyle.Render("Custom Range: ") +
		valueStyle.Render("Start ") + valueStyle.Render(startText) + "  " +
		valueStyle.Render("End ") + valueStyle.Render(endText)
	return fields
}

func actionKeyLabel(keys *KeyRegistry, scope string, action Action, fallback string) string {
	if keys == nil {
		return fallback
	}
	for _, b := range keys.BindingsForScope(scope) {
		if b.Action == action && len(b.Keys) > 0 {
			return prettyHelpKey(b.Keys[0])
		}
	}
	return prettyHelpKey(fallback)
}

func renderActionHint(keys *KeyRegistry, scope string, action Action, fallback, desc string) string {
	return helpKeyStyle.Render(actionKeyLabel(keys, scope, action, fallback)) + helpDescStyle.Render(" "+desc)
}

func modalCursor(active bool) string {
	if active {
		return cursorStyle.Render("> ")
	}
	return "  "
}

func renderInfoPair(label, value string) string {
	return infoLabelStyle.Render(label) + infoValueStyle.Render(value)
}

func renderModalContent(title string, body []string, footer string) string {
	return renderModalContentWithWidth(title, body, footer, 0)
}

func renderModalContentWithWidth(title string, body []string, footer string, fixedWidth int) string {
	lines := make([]string, 0, len(body)+3)
	lines = append(lines, body...)
	if strings.TrimSpace(footer) != "" {
		lines = append(lines, "")
		lines = append(lines, modalFooterStyle.Render(footer))
	}

	contentWidth := fixedWidth
	if contentWidth <= 0 {
		contentWidth = max(18, ansi.StringWidth(ansi.Strip(title))+2)
		for _, line := range lines {
			contentWidth = max(contentWidth, ansi.StringWidth(line))
		}
		contentWidth = min(contentWidth, 56)
	}
	contentWidth = max(contentWidth, 18)

	titleText := " " + ansi.Strip(title) + " "
	titleRunes := []rune(titleText)
	avail := contentWidth
	if len(titleRunes) > avail {
		titleText = string(titleRunes[:avail])
	}
	leftPad := max(0, (contentWidth-ansi.StringWidth(titleText))/2)
	rightPad := max(0, contentWidth-ansi.StringWidth(titleText)-leftPad)
	top := "╭" + strings.Repeat("─", leftPad) + modalTitleStyle.Render(titleText) + strings.Repeat("─", rightPad) + "╮"
	bottom := "╰" + strings.Repeat("─", contentWidth) + "╯"

	framed := make([]string, 0, len(lines)+2)
	framed = append(framed, modalBorderStyle.Render(top))
	for _, line := range lines {
		padded := padStyledLine(line, contentWidth)
		framed = append(framed, modalBorderStyle.Render("│")+modalBodyStyle.Render(padded)+modalBorderStyle.Render("│"))
	}
	framed = append(framed, modalBorderStyle.Render(bottom))
	return strings.Join(framed, "\n")
}

func renderQuickOffsetModal(m model) string {
	targetCount := len(m.quickOffsetFor)
	targetLabel := fmt.Sprintf("%d transaction(s)", targetCount)
	if targetCount == 1 {
		targetLabel = "1 transaction"
	}
	body := []string{
		detailLabelStyle.Render("Apply offset to: ") + detailValueStyle.Render(targetLabel),
		detailActiveStyle.Render("Offset amount: ") + detailValueStyle.Render(renderASCIIInputCursor(m.quickOffsetAmount, m.quickOffsetCursor)),
	}
	footer := strings.Join([]string{
		renderActionHint(m.keys, scopeQuickOffset, actionConfirm, "enter", "apply"),
		renderActionHint(m.keys, scopeQuickOffset, actionClose, "esc", "cancel"),
	}, "  ")
	return renderModalContentWithWidth("Quick Offset", body, footer, 56)
}

// renderFilePicker renders a simple list of CSV files with a cursor.
func renderFilePicker(files []string, cursor int, keys *KeyRegistry) string {
	if len(files) == 0 {
		return renderModalContent("Import CSV", []string{
			lipgloss.NewStyle().Foreground(colorOverlay1).Render("Loading CSV files..."),
		}, fmt.Sprintf(
			"%s select  %s cancel",
			actionKeyLabel(keys, scopeFilePicker, actionSelect, "enter"),
			actionKeyLabel(keys, scopeFilePicker, actionClose, "esc"),
		))
	}
	lines := make([]string, 0, len(files))
	for i, f := range files {
		prefix := "  "
		if i == cursor {
			prefix = cursorStyle.Render("> ")
		}
		lines = append(lines, prefix+lipgloss.NewStyle().Foreground(colorText).Render(f))
	}
	return renderModalContent("Import CSV", lines, fmt.Sprintf(
		"%s select  %s cancel",
		actionKeyLabel(keys, scopeFilePicker, actionSelect, "enter"),
		actionKeyLabel(keys, scopeFilePicker, actionClose, "esc"),
	))
}

func renderImportPreview(
	snapshot *importPreviewSnapshot,
	postRules,
	showAll bool,
	cursor,
	topIndex,
	compactRows,
	terminalWidth int,
	keys *KeyRegistry,
) string {
	if snapshot == nil {
		return renderModalContent("Import Preview", []string{
			lipgloss.NewStyle().Foreground(colorOverlay1).Render("No import snapshot loaded."),
		}, renderActionHint(keys, scopeImportPreview, actionClose, "esc", "cancel"))
	}
	return renderImportPreviewCompact(snapshot, postRules, showAll, cursor, topIndex, compactRows, terminalWidth, keys)
}

func renderImportPreviewCompact(snapshot *importPreviewSnapshot, postRules, showAll bool, cursor, topIndex, compactRows, terminalWidth int, keys *KeyRegistry) string {
	body := []string{
		detailLabelStyle.Render("Summary"),
		detailLabelStyle.Render("  File:    ") + detailValueStyle.Render(snapshot.fileName),
		detailLabelStyle.Render("  Rows:    ") + detailValueStyle.Render(fmt.Sprintf("%d total", snapshot.totalRows)),
		detailLabelStyle.Render("  New:     ") + detailValueStyle.Render(fmt.Sprintf("%d", snapshot.newCount)),
		detailLabelStyle.Render("  Dupes:   ") + detailValueStyle.Render(fmt.Sprintf("%d", snapshot.dupeCount)),
		detailLabelStyle.Render("  Errors:  ") + detailValueStyle.Render(fmt.Sprintf("%d", snapshot.errorCount)),
		detailLabelStyle.Render("  Rules:   ") + detailValueStyle.Render(map[bool]string{true: "ON", false: "OFF"}[postRules]),
		"",
	}

	if snapshot.errorCount > 0 {
		body = append(body, lipgloss.NewStyle().Foreground(colorError).Render("Import blocked: fix parse/normalize errors before confirming."))
		for i := 0; i < min(5, len(snapshot.parseErrors)); i++ {
			pe := snapshot.parseErrors[i]
			body = append(body, fmt.Sprintf("  line %d (row %d, %s): %s", pe.sourceLine, pe.rowIndex, pe.field, pe.message))
		}
		if len(snapshot.parseErrors) > 5 {
			body = append(body, fmt.Sprintf("  +%d more errors not shown", len(snapshot.parseErrors)-5))
		}
		body = append(body, "")
	}

	rows := compactImportRows(snapshot, showAll)
	modeLabel := "Duplicate Rows"
	if showAll {
		modeLabel = "Preview Rows"
	}
	body = append(body, detailLabelStyle.Render(fmt.Sprintf("%s (%d)", modeLabel, len(rows))))

	if len(rows) == 0 {
		body = append(body, "  No rows in this view.")
	} else {
		table := renderImportPreviewTable(rows, postRules, cursor, topIndex, compactRows, terminalWidth)
		body = append(body, splitLines(table)...)
		body = append(body, detailLabelStyle.Render(fmt.Sprintf("  showing %d rows/page", compactRows)))
	}

	previewLabel := "preview"
	if showAll {
		previewLabel = "dupes"
	}
	footer := strings.Join([]string{
		renderActionHint(keys, scopeImportPreview, actionImportAll, "a", "import all"),
		renderActionHint(keys, scopeImportPreview, actionSkipDupes, "s", "skip"),
		renderActionHint(keys, scopeImportPreview, actionImportPreviewToggle, "p", previewLabel),
		renderActionHint(keys, scopeImportPreview, actionImportRawView, "r", "rules"),
		renderActionHint(keys, scopeImportPreview, actionClose, "esc", "cancel"),
	}, "  ")
	width := max(96, min(136, terminalWidth-8))
	return renderModalContentWithWidth("Import Preview", body, footer, width)
}

func compactImportRows(snapshot *importPreviewSnapshot, showAll bool) []importPreviewRow {
	if snapshot == nil {
		return nil
	}
	if showAll {
		return snapshot.rows
	}
	out := make([]importPreviewRow, 0, snapshot.dupeCount)
	for _, row := range snapshot.rows {
		if row.isDupe {
			out = append(out, row)
		}
	}
	return out
}

func renderImportPreviewTable(rows []importPreviewRow, postRules bool, cursor, topIndex, visibleRows, terminalWidth int) string {
	if visibleRows <= 0 {
		visibleRows = 10
	}
	txns := make([]transaction, 0, len(rows))
	txnTags := make(map[int][]tag)
	categories := make([]category, 0)
	catSeen := make(map[string]bool)
	if postRules {
		categories = append(categories, category{id: 1, name: "Uncategorised"})
		catSeen["Uncategorised"] = true
	}
	for i, row := range rows {
		txnID := i + 1
		txn := transaction{
			id:          txnID,
			dateRaw:     row.dateRaw,
			dateISO:     row.dateISO,
			amount:      row.amount,
			description: row.description,
		}
		if postRules {
			cat := strings.TrimSpace(row.previewCat)
			if cat == "" {
				cat = "Uncategorised"
			}
			txn.categoryName = cat
			txn.categoryColor = strings.TrimSpace(row.previewCatColor)
			if !catSeen[cat] {
				categories = append(categories, category{name: cat, color: txn.categoryColor})
				catSeen[cat] = true
			}
			if len(row.previewTagObjs) > 0 {
				txnTags[txnID] = append(txnTags[txnID], row.previewTagObjs...)
			} else if len(row.previewTags) > 0 {
				for j, name := range row.previewTags {
					if strings.TrimSpace(name) == "" {
						continue
					}
					txnTags[txnID] = append(txnTags[txnID], tag{id: j + 1, name: name})
				}
			}
		}
		txns = append(txns, txn)
	}
	contentWidth := max(88, min(124, terminalWidth-12))
	cursorTxnID := 0
	if cursor >= 0 && cursor < len(txns) {
		cursorTxnID = txns[cursor].id
	}
	return renderTransactionTable(txns, categories, txnTags, nil, nil, nil, cursorTxnID, topIndex, visibleRows, contentWidth, sortByDate, true)
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
	offsetsByDebit map[int][]creditOffset,
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
	offsetW := 11
	catW := 0
	accountW := 0
	tagsW := 0
	descTargetW := 40
	showCats := categories != nil
	showTags := categories != nil
	showAccounts := hasMultipleAccountNames(rows)
	showOffset := offsetsByDebit != nil
	if showCats {
		catW = 14
	}
	if showAccounts {
		accountW = 14
	}
	sep := " "   // single-space column separator
	numCols := 3 // date amount desc
	if showOffset {
		numCols++
	}
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
	if showOffset {
		fixedWithoutTags += offsetW
	}
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
	offsetLbl := "Offset"
	descLbl := addSortIndicator("Description", sortByDescription, sortCol, sortAsc)

	var header string
	if showCats && showTags && showAccounts {
		catLbl := addSortIndicator("Category", sortByCategory, sortCol, sortAsc)
		if showOffset {
			header = fmt.Sprintf("%-*s"+sep+"%-*s"+sep+"%-*s"+sep+"%-*s"+sep+"%-*s"+sep+"%-*s"+sep+"%-*s", dateW, dateLbl, amountW, amtLbl, offsetW, offsetLbl, descW, descLbl, accountW, "Account", catW, catLbl, tagsW, "Tags")
		} else {
			header = fmt.Sprintf("%-*s"+sep+"%-*s"+sep+"%-*s"+sep+"%-*s"+sep+"%-*s"+sep+"%-*s", dateW, dateLbl, amountW, amtLbl, descW, descLbl, accountW, "Account", catW, catLbl, tagsW, "Tags")
		}
	} else if showCats && showTags {
		catLbl := addSortIndicator("Category", sortByCategory, sortCol, sortAsc)
		if showOffset {
			header = fmt.Sprintf("%-*s"+sep+"%-*s"+sep+"%-*s"+sep+"%-*s"+sep+"%-*s"+sep+"%-*s", dateW, dateLbl, amountW, amtLbl, offsetW, offsetLbl, descW, descLbl, catW, catLbl, tagsW, "Tags")
		} else {
			header = fmt.Sprintf("%-*s"+sep+"%-*s"+sep+"%-*s"+sep+"%-*s"+sep+"%-*s", dateW, dateLbl, amountW, amtLbl, descW, descLbl, catW, catLbl, tagsW, "Tags")
		}
	} else if showCats && showAccounts {
		catLbl := addSortIndicator("Category", sortByCategory, sortCol, sortAsc)
		if showOffset {
			header = fmt.Sprintf("%-*s"+sep+"%-*s"+sep+"%-*s"+sep+"%-*s"+sep+"%-*s"+sep+"%-*s", dateW, dateLbl, amountW, amtLbl, offsetW, offsetLbl, descW, descLbl, accountW, "Account", catW, catLbl)
		} else {
			header = fmt.Sprintf("%-*s"+sep+"%-*s"+sep+"%-*s"+sep+"%-*s"+sep+"%-*s", dateW, dateLbl, amountW, amtLbl, descW, descLbl, accountW, "Account", catW, catLbl)
		}
	} else if showCats {
		catLbl := addSortIndicator("Category", sortByCategory, sortCol, sortAsc)
		if showOffset {
			header = fmt.Sprintf("%-*s"+sep+"%-*s"+sep+"%-*s"+sep+"%-*s"+sep+"%-*s", dateW, dateLbl, amountW, amtLbl, offsetW, offsetLbl, descW, descLbl, catW, catLbl)
		} else {
			header = fmt.Sprintf("%-*s"+sep+"%-*s"+sep+"%-*s"+sep+"%-*s", dateW, dateLbl, amountW, amtLbl, descW, descLbl, catW, catLbl)
		}
	} else if showAccounts {
		if showOffset {
			header = fmt.Sprintf("%-*s"+sep+"%-*s"+sep+"%-*s"+sep+"%-*s"+sep+"%-*s", dateW, dateLbl, amountW, amtLbl, offsetW, offsetLbl, descW, descLbl, accountW, "Account")
		} else {
			header = fmt.Sprintf("%-*s"+sep+"%-*s"+sep+"%-*s"+sep+"%-*s", dateW, dateLbl, amountW, amtLbl, descW, descLbl, accountW, "Account")
		}
	} else {
		if showOffset {
			header = fmt.Sprintf("%-*s"+sep+"%-*s"+sep+"%-*s"+sep+"%-*s", dateW, dateLbl, amountW, amtLbl, offsetW, offsetLbl, descW, descLbl)
		} else {
			header = fmt.Sprintf("%-*s"+sep+"%-*s"+sep+"%-*s", dateW, dateLbl, amountW, amtLbl, descW, descLbl)
		}
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
		offsetField := ""
		if showOffset {
			offsetValue := totalOffsetForTxn(row.id, offsetsByDebit)
			offsetText := fmt.Sprintf("%.2f", offsetValue)
			offsetField = padRight(offsetText, offsetW)
		}

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
		if showOffset {
			offsetStyle := lipgloss.NewStyle().Foreground(colorSuccess).Background(rowBg)
			if cursorStrong {
				offsetStyle = offsetStyle.Bold(true)
			}
			offsetField = offsetStyle.Render(offsetField)
		}

		if showCats && showTags && showAccounts {
			catField := renderCategoryTagOnBackground(row.categoryName, row.categoryColor, catW, rowBg, cursorStrong)
			tagField := renderTagsOnBackground(txnTags[row.id], tagsW, rowBg, cursorStrong)
			accountField := cellStyle.Render(padRight(truncate(row.accountName, accountW), accountW))
			if showOffset {
				line = cellStyle.Render(dateField) + sepField + amountField + sepField + offsetField + sepField + cellStyle.Render(descField) + sepField + accountField + sepField + catField + sepField + tagField
			} else {
				line = cellStyle.Render(dateField) + sepField + amountField + sepField + accountField + sepField + cellStyle.Render(descField) + sepField + catField + sepField + tagField
			}
		} else if showCats && showTags {
			catField := renderCategoryTagOnBackground(row.categoryName, row.categoryColor, catW, rowBg, cursorStrong)
			tagField := renderTagsOnBackground(txnTags[row.id], tagsW, rowBg, cursorStrong)
			if showOffset {
				line = cellStyle.Render(dateField) + sepField + amountField + sepField + offsetField + sepField + cellStyle.Render(descField) + sepField + catField + sepField + tagField
			} else {
				line = cellStyle.Render(dateField) + sepField + amountField + sepField + cellStyle.Render(descField) + sepField + catField + sepField + tagField
			}
		} else if showCats && showAccounts {
			catField := renderCategoryTagOnBackground(row.categoryName, row.categoryColor, catW, rowBg, cursorStrong)
			accountField := cellStyle.Render(padRight(truncate(row.accountName, accountW), accountW))
			if showOffset {
				line = cellStyle.Render(dateField) + sepField + amountField + sepField + offsetField + sepField + cellStyle.Render(descField) + sepField + accountField + sepField + catField
			} else {
				line = cellStyle.Render(dateField) + sepField + amountField + sepField + accountField + sepField + cellStyle.Render(descField) + sepField + catField
			}
		} else if showCats {
			catField := renderCategoryTagOnBackground(row.categoryName, row.categoryColor, catW, rowBg, cursorStrong)
			if showOffset {
				line = cellStyle.Render(dateField) + sepField + amountField + sepField + offsetField + sepField + cellStyle.Render(descField) + sepField + catField
			} else {
				line = cellStyle.Render(dateField) + sepField + amountField + sepField + cellStyle.Render(descField) + sepField + catField
			}
		} else if showAccounts {
			accountField := cellStyle.Render(padRight(truncate(row.accountName, accountW), accountW))
			if showOffset {
				line = cellStyle.Render(dateField) + sepField + amountField + sepField + offsetField + sepField + cellStyle.Render(descField) + sepField + accountField
			} else {
				line = cellStyle.Render(dateField) + sepField + amountField + sepField + accountField + sepField + cellStyle.Render(descField)
			}
		} else {
			if showOffset {
				line = cellStyle.Render(dateField) + sepField + amountField + sepField + offsetField + sepField + cellStyle.Render(descField)
			} else {
				line = cellStyle.Render(dateField) + sepField + amountField + sepField + cellStyle.Render(descField)
			}
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
		shown := endIdx - start + 1
		if shown < 0 {
			shown = 0
		}
		indicator := scrollStyle.Render(fmt.Sprintf("── showing %d-%d of %d (%d) ──", start, endIdx, total, shown))
		lines = append(lines, indicator)
	}

	return strings.Join(lines, "\n")
}

func totalOffsetForTxn(txnID int, offsetsByDebit map[int][]creditOffset) float64 {
	if txnID <= 0 || len(offsetsByDebit) == 0 {
		return 0
	}
	offsets := offsetsByDebit[txnID]
	if len(offsets) == 0 {
		return 0
	}
	total := 0.0
	for _, off := range offsets {
		total += off.amount
	}
	return total
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
		return colorBlue, true
	case isCursor && highlighted:
		return colorSapphire, true
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

func renderDashboardAnalyticsRegion(m model) string {
	if len(m.dashWidgets) != dashboardPaneCount {
		m.dashWidgets = newDashboardWidgets(m.customPaneModes)
	}
	totalWidth := m.sectionWidth()
	if totalWidth <= 0 {
		totalWidth = 80
	}
	gap := 1
	narrow := totalWidth < 80
	if narrow {
		panes := make([]string, 0, len(m.dashWidgets))
		for i := 0; i < len(m.dashWidgets); i++ {
			spec := dashboardPaneLayoutSpecFor(m, m.dashWidgets[i].kind)
			panes = append(panes, renderDashboardWidgetPane(m, i, totalWidth, spec))
		}
		return strings.Join(panes, "\n")
	}
	avail := totalWidth - gap
	if avail < 2 {
		avail = 2
	}
	leftW := avail * 60 / 100
	rightW := avail - leftW
	if leftW < 24 {
		leftW = 24
		rightW = max(20, avail-leftW)
	}
	netPane := renderDashboardWidgetPane(m, 0, leftW, dashboardPaneLayoutSpecFor(m, widgetNetCashflow))
	compPane := renderDashboardWidgetPane(m, 1, rightW, dashboardPaneLayoutSpecFor(m, widgetComposition))
	return lipgloss.JoinHorizontal(lipgloss.Top, netPane, strings.Repeat(" ", gap), compPane)
}

type dashboardPaneLayoutSpec struct {
	minLines    int
	chartHeight int
}

func dashboardPaneLayoutSpecFor(m model, kind widgetKind) dashboardPaneLayoutSpec {
	paneRows := max(spendingTrackerHeight, (m.height*40)/100)
	switch kind {
	case widgetNetCashflow:
		return dashboardPaneLayoutSpec{minLines: paneRows, chartHeight: paneRows}
	default:
		return dashboardPaneLayoutSpec{minLines: paneRows, chartHeight: paneRows}
	}
}

func renderDashboardWidgetPane(m model, idx int, width int, spec dashboardPaneLayoutSpec) string {
	if idx < 0 || idx >= len(m.dashWidgets) {
		return renderManagerSectionBox("Dashboard Pane", false, false, width, "")
	}
	w := m.dashWidgets[idx]
	if len(w.modes) == 0 {
		return renderManagerSectionBox(w.title, m.focusedSection == idx, m.focusedSection == idx, width, "No modes configured.")
	}
	modeIdx := w.activeMode
	if modeIdx < 0 || modeIdx >= len(w.modes) {
		modeIdx = 0
	}
	mode := w.modes[modeIdx]
	title := w.title + " [" + strings.ToUpper(w.jumpKey) + "] · " + mode.label
	contentW := max(1, width-4)
	rows := m.dashboardRowsForMode(mode)
	content := renderDashboardWidgetModeContent(m, w, mode, rows, contentW, spec)
	content = ensureMinLines(content, spec.minLines)
	isFocused := m.activeTab == tabDashboard && m.focusedSection == idx
	return renderManagerSectionBox(title, isFocused, isFocused, width, content)
}

func ensureMinLines(content string, minLines int) string {
	if minLines <= 0 {
		return content
	}
	lines := splitLines(content)
	if len(lines) >= minLines {
		return content
	}
	for len(lines) < minLines {
		lines = append(lines, "")
	}
	return strings.Join(lines, "\n")
}

func renderDashboardWidgetModeContent(m model, w widget, mode widgetMode, rows []transaction, width int, spec dashboardPaneLayoutSpec) string {
	switch w.kind {
	case widgetNetCashflow:
		return renderDashboardNetCashflowMode(m, mode, rows, width, spec.chartHeight)
	case widgetComposition:
		return renderDashboardCompositionMode(m, mode, rows, width)
	default:
		return "Unsupported widget kind."
	}
}

func renderDashboardNetCashflowMode(m model, mode widgetMode, rows []transaction, width int, chartHeight int) string {
	start, end := m.dashboardChartRange(time.Now())
	switch mode.id {
	case "spending":
		spendRows := dashboardSpendRows(rows, m.txnTags)
		return renderSpendingTrackerWithRangeSized(spendRows, width, m.spendingWeekAnchor, start, end, chartHeight)
	default: // net_worth + custom
		return renderNetWorthTrackerWithRange(rows, width, m.spendingWeekAnchor, start, end, chartHeight)
	}
}

func renderDashboardCompositionMode(m model, mode widgetMode, rows []transaction, width int) string {
	spendRows := dashboardSpendRows(rows, m.txnTags)
	switch mode.id {
	case "top_merchants":
		return renderDashboardTopMerchants(spendRows, width)
	default:
		return renderCategoryBreakdown(spendRows, m.categories, width)
	}
}

func renderDashboardCompareBarsMode(m model, mode widgetMode, rows []transaction, width int) string {
	switch mode.id {
	case "budget_vs_actual":
		budgetTotal := 0.0
		for _, line := range m.budgetLines {
			budgetTotal += line.budgeted
		}
		actual := 0.0
		for _, row := range rows {
			if row.amount < 0 {
				actual += -row.amount
			}
		}
		scale := max(budgetTotal, actual)
		barBudget := renderMiniMeter("Budget", budgetTotal, scale, max(1, width/2))
		barActual := renderMiniMeter("Actual", actual, scale, max(1, width/2))
		return barBudget + "\n" + barActual
	case "income_vs_expense":
		income := 0.0
		expense := 0.0
		for _, row := range rows {
			if row.amount > 0 {
				income += row.amount
			} else {
				expense += -row.amount
			}
		}
		scale := max(income, expense)
		return renderMiniMeter("Income", income, scale, max(1, width/2)) + "\n" + renderMiniMeter("Expense", expense, scale, max(1, width/2))
	case "month_over_month":
		curMonth := latestDebitMonthKey(rows)
		prevMonth := previousMonthKey(curMonth)
		curSpend := 0.0
		prevSpend := 0.0
		for _, row := range rows {
			if row.amount >= 0 {
				continue
			}
			month, ok := monthKeyFromDateISO(row.dateISO)
			if !ok {
				continue
			}
			if month == curMonth {
				curSpend += -row.amount
			} else if month == prevMonth {
				prevSpend += -row.amount
			}
		}
		scale := max(curSpend, prevSpend)
		return renderMiniMeter("Current", curSpend, scale, max(1, width/2)) + "\n" + renderMiniMeter("Previous", prevSpend, scale, max(1, width/2))
	default:
		return "No compare mode configured."
	}
}

func monthKeyFromDateISO(dateISO string) (string, bool) {
	if len(dateISO) < 7 {
		return "", false
	}
	month := dateISO[:7]
	if _, err := time.Parse("2006-01", month); err != nil {
		return "", false
	}
	return month, true
}

func latestDebitMonthKey(rows []transaction) string {
	latest := ""
	for _, row := range rows {
		if row.amount >= 0 {
			continue
		}
		month, ok := monthKeyFromDateISO(row.dateISO)
		if !ok {
			continue
		}
		if month > latest {
			latest = month
		}
	}
	return latest
}

func previousMonthKey(monthKey string) string {
	if monthKey == "" {
		return ""
	}
	t, err := time.Parse("2006-01", monthKey)
	if err != nil {
		return ""
	}
	return t.AddDate(0, -1, 0).Format("2006-01")
}

func renderMiniMeter(label string, value float64, maxValue float64, barWidth int) string {
	if barWidth < 1 {
		barWidth = 1
	}
	amount := math.Abs(value)
	scale := math.Abs(maxValue)
	filled := 0
	if scale > 0 {
		filled = int(math.Round((amount / scale) * float64(barWidth)))
	}
	if filled < 0 {
		filled = 0
	}
	if filled > barWidth {
		filled = barWidth
	}
	bar := strings.Repeat("█", filled) + strings.Repeat("░", barWidth-filled)
	return fmt.Sprintf("%-10s %s %s", label+":", bar, formatMoney(amount))
}

func renderDashboardTopTransactions(rows []transaction, width int) string {
	if len(rows) == 0 {
		return "No rows in scope."
	}
	limit := min(6, len(rows))
	lines := make([]string, 0, limit)
	for i := 0; i < limit; i++ {
		row := rows[i]
		lines = append(lines, fmt.Sprintf("%s  %7s  %s", formatDateShort(row.dateISO), formatMoney(row.amount), truncate(row.description, max(8, width-24))))
	}
	return strings.Join(lines, "\n")
}

func renderDashboardTopMerchants(rows []transaction, width int) string {
	if len(rows) == 0 {
		return "No merchant spend in scope."
	}
	spendByMerchant := make(map[string]float64)
	for _, row := range rows {
		if row.amount >= 0 {
			continue
		}
		name := strings.TrimSpace(row.description)
		if name == "" {
			name = "Unknown"
		}
		spendByMerchant[name] += -row.amount
	}
	type merchantSpend struct {
		name  string
		spend float64
	}
	sorted := make([]merchantSpend, 0, len(spendByMerchant))
	maxSpend := 0.0
	for name, spend := range spendByMerchant {
		sorted = append(sorted, merchantSpend{name: name, spend: spend})
		if spend > maxSpend {
			maxSpend = spend
		}
	}
	sort.SliceStable(sorted, func(i, j int) bool {
		if sorted[i].spend != sorted[j].spend {
			return sorted[i].spend > sorted[j].spend
		}
		return sorted[i].name < sorted[j].name
	})
	limit := min(6, len(sorted))
	lines := make([]string, 0, limit)
	barWidth := max(1, width-28)
	if maxSpend <= 0 {
		maxSpend = 1
	}
	for i := 0; i < limit; i++ {
		item := sorted[i]
		ratio := item.spend / maxSpend
		fill := int(math.Round(ratio * float64(barWidth)))
		if fill < 1 {
			fill = 1
		}
		if fill > barWidth {
			fill = barWidth
		}
		bar := strings.Repeat("█", fill) + strings.Repeat("░", barWidth-fill)
		lines = append(lines, fmt.Sprintf("%s %s %s", truncate(item.name, 14), bar, formatMoney(item.spend)))
	}
	return strings.Join(lines, "\n")
}

func hasRecurringTag(tags []tag) bool {
	for _, tg := range tags {
		if strings.EqualFold(strings.TrimSpace(tg.name), "recurring") {
			return true
		}
	}
	return false
}

// renderSummaryCards renders the summary cards: balance, income, expenses,
// transaction count, uncategorised count/amount.
func renderSummaryCards(rows []transaction, categories []category, width int) string {
	var income, expenses float64
	var uncatCount int
	var uncatTotal float64
	minDate := ""
	maxDate := ""
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

	_ = categories
	greenSty := lipgloss.NewStyle().Foreground(colorSuccess)
	redSty := lipgloss.NewStyle().Foreground(colorError)
	warnSty := lipgloss.NewStyle().Foreground(colorWarning)

	// 4 rows, 2 columns
	col1W := 34
	col2W := width - col1W
	if col2W < 16 {
		col2W = 16
	}

	debits := math.Abs(expenses)
	credits := income
	days := 1.0
	if minDate != "" && maxDate != "" {
		start, startErr := time.Parse("2006-01-02", minDate)
		end, endErr := time.Parse("2006-01-02", maxDate)
		if startErr == nil && endErr == nil {
			span := end.Sub(start).Hours()/24 + 1
			if span > 1 {
				days = span
			}
		}
	}
	dailyBurn := 0.0
	if debits > 0 {
		dailyBurn = debits / days
	}
	savingsRate := 0.0
	if credits > 0 {
		savingsRate = ((credits - debits) / credits) * 100
	}
	runway := "∞"
	if dailyBurn > 0 {
		runway = fmt.Sprintf("%.1f days", balance/dailyBurn)
	}

	row1 := padRight(infoLabelStyle.Render("Balance      ")+balanceStyle(balance, greenSty, redSty), col1W) +
		padRight(infoLabelStyle.Render("Uncat ")+infoValueStyle.Render(fmt.Sprintf("%d (%s)", uncatCount, formatMoney(uncatTotal))), col2W)

	row2 := padRight(infoLabelStyle.Render("Debits       ")+redSty.Render(formatMoney(debits)), col1W) +
		padRight(infoLabelStyle.Render("Transactions ")+infoValueStyle.Render(fmt.Sprintf("%d", len(rows))), col2W)

	row3 := padRight(infoLabelStyle.Render("Credits      ")+greenSty.Render(formatMoney(credits)), col1W) +
		padRight(infoLabelStyle.Render("Daily Burn ")+warnSty.Render(formatMoney(dailyBurn)), col2W)

	row4 := padRight(infoLabelStyle.Render("Savings Rate ")+infoValueStyle.Render(fmt.Sprintf("%.1f%%", savingsRate)), col1W) +
		padRight(infoLabelStyle.Render("Runway ")+infoValueStyle.Render(runway), col2W)

	return row1 + "\n" + row2 + "\n" + row3 + "\n" + row4
}

func dashboardDateRange(rows []transaction, timeframe int, customStart, customEnd string, now time.Time) string {
	start, endExcl, ok := timeframeBounds(timeframe, customStart, customEnd, now)
	return dashboardDateRangeFromBounds(rows, start, endExcl, ok)
}

func dashboardDateRangeFromBounds(rows []transaction, start, endExcl time.Time, ok bool) string {
	if ok {
		end := endExcl.AddDate(0, 0, -1)
		if end.Before(start) {
			end = start
		}
		if start.Format("2006-01") == end.Format("2006-01") {
			return formatMonth(start.Format("2006-01-02"))
		}
		return formatMonth(start.Format("2006-01-02")) + " – " + formatMonth(end.Format("2006-01-02"))
	}

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
		pctStr := infoLabelStyle.Render(pctText)
		amtStr := infoValueStyle.Render(amtText)

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

func aggregateDailyNetForRange(rows []transaction, start, end time.Time) ([]float64, []time.Time) {
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
		byDay[r.dateISO] += r.amount
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

func cumulativeSeries(in []float64) []float64 {
	out := make([]float64, len(in))
	total := 0.0
	for i, v := range in {
		total += v
		out[i] = total
	}
	return out
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
	return renderSpendingTrackerWithRangeSized(rows, width, weekAnchor, start, end, spendingTrackerHeight)
}

func renderSpendingTrackerWithRangeSized(rows []transaction, width int, weekAnchor time.Weekday, start, end time.Time, height int) string {
	values, dates := aggregateDailySpendForRange(rows, start, end)
	return renderTimeSeriesWithRange(values, dates, width, weekAnchor, height, false)
}

func renderNetWorthTrackerWithRange(rows []transaction, width int, weekAnchor time.Weekday, start, end time.Time, height int) string {
	netDaily, dates := aggregateDailyNetForRange(rows, start, end)
	balance := cumulativeSeries(netDaily)
	return renderTimeSeriesWithRange(balance, dates, width, weekAnchor, height, true)
}

func renderTimeSeriesWithRange(values []float64, dates []time.Time, width int, weekAnchor time.Weekday, height int, signed bool) string {
	if width <= 0 {
		width = 20
	}
	if height <= 0 {
		height = spendingTrackerHeight
	}
	if len(dates) == 0 {
		return lipgloss.NewStyle().Foreground(colorOverlay1).Render("No data for spending tracker.")
	}

	start := dates[0]
	end := dates[len(dates)-1]
	maxVal := 0.0
	minVal := 0.0
	for _, v := range values {
		if v > maxVal {
			maxVal = v
		}
		if v < minVal {
			minVal = v
		}
	}

	chart := tslc.New(width, height)
	chart.SetXStep(1)
	chart.SetYStep(spendingTrackerYStep)
	chart.SetStyle(lipgloss.NewStyle().Foreground(colorPeach))
	chart.AxisStyle = lipgloss.NewStyle().Foreground(colorSurface2)
	chart.LabelStyle = lipgloss.NewStyle().Foreground(colorOverlay1)
	chart.SetTimeRange(start, end)
	chart.SetViewTimeRange(start, end)

	plan := planSpendingAxes(&chart, dates, max(maxVal, math.Abs(minVal)))
	yMin := 0.0
	yMax := 0.0
	if signed {
		step, minScaled, maxScaled := signedYScale(minVal, maxVal, chart.GraphHeight())
		plan.yStep = step
		yMin = minScaled
		yMax = maxScaled
	} else {
		step, maxScaled := spendingYScale(max(0, maxVal), chart.GraphHeight())
		plan.yStep = step
		plan.yMax = maxScaled
		yMin = -(maxScaled * 0.08)
		yMax = maxScaled
	}
	chart.SetYRange(yMin, yMax)
	chart.SetViewYRange(yMin, yMax)
	chart.Model.XLabelFormatter = spendingXLabelFormatter(plan.xLabels)
	chart.Model.YLabelFormatter = spendingYLabelFormatter(plan.yStep, yMin, yMax)

	for i, d := range dates {
		chart.Push(tslc.TimePoint{Time: d, Value: values[i]})
	}

	chart.DrawBraille()
	clearAxes(&chart)
	raiseXAxisLabels(&chart)
	drawVerticalGridlines(&chart, dates, plan, weekAnchor)
	if signed {
		drawHorizontalValueLine(&chart, 0, lipgloss.NewStyle().Foreground(colorSurface2))
	}

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

func signedYScale(minVal, maxVal float64, graphHeight int) (step, yMin, yMax float64) {
	if minVal > 0 {
		minVal = 0
	}
	if maxVal < 0 {
		maxVal = 0
	}
	span := maxVal - minVal
	if span <= 0 {
		span = 1
	}
	targetTicks := max(4, min(8, graphHeight/2))
	if targetTicks <= 1 {
		targetTicks = 4
	}
	step = niceCeil(span / float64(targetTicks-1))
	if step < 1 {
		step = 1
	}
	yMin = math.Floor(minVal/step) * step
	yMax = math.Ceil(maxVal/step) * step
	if yMin == yMax {
		yMax = yMin + step
	}
	return step, yMin, yMax
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

const chartYAxisLabelWidth = 6

func spendingYLabelFormatter(step, yMin, yMax float64) linechart.LabelFormatter {
	tolerance := step * 0.2
	return func(_ int, v float64) string {
		nearest := math.Round(v/step) * step
		if nearest < yMin-step*0.01 || nearest > yMax+step*0.01 {
			return ""
		}
		// Keep the bottom-most row free so raised x-axis labels don't collide
		// with the minimum y tick in signed ranges.
		if nearest <= yMin+step*0.01 {
			return ""
		}
		if math.Abs(v-nearest) > tolerance {
			return ""
		}
		if math.Abs(nearest) < 0.5 {
			return fmt.Sprintf("%*s", chartYAxisLabelWidth, "0")
		}
		label := formatAxisTick(nearest)
		if nearest < 0 {
			label = "-" + label
		}
		return fmt.Sprintf("%*s", chartYAxisLabelWidth, label)
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

func chartRowY(chart *tslc.Model, v float64) int {
	point := canvas.Float64Point{X: chart.ViewMinX(), Y: v}
	scaled := chart.ScaleFloat64Point(point)
	p := canvas.CanvasPointFromFloat64Point(chart.Origin(), scaled)
	if chart.YStep() > 0 {
		p.X++
	}
	if chart.XStep() > 0 {
		p.Y--
	}
	return p.Y
}

func drawHorizontalValueLine(chart *tslc.Model, v float64, style lipgloss.Style) {
	origin := chart.Origin()
	topY := origin.Y - chart.GraphHeight()
	bottomY := origin.Y - 1
	y := chartRowY(chart, v)
	if y < topY || y > bottomY {
		return
	}
	for x := origin.X + 1; x < chart.Width(); x++ {
		p := canvas.Point{X: x, Y: y}
		if chart.Canvas.Cell(p).Rune != 0 {
			continue
		}
		chart.Canvas.SetRuneWithStyle(p, '─', style)
	}
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
	filtersContent := renderSettingsFilters(m, leftWidth-4)
	filtersBox := renderSettingsSectionBox("Filters", settSecFilters, m, leftWidth, filtersContent)

	leftCol := catBox + "\n" + tagsBox + "\n" + rulesBox + "\n" + filtersBox

	// Right column: Chart + Database & Imports (stacked)
	chartContent := renderSettingsChart(m, rightWidth-4)
	chartBox := renderSettingsSectionBox("Chart", settSecChart, m, rightWidth, chartContent)

	dbContent := renderSettingsDBImport(m, rightWidth-4)
	dbBox := renderSettingsSectionBox("Database", settSecDBImport, m, rightWidth, dbContent)

	importContent := renderSettingsImportHistory(m, rightWidth-4)
	importBox := renderSettingsSectionBox("Import History", settSecImportHistory, m, rightWidth, importContent)

	rightCol := chartBox + "\n" + dbBox + "\n" + importBox

	return lipgloss.JoinHorizontal(lipgloss.Top, leftCol, strings.Repeat(" ", gap), rightCol)
}

// renderSettingsSectionBox wraps content in a bordered box, highlighting if focused.
func renderSettingsSectionBox(title string, sec int, m model, width int, content string) string {
	isFocused := m.settSection == sec
	isActive := isFocused && m.settActive
	return renderManagerSectionBox(title, isFocused, isActive, width, content)
}

func renderManagerSectionBox(title string, isFocused, isActive bool, width int, content string) string {
	borderColor := colorSurface1
	titleSty := lipgloss.NewStyle().Foreground(colorSubtext0).Bold(true)
	if isFocused {
		borderColor = colorAccent
		titleSty = lipgloss.NewStyle().Foreground(colorAccent).Bold(true)
	}
	if isActive {
		title += " *"
	}
	return renderSectionBox(title, content, width, false, borderColor, titleSty)
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
		countText := fmt.Sprintf("%d", acc.txnCount)
		countColor := colorSubtext1
		if acc.txnCount == 0 {
			countText = "Empty"
			countColor = colorOverlay1
		}
		chip := lipgloss.NewStyle().
			Foreground(colorText).
			Render(name) + " " +
			lipgloss.NewStyle().Foreground(typeColor).Render(strings.ToUpper(acc.acctType)) + " " +
			lipgloss.NewStyle().Foreground(countColor).Render(countText) + " " +
			lipgloss.NewStyle().Foreground(scopeColor).Render(scopeText)
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

	if m.settMode == settModeAddCat || m.settMode == settModeEditCat {
		lines = append(lines, "")
		label := "Add Category"
		if m.settMode == settModeEditCat {
			label = "Edit Category"
		}
		lines = append(lines, detailActiveStyle.Render(label))
		nameValue := m.settInput
		if m.settCatFocus == 0 {
			nameValue = renderASCIIInputCursor(m.settInput, m.settInputCursor)
		}
		lines = append(lines, modalCursor(m.settCatFocus == 0)+detailLabelStyle.Render("Name: ")+detailValueStyle.Render(nameValue))
		colors := CategoryAccentColors()
		var colorRow string
		for i, c := range colors {
			swatch := lipgloss.NewStyle().Foreground(c).Render("■")
			if i == m.settColorIdx {
				swatch = lipgloss.NewStyle().Foreground(c).Bold(true).Render("[■]")
			}
			colorRow += swatch + " "
		}
		lines = append(lines, modalCursor(m.settCatFocus == 1)+detailLabelStyle.Render("Color: ")+colorRow)
		lines = append(lines, scrollStyle.Render(fmt.Sprintf(
			"tab field  %s/%s color  %s save  %s cancel",
			actionKeyLabel(m.keys, scopeSettingsModeCat, actionLeft, "left"),
			actionKeyLabel(m.keys, scopeSettingsModeCat, actionRight, "right"),
			actionKeyLabel(m.keys, scopeSettingsModeCat, actionSave, "enter"),
			actionKeyLabel(m.keys, scopeSettingsModeCat, actionClose, "esc"),
		)))
	}
	_ = width
	return strings.Join(lines, "\n")
}

func renderSettingsTags(m model, width int) string {
	var lines []string

	showCursor := m.settSection == settSecTags && m.settActive
	for i, tg := range m.tags {
		prefix := "  "
		if showCursor && i == m.settItemCursor {
			prefix = cursorStyle.Render("> ")
		}
		swatch := lipgloss.NewStyle().Foreground(lipgloss.Color(tg.color)).Render("■")
		nameStyle := lipgloss.NewStyle().Foreground(colorText)
		scopeLabel := " (global)"
		if tg.categoryID != nil {
			scopeLabel = " (" + categoryNameForID(m.categories, *tg.categoryID) + ")"
		}
		lines = append(lines, prefix+swatch+" "+nameStyle.Render(tg.name)+lipgloss.NewStyle().Foreground(colorOverlay1).Render(scopeLabel))
	}
	if len(lines) == 0 {
		lines = append(lines, lipgloss.NewStyle().Foreground(colorOverlay1).Render("No tags. Activate to add."))
	}

	if m.settMode == settModeAddTag || m.settMode == settModeEditTag {
		lines = append(lines, "")
		label := "Add Tag"
		if m.settMode == settModeEditTag {
			label = "Edit Tag"
		}
		lines = append(lines, detailActiveStyle.Render(label))
		nameValue := m.settInput
		if m.settTagFocus == 0 {
			nameValue = renderASCIIInputCursor(m.settInput, m.settInputCursor)
		}
		lines = append(lines, modalCursor(m.settTagFocus == 0)+detailLabelStyle.Render("Name: ")+detailValueStyle.Render(nameValue))
		colors := TagAccentColors()
		var colorRow string
		for i, c := range colors {
			swatch := lipgloss.NewStyle().Foreground(c).Render("■")
			if i == m.settColorIdx {
				swatch = lipgloss.NewStyle().Foreground(c).Bold(true).Render("[■]")
			}
			colorRow += swatch + " "
		}
		lines = append(lines, modalCursor(m.settTagFocus == 1)+detailLabelStyle.Render("Color: ")+colorRow)
		scopeName := "Global"
		if m.settTagScopeID != 0 {
			scopeName = fmt.Sprintf("Category: %s", categoryNameForID(m.categories, m.settTagScopeID))
		}
		lines = append(lines, modalCursor(m.settTagFocus == 2)+detailLabelStyle.Render("Scope: ")+detailValueStyle.Render(scopeName))
		lines = append(lines, scrollStyle.Render(fmt.Sprintf(
			"tab field  %s/%s adjust  %s save  %s cancel",
			actionKeyLabel(m.keys, scopeSettingsModeTag, actionLeft, "left"),
			actionKeyLabel(m.keys, scopeSettingsModeTag, actionRight, "right"),
			actionKeyLabel(m.keys, scopeSettingsModeTag, actionSave, "enter"),
			actionKeyLabel(m.keys, scopeSettingsModeTag, actionClose, "esc"),
		)))
	}
	_ = width
	return strings.Join(lines, "\n")
}

func categoryNameForID(categories []category, id int) string {
	for _, c := range categories {
		if c.id == id {
			return c.name
		}
	}
	return fmt.Sprintf("Category %d", id)
}

func renderASCIIInputCursor(s string, cursor int) string {
	idx := clampInputCursorASCII(s, cursor)
	return s[:idx] + "_" + s[idx:]
}

func renderSettingsRules(m model, width int) string {
	if len(m.rules) == 0 {
		return lipgloss.NewStyle().Foreground(colorOverlay1).Render("No rules. Activate to add.")
	}

	catNames := make(map[int]string, len(m.categories))
	for _, cat := range m.categories {
		catNames[cat.id] = cat.name
	}
	tagNames := make(map[int]string, len(m.tags))
	for _, tg := range m.tags {
		tagNames[tg.id] = tg.name
	}

	var lines []string
	showCursor := m.settSection == settSecRules && m.settActive
	for i, rule := range m.rules {
		prefix := "  "
		if showCursor && i == m.settItemCursor {
			prefix = cursorStyle.Render("> ")
		}
		state := "✓"
		if !rule.enabled {
			state = "✗"
		}
		name := truncate(strings.TrimSpace(rule.name), max(8, width/3))
		filterLabel, filterHealthy := renderRuleFilterLabel(m, rule, width)
		actions := renderRuleActionSummary(rule, catNames, tagNames)
		line := fmt.Sprintf("%2d. %s %s  %s  %s", i+1, state, name, filterLabel, actions)
		switch {
		case !filterHealthy:
			line = lipgloss.NewStyle().Foreground(colorError).Render(line)
		case !rule.enabled:
			line = lipgloss.NewStyle().Foreground(colorOverlay1).Render(line)
		}
		lines = append(lines, prefix+line)
	}
	return strings.Join(lines, "\n")
}

func renderRuleFilterLabel(m model, rule ruleV2, width int) (label string, healthy bool) {
	filterID := strings.TrimSpace(rule.savedFilterID)
	if strings.HasPrefix(filterID, legacyRuleExprPrefix) {
		expr := strings.TrimSpace(strings.TrimPrefix(filterID, legacyRuleExprPrefix))
		if _, err := parseFilterStrict(expr); err != nil {
			return truncate("legacy (invalid)", max(12, width/2)), false
		}
		return truncate(expr, max(12, width/2)), true
	}
	if filterID == "" {
		return "filter:(missing)", false
	}
	sf, ok := m.findSavedFilterByID(filterID)
	if !ok {
		return truncate("filter:"+filterID+" (missing)", max(12, width/2)), false
	}
	if _, err := parseFilterStrict(strings.TrimSpace(sf.Expr)); err != nil {
		return truncate("filter:"+sf.ID+" (invalid)", max(12, width/2)), false
	}
	display := sf.ID
	if name := strings.TrimSpace(sf.Name); name != "" {
		display += " (" + name + ")"
	}
	return truncate("filter:"+display, max(12, width/2)), true
}

func renderRuleActionSummary(rule ruleV2, catNames map[int]string, tagNames map[int]string) string {
	parts := make([]string, 0, 3)
	if rule.setCategoryID != nil {
		if name, ok := catNames[*rule.setCategoryID]; ok {
			parts = append(parts, "→ "+name)
		} else {
			parts = append(parts, fmt.Sprintf("→ #%d", *rule.setCategoryID))
		}
	}
	if len(rule.addTagIDs) > 0 {
		add := make([]string, 0, len(rule.addTagIDs))
		for _, id := range rule.addTagIDs {
			if name, ok := tagNames[id]; ok {
				add = append(add, "+"+name)
			}
		}
		if len(add) > 0 {
			parts = append(parts, strings.Join(add, ","))
		}
	}
	if len(parts) == 0 {
		return "—"
	}
	return strings.Join(parts, " ")
}

func renderSettingsChart(m model, width int) string {
	var lines []string
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

	lines = append(lines, renderInfoPair("Week boundary:  ", spendingWeekAnchorLabel(m.spendingWeekAnchor)))
	lines = append(lines, renderInfoPair("Timeframe:      ", dashTimeframeLabel(m.dashTimeframe)))
	lines = append(lines, renderInfoPair("History window: ", fmt.Sprintf("%d days", days)))
	lines = append(lines, renderInfoPair("Minor grid:     ", fmt.Sprintf("every %d day(s)", minor)))
	lines = append(lines, renderInfoPair("Major grid:     ", major))
	lines = append(lines, "")
	lines = append(lines, scrollStyle.Render(fmt.Sprintf(
		"%s/%s or %s to toggle boundary",
		actionKeyLabel(m.keys, scopeSettingsActiveChart, actionLeft, "h"),
		actionKeyLabel(m.keys, scopeSettingsActiveChart, actionRight, "l"),
		actionKeyLabel(m.keys, scopeSettingsActiveChart, actionConfirm, "enter"),
	)))

	_ = width
	return strings.Join(lines, "\n")
}

func renderSettingsFilters(m model, width int) string {
	ordered := m.orderedSavedFilters()
	var lines []string
	showCursor := m.settSection == settSecFilters && m.settActive
	if len(ordered) == 0 {
		lines = append(lines, lipgloss.NewStyle().Foreground(colorOverlay1).Render("No saved filters. Activate to add."))
		_ = width
		return strings.Join(lines, "\n")
	}
	for i, sf := range ordered {
		prefix := "  "
		if showCursor && i == m.settItemCursor {
			prefix = cursorStyle.Render("> ")
		}
		label := detailLabelStyle.Render(sf.ID)
		name := strings.TrimSpace(sf.Name)
		if name != "" {
			label += lipgloss.NewStyle().Foreground(colorSubtext0).Render(" (" + name + ")")
		}
		expr := lipgloss.NewStyle().Foreground(colorOverlay1).Render(" " + truncate(strings.TrimSpace(sf.Expr), max(16, width/2)))
		lines = append(lines, prefix+label+expr)
	}
	_ = width
	return strings.Join(lines, "\n")
}

func renderSettingsDBImport(m model, width int) string {
	var lines []string
	info := m.dbInfo

	// Database info
	lines = append(lines, renderInfoPair("Schema version:  ", fmt.Sprintf("v%d", info.schemaVersion)))
	lines = append(lines, renderInfoPair("Transactions:    ", fmt.Sprintf("%d", info.transactionCount)))
	lines = append(lines, renderInfoPair("Categories:      ", fmt.Sprintf("%d", info.categoryCount)))
	lines = append(lines, renderInfoPair("Rules:           ", fmt.Sprintf("%d", info.ruleCount)))
	lines = append(lines, renderInfoPair("Tags:            ", fmt.Sprintf("%d", info.tagCount)))
	lines = append(lines, renderInfoPair("Tag Rules:       ", fmt.Sprintf("%d", info.tagRuleCount)))
	lines = append(lines, renderInfoPair("Imports:         ", fmt.Sprintf("%d", info.importCount)))
	lines = append(lines, renderInfoPair("Accounts:        ", fmt.Sprintf("%d", info.accountCount)))
	lines = append(lines, renderInfoPair("Rows per page:   ", fmt.Sprintf("%d", m.maxVisibleRows)))
	lines = append(lines, renderInfoPair("Command default: ", commandDefaultLabel(m.commandDefault)))
	_ = width
	return strings.Join(lines, "\n")
}

func renderSettingsImportHistory(m model, width int) string {
	var lines []string
	if len(m.imports) == 0 {
		lines = append(lines, lipgloss.NewStyle().Foreground(colorOverlay1).Render("No imports yet."))
	} else {
		for _, imp := range m.imports {
			fname := lipgloss.NewStyle().Foreground(colorText).Render(imp.filename)
			count := infoValueStyle.Render(fmt.Sprintf("%d rows", imp.rowCount))
			date := infoLabelStyle.Render(imp.importedAt)
			lines = append(lines, fname+"  "+count+"  "+date)
		}
	}
	_ = width
	return strings.Join(lines, "\n")
}

func renderManagerAccountModal(m model) string {
	title := "Edit Account"
	if m.managerModalIsNew {
		title = "Create Account"
	}

	var body []string

	nameVal := m.managerEditName
	if m.managerEditFocus == 0 {
		nameVal = renderASCIIInputCursor(m.managerEditName, m.managerEditNameCur)
	}
	typeVal := strings.ToUpper(m.managerEditType)
	activeVal := "false"
	if m.managerEditActive {
		activeVal = "true"
	}
	prefixVal := m.managerEditPrefix
	if m.managerEditFocus == 2 {
		prefixVal = renderASCIIInputCursor(m.managerEditPrefix, m.managerEditPrefixCur)
	}

	body = append(body, modalCursor(m.managerEditFocus == 0)+detailLabelStyle.Render("Name:         ")+detailValueStyle.Render(nameVal))
	body = append(body, modalCursor(m.managerEditFocus == 1)+detailLabelStyle.Render("Type:         ")+detailValueStyle.Render(typeVal))
	body = append(body, modalCursor(m.managerEditFocus == 2)+detailLabelStyle.Render("Import Prefix:")+detailValueStyle.Render(" "+prefixVal))
	body = append(body, modalCursor(m.managerEditFocus == 3)+detailLabelStyle.Render("Is Active:    ")+detailValueStyle.Render(activeVal))

	footer := scrollStyle.Render(fmt.Sprintf(
		"tab field  %s toggle  %s save  %s cancel",
		actionKeyLabel(m.keys, scopeManagerModal, actionToggleSelect, "space"),
		actionKeyLabel(m.keys, scopeManagerModal, actionConfirm, "enter"),
		actionKeyLabel(m.keys, scopeManagerModal, actionClose, "esc"),
	))
	return renderModalContent(title, body, footer)
}

func renderFilterEditorModal(m model) string {
	title := "Save Filter"
	if !m.filterEditIsNew {
		title = "Edit Filter"
	}
	idVal := m.filterEditID
	if m.filterEditFocus == 0 {
		idVal = renderASCIIInputCursor(idVal, m.filterEditIDCur)
	}
	nameVal := m.filterEditName
	if m.filterEditFocus == 1 {
		nameVal = renderASCIIInputCursor(nameVal, m.filterEditNameCur)
	}
	exprVal := m.filterEditExpr
	if m.filterEditFocus == 2 {
		exprVal = renderASCIIInputCursor(exprVal, m.filterEditExprCur)
	}
	exprState := lipgloss.NewStyle().Foreground(colorSuccess).Render("ok")
	exprCount := ""
	if strings.TrimSpace(m.filterEditExpr) == "" {
		exprState = lipgloss.NewStyle().Foreground(colorOverlay1).Render("pending")
	} else if node, err := parseFilterStrict(strings.TrimSpace(m.filterEditExpr)); err != nil {
		exprState = lipgloss.NewStyle().Foreground(colorError).Render("invalid")
	} else {
		exprCount = detailLabelStyle.Render(fmt.Sprintf(" · %d txns", m.countFilterMatchesInRulesScope(node)))
	}
	body := []string{
		modalCursor(m.filterEditFocus == 0) + detailLabelStyle.Render("ID:   ") + detailValueStyle.Render(idVal),
		modalCursor(m.filterEditFocus == 1) + detailLabelStyle.Render("Name: ") + detailValueStyle.Render(nameVal),
		modalCursor(m.filterEditFocus == 2) + detailLabelStyle.Render("Expr: ") + detailValueStyle.Render(exprVal) + "  " + exprState + exprCount,
	}
	if strings.TrimSpace(m.filterEditErr) != "" {
		body = append(body, "")
		body = append(body, lipgloss.NewStyle().Foreground(colorError).Render("Error: "+strings.TrimSpace(m.filterEditErr)))
	}
	footer := scrollStyle.Render(fmt.Sprintf(
		"tab field  %s save  %s cancel",
		actionKeyLabel(m.keys, scopeFilterEdit, actionSave, "enter"),
		actionKeyLabel(m.keys, scopeFilterEdit, actionClose, "esc"),
	))
	return renderModalContentWithWidth(title, body, footer, 72)
}

func selectedTagNames(ids []int, tags []tag) string {
	if len(ids) == 0 {
		return "(none)"
	}
	names := make([]string, 0, len(ids))
	for _, id := range ids {
		for _, tg := range tags {
			if tg.id == id {
				names = append(names, tg.name)
				break
			}
		}
	}
	if len(names) == 0 {
		return "(none)"
	}
	return strings.Join(names, ", ")
}

func renderRuleEditorModal(m model) string {
	title := "Add Rule"
	if m.ruleEditorID > 0 {
		title = "Edit Rule"
	}

	nameVal := m.ruleEditorName
	if m.ruleEditorStep == 0 {
		nameVal = renderASCIIInputCursor(nameVal, m.ruleEditorNameCur)
	}
	filterVal := strings.TrimSpace(m.ruleEditorFilterID)
	filterState := lipgloss.NewStyle().Foreground(colorOverlay1).Render("pending")
	filterCount := ""
	if filterVal != "" {
		filterState = lipgloss.NewStyle().Foreground(colorSuccess).Render("ok")
		if sf, ok := m.findSavedFilterByID(filterVal); ok {
			if node, err := parseFilterStrict(strings.TrimSpace(sf.Expr)); err != nil {
				filterState = lipgloss.NewStyle().Foreground(colorError).Render("invalid")
				filterVal = sf.ID
			} else {
				filterCount = detailLabelStyle.Render(fmt.Sprintf(" · %d txns", m.countFilterMatchesInRulesScope(node)))
				filterVal = sf.ID
				if strings.TrimSpace(sf.Name) != "" {
					filterVal += " (" + strings.TrimSpace(sf.Name) + ")"
				}
			}
		} else if strings.HasPrefix(filterVal, legacyRuleExprPrefix) {
			expr := strings.TrimSpace(strings.TrimPrefix(filterVal, legacyRuleExprPrefix))
			if node, err := parseFilterStrict(expr); err != nil {
				filterState = lipgloss.NewStyle().Foreground(colorError).Render("invalid")
			} else {
				filterCount = detailLabelStyle.Render(fmt.Sprintf(" · %d txns", m.countFilterMatchesInRulesScope(node)))
			}
			filterVal = truncate(expr, 48)
		} else {
			filterState = lipgloss.NewStyle().Foreground(colorError).Render("missing")
		}
	}
	catName := "No category change"
	if m.ruleEditorCatID != nil {
		catName = categoryNameForID(m.categories, *m.ruleEditorCatID)
	}

	addTags := selectedTagNames(m.ruleEditorAddTags, m.tags)
	enabledVal := "Yes"
	if !m.ruleEditorEnabled {
		enabledVal = "No"
	}

	body := []string{
		modalCursor(m.ruleEditorStep == 0) + detailLabelStyle.Render("1 Name:      ") + detailValueStyle.Render(nameVal),
		modalCursor(m.ruleEditorStep == 1) + detailLabelStyle.Render("2 Filter:    ") + detailValueStyle.Render(filterVal) + "  " + filterState + filterCount,
		modalCursor(m.ruleEditorStep == 2) + detailLabelStyle.Render("3 Category:  ") + detailValueStyle.Render(catName),
		modalCursor(m.ruleEditorStep == 3) + detailLabelStyle.Render("4 Add tags:  ") + detailValueStyle.Render(addTags),
		modalCursor(m.ruleEditorStep == 4) + detailLabelStyle.Render("5 Enabled:   ") + detailValueStyle.Render(enabledVal),
	}
	if strings.TrimSpace(m.ruleEditorErr) != "" {
		body = append(body, "")
		body = append(body, lipgloss.NewStyle().Foreground(colorError).Render(strings.TrimSpace(m.ruleEditorErr)))
	}

	footer := scrollStyle.Render(fmt.Sprintf(
		"tab step  %s toggle  %s pick/save  %s cancel",
		actionKeyLabel(m.keys, scopeRuleEditor, actionToggleSelect, "space"),
		actionKeyLabel(m.keys, scopeRuleEditor, actionSelect, "enter"),
		actionKeyLabel(m.keys, scopeRuleEditor, actionClose, "esc"),
	))
	return renderModalContentWithWidth(title, body, footer, 92)
}

func (m model) countFilterMatchesInRulesScope(node *filterNode) int {
	if node == nil {
		return 0
	}
	scope := m.buildAccountScopeFilter()
	count := 0
	for _, row := range m.rows {
		rowTags := m.txnTags[row.id]
		if scope != nil && !evalFilter(scope, row, rowTags) {
			continue
		}
		if evalFilter(node, row, rowTags) {
			count++
		}
	}
	return count
}

func renderDryRunResultsModal(m model) string {
	body := []string{
		detailLabelStyle.Render("Scope: ") + detailValueStyle.Render(m.dryRunScopeLabel),
		detailLabelStyle.Render("Summary: ") + detailValueStyle.Render(fmt.Sprintf(
			"%d modified, %d category changes, %d tag changes, %d failed rules",
			m.dryRunSummary.totalModified,
			m.dryRunSummary.totalCatChange,
			m.dryRunSummary.totalTagChange,
			m.dryRunSummary.failedRules,
		)),
		"",
	}

	start := m.dryRunScroll
	if start < 0 {
		start = 0
	}
	if start >= len(m.dryRunResults) {
		start = max(0, len(m.dryRunResults)-1)
	}
	end := start + 3
	if end > len(m.dryRunResults) {
		end = len(m.dryRunResults)
	}
	for i := start; i < end; i++ {
		res := m.dryRunResults[i]
		state := "enabled"
		if !res.rule.enabled {
			state = "disabled"
		}
		body = append(body, detailActiveStyle.Render(fmt.Sprintf("Rule %d: %q (%s)", i+1, res.rule.name, state)))
		body = append(body, detailLabelStyle.Render("  Filter: ")+detailValueStyle.Render(strings.TrimSpace(res.filterExpr)))
		body = append(body, detailLabelStyle.Render("  Matches: ")+detailValueStyle.Render(fmt.Sprintf("%d", res.matchCount)))
		body = append(body, detailLabelStyle.Render("  Changes: ")+detailValueStyle.Render(fmt.Sprintf("%d category, %d tags", res.catChanges, res.tagChanges)))
		for _, sample := range res.samples {
			body = append(body, detailValueStyle.Render(fmt.Sprintf("    %s  %s  %s", sample.txn.dateISO, formatMoney(sample.txn.amount), truncate(sample.txn.description, 32))))
		}
		body = append(body, "")
	}
	if len(m.dryRunResults) == 0 {
		body = append(body, lipgloss.NewStyle().Foreground(colorOverlay1).Render("No enabled rules to evaluate."))
	}
	footer := scrollStyle.Render(fmt.Sprintf(
		"%s/%s scroll  %s close",
		actionKeyLabel(m.keys, scopeDryRunModal, actionUp, "k"),
		actionKeyLabel(m.keys, scopeDryRunModal, actionDown, "j"),
		actionKeyLabel(m.keys, scopeDryRunModal, actionClose, "esc"),
	))
	return renderModalContentWithWidth("Dry-Run Results", body, footer, 96)
}

func renderBudgetTable(m model) string {
	w := m.sectionBoxContentWidth(m.sectionWidth())

	// -- Category Budgets pane --
	catBudgetFocused := m.budgetCursor < len(m.budgetLines)
	catContent := renderBudgetCategoryTable(m, w)
	catTitle := fmt.Sprintf("Category Budgets (%d)", len(m.budgetLines))
	catPane := renderManagerSectionBox(catTitle, catBudgetFocused, m.budgetEditing && catBudgetFocused, m.sectionWidth(), catContent)

	// -- Spending Targets pane --
	targetFocused := !catBudgetFocused && len(m.targetLines) > 0
	targetContent := renderBudgetTargetTable(m, w)
	targetTitle := fmt.Sprintf("Spending Targets (%d)", len(m.targetLines))
	targetPane := renderManagerSectionBox(targetTitle, targetFocused, m.budgetEditing && targetFocused, m.sectionWidth(), targetContent)

	// -- Compare bars (wide strip) --
	compareContent := renderBudgetCompareBarsWide(m, w)
	comparePane := renderTitledSectionBox("Compare Bars", compareContent, m.sectionWidth(), false)

	// -- Analytics strip --
	analyticsContent := renderBudgetAnalyticsStrip(m, w)
	analyticsPane := renderTitledSectionBox("Analytics", analyticsContent, m.sectionWidth(), false)

	return catPane + "\n" + targetPane + "\n" + comparePane + "\n" + analyticsPane
}

func renderBudgetCategoryTable(m model, width int) string {
	if len(m.budgetLines) == 0 {
		return lipgloss.NewStyle().Foreground(colorOverlay1).Render("No category budgets. Categories auto-seed budget rows.")
	}

	// Column widths
	swatchW := 2 // "● "
	catW := 18
	budgetedW := 11
	spentW := 11
	offsetsW := 10
	remainW := 11
	overW := 5
	sep := " "

	header := fmt.Sprintf("  %-*s %*s %*s %*s %*s",
		swatchW+catW, "Category",
		budgetedW, "Budgeted",
		spentW, "Spent",
		offsetsW, "Offsets",
		remainW, "Remaining",
	)
	lines := []string{tableHeaderStyle.Render(header)}

	for i, line := range m.budgetLines {
		isCursor := i == m.budgetCursor
		rowBg := lipgloss.Color("")
		bold := false
		if isCursor {
			rowBg = colorSurface2
			bold = true
		}
		cellStyle := lipgloss.NewStyle().Background(rowBg)
		if bold {
			cellStyle = cellStyle.Bold(true)
		}
		sepField := cellStyle.Render(sep)

		// Category swatch + name
		swatchColor := colorOverlay1
		if line.categoryColor != "" && line.categoryColor != "#7f849c" {
			swatchColor = lipgloss.Color(line.categoryColor)
		}
		swatch := lipgloss.NewStyle().Foreground(swatchColor).Background(rowBg).Render("● ")
		catField := cellStyle.Render(padRight(truncate(line.categoryName, catW), catW))

		// Amounts
		budgetedText := fmt.Sprintf("%*s", budgetedW, formatMoney(line.budgeted))
		budgetedField := lipgloss.NewStyle().Foreground(colorSubtext0).Background(rowBg).Bold(bold).Render(budgetedText)

		spentText := fmt.Sprintf("%*s", spentW, formatMoney(line.spent))
		spentField := lipgloss.NewStyle().Foreground(colorError).Background(rowBg).Bold(bold).Render(spentText)

		offsetsText := fmt.Sprintf("%*s", offsetsW, formatMoney(line.offsets))
		offsetsField := lipgloss.NewStyle().Foreground(colorSuccess).Background(rowBg).Bold(bold).Render(offsetsText)

		remainColor := colorSuccess
		if line.overBudget {
			remainColor = colorError
		}
		remainText := fmt.Sprintf("%*s", remainW, formatMoney(line.remaining))
		remainField := lipgloss.NewStyle().Foreground(remainColor).Background(rowBg).Bold(bold).Render(remainText)

		overField := ""
		if line.overBudget {
			overField = lipgloss.NewStyle().Foreground(colorError).Background(rowBg).Bold(true).Render(" OVER")
		} else {
			overField = cellStyle.Render(strings.Repeat(" ", overW))
		}

		row := cellStyle.Render("  ") + swatch + catField + sepField + budgetedField + sepField + spentField + sepField + offsetsField + sepField + remainField + overField

		// Inline edit indicator
		if m.budgetEditing && isCursor {
			editStyle := lipgloss.NewStyle().Foreground(colorAccent).Background(rowBg).Bold(true)
			row += editStyle.Render("  [") + editStyle.Render(renderASCIIInputCursor(m.budgetEditValue, m.budgetEditCursor)) + editStyle.Render("]")
		}

		// Ensure row spans full width
		row = ansi.Truncate(row, width, "")
		row += cellStyle.Render(strings.Repeat(" ", max(0, width-ansi.StringWidth(row))))
		lines = append(lines, row)
	}

	return strings.Join(lines, "\n")
}

func renderBudgetTargetTable(m model, width int) string {
	if len(m.targetLines) == 0 {
		return lipgloss.NewStyle().Foreground(colorOverlay1).Render("No spending targets. Press 'a' to add one.")
	}

	nameW := 22
	periodW := 10
	budgetedW := 11
	spentW := 11
	remainW := 11
	sep := " "

	header := fmt.Sprintf("  %-*s %-*s %*s %*s %*s",
		nameW, "Target",
		periodW, "Period",
		budgetedW, "Budgeted",
		spentW, "Spent",
		remainW, "Remaining",
	)
	lines := []string{tableHeaderStyle.Render(header)}

	for i, t := range m.targetLines {
		rowIdx := len(m.budgetLines) + i
		isCursor := rowIdx == m.budgetCursor
		rowBg := lipgloss.Color("")
		bold := false
		if isCursor {
			rowBg = colorSurface2
			bold = true
		}
		cellStyle := lipgloss.NewStyle().Background(rowBg)
		if bold {
			cellStyle = cellStyle.Bold(true)
		}
		sepField := cellStyle.Render(sep)

		nameField := cellStyle.Render(padRight(truncate(t.name, nameW), nameW))
		periodField := lipgloss.NewStyle().Foreground(colorSubtext1).Background(rowBg).Bold(bold).Render(padRight(t.periodType, periodW))

		budgetedField := lipgloss.NewStyle().Foreground(colorSubtext0).Background(rowBg).Bold(bold).Render(fmt.Sprintf("%*s", budgetedW, formatMoney(t.budgeted)))

		spentField := lipgloss.NewStyle().Foreground(colorError).Background(rowBg).Bold(bold).Render(fmt.Sprintf("%*s", spentW, formatMoney(t.spent)))

		remainColor := colorSuccess
		if t.overBudget {
			remainColor = colorError
		}
		remainField := lipgloss.NewStyle().Foreground(remainColor).Background(rowBg).Bold(bold).Render(fmt.Sprintf("%*s", remainW, formatMoney(t.remaining)))

		row := cellStyle.Render("  ") + nameField + sepField + periodField + sepField + budgetedField + sepField + spentField + sepField + remainField

		row = ansi.Truncate(row, width, "")
		row += cellStyle.Render(strings.Repeat(" ", max(0, width-ansi.StringWidth(row))))
		lines = append(lines, row)
	}

	return strings.Join(lines, "\n")
}

func renderBudgetCompareBarsWide(m model, width int) string {
	rows := rowsForBudgetMonthAndScope(m, m.budgetMonth)
	allScopedRows := rowsForBudgetScopeAllMonths(m)
	lines := []string{
		renderDashboardCompareBarsMode(m, widgetMode{id: "budget_vs_actual"}, rows, width),
		renderDashboardCompareBarsMode(m, widgetMode{id: "income_vs_expense"}, rows, width),
		renderDashboardCompareBarsMode(m, widgetMode{id: "month_over_month"}, allScopedRows, width),
	}
	return strings.Join(lines, "\n")
}

func renderBudgetAnalyticsStrip(m model, width int) string {
	greenSty := lipgloss.NewStyle().Foreground(colorSuccess)
	redSty := lipgloss.NewStyle().Foreground(colorError)
	warnSty := lipgloss.NewStyle().Foreground(colorWarning)

	adherenceColor := greenSty
	if m.budgetAdherencePct < 50 {
		adherenceColor = redSty
	} else if m.budgetAdherencePct < 80 {
		adherenceColor = warnSty
	}

	overColor := greenSty
	if m.budgetOverCount > 0 {
		overColor = redSty
	}

	totalOffsets := 0.0
	for _, line := range m.budgetLines {
		totalOffsets += line.offsets
	}

	col1W := 24
	col2W := 20
	col3W := width - col1W - col2W
	if col3W < 10 {
		col3W = 10
	}

	row := padRight(infoLabelStyle.Render("Adherence  ")+adherenceColor.Render(fmt.Sprintf("%.0f%%", m.budgetAdherencePct)), col1W) +
		padRight(infoLabelStyle.Render("Over  ")+overColor.Render(fmt.Sprintf("%d", m.budgetOverCount)), col2W) +
		padRight(infoLabelStyle.Render("Offsets  ")+greenSty.Render(formatMoney(totalOffsets)), col3W)

	currentSpend := budgetMonthSpendForScope(m, m.budgetMonth)
	prevMonth := previousMonthKey(m.budgetMonth)
	prevSpend := budgetMonthSpendForScope(m, prevMonth)
	momDelta := currentSpend - prevSpend
	momPctText := "n/a"
	if prevSpend > 0 {
		momPctText = fmt.Sprintf("%+.1f%%", (momDelta/prevSpend)*100)
	}
	momColor := greenSty
	if momDelta > 0 {
		momColor = redSty
	}
	momLine := infoLabelStyle.Render("MoM Spend  ") +
		infoValueStyle.Render(formatMoney(currentSpend)) +
		infoLabelStyle.Render(" vs ") +
		infoValueStyle.Render(formatMoney(prevSpend)) +
		infoLabelStyle.Render(" (") +
		momColor.Render(momPctText) +
		infoLabelStyle.Render(")")

	sparkLabel := infoLabelStyle.Render("Variance  ")
	sparkline := renderBudgetVarianceSparkline(m.budgetVarSparkline)

	return row + "\n" + momLine + "\n" + sparkLabel + sparkline
}

func budgetMonthSpendForScope(m model, monthKey string) float64 {
	rows := rowsForBudgetMonthAndScope(m, monthKey)
	total := 0.0
	for _, row := range rows {
		if row.amount >= 0 {
			continue
		}
		total += -row.amount
	}
	return total
}

func rowsForBudgetMonthAndScope(m model, monthKey string) []transaction {
	if strings.TrimSpace(monthKey) == "" {
		return nil
	}
	allRows := rowsForBudgetScopeAllMonths(m)
	out := make([]transaction, 0)
	for _, row := range allRows {
		if !strings.HasPrefix(row.dateISO, monthKey+"-") {
			continue
		}
		out = append(out, row)
	}
	return out
}

func rowsForBudgetScopeAllMonths(m model) []transaction {
	var allowedAccounts map[string]bool
	if len(m.filterAccounts) > 0 {
		allowedAccounts = make(map[string]bool, len(m.filterAccounts))
		for _, acc := range m.accounts {
			if !m.filterAccounts[acc.id] {
				continue
			}
			name := strings.ToLower(strings.TrimSpace(acc.name))
			if name != "" {
				allowedAccounts[name] = true
			}
		}
	}
	out := make([]transaction, 0)
	for _, row := range m.rows {
		if allowedAccounts != nil {
			name := strings.ToLower(strings.TrimSpace(row.accountName))
			if !allowedAccounts[name] {
				continue
			}
		}
		out = append(out, row)
	}
	return out
}

func renderBudgetPlanner(m model) string {
	w := m.sectionBoxContentWidth(m.sectionWidth())

	plannerContent := renderBudgetPlannerGrid(m, w)
	plannerTitle := fmt.Sprintf("Budget Planner - %d", m.budgetYear)
	plannerPane := renderManagerSectionBox(plannerTitle, true, m.budgetEditing, m.sectionWidth(), plannerContent)

	return plannerPane
}

func renderBudgetPlannerGrid(m model, width int) string {
	if len(m.budgetLines) == 0 {
		return lipgloss.NewStyle().Foreground(colorOverlay1).Render("No category budgets.")
	}

	catW := 16
	monthW := 7
	months := []string{"Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"}
	sep := " "

	// Header
	headerParts := fmt.Sprintf("  %-*s", catW, "Category")
	for _, mon := range months {
		headerParts += sep + fmt.Sprintf("%*s", monthW, mon)
	}
	lines := []string{tableHeaderStyle.Render(headerParts)}

	for i, line := range m.budgetLines {
		isCursor := i == m.budgetCursor
		rowBg := lipgloss.Color("")
		bold := false
		if isCursor {
			rowBg = colorSurface2
			bold = true
		}
		cellStyle := lipgloss.NewStyle().Background(rowBg)
		if bold {
			cellStyle = cellStyle.Bold(true)
		}

		// Category swatch + name
		swatchColor := colorOverlay1
		if line.categoryColor != "" && line.categoryColor != "#7f849c" {
			swatchColor = lipgloss.Color(line.categoryColor)
		}
		swatch := lipgloss.NewStyle().Foreground(swatchColor).Background(rowBg).Render("● ")
		catName := cellStyle.Render(padRight(truncate(line.categoryName, catW-2), catW-2))
		row := swatch + catName

		for month := 1; month <= 12; month++ {
			amount := line.budgeted
			isOverride := false
			if id := budgetIDForCategory(m.categoryBudgets, line.categoryID); id != 0 {
				key := fmt.Sprintf("%04d-%02d", m.budgetYear, month)
				if ov, ok := budgetOverrideAmount(m.budgetOverrides[id], key); ok {
					amount = ov
					isOverride = true
				}
			}
			isCursorCell := isCursor && (month-1 == m.budgetPlannerCol)

			amtStyle := lipgloss.NewStyle().Background(rowBg)
			if bold {
				amtStyle = amtStyle.Bold(true)
			}
			if isCursorCell {
				amtStyle = amtStyle.Foreground(colorAccent).Bold(true)
			} else if isOverride {
				amtStyle = amtStyle.Foreground(colorWarning)
			} else {
				amtStyle = amtStyle.Foreground(colorSubtext0)
			}

			amtText := fmt.Sprintf("%*.0f", monthW, amount)
			if isOverride && !isCursorCell {
				amtText = fmt.Sprintf("%*.0f", monthW-1, amount) + "*"
			}
			row += cellStyle.Render(sep) + amtStyle.Render(amtText)
		}

		// Inline edit indicator
		if m.budgetEditing && isCursor {
			editStyle := lipgloss.NewStyle().Foreground(colorAccent).Background(rowBg).Bold(true)
			row += editStyle.Render(" [") + editStyle.Render(renderASCIIInputCursor(m.budgetEditValue, m.budgetEditCursor)) + editStyle.Render("]")
		}

		row = ansi.Truncate(row, width, "")
		row += cellStyle.Render(strings.Repeat(" ", max(0, width-ansi.StringWidth(row))))
		lines = append(lines, row)
	}

	return strings.Join(lines, "\n")
}

func renderBudgetVarianceSparkline(series []float64) string {
	if len(series) == 0 {
		return "-"
	}
	var b strings.Builder
	for _, v := range series {
		switch {
		case v < -100:
			b.WriteString("▁")
		case v < -10:
			b.WriteString("▂")
		case v < 0:
			b.WriteString("▃")
		case v < 10:
			b.WriteString("▄")
		case v < 100:
			b.WriteString("▆")
		default:
			b.WriteString("█")
		}
	}
	return b.String()
}

func budgetIDForCategory(budgets []categoryBudget, categoryID int) int {
	for _, b := range budgets {
		if b.categoryID == categoryID {
			return b.id
		}
	}
	return 0
}

func budgetOverrideAmount(overrides []budgetOverride, monthKey string) (float64, bool) {
	for _, ov := range overrides {
		if ov.monthKey == monthKey {
			return ov.amount, true
		}
	}
	return 0, false
}

// renderDetail renders the transaction detail modal content.
func renderDetail(txn transaction, tags []tag, notes string, notesCursor int, editing string, keys *KeyRegistry) string {
	return renderDetailWithOffsets(txn, tags, notes, notesCursor, editing, "", 0, nil, nil, keys)
}

func renderDetailWithOffsets(txn transaction, tags []tag, notes string, notesCursor int, editing string, offsetAmount string, offsetAmountCursor int, offsetsByCredit map[int][]creditOffset, allRows []transaction, keys *KeyRegistry) string {
	const detailModalWidth = 52
	const detailTextWrap = 40
	var body []string

	amtStyle := detailValueStyle
	if txn.amount > 0 {
		amtStyle = creditStyle
	} else if txn.amount < 0 {
		amtStyle = debitStyle
	}
	dateAmountLine := detailLabelStyle.Render("Date: ") + detailValueStyle.Render(txn.dateISO) + "  " +
		detailLabelStyle.Render("Amount: ") + amtStyle.Render(fmt.Sprintf("%.2f", txn.amount))
	body = append(body, dateAmountLine)

	catDisplay := "Uncategorised"
	if strings.TrimSpace(txn.categoryName) != "" {
		catDisplay = txn.categoryName
	}
	catStyle := detailValueStyle
	if strings.TrimSpace(txn.categoryColor) != "" && txn.categoryColor != "#7f849c" {
		catStyle = lipgloss.NewStyle().Foreground(lipgloss.Color(txn.categoryColor))
	}
	body = append(body, detailLabelStyle.Render("Category:    ")+catStyle.Render(catDisplay))

	tagDisplay := "-"
	if len(tags) > 0 {
		var names []string
		for _, tg := range tags {
			names = append(names, tg.name)
		}
		tagDisplay = strings.Join(names, " ")
	}
	tagPrefix := "Tags:        "
	tagLines := splitLines(wrapText(tagDisplay, detailTextWrap))
	if len(tagLines) == 0 {
		tagLines = []string{"-"}
	}
	body = append(body, detailLabelStyle.Render(tagPrefix)+detailValueStyle.Render(tagLines[0]))
	tagIndent := strings.Repeat(" ", ansi.StringWidth(tagPrefix))
	for _, line := range tagLines[1:] {
		body = append(body, detailValueStyle.Render(tagIndent+line))
	}
	body = append(body, "")

	body = append(body, detailLabelStyle.Render("Description"))
	descLines := splitLines(wrapText(txn.description, detailTextWrap))
	for _, line := range descLines {
		body = append(body, detailValueStyle.Render(line))
	}
	body = append(body, "")

	if txn.amount > 0 {
		offsets := offsetsByCredit[txn.id]
		if len(offsets) > 0 {
			totalOffsets := 0.0
			for _, off := range offsets {
				totalOffsets += off.amount
			}
			body = append(body, detailLabelStyle.Render("Offsets:     ")+creditStyle.Render(formatMoney(totalOffsets)))
			// Per-offset debit details
			indent := "  └─ "
			for _, off := range offsets {
				debitDesc := "unknown"
				debitDate := ""
				debitAmt := 0.0
				for _, r := range allRows {
					if r.id == off.debitTxnID {
						debitDesc = truncate(r.description, 24)
						debitDate = r.dateISO
						debitAmt = r.amount
						break
					}
				}
				line := detailLabelStyle.Render(indent) +
					debitStyle.Render(formatMoney(off.amount)) +
					detailLabelStyle.Render(" → ") +
					detailValueStyle.Render(debitDesc)
				if debitDate != "" {
					line += detailLabelStyle.Render(fmt.Sprintf(" (%s, %s)", debitDate, formatMoney(debitAmt)))
				}
				body = append(body, line)
			}
		} else {
			body = append(body, detailLabelStyle.Render("Offsets:     ")+lipgloss.NewStyle().Foreground(colorOverlay1).Render("none"))
		}
		body = append(body, "")
	}

	// Notes
	notesLabel := detailLabelStyle.Render("Notes: ")
	notePrefix := "Notes: "
	indentPrefix := strings.Repeat(" ", ansi.StringWidth(notePrefix))
	footer := ""
	if editing == "offset_amount" {
		body = append(body, detailActiveStyle.Render("Offset amount: ")+detailValueStyle.Render(renderASCIIInputCursor(offsetAmount, offsetAmountCursor)))
		footer = scrollStyle.Render(fmt.Sprintf(
			"%s link  %s cancel",
			actionKeyLabel(keys, scopeDetailModal, actionSelect, "enter"),
			actionKeyLabel(keys, scopeDetailModal, actionClose, "esc"),
		))
	} else if editing == "notes" {
		notesLabel = detailActiveStyle.Render("Notes: ")
		noteLines := splitLines(wrapText(renderASCIIInputCursor(notes, notesCursor), detailTextWrap))
		if len(noteLines) == 0 {
			noteLines = []string{""}
		}
		body = append(body, notesLabel+detailValueStyle.Render(noteLines[0]))
		for _, line := range noteLines[1:] {
			body = append(body, detailValueStyle.Render(indentPrefix+line))
		}
		footer = scrollStyle.Render(fmt.Sprintf(
			"%s done  %s close",
			actionKeyLabel(keys, scopeDetailModal, actionSelect, "enter"),
			actionKeyLabel(keys, scopeDetailModal, actionClose, "esc"),
		))
	} else {
		display := notes
		if display == "" {
			display = fmt.Sprintf("(empty - press %s to edit)", actionKeyLabel(keys, scopeDetailModal, actionEdit, "n"))
		}
		noteLines := splitLines(wrapText(display, detailTextWrap))
		if len(noteLines) == 0 {
			noteLines = []string{""}
		}
		body = append(body, notesLabel+detailValueStyle.Render(noteLines[0]))
		for _, line := range noteLines[1:] {
			body = append(body, detailValueStyle.Render(indentPrefix+line))
		}
		footerParts := fmt.Sprintf("%s notes", actionKeyLabel(keys, scopeDetailModal, actionEdit, "n"))
		footerParts += fmt.Sprintf("  %s save  %s close",
			actionKeyLabel(keys, scopeDetailModal, actionSelect, "enter"),
			actionKeyLabel(keys, scopeDetailModal, actionClose, "esc"),
		)
		footer = scrollStyle.Render(footerParts)
	}

	return renderModalContentWithWidth("Transaction Details", body, footer, detailModalWidth)
}

func wrapText(s string, width int) string {
	if width <= 0 {
		return s
	}
	var lines []string
	for _, rawLine := range strings.Split(s, "\n") {
		line := strings.TrimSpace(rawLine)
		if line == "" {
			lines = append(lines, "")
			continue
		}
		words := strings.Fields(line)
		current := ""
		for _, word := range words {
			if ansi.StringWidth(word) > width {
				if current != "" {
					lines = append(lines, current)
					current = ""
				}
				runes := []rune(word)
				part := ""
				for _, r := range runes {
					next := part + string(r)
					if ansi.StringWidth(next) > width {
						if part != "" {
							lines = append(lines, part)
						}
						part = string(r)
						continue
					}
					part = next
				}
				if part != "" {
					current = part
				}
				continue
			}
			if current == "" {
				current = word
				continue
			}
			if ansi.StringWidth(current)+1+ansi.StringWidth(word) <= width {
				current += " " + word
				continue
			}
			lines = append(lines, current)
			current = word
		}
		if current != "" {
			lines = append(lines, current)
		}
	}
	if len(lines) == 0 {
		return ""
	}
	return strings.Join(lines, "\n")
}
