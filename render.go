package main

import (
	"fmt"
	"strings"

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
)

// ---------------------------------------------------------------------------
// Tab names
// ---------------------------------------------------------------------------

var tabNames = []string{"Dashboard", "Transactions", "Analytics", "Settings"}

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
	contentWidth := m.sectionContentWidth()
	header := padRight(titleStyle.Render(title), contentWidth)
	sepStyle := lipgloss.NewStyle().Foreground(colorSurface2)
	separator := sepStyle.Render(strings.Repeat("─", contentWidth))
	sectionContent := header + "\n" + separator + "\n" + content
	section := listBoxStyle.Width(m.sectionWidth()).Render(sectionContent)
	if m.width == 0 {
		return section
	}
	return lipgloss.Place(m.width, lipgloss.Height(section), lipgloss.Center, lipgloss.Top, section)
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

func (m model) renderStatus(text string) string {
	flat := strings.ReplaceAll(text, "\n", " ")
	if m.width == 0 {
		return statusBarStyle.Render(flat)
	}
	return statusBarStyle.Width(m.width).Render(flat)
}

func (m model) placeWithFooter(body, statusLine, footer string) string {
	if m.height == 0 {
		return body + "\n\n" + statusLine + "\n" + footer
	}
	contentHeight := m.height - 2
	if contentHeight < 1 {
		contentHeight = 1
	}
	if lipgloss.Height(body) >= contentHeight {
		return body + "\n" + statusLine + "\n" + footer
	}
	main := lipgloss.Place(m.width, contentHeight, lipgloss.Left, lipgloss.Top, body)
	// Ensure every line is full-width to prevent ghosting from previous frames
	lines := splitLines(main)
	for i, line := range lines {
		lines[i] = padRight(line, m.width)
	}
	main = strings.Join(lines, "\n")
	return main + "\n" + statusLine + "\n" + footer
}

// ---------------------------------------------------------------------------
// Modal overlay
// ---------------------------------------------------------------------------

func (m model) composeModal(base, statusLine, footer string) string {
	baseView := m.placeWithFooter(base, statusLine, footer)
	if m.height == 0 || m.width == 0 {
		return baseView + "\n\n" + m.popupView()
	}
	modalContent := lipgloss.NewStyle().Width(m.fileList.Width()).Render(m.popupView())
	modal := modalStyle.Render(modalContent)
	lines := splitLines(modal)
	modalWidth := maxLineWidth(lines)
	modalHeight := len(lines)

	targetHeight := m.height - 2
	if targetHeight < 1 {
		targetHeight = 1
	}
	x := (m.width - modalWidth) / 2
	if x < 0 {
		x = 0
	}
	y := (targetHeight - modalHeight) / 2
	if y < 0 {
		y = 0
	}
	return overlayAt(baseView, modal, x, y, m.width, targetHeight)
}

func (m model) popupView() string {
	if !m.listReady {
		return "Loading CSV files..."
	}
	return m.fileList.View()
}

// ---------------------------------------------------------------------------
// Data rendering
// ---------------------------------------------------------------------------

func renderTable(rows []transaction, cursor, topIndex, visible, width int, colorAmounts bool) string {
	cursorWidth := 2
	dateWidth := 12
	amountWidth := 12
	descWidth := width - dateWidth - amountWidth - cursorWidth - 6
	if descWidth < 5 {
		descWidth = 5
	}

	header := fmt.Sprintf("  %-*s  %-*s  %-*s", dateWidth, "Date", amountWidth, "Amount", descWidth, "Description")
	headerLine := tableHeaderStyle.Render(header)
	lines := []string{headerLine}

	end := topIndex + visible
	if end > len(rows) {
		end = len(rows)
	}
	for i := topIndex; i < end; i++ {
		row := rows[i]
		amountText := fmt.Sprintf("%.2f", row.amount)
		amountField := padRight(amountText, amountWidth)
		if colorAmounts {
			if row.amount > 0 {
				amountField = creditStyle.Render(amountField)
			} else if row.amount < 0 {
				amountField = debitStyle.Render(amountField)
			}
		}
		desc := truncate(row.description, descWidth)
		prefix := "  "
		if i == cursor {
			prefix = cursorStyle.Render("> ")
		}
		dateField := padRight(row.dateRaw, dateWidth)
		descField := padRight(desc, descWidth)
		lines = append(lines, prefix+dateField+"  "+amountField+"  "+descField)
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

func renderOverview(rows []transaction, width int) string {
	net, debits := 0.0, 0.0
	for _, row := range rows {
		net += row.amount
		if row.amount < 0 {
			debits += row.amount
		}
	}
	labelStyle := lipgloss.NewStyle().Foreground(colorSubtext0)
	valueStyle := lipgloss.NewStyle().Foreground(colorPeach)

	lines := []string{
		labelStyle.Render(fmt.Sprintf("%-12s", "Net Value")) + " " + valueStyle.Render(fmt.Sprintf("%12.2f", net)),
		labelStyle.Render(fmt.Sprintf("%-12s", "Net Debits")) + " " + valueStyle.Render(fmt.Sprintf("%12.2f", debits)),
	}
	for i, line := range lines {
		lines[i] = padRight(line, width)
	}
	return strings.Join(lines, "\n")
}

func overviewLineCount() int {
	return 2
}
