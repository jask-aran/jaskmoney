package main

import (
	"time"

	tea "github.com/charmbracelet/bubbletea"
)

func (m model) updateDashboard(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	if m.dashCustomEditing {
		return m.updateDashboardCustomInput(msg)
	}

	switch {
	case m.isAction(scopeDashboard, actionTimeframe, msg):
		m.dashTimeframeFocus = !m.dashTimeframeFocus
		if m.dashTimeframeFocus {
			m.dashTimeframeCursor = m.dashTimeframe
		}
		return m, nil
	}

	if !m.dashTimeframeFocus {
		return m, nil
	}

	keyName := normalizeKeyName(msg.String())
	switch {
	case m.isAction(scopeDashboardTimeframe, actionColumn, msg):
		delta := navDeltaFromKeyName(keyName)
		if delta < 0 {
			m.dashTimeframeCursor--
			if m.dashTimeframeCursor < 0 {
				m.dashTimeframeCursor = dashTimeframeCount - 1
			}
		} else if delta > 0 {
			m.dashTimeframeCursor = (m.dashTimeframeCursor + 1) % dashTimeframeCount
		}
		return m, nil
	case m.isAction(scopeDashboardTimeframe, actionSelect, msg):
		if m.dashTimeframeCursor == dashTimeframeCustom {
			m.dashCustomEditing = true
			m.dashCustomStart = ""
			m.dashCustomEnd = ""
			m.dashCustomInput = ""
			m.setStatus("Custom timeframe: enter start date (YYYY-MM-DD).")
			return m, nil
		}
		m.dashTimeframe = m.dashTimeframeCursor
		m.dashTimeframeFocus = false
		m.setStatusf("Dashboard timeframe: %s", dashTimeframeLabel(m.dashTimeframe))
		return m, saveSettingsCmd(m.currentAppSettings())
	case m.isAction(scopeDashboardTimeframe, actionCancel, msg):
		m.dashTimeframeFocus = false
		m.setStatus("Timeframe selection cancelled.")
		return m, nil
	}
	return m, nil
}

func (m model) updateDashboardCustomInput(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch {
	case m.isAction(scopeDashboardCustomInput, actionCancel, msg):
		m.dashCustomEditing = false
		m.dashTimeframeFocus = false
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
		m.dashTimeframeCursor = dashTimeframeCustom
		m.dashCustomEditing = false
		m.dashTimeframeFocus = false
		m.setStatusf("Dashboard timeframe: %s to %s", m.dashCustomStart, m.dashCustomEnd)
		return m, saveSettingsCmd(m.currentAppSettings())
	default:
		appendPrintableASCII(&m.dashCustomInput, msg.String())
		return m, nil
	}
}
