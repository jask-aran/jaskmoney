package main

import (
	"time"

	tea "github.com/charmbracelet/bubbletea"
)

func (m model) updateDashboard(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	if m.dashCustomEditing {
		return m.updateDashboardCustomInput(msg)
	}

	if next, cmd, handled := m.executeBoundCommand(scopeDashboard, msg); handled {
		return next, cmd
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
