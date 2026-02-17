package main

import (
	"fmt"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
)

func (m model) updateDashboard(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	if m.dashCustomEditing {
		return m.updateDashboardCustomInput(msg)
	}
	if len(m.dashWidgets) != dashboardPaneCount {
		m.dashWidgets = newDashboardWidgets(m.customPaneModes)
	}

	if m.dashboardFocusedWidgetIndex() >= 0 && !m.dashTimeframeFocus {
		switch {
		case m.isAction(scopeDashboardFocused, actionCancel, msg):
			m.focusedSection = sectionUnfocused
			m.setStatus("Dashboard pane unfocused.")
			return m, nil
		default:
			return m, nil
		}
	}

	if !m.dashTimeframeFocus {
		return m, nil
	}

	switch {
	case m.isAction(scopeDashboardTimeframe, actionBudgetPrevMonth, msg):
		base, _, err := parseMonthKey(m.dashboardBudgetMonth())
		if err != nil {
			now := time.Now()
			base = time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.Local)
		}
		m.dashAnchorMonth = base.AddDate(0, -1, 0).Format("2006-01")
		m.dashMonthMode = true
		budgetChanged := m.syncBudgetMonthFromDashboard()
		if budgetChanged && m.db != nil {
			return m, refreshCmd(m.db)
		}
		return m, nil
	case m.isAction(scopeDashboardTimeframe, actionBudgetNextMonth, msg):
		base, _, err := parseMonthKey(m.dashboardBudgetMonth())
		if err != nil {
			now := time.Now()
			base = time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.Local)
		}
		m.dashAnchorMonth = base.AddDate(0, 1, 0).Format("2006-01")
		m.dashMonthMode = true
		budgetChanged := m.syncBudgetMonthFromDashboard()
		if budgetChanged && m.db != nil {
			return m, refreshCmd(m.db)
		}
		return m, nil
	case m.isAction(scopeDashboardTimeframe, actionTimeframeThisMonth, msg):
		now := time.Now()
		m.dashMonthMode = false
		m.dashTimeframe = dashTimeframeThisMonth
		m.dashTimeframeCursor = dashTimeframeThisMonth
		m.dashAnchorMonth = now.Format("2006-01")
		budgetChanged := m.syncBudgetMonthFromDashboard()
		saveCmd := saveSettingsCmd(m.currentAppSettings())
		if budgetChanged && m.db != nil {
			return m, tea.Batch(saveCmd, refreshCmd(m.db))
		}
		return m, saveCmd
	case m.horizontalDelta(scopeDashboardTimeframe, msg) != 0:
		delta := m.horizontalDelta(scopeDashboardTimeframe, msg)
		if delta < 0 {
			m.dashTimeframeCursor--
			if m.dashTimeframeCursor < 0 {
				m.dashTimeframeCursor = dashTimeframeCount - 1
			}
		} else if delta > 0 {
			m.dashTimeframeCursor = (m.dashTimeframeCursor + 1) % dashTimeframeCount
		}
	case m.isAction(scopeDashboardTimeframe, actionSelect, msg):
		if m.dashTimeframeCursor == dashTimeframeCustom {
			m.dashCustomEditing = true
			m.dashMonthMode = false
			m.dashCustomStart = ""
			m.dashCustomEnd = ""
			m.dashCustomInput = ""
			m.setStatus("Custom timeframe: enter start date (YYYY-MM-DD).")
			return m, nil
		}
		m.dashMonthMode = false
		m.dashTimeframe = m.dashTimeframeCursor
		budgetChanged := m.syncBudgetMonthFromDashboard()
		m.setStatusf("Dashboard timeframe: %s", dashTimeframeLabel(m.dashTimeframe))
		saveCmd := saveSettingsCmd(m.currentAppSettings())
		if budgetChanged && m.db != nil {
			return m, tea.Batch(saveCmd, refreshCmd(m.db))
		}
		return m, saveCmd
	case m.isAction(scopeDashboardTimeframe, actionCancel, msg):
		m.dashTimeframeFocus = false
		m.focusedSection = sectionUnfocused
		m.setStatus("Date range pane unfocused.")
		return m, nil
	}
	return m, nil
}

func (m model) updateDashboardCustomInput(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch {
	case m.isAction(scopeDashboardCustomInput, actionCancel, msg):
		m.dashCustomEditing = false
		m.dashCustomInput = ""
		m.dashCustomStart = ""
		m.dashCustomEnd = ""
		m.setStatus("Custom timeframe cancelled.")
		return m, nil
	case isBackspaceKey(msg):
		deleteLastASCIIByte(&m.dashCustomInput)
		return m, nil
	case m.isAction(scopeDashboardCustomInput, actionConfirm, msg):
		if _, err := time.Parse("2006-01-02", m.dashCustomInput); err != nil {
			m.setError("Invalid date. Use YYYY-MM-DD.")
			return m, nil
		}
		if m.dashCustomStart == "" {
			m.dashCustomStart = m.dashCustomInput
			m.dashCustomInput = ""
			m.setStatus("Custom timeframe: enter end date (YYYY-MM-DD).")
			return m, nil
		}
		m.dashCustomEnd = m.dashCustomInput
		m.dashCustomInput = ""
		start, _ := time.Parse("2006-01-02", m.dashCustomStart)
		end, _ := time.Parse("2006-01-02", m.dashCustomEnd)
		if end.Before(start) {
			m.setError("End date must be on or after start date.")
			m.dashCustomEnd = ""
			return m, nil
		}
		m.dashTimeframe = dashTimeframeCustom
		m.dashMonthMode = false
		m.dashTimeframeCursor = dashTimeframeCustom
		m.dashCustomEditing = false
		budgetChanged := m.syncBudgetMonthFromDashboard()
		m.setStatusf("Dashboard timeframe: %s to %s", m.dashCustomStart, m.dashCustomEnd)
		saveCmd := saveSettingsCmd(m.currentAppSettings())
		if budgetChanged && m.db != nil {
			return m, tea.Batch(saveCmd, refreshCmd(m.db))
		}
		return m, saveCmd
	default:
		appendPrintableASCII(&m.dashCustomInput, msg.String())
		return m, nil
	}
}

func (m model) dashboardCycleFocusedMode(delta int) (model, error) {
	if len(m.dashWidgets) != dashboardPaneCount {
		m.dashWidgets = newDashboardWidgets(m.customPaneModes)
	}
	idx := m.dashboardFocusedWidgetIndex()
	if idx < 0 {
		return m, fmt.Errorf("no focused dashboard pane")
	}
	w := &m.dashWidgets[idx]
	if len(w.modes) == 0 {
		return m, fmt.Errorf("focused dashboard pane has no modes")
	}
	current := w.activeMode
	if current < 0 || current >= len(w.modes) {
		current = 0
	}
	if delta > 0 {
		current = (current + 1) % len(w.modes)
	} else if delta < 0 {
		current = (current - 1 + len(w.modes)) % len(w.modes)
	}
	w.activeMode = current
	m.setStatusf("%s mode: %s", w.title, w.modes[current].label)
	return m, nil
}

func (m model) dashboardFocusedMode() (widgetMode, bool) {
	if len(m.dashWidgets) != dashboardPaneCount {
		return widgetMode{}, false
	}
	idx := m.dashboardFocusedWidgetIndex()
	if idx < 0 {
		return widgetMode{}, false
	}
	w := m.dashWidgets[idx]
	if len(w.modes) == 0 {
		return widgetMode{}, false
	}
	active := w.activeMode
	if active < 0 || active >= len(w.modes) {
		active = 0
	}
	return w.modes[active], true
}

func (m model) dashboardDrillPredicate(mode widgetMode) *filterNode {
	if strings.TrimSpace(mode.filterExpr) != "" {
		if node, err := parseFilterStrict(mode.filterExpr); err == nil {
			return node
		}
	}
	expr := ""
	switch strings.TrimSpace(mode.id) {
	case "net_worth":
		expr = "type:debit OR type:credit"
	default:
		expr = "type:debit"
	}
	node, err := parseFilterStrict(expr)
	if err != nil {
		return nil
	}
	return node
}

func (m model) dashboardDrillDown() (model, error) {
	if len(m.dashWidgets) != dashboardPaneCount {
		m.dashWidgets = newDashboardWidgets(m.customPaneModes)
	}
	idx := m.dashboardFocusedWidgetIndex()
	if idx < 0 {
		return m, fmt.Errorf("no focused dashboard pane")
	}
	mode, ok := m.dashboardFocusedMode()
	if !ok {
		return m, fmt.Errorf("no focused dashboard mode")
	}
	predicate := m.dashboardDrillPredicate(mode)
	if predicate == nil {
		return m, fmt.Errorf("focused mode has no drill predicate")
	}
	composed := andFilterNodes(m.buildDashboardScopeFilter(), predicate)
	if composed == nil {
		return m, fmt.Errorf("failed to compose drill filter")
	}
	w := m.dashWidgets[idx]
	active := w.activeMode
	if active < 0 || active >= len(w.modes) {
		active = 0
	}
	m.drillReturn = &drillReturnState{
		returnTab:             tabDashboard,
		focusedWidget:         idx,
		activeMode:            active,
		scroll:                0,
		prevFilterInput:       m.filterInput,
		prevFilterExpr:        m.filterExpr,
		prevFilterLastApplied: m.filterLastApplied,
		prevFilterInputErr:    m.filterInputErr,
	}
	expr := filterExprString(composed)
	m.filterInput = expr
	m.filterExpr = composed
	m.filterInputErr = ""
	m.filterLastApplied = expr
	m.filterInputMode = true
	m.filterInputCursor = len(m.filterInput)
	m.activeTab = tabManager
	m.managerMode = managerModeTransactions
	m.focusedSection = sectionManagerTransactions
	m.setStatusf("Dashboard drill-down: %s.", mode.label)
	return m, nil
}

func (m *model) restoreDrillReturnToDashboard() bool {
	if m == nil || m.drillReturn == nil {
		return false
	}
	state := m.drillReturn
	m.drillReturn = nil

	m.filterInput = state.prevFilterInput
	m.filterExpr = state.prevFilterExpr
	m.filterInputErr = state.prevFilterInputErr
	m.filterLastApplied = state.prevFilterLastApplied
	m.filterInputCursor = len(m.filterInput)
	m.filterInputMode = false

	m.activeTab = state.returnTab
	if m.activeTab != tabDashboard {
		m.applyTabDefaultsOnSwitch()
		return true
	}
	if len(m.dashWidgets) != dashboardPaneCount {
		m.dashWidgets = newDashboardWidgets(m.customPaneModes)
	}
	m.dashTimeframeFocus = false
	m.dashCustomEditing = false
	m.dashCustomInput = ""
	idx := state.focusedWidget
	if idx < 0 || idx >= len(m.dashWidgets) {
		m.focusedSection = sectionUnfocused
		return true
	}
	m.focusedSection = idx
	w := &m.dashWidgets[idx]
	if len(w.modes) == 0 {
		w.activeMode = 0
		return true
	}
	modeIdx := state.activeMode
	if modeIdx < 0 || modeIdx >= len(w.modes) {
		modeIdx = 0
	}
	w.activeMode = modeIdx
	m.setStatus("Returned from dashboard drill-down.")
	return true
}

func (m model) dashboardOpenCustomModeEdit() (model, error) {
	if len(m.savedFilters) == 0 {
		return m, fmt.Errorf("no saved filters")
	}
	if len(m.dashWidgets) != dashboardPaneCount {
		m.dashWidgets = newDashboardWidgets(m.customPaneModes)
	}
	idx := m.dashboardFocusedWidgetIndex()
	if idx != sectionDashboardNetCashflow {
		return m, fmt.Errorf("custom slot is active on Net/Cashflow only")
	}
	m.openFilterApplyPicker("")
	if m.filterApplyPicker != nil {
		m.filterApplyPicker.title = "Select Saved Filter for Net/Cashflow"
	}
	m.dashCustomModeEdit = true
	return m, nil
}

func (m model) dashboardApplyCustomModeFromSavedFilterID(id string) (model, error) {
	saved, ok := m.findSavedFilterByID(id)
	if !ok {
		return m, fmt.Errorf("unknown saved filter %q", strings.TrimSpace(id))
	}
	name := strings.TrimSpace(saved.Name)
	if name == "" {
		name = strings.TrimSpace(saved.ID)
	}
	entry := customPaneMode{
		Pane:     "net_cashflow",
		Name:     name,
		Expr:     strings.TrimSpace(saved.Expr),
		ViewType: "",
	}
	updated := false
	for i := range m.customPaneModes {
		if strings.EqualFold(strings.TrimSpace(m.customPaneModes[i].Pane), "net_cashflow") {
			m.customPaneModes[i] = entry
			updated = true
			break
		}
	}
	if !updated {
		m.customPaneModes = append(m.customPaneModes, entry)
	}
	m.dashWidgets = newDashboardWidgets(m.customPaneModes)
	if len(m.dashWidgets) > 0 {
		customIdx := len(m.dashWidgets[0].modes) - 1
		if customIdx >= 0 && m.dashWidgets[0].modes[customIdx].custom {
			m.dashWidgets[0].activeMode = customIdx
		}
	}
	m.focusedSection = sectionDashboardNetCashflow
	m.dashCustomModeEdit = false
	m.setStatusf("Net/Cashflow custom mode: %s.", name)
	return m, nil
}

func saveCustomPaneModesCmd(modes []customPaneMode) tea.Cmd {
	out := append([]customPaneMode(nil), modes...)
	return func() tea.Msg {
		return settingsSavedMsg{err: saveCustomPaneModes(out)}
	}
}
