package main

import (
	"strings"

	"github.com/charmbracelet/bubbles/key"
	"github.com/charmbracelet/lipgloss"
)

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

func (m model) composeOverlay(base, statusLine, footer, content string) string {
	baseView := m.placeWithFooter(base, statusLine, footer)
	if m.height == 0 || m.width == 0 {
		return baseView + "\n\n" + content
	}
	modalContent := lipgloss.NewStyle().Width(min(60, m.width-10)).Render(content)
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

// ---------------------------------------------------------------------------
// Settings footer bindings
// ---------------------------------------------------------------------------

func (m model) settingsFooterBindings() []key.Binding {
	if m.settMode != settModeNone {
		switch m.settMode {
		case settModeAddCat, settModeEditCat:
			return m.keys.HelpBindings(scopeSettingsModeCat)
		case settModeAddRule, settModeEditRule:
			return m.keys.HelpBindings(scopeSettingsModeRule)
		case settModeRuleCat:
			return m.keys.HelpBindings(scopeSettingsModeRuleCat)
		}
	}
	if m.confirmAction != "" {
		return m.keys.HelpBindings(scopeSettingsConfirm)
	}
	if m.settActive {
		switch m.settSection {
		case settSecCategories:
			return m.keys.HelpBindings(scopeSettingsActiveCategories)
		case settSecRules:
			return m.keys.HelpBindings(scopeSettingsActiveRules)
		case settSecChart:
			return m.keys.HelpBindings(scopeSettingsActiveChart)
		case settSecDBImport:
			return m.keys.HelpBindings(scopeSettingsActiveDBImport)
		}
	}
	return m.keys.HelpBindings(scopeSettingsNav)
}

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

func (m model) footerBindings() []key.Binding {
	if m.showDetail {
		return m.keys.HelpBindings(scopeDetailModal)
	}
	if m.importPicking {
		return m.keys.HelpBindings(scopeFilePicker)
	}
	if m.importDupeModal {
		return m.keys.HelpBindings(scopeDupeModal)
	}
	if m.searchMode {
		return m.keys.HelpBindings(scopeSearch)
	}
	if m.activeTab == tabTransactions {
		return m.keys.HelpBindings(scopeTransactions)
	}
	if m.activeTab == tabSettings {
		return m.settingsFooterBindings()
	}
	return m.keys.HelpBindings(scopeDashboard)
}

func (m *model) visibleRows() int {
	maxRows := m.maxVisibleRows
	if maxRows <= 0 {
		maxRows = 20
	}
	if m.height == 0 {
		return min(10, maxRows)
	}
	frameV := listBoxStyle.GetVerticalFrameSize()
	headerHeight := 1
	headerGap := 1
	sectionHeaderHeight := sectionHeaderLineCount()
	tableHeaderHeight := 1
	scrollIndicator := 1
	available := m.height - 2 - headerHeight - headerGap - frameV - sectionHeaderHeight - tableHeaderHeight - scrollIndicator
	if available < 3 {
		available = 3
	}
	if available > maxRows {
		available = maxRows
	}
	return available
}

func (m *model) listContentWidth() int {
	if m.width == 0 {
		return 80
	}
	contentWidth := m.sectionContentWidth()
	if contentWidth < 20 {
		return 20
	}
	return contentWidth
}

func (m *model) sectionContentWidth() int {
	if m.width == 0 {
		return 80
	}
	frameH := listBoxStyle.GetHorizontalFrameSize()
	contentWidth := m.sectionWidth() - frameH
	if contentWidth < 1 {
		contentWidth = 1
	}
	return contentWidth
}

func (m *model) sectionWidth() int {
	if m.width == 0 {
		return 80
	}
	width := m.width - 4
	if width < 20 {
		width = m.width
	}
	return width
}

func (m *model) ensureCursorInWindow() {
	visible := m.visibleRows()
	if visible <= 0 {
		return
	}
	filtered := m.getFilteredRows()
	total := len(filtered)
	if m.cursor >= total {
		m.cursor = total - 1
	}
	if m.cursor < 0 {
		m.cursor = 0
	}
	if m.cursor < m.topIndex {
		m.topIndex = m.cursor
	} else if m.cursor >= m.topIndex+visible {
		m.topIndex = m.cursor - visible + 1
	}
	maxTop := total - visible
	if maxTop < 0 {
		maxTop = 0
	}
	if m.topIndex > maxTop {
		m.topIndex = maxTop
	}
	if m.topIndex < 0 {
		m.topIndex = 0
	}
}

func sectionHeaderLineCount() int {
	return 2
}
