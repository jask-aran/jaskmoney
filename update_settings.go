package main

import (
	"fmt"
	"time"

	tea "github.com/charmbracelet/bubbletea"
)

// ---------------------------------------------------------------------------
// Settings key handler
// ---------------------------------------------------------------------------

// settSectionForColumn returns the settSection index given current column and row.
func settSectionForColumn(col, row int) int {
	if col == settColRight {
		if row == 0 {
			return settSecChart
		}
		return settSecDBImport
	}
	// Left column: row 0 = Categories, row 1 = Rules
	if row == 0 {
		return settSecCategories
	}
	return settSecRules
}

// settColumnRow returns (column, row) for a given settSection.
func settColumnRow(sec int) (int, int) {
	switch sec {
	case settSecCategories:
		return settColLeft, 0
	case settSecRules:
		return settColLeft, 1
	case settSecChart:
		return settColRight, 0
	case settSecDBImport:
		return settColRight, 1
	}
	return settColLeft, 0
}

func (m model) updateSettings(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	// Text input modes (always handled first)
	if m.settMode == settModeAddCat || m.settMode == settModeEditCat {
		return m.updateSettingsTextInput(msg)
	}
	if m.settMode == settModeAddRule || m.settMode == settModeEditRule {
		return m.updateSettingsRuleInput(msg)
	}
	if m.settMode == settModeRuleCat {
		return m.updateSettingsRuleCatPicker(msg)
	}

	// Two-key confirm check
	if m.confirmAction != "" {
		return m.updateSettingsConfirm(msg)
	}

	// If a section is active, delegate to section-specific handler
	if m.settActive {
		return m.updateSettingsActive(msg)
	}

	// Section navigation mode
	switch msg.String() {
	case "ctrl+c", "q":
		return m, tea.Quit
	case "tab":
		m.activeTab = (m.activeTab + 1) % tabCount
		return m, nil
	case "shift+tab":
		m.activeTab = (m.activeTab - 1 + tabCount) % tabCount
		return m, nil
	case "h", "left":
		if m.settColumn == settColRight {
			m.settColumn = settColLeft
			// Default to first row in left column
			m.settSection = settSecCategories
		}
		return m, nil
	case "l", "right":
		if m.settColumn == settColLeft {
			m.settColumn = settColRight
			m.settSection = settSecChart
		}
		return m, nil
	case "j", "down":
		col, row := settColumnRow(m.settSection)
		row++
		if row > 1 {
			row = 0
		}
		m.settSection = settSectionForColumn(col, row)
		return m, nil
	case "k", "up":
		col, row := settColumnRow(m.settSection)
		row--
		if row < 0 {
			row = 1
		}
		m.settSection = settSectionForColumn(col, row)
		return m, nil
	case "enter":
		m.settActive = true
		m.settItemCursor = 0
		return m, nil
	case "i":
		m.importPicking = true
		m.importFiles = nil
		m.importCursor = 0
		return m, loadFilesCmd(m.basePath)
	}
	return m, nil
}

// updateSettingsActive handles keys when a section is activated (enter was pressed).
func (m model) updateSettingsActive(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "esc":
		m.settActive = false
		return m, nil
	case "ctrl+c", "q":
		return m, tea.Quit
	}

	switch m.settSection {
	case settSecCategories:
		return m.updateSettingsCategories(msg)
	case settSecRules:
		return m.updateSettingsRules(msg)
	case settSecChart:
		return m.updateSettingsChart(msg)
	case settSecDBImport:
		return m.updateSettingsDBImport(msg)
	}
	return m, nil
}

func (m model) updateSettingsCategories(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "j", "down":
		if m.settItemCursor < len(m.categories)-1 {
			m.settItemCursor++
		}
		return m, nil
	case "k", "up":
		if m.settItemCursor > 0 {
			m.settItemCursor--
		}
		return m, nil
	case "a":
		m.settMode = settModeAddCat
		m.settInput = ""
		m.settColorIdx = 0
		return m, nil
	case "e":
		if m.settItemCursor < len(m.categories) {
			cat := m.categories[m.settItemCursor]
			m.settMode = settModeEditCat
			m.settEditID = cat.id
			m.settInput = cat.name
			m.settColorIdx = 0
			colors := CategoryAccentColors()
			for i, c := range colors {
				if string(c) == cat.color {
					m.settColorIdx = i
					break
				}
			}
		}
		return m, nil
	case "d":
		if m.settItemCursor < len(m.categories) {
			cat := m.categories[m.settItemCursor]
			if cat.isDefault {
				m.status = "Cannot delete the default category."
				return m, nil
			}
			m.confirmAction = "delete_cat"
			m.confirmID = cat.id
			m.status = fmt.Sprintf("Press d again to delete %q", cat.name)
			return m, confirmTimerCmd()
		}
		return m, nil
	}
	return m, nil
}

func (m model) updateSettingsRules(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "j", "down":
		if m.settItemCursor < len(m.rules)-1 {
			m.settItemCursor++
		}
		return m, nil
	case "k", "up":
		if m.settItemCursor > 0 {
			m.settItemCursor--
		}
		return m, nil
	case "a":
		m.settMode = settModeAddRule
		m.settInput = ""
		m.settRuleCatIdx = 0
		m.settEditID = 0
		return m, nil
	case "e":
		if m.settItemCursor < len(m.rules) {
			rule := m.rules[m.settItemCursor]
			m.settMode = settModeEditRule
			m.settEditID = rule.id
			m.settInput = rule.pattern
			m.settRuleCatIdx = 0
			for i, c := range m.categories {
				if c.id == rule.categoryID {
					m.settRuleCatIdx = i
					break
				}
			}
		}
		return m, nil
	case "d":
		if m.settItemCursor < len(m.rules) {
			rule := m.rules[m.settItemCursor]
			m.confirmAction = "delete_rule"
			m.confirmID = rule.id
			m.status = fmt.Sprintf("Press d again to delete rule %q", rule.pattern)
			return m, confirmTimerCmd()
		}
		return m, nil
	case "A":
		if m.db == nil {
			return m, nil
		}
		db := m.db
		return m, func() tea.Msg {
			count, err := applyCategoryRules(db)
			return rulesAppliedMsg{count: count, err: err}
		}
	}
	return m, nil
}

func (m model) updateSettingsDBImport(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "c":
		m.confirmAction = "clear_db"
		m.status = "Press c again to clear all data"
		return m, confirmTimerCmd()
	case "i":
		m.importPicking = true
		m.importFiles = nil
		m.importCursor = 0
		return m, loadFilesCmd(m.basePath)
	case "+", "=":
		if m.maxVisibleRows < 50 {
			m.maxVisibleRows++
			m.status = fmt.Sprintf("Rows per page: %d", m.maxVisibleRows)
		}
		return m, nil
	case "-":
		if m.maxVisibleRows > 5 {
			m.maxVisibleRows--
			m.status = fmt.Sprintf("Rows per page: %d", m.maxVisibleRows)
		}
		return m, nil
	}
	return m, nil
}

func (m model) updateSettingsChart(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "h", "left", "l", "right", "enter":
		if m.spendingWeekAnchor == time.Monday {
			m.spendingWeekAnchor = time.Sunday
		} else {
			m.spendingWeekAnchor = time.Monday
		}
		m.status = fmt.Sprintf("Spending tracker week boundary: %s", spendingWeekAnchorLabel(m.spendingWeekAnchor))
		m.statusErr = false
		return m, nil
	}
	return m, nil
}

func (m model) updateSettingsConfirm(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	key := msg.String()
	switch m.confirmAction {
	case "delete_cat":
		if key == "d" {
			if m.db == nil {
				return m, nil
			}
			db := m.db
			id := m.confirmID
			m.confirmAction = ""
			return m, func() tea.Msg {
				return categoryDeletedMsg{err: deleteCategory(db, id)}
			}
		}
	case "delete_rule":
		if key == "d" {
			if m.db == nil {
				return m, nil
			}
			db := m.db
			id := m.confirmID
			m.confirmAction = ""
			return m, func() tea.Msg {
				return ruleDeletedMsg{err: deleteCategoryRule(db, id)}
			}
		}
	case "clear_db":
		if key == "c" {
			if m.db == nil {
				return m, nil
			}
			db := m.db
			m.confirmAction = ""
			m.status = "Clearing database..."
			return m, func() tea.Msg {
				err := clearAllData(db)
				return clearDoneMsg{err: err}
			}
		}
	}
	// Any other key cancels the confirm
	m.confirmAction = ""
	m.confirmID = 0
	m.status = "Cancelled."
	return m, nil
}

// updateSettingsTextInput handles text input for add/edit category.
func (m model) updateSettingsTextInput(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "esc":
		m.settMode = settModeNone
		m.settInput = ""
		m.settInput2 = ""
		return m, nil
	case "left", "h":
		colors := CategoryAccentColors()
		if len(colors) > 0 {
			m.settColorIdx = (m.settColorIdx - 1 + len(colors)) % len(colors)
		}
		return m, nil
	case "right", "l":
		colors := CategoryAccentColors()
		if len(colors) > 0 {
			m.settColorIdx = (m.settColorIdx + 1) % len(colors)
		}
		return m, nil
	case "enter":
		if m.settInput == "" {
			m.status = "Name cannot be empty."
			return m, nil
		}
		if m.db == nil {
			return m, nil
		}
		colors := CategoryAccentColors()
		color := string(colors[m.settColorIdx])
		name := m.settInput
		db := m.db
		if m.settMode == settModeAddCat {
			return m, func() tea.Msg {
				_, err := insertCategory(db, name, color)
				return categorySavedMsg{err: err}
			}
		}
		// Edit mode
		id := m.settEditID
		return m, func() tea.Msg {
			err := updateCategory(db, id, name, color)
			return categorySavedMsg{err: err}
		}
	case "backspace":
		if len(m.settInput) > 0 {
			m.settInput = m.settInput[:len(m.settInput)-1]
		}
		return m, nil
	case "ctrl+c":
		return m, tea.Quit
	default:
		r := msg.String()
		if len(r) == 1 && r[0] >= 32 && r[0] < 127 {
			m.settInput += r
		}
		return m, nil
	}
}

// updateSettingsRuleInput handles text input for add/edit rule pattern.
func (m model) updateSettingsRuleInput(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "esc":
		m.settMode = settModeNone
		m.settInput = ""
		m.settEditID = 0
		return m, nil
	case "enter":
		if m.settInput == "" {
			m.status = "Pattern cannot be empty."
			return m, nil
		}
		// Move to category picker
		m.settMode = settModeRuleCat
		return m, nil
	case "backspace":
		if len(m.settInput) > 0 {
			m.settInput = m.settInput[:len(m.settInput)-1]
		}
		return m, nil
	case "ctrl+c":
		return m, tea.Quit
	default:
		r := msg.String()
		if len(r) == 1 && r[0] >= 32 && r[0] < 127 {
			m.settInput += r
		}
		return m, nil
	}
}

// updateSettingsRuleCatPicker handles category selection for a rule.
func (m model) updateSettingsRuleCatPicker(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "esc":
		m.settMode = settModeNone
		m.settInput = ""
		m.settEditID = 0
		return m, nil
	case "j", "down":
		if m.settRuleCatIdx < len(m.categories)-1 {
			m.settRuleCatIdx++
		}
		return m, nil
	case "k", "up":
		if m.settRuleCatIdx > 0 {
			m.settRuleCatIdx--
		}
		return m, nil
	case "enter":
		if m.db == nil || len(m.categories) == 0 {
			return m, nil
		}
		pattern := m.settInput
		catID := m.categories[m.settRuleCatIdx].id
		db := m.db

		if m.settMode == settModeRuleCat && m.settEditID > 0 {
			// We were editing
			editID := m.settEditID
			return m, func() tea.Msg {
				err := updateCategoryRule(db, editID, pattern, catID)
				return ruleSavedMsg{err: err}
			}
		}
		// New rule
		return m, func() tea.Msg {
			_, err := insertCategoryRule(db, pattern, catID)
			return ruleSavedMsg{err: err}
		}
	case "ctrl+c":
		return m, tea.Quit
	}
	return m, nil
}

// confirmTimerCmd returns a command that fires confirmExpiredMsg after 2 seconds.
func confirmTimerCmd() tea.Cmd {
	return tea.Tick(2*time.Second, func(t time.Time) tea.Msg {
		return confirmExpiredMsg{}
	})
}
