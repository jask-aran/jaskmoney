package main

import (
	"fmt"
	"strconv"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
)

func (m model) updateBudget(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	if m.budgetEditing {
		return m.updateBudgetEdit(msg)
	}
	// In planner view, intercept h/l/left/right for column navigation
	// BEFORE executeBoundCommand can route them to month-change commands.
	if m.budgetView == 1 {
		if m.isAction(scopeBudget, actionBudgetPrevMonth, msg) {
			m.budgetPlannerCol--
			if m.budgetPlannerCol < 0 {
				m.budgetPlannerCol = 0
			}
			return m, nil
		}
		if m.isAction(scopeBudget, actionBudgetNextMonth, msg) {
			m.budgetPlannerCol++
			if m.budgetPlannerCol > 11 {
				m.budgetPlannerCol = 11
			}
			return m, nil
		}
	}
	if next, cmd, handled := m.executeBoundCommand(scopeBudget, msg); handled {
		return next, cmd
	}
	if m.moveBudgetCursor(msg) {
		return m, nil
	}
	return m, nil
}

func (m *model) moveBudgetCursor(msg tea.KeyMsg) bool {
	size := len(m.budgetLines)
	if m.budgetView == 0 {
		size += len(m.targetLines)
	}
	if size <= 0 {
		m.budgetCursor = 0
		return false
	}
	delta := m.verticalDelta(scopeBudget, msg)
	if delta == 0 {
		return false
	}
	m.budgetCursor = moveBoundedCursor(m.budgetCursor, size, delta)
	// Any cursor movement cancels the armed delete state.
	m.budgetDeleteArmedTarget = 0
	return true
}

func (m model) updateBudgetEdit(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	keyName := normalizeKeyName(msg.String())
	switch {
	case m.isAction(scopeBudget, actionCancel, msg):
		m.budgetEditing = false
		m.budgetEditValue = ""
		m.budgetEditCursor = 0
		return m, nil
	case m.isAction(scopeBudget, actionConfirm, msg):
		if m.budgetCursor < 0 || m.budgetCursor >= len(m.budgetLines) {
			m.budgetEditing = false
			m.budgetEditValue = ""
			m.budgetEditCursor = 0
			return m, nil
		}
		value, err := strconv.ParseFloat(strings.TrimSpace(m.budgetEditValue), 64)
		if err != nil {
			m.setError("Invalid budget value.")
			return m, nil
		}
		line := m.budgetLines[m.budgetCursor]
		if m.db == nil {
			m.setError("Database not ready.")
			return m, nil
		}
		if m.budgetView == 1 {
			month := time.Date(m.budgetYear, time.Month(m.budgetPlannerCol+1), 1, 0, 0, 0, 0, time.UTC).Format("2006-01")
			var budgetID int
			for _, b := range m.categoryBudgets {
				if b.categoryID == line.categoryID {
					budgetID = b.id
					break
				}
			}
			if budgetID == 0 {
				m.setError("Budget row not found.")
				return m, nil
			}
			if err := upsertBudgetOverride(m.db, budgetID, month, value); err != nil {
				m.setError(fmt.Sprintf("Save override failed: %v", err))
				return m, nil
			}
		} else {
			if err := upsertCategoryBudget(m.db, line.categoryID, value); err != nil {
				m.setError(fmt.Sprintf("Save budget failed: %v", err))
				return m, nil
			}
		}
		m.budgetEditing = false
		m.budgetEditValue = ""
		m.budgetEditCursor = 0
		return m, refreshCmd(m.db)
	case isBackspaceKey(msg):
		deleteASCIIByteBeforeCursor(&m.budgetEditValue, &m.budgetEditCursor)
		return m, nil
	case keyName == "left":
		moveInputCursorASCII(m.budgetEditValue, &m.budgetEditCursor, -1)
		return m, nil
	case keyName == "right":
		moveInputCursorASCII(m.budgetEditValue, &m.budgetEditCursor, 1)
		return m, nil
	default:
		insertPrintableASCIIAtCursor(&m.budgetEditValue, &m.budgetEditCursor, msg.String())
		return m, nil
	}
}

func budgetDeleteConfirmTimerCmd() tea.Cmd {
	return tea.Tick(2*time.Second, func(time.Time) tea.Msg {
		return budgetDeleteConfirmExpiredMsg{}
	})
}
