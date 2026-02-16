package core

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/x/ansi"

	"jaskmoney-v2/widgets"
)

func (m Model) View() string {
	if m.quitting {
		return "Goodbye\n"
	}
	header := renderHeader(m)
	status := RenderStatusBar(m)
	footer := RenderFooter(m)
	available := m.height - lipgloss.Height(header) - lipgloss.Height(status) - lipgloss.Height(footer)
	if available < 0 {
		available = 0
	}
	bodyHeight := available
	var body string
	if len(m.tabs) > 0 && bodyHeight > 0 {
		body = m.tabs[m.activeTab].Build(&m).Render(max(1, m.width-2), bodyHeight)
	}
	if top := m.screens.Top(); top != nil && bodyHeight > 0 {
		body = widgets.RenderPopup(body, top.View(max(20, m.width-12), max(8, m.height-8)), m.width-2, bodyHeight)
	}
	body = fitHeight(body, bodyHeight)
	main := strings.TrimSuffix(strings.Join([]string{header, status, body}, "\n"), "\n")
	main = fitHeight(main, lipgloss.Height(header)+lipgloss.Height(status)+available)
	view := strings.Join([]string{main, footer}, "\n")
	view = fitHeight(view, max(1, m.height))
	return appStyle.Width(max(1, m.width)).MaxWidth(max(1, m.width)).Render(view)
}

func renderHeader(m Model) string {
	tabs := make([]string, 0, len(m.tabs))
	for i, t := range m.tabs {
		label := fmt.Sprintf("%d:%s", i+1, t.Title())
		if i == m.activeTab {
			tabs = append(tabs, activeTabStyle.Render(label))
		} else {
			tabs = append(tabs, inactiveTabStyle.Render(label))
		}
	}
	left := headerAppStyle.Render("JaskMoney v2")
	right := tabSepStyle.Render(" ") + strings.Join(tabs, tabSepStyle.Render("│"))
	right = ansi.Truncate(right, max(1, m.width), "")
	leftW := ansi.StringWidth(left)
	rightW := ansi.StringWidth(right)
	gap := 1
	if leftW+rightW+1 < m.width {
		gap = m.width - leftW - rightW
	}
	return renderHeaderBar(headerBarStyle, max(1, m.width), left+strings.Repeat(" ", gap)+right)
}

func fitHeight(s string, height int) string {
	if height <= 0 {
		return ""
	}
	lines := strings.Split(s, "\n")
	if len(lines) > height {
		lines = lines[:height]
	}
	for len(lines) < height {
		lines = append(lines, "")
	}
	return strings.Join(lines, "\n")
}

func renderHeaderBar(style lipgloss.Style, width int, line string) string {
	line = ansi.Truncate(strings.ReplaceAll(line, "\n", " "), width, "")
	lineW := ansi.StringWidth(line)
	if lineW < width {
		line += strings.Repeat(" ", width-lineW)
	}
	return style.Width(width).MaxWidth(width).Render(line)
}
