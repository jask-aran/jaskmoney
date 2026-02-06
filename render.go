package main

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/bubbles/key"
	"github.com/charmbracelet/lipgloss"
)

// ---------------------------------------------------------------------------
// Styles — single source of truth for all lipgloss styles
// ---------------------------------------------------------------------------

var (
	titleStyle     = lipgloss.NewStyle().Bold(true)
	statusStyle    = lipgloss.NewStyle().Foreground(lipgloss.Color("241"))
	footerStyle    = lipgloss.NewStyle().Foreground(lipgloss.Color("255")).Background(lipgloss.Color("238")).Padding(0, 2)
	statusBarStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("252")).Background(lipgloss.Color("236")).Padding(0, 2)
	modalStyle     = lipgloss.NewStyle().Border(lipgloss.RoundedBorder()).Padding(0, 1)
	listBoxStyle   = lipgloss.NewStyle().Border(lipgloss.RoundedBorder()).Padding(0, 1)
)

// ---------------------------------------------------------------------------
// Section & chrome rendering
// ---------------------------------------------------------------------------

func (m model) renderSection(title, content string) string {
	header := titleStyle.Render(title)
	section := header + "\n" + listBoxStyle.Width(m.sectionWidth()).Render(content)
	if m.width == 0 {
		return section
	}
	return lipgloss.Place(m.width, lipgloss.Height(section), lipgloss.Center, lipgloss.Top, section)
}

func (m model) renderFooter(text string) string {
	if m.width == 0 {
		return footerStyle.Render(text)
	}
	flat := strings.ReplaceAll(text, "\n", " ")
	padded := padRight(flat, m.width)
	return footerStyle.Render(padded)
}

func (m model) renderStatus(text string) string {
	if m.width == 0 {
		return statusBarStyle.Render(text)
	}
	flat := strings.ReplaceAll(text, "\n", " ")
	padded := padRight(flat, m.width)
	return statusBarStyle.Render(padded)
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
	lines := []string{header}
	creditStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("2"))
	end := topIndex + visible
	if end > len(rows) {
		end = len(rows)
	}
	for i := topIndex; i < end; i++ {
		row := rows[i]
		amountText := fmt.Sprintf("%.2f", row.amount)
		amountField := padRight(amountText, amountWidth)
		if colorAmounts && row.amount > 0 {
			amountField = creditStyle.Render(amountField)
		}
		desc := truncate(row.description, descWidth)
		prefix := "  "
		if i == cursor {
			prefix = "> "
		}
		dateField := padRight(row.dateRaw, dateWidth)
		descField := padRight(desc, descWidth)
		lines = append(lines, prefix+dateField+"  "+amountField+"  "+descField)
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
	lines := []string{
		fmt.Sprintf("%-12s %12.2f", "Net Value", net),
		fmt.Sprintf("%-12s %12.2f", "Net Debits", debits),
	}
	for i, line := range lines {
		lines[i] = padRight(line, width)
	}
	return strings.Join(lines, "\n")
}

func overviewLineCount() int {
	return 2
}

// ---------------------------------------------------------------------------
// Help bar
// ---------------------------------------------------------------------------

func renderHelp(bindings []key.Binding) string {
	parts := make([]string, 0, len(bindings))
	for _, binding := range bindings {
		help := binding.Help()
		if help.Key == "" && help.Desc == "" {
			continue
		}
		parts = append(parts, boldKey(help.Key)+" "+help.Desc)
	}
	return strings.Join(parts, "  ")
}
