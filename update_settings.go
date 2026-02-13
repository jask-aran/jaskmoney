package main

import (
	"fmt"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
)

func settSectionForColumn(col, row int) int {
	if col == settColRight {
		if row <= 0 {
			return settSecChart
		}
		if row == 1 {
			return settSecDBImport
		}
		return settSecImportHistory
	}
	// Left column: row 0 = Categories, row 1 = Tags, row 2 = Rules, row 3 = Filters.
	if row <= 0 {
		return settSecCategories
	}
	if row == 1 {
		return settSecTags
	}
	if row == 2 {
		return settSecRules
	}
	return settSecFilters
}

// settColumnRow returns (column, row) for a given settSection.
func settColumnRow(sec int) (int, int) {
	switch sec {
	case settSecCategories:
		return settColLeft, 0
	case settSecTags:
		return settColLeft, 1
	case settSecRules:
		return settColLeft, 2
	case settSecFilters:
		return settColLeft, 3
	case settSecChart:
		return settColRight, 0
	case settSecDBImport:
		return settColRight, 1
	case settSecImportHistory:
		return settColRight, 2
	}
	return settColLeft, 0
}

func settingsActiveScope(section int) string {
	switch section {
	case settSecCategories:
		return scopeSettingsActiveCategories
	case settSecTags:
		return scopeSettingsActiveTags
	case settSecRules:
		return scopeSettingsActiveRules
	case settSecChart:
		return scopeSettingsActiveChart
	case settSecFilters:
		return scopeSettingsActiveFilters
	case settSecDBImport:
		return scopeSettingsActiveDBImport
	case settSecImportHistory:
		return scopeSettingsActiveImportHist
	default:
		return scopeSettingsActiveCategories
	}
}

func settingsFocusSectionForSettSection(section int) int {
	switch section {
	case settSecCategories:
		return sectionSettingsCategories
	case settSecTags:
		return sectionSettingsTags
	case settSecRules:
		return sectionSettingsRules
	case settSecImportHistory:
		return sectionSettingsImportHistory
	case settSecFilters:
		return sectionSettingsFilters
	case settSecDBImport:
		return sectionSettingsDatabase
	case settSecChart:
		return sectionSettingsViews
	default:
		return sectionSettingsDatabase
	}
}

func (m model) updateSettings(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	// Text input modes (always handled first)
	if m.settMode == settModeAddCat || m.settMode == settModeEditCat || m.settMode == settModeAddTag || m.settMode == settModeEditTag {
		return m.updateSettingsTextInput(msg)
	}
	if m.settMode == settModeAddRule || m.settMode == settModeEditRule {
		return m.updateSettingsRuleInput(msg)
	}
	if m.settMode == settModeRuleCat {
		return m.updateSettingsRuleCatPicker(msg)
	}

	// Two-key confirm check
	if m.confirmAction != confirmActionNone {
		return m.updateSettingsConfirm(msg)
	}
	// If a section is active, delegate to section-specific handler
	if m.settActive {
		return m.updateSettingsActive(msg)
	}

	// Section navigation mode
	switch {
	case m.isAction(scopeSettingsNav, actionQuit, msg) || m.isAction(scopeGlobal, actionQuit, msg):
		return m, tea.Quit
	case m.isAction(scopeSettingsNav, actionPrevTab, msg) || m.isAction(scopeGlobal, actionPrevTab, msg):
		if next, cmd, handled := m.executeBoundCommand(scopeGlobal, msg); handled {
			return next, cmd
		}
		return m, nil
	case m.horizontalDelta(scopeSettingsNav, msg) != 0:
		delta := m.horizontalDelta(scopeSettingsNav, msg)
		if delta < 0 && m.settColumn == settColRight {
			m.settColumn = settColLeft
			m.settSection = settSecCategories
		} else if delta > 0 && m.settColumn == settColLeft {
			m.settColumn = settColRight
			m.settSection = settSecChart
		}
		m.focusedSection = settingsFocusSectionForSettSection(m.settSection)
		return m, nil
	case m.verticalDelta(scopeSettingsNav, msg) != 0:
		delta := m.verticalDelta(scopeSettingsNav, msg)
		if delta != 0 {
			m.settSection = moveSettingsSection(m.settSection, delta)
		}
		m.focusedSection = settingsFocusSectionForSettSection(m.settSection)
		return m, nil
	case m.isAction(scopeSettingsNav, actionActivate, msg):
		m.settActive = true
		m.settItemCursor = 0
		m.focusedSection = settingsFocusSectionForSettSection(m.settSection)
		return m, nil
	}
	if next, cmd, handled := m.executeBoundCommand(scopeSettingsNav, msg); handled {
		return next, cmd
	}
	return m, nil
}

// updateSettingsActive handles keys when a section is activated (enter was pressed).
func (m model) updateSettingsActive(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	scope := settingsActiveScope(m.settSection)
	switch {
	case m.isAction(scope, actionBack, msg):
		m.settActive = false
		return m, nil
	case m.isAction(scopeGlobal, actionQuit, msg):
		return m, tea.Quit
	}
	if next, cmd, handled := m.executeBoundCommand(scope, msg); handled {
		return next, cmd
	}

	switch m.settSection {
	case settSecCategories:
		return m.updateSettingsCategories(msg)
	case settSecTags:
		return m.updateSettingsTags(msg)
	case settSecRules:
		return m.updateSettingsRules(msg)
	case settSecChart:
		return m.updateSettingsChart(msg)
	case settSecFilters:
		return m.updateSettingsFilters(msg)
	case settSecDBImport:
		return m.updateSettingsDBImport(msg)
	case settSecImportHistory:
		return m, nil
	}
	return m, nil
}

func (m model) updateSettingsCategories(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch {
	case m.verticalDelta(scopeSettingsActiveCategories, msg) != 0:
		m.settItemCursor = moveBoundedCursor(m.settItemCursor, len(m.categories), m.verticalDelta(scopeSettingsActiveCategories, msg))
		return m, nil
	case m.isAction(scopeSettingsActiveCategories, actionAdd, msg):
		m.beginSettingsCategoryMode(nil)
		return m, nil
	case m.isAction(scopeSettingsActiveCategories, actionSelect, msg), normalizeKeyName(msg.String()) == "enter":
		if m.settItemCursor < len(m.categories) {
			cat := m.categories[m.settItemCursor]
			m.beginSettingsCategoryMode(&cat)
		}
		return m, nil
	case m.isAction(scopeSettingsActiveCategories, actionDelete, msg):
		if m.settItemCursor < len(m.categories) {
			cat := m.categories[m.settItemCursor]
			if cat.isDefault {
				m.setStatus("Cannot delete the default category.")
				return m, nil
			}
			keyLabel := m.primaryActionKey(scopeSettingsActiveCategories, actionDelete, "del")
			return m, m.armSettingsConfirm(confirmActionDeleteCategory, cat.id, fmt.Sprintf("Press %s again to delete %q", keyLabel, cat.name))
		}
		return m, nil
	}
	return m, nil
}

func (m model) updateSettingsTags(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch {
	case m.verticalDelta(scopeSettingsActiveTags, msg) != 0:
		m.settItemCursor = moveBoundedCursor(m.settItemCursor, len(m.tags), m.verticalDelta(scopeSettingsActiveTags, msg))
		return m, nil
	case m.isAction(scopeSettingsActiveTags, actionAdd, msg):
		m.beginSettingsTagMode(nil)
		return m, nil
	case m.isAction(scopeSettingsActiveTags, actionSelect, msg), normalizeKeyName(msg.String()) == "enter":
		if m.settItemCursor < len(m.tags) {
			tg := m.tags[m.settItemCursor]
			m.beginSettingsTagMode(&tg)
		}
		return m, nil
	case m.isAction(scopeSettingsActiveTags, actionDelete, msg):
		if m.settItemCursor < len(m.tags) {
			tg := m.tags[m.settItemCursor]
			keyLabel := m.primaryActionKey(scopeSettingsActiveTags, actionDelete, "del")
			return m, m.armSettingsConfirm(confirmActionDeleteTag, tg.id, fmt.Sprintf("Press %s again to delete tag %q", keyLabel, tg.name))
		}
		return m, nil
	}
	return m, nil
}

func (m model) updateSettingsRules(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch {
	case m.verticalDelta(scopeSettingsActiveRules, msg) != 0:
		m.settItemCursor = moveBoundedCursor(m.settItemCursor, len(m.rules), m.verticalDelta(scopeSettingsActiveRules, msg))
		return m, nil
	case m.isAction(scopeSettingsActiveRules, actionAdd, msg):
		m.beginSettingsRuleMode(nil)
		return m, nil
	case m.isAction(scopeSettingsActiveRules, actionEdit, msg):
		if m.settItemCursor < len(m.rules) {
			rule := m.rules[m.settItemCursor]
			m.beginSettingsRuleMode(&rule)
		}
		return m, nil
	case m.isAction(scopeSettingsActiveRules, actionDelete, msg):
		if m.settItemCursor < len(m.rules) {
			rule := m.rules[m.settItemCursor]
			keyLabel := m.primaryActionKey(scopeSettingsActiveRules, actionDelete, "del")
			return m, m.armSettingsConfirm(confirmActionDeleteRule, rule.id, fmt.Sprintf("Press %s again to delete rule %q", keyLabel, rule.pattern))
		}
		return m, nil
	}
	return m, nil
}

func (m model) updateSettingsFilters(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	ordered := m.orderedSavedFilters()
	switch {
	case m.verticalDelta(scopeSettingsActiveFilters, msg) != 0:
		m.settItemCursor = moveBoundedCursor(m.settItemCursor, len(ordered), m.verticalDelta(scopeSettingsActiveFilters, msg))
		return m, nil
	case m.isAction(scopeSettingsActiveFilters, actionAdd, msg):
		m.openFilterEditor(nil, "")
		return m, nil
	case m.isAction(scopeSettingsActiveFilters, actionSelect, msg), normalizeKeyName(msg.String()) == "enter":
		if m.settItemCursor < len(ordered) {
			selected := ordered[m.settItemCursor]
			m.openFilterEditor(&selected, "")
		}
		return m, nil
	case m.isAction(scopeSettingsActiveFilters, actionDelete, msg):
		if m.settItemCursor >= len(ordered) {
			return m, nil
		}
		selected := ordered[m.settItemCursor]
		keyLabel := m.primaryActionKey(scopeSettingsActiveFilters, actionDelete, "del")
		return m, m.armSettingsFilterConfirm(selected.ID, fmt.Sprintf("Press %s again to delete filter %q", keyLabel, selected.ID))
	}
	return m, nil
}

func (m model) updateSettingsDBImport(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch {
	case m.isAction(scopeSettingsActiveDBImport, actionResetKeybindings, msg):
		return m, resetKeybindingsCmd()
	case m.isAction(scopeSettingsActiveDBImport, actionRowsPerPage, msg):
		delta := rowsPerPageDeltaFromKeyName(normalizeKeyName(msg.String()))
		if delta > 0 && m.maxVisibleRows < 50 {
			m.maxVisibleRows++
			m.setStatusf("Rows per page: %d", m.maxVisibleRows)
			return m, saveSettingsCmd(m.currentAppSettings())
		}
		if delta < 0 && m.maxVisibleRows > 5 {
			m.maxVisibleRows--
			m.setStatusf("Rows per page: %d", m.maxVisibleRows)
			return m, saveSettingsCmd(m.currentAppSettings())
		}
		return m, nil
	case m.isAction(scopeSettingsActiveDBImport, actionCommandDefault, msg):
		if m.commandDefault == commandUIKindColon {
			m.commandDefault = commandUIKindPalette
		} else {
			m.commandDefault = commandUIKindColon
		}
		m.setStatusf("Command default: %s", commandDefaultLabel(m.commandDefault))
		return m, saveSettingsCmd(m.currentAppSettings())
	}
	return m, nil
}

func (m model) updateSettingsChart(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch {
	case m.horizontalDelta(scopeSettingsActiveChart, msg) != 0,
		m.isAction(scopeSettingsActiveChart, actionConfirm, msg):
		if m.spendingWeekAnchor == time.Monday {
			m.spendingWeekAnchor = time.Sunday
		} else {
			m.spendingWeekAnchor = time.Monday
		}
		m.setStatusf("Spending tracker week boundary: %s", spendingWeekAnchorLabel(m.spendingWeekAnchor))
		return m, saveSettingsCmd(m.currentAppSettings())
	}
	return m, nil
}

func (m model) updateSettingsConfirm(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	if !m.matchesSettingsConfirm(msg) {
		m.clearSettingsConfirm()
		m.setStatus("Cancelled.")
		return m, nil
	}
	if m.db == nil {
		return m, nil
	}
	db := m.db
	id := m.confirmID
	filterID := strings.TrimSpace(m.confirmFilterID)
	confirmAction := m.confirmAction
	m.clearSettingsConfirm()
	switch confirmAction {
	case confirmActionDeleteCategory:
		return m, func() tea.Msg {
			return categoryDeletedMsg{err: deleteCategory(db, id)}
		}
	case confirmActionDeleteRule:
		return m, func() tea.Msg {
			return ruleDeletedMsg{err: deleteCategoryRule(db, id)}
		}
	case confirmActionDeleteTag:
		return m, func() tea.Msg {
			return tagDeletedMsg{err: deleteTag(db, id)}
		}
	case confirmActionDeleteFilter:
		if filterID == "" {
			m.setError("Delete filter failed: missing filter ID.")
			return m, nil
		}
		next, err := m.deleteSavedFilterByID(filterID)
		if err != nil {
			m.setError(fmt.Sprintf("Delete filter failed: %v", err))
			return next, nil
		}
		next.setStatusf("Deleted filter %q.", filterID)
		return next, nil
	case confirmActionClearDB:
		m.setStatus("Clearing database...")
		return m, func() tea.Msg {
			err := clearAllData(db)
			return clearDoneMsg{err: err}
		}
	default:
		return m, nil
	}
}

// updateSettingsTextInput handles text input for add/edit category.
func (m model) updateSettingsTextInput(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	scope := scopeSettingsModeCat
	palette := CategoryAccentColors()
	isTagMode := m.settMode == settModeAddTag || m.settMode == settModeEditTag
	isCategoryMode := m.settMode == settModeAddCat || m.settMode == settModeEditCat
	if isTagMode {
		scope = scopeSettingsModeTag
		palette = TagAccentColors()
	}

	saveInput := func(m model) (tea.Model, tea.Cmd) {
		if m.settInput == "" {
			m.setStatus("Name cannot be empty.")
			return m, nil
		}
		if m.db == nil {
			return m, nil
		}
		color := ""
		if len(palette) > 0 {
			color = string(palette[m.settColorIdx%len(palette)])
		}
		name := m.settInput
		db := m.db
		if isTagMode {
			var scopeCategoryID *int
			if m.settTagScopeID != 0 {
				id := m.settTagScopeID
				scopeCategoryID = &id
			}
			if m.settMode == settModeAddTag {
				return m, func() tea.Msg {
					_, err := insertTag(db, name, color, scopeCategoryID)
					return tagSavedMsg{err: err}
				}
			}
			id := m.settEditID
			return m, func() tea.Msg {
				err := updateTag(db, id, name, color, scopeCategoryID)
				return tagSavedMsg{err: err}
			}
		}
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
	}

	keyName := normalizeKeyName(msg.String())
	isNameFocus := (isCategoryMode && m.settCatFocus == 0) || (isTagMode && m.settTagFocus == 0)
	if isNameFocus {
		switch keyName {
		case "esc":
			m.settMode = settModeNone
			m.settInput = ""
			m.settInputCursor = 0
			m.settCatFocus = 0
			m.settTagFocus = 0
			m.settTagScopeID = 0
			return m, nil
		case "enter":
			return saveInput(m)
		case "left":
			moveInputCursorASCII(m.settInput, &m.settInputCursor, -1)
			return m, nil
		case "right":
			moveInputCursorASCII(m.settInput, &m.settInputCursor, 1)
			return m, nil
		case "backspace":
			deleteASCIIByteBeforeCursor(&m.settInput, &m.settInputCursor)
			return m, nil
		default:
			if insertPrintableASCIIAtCursor(&m.settInput, &m.settInputCursor, msg.String()) {
				return m, nil
			}
		}
	}

	switch {
	case m.isAction(scope, actionClose, msg) || keyName == "esc":
		m.settMode = settModeNone
		m.settInput = ""
		m.settInputCursor = 0
		m.settCatFocus = 0
		m.settTagFocus = 0
		m.settTagScopeID = 0
		return m, nil
	case isCategoryMode && m.verticalDelta(scopeSettingsModeCat, msg) != 0:
		delta := m.verticalDelta(scopeSettingsModeCat, msg)
		if delta > 0 {
			m.settCatFocus = (m.settCatFocus + 1) % 2
		} else if delta < 0 {
			m.settCatFocus = (m.settCatFocus - 1 + 2) % 2
		}
		return m, nil
	case isTagMode && m.verticalDelta(scopeSettingsModeTag, msg) != 0:
		delta := m.verticalDelta(scopeSettingsModeTag, msg)
		if delta > 0 {
			m.settTagFocus = (m.settTagFocus + 1) % 3
		} else if delta < 0 {
			m.settTagFocus = (m.settTagFocus - 1 + 3) % 3
		}
		return m, nil
	case m.horizontalDelta(scope, msg) != 0:
		delta := m.horizontalDelta(scope, msg)
		if isCategoryMode && m.settCatFocus != 1 {
			return m, nil
		}
		if isTagMode {
			if m.settTagFocus == 2 {
				scopeOpts := m.tagScopeOptions()
				if len(scopeOpts) > 0 && delta != 0 {
					idx := tagScopeIndex(scopeOpts, m.settTagScopeID)
					if delta < 0 {
						idx = (idx - 1 + len(scopeOpts)) % len(scopeOpts)
					} else {
						idx = (idx + 1) % len(scopeOpts)
					}
					m.settTagScopeID = scopeOpts[idx]
				}
				return m, nil
			}
			if m.settTagFocus != 1 {
				return m, nil
			}
		}
		if len(palette) > 0 && delta < 0 {
			m.settColorIdx = (m.settColorIdx - 1 + len(palette)) % len(palette)
		} else if len(palette) > 0 && delta > 0 {
			m.settColorIdx = (m.settColorIdx + 1) % len(palette)
		}
		return m, nil
	case m.isAction(scope, actionSave, msg) || keyName == "enter":
		return saveInput(m)
	case isBackspaceKey(msg):
		if isCategoryMode && m.settCatFocus != 0 {
			return m, nil
		}
		if isTagMode && m.settTagFocus != 0 {
			return m, nil
		}
		deleteLastASCIIByte(&m.settInput)
		return m, nil
	case m.isAction(scopeGlobal, actionQuit, msg):
		return m, tea.Quit
	default:
		if isCategoryMode && m.settCatFocus != 0 {
			return m, nil
		}
		if isTagMode && m.settTagFocus != 0 {
			return m, nil
		}
		appendPrintableASCII(&m.settInput, msg.String())
		return m, nil
	}
}

func (m model) tagScopeOptions() []int {
	out := make([]int, 0, len(m.categories)+1)
	out = append(out, 0) // global
	for _, c := range m.categories {
		out = append(out, c.id)
	}
	return out
}

func tagScopeIndex(options []int, scopeID int) int {
	for i, id := range options {
		if id == scopeID {
			return i
		}
	}
	return 0
}

// updateSettingsRuleInput handles text input for add/edit rule pattern.
func (m model) updateSettingsRuleInput(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch {
	case m.isAction(scopeSettingsModeRule, actionClose, msg):
		m.settMode = settModeNone
		m.settInput = ""
		m.settEditID = 0
		return m, nil
	case m.isAction(scopeSettingsModeRule, actionNext, msg):
		if m.settInput == "" {
			m.setStatus("Pattern cannot be empty.")
			return m, nil
		}
		// Move to category picker
		m.settMode = settModeRuleCat
		return m, nil
	case isBackspaceKey(msg):
		deleteLastASCIIByte(&m.settInput)
		return m, nil
	default:
		appendPrintableASCII(&m.settInput, msg.String())
		return m, nil
	}
}

// updateSettingsRuleCatPicker handles category selection for a rule.
func (m model) updateSettingsRuleCatPicker(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch {
	case m.isAction(scopeSettingsModeRuleCat, actionClose, msg):
		m.settMode = settModeNone
		m.settInput = ""
		m.settEditID = 0
		return m, nil
	case m.verticalDelta(scopeSettingsModeRuleCat, msg) != 0:
		m.settRuleCatIdx = moveBoundedCursor(m.settRuleCatIdx, len(m.categories), m.verticalDelta(scopeSettingsModeRuleCat, msg))
		return m, nil
	case m.isAction(scopeSettingsModeRuleCat, actionSave, msg):
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
	case m.isAction(scopeGlobal, actionQuit, msg):
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

func resetKeybindingsCmd() tea.Cmd {
	return func() tea.Msg {
		return keybindingsResetMsg{err: resetKeybindingsFileToDefaults()}
	}
}
