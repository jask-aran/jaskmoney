package main

import (
	"strings"

	tea "github.com/charmbracelet/bubbletea"
)

func (m *model) openDetail(txn transaction) {
	m.showDetail = true
	m.detailIdx = txn.id
	m.detailNotes = txn.notes
	m.detailEditing = ""
	m.detailCatCursor = 0
	// Position category cursor at current category
	if txn.categoryID != nil {
		for i, c := range m.categories {
			if c.id == *txn.categoryID {
				m.detailCatCursor = i
				break
			}
		}
	}
}

func (m model) updateFilterInput(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	keyName := normalizeKeyName(msg.String())
	switch {
	case m.isAction(scopeFilterInput, actionClearSearch, msg):
		m.filterInputMode = false
		m.filterInput = ""
		m.filterInputCursor = 0
		m.filterExpr = nil
		m.filterInputErr = ""
		m.filterLastApplied = ""
		m.cursor = 0
		m.topIndex = 0
		return m, nil
	case m.isAction(scopeFilterInput, actionConfirm, msg):
		m.filterInputCursor = clampInputCursorASCII(m.filterInput, m.filterInputCursor)
		if strings.TrimSpace(m.filterInput) == "" {
			m.filterLastApplied = ""
		} else if node, err := parseFilterStrict(strings.TrimSpace(m.filterInput)); err == nil {
			m.filterLastApplied = filterExprString(node)
		} else {
			m.filterLastApplied = ""
		}
		// Apply expression and return focus to table navigation.
		m.filterInputMode = false
		return m, nil
	case keyName == "left":
		moveInputCursorASCII(m.filterInput, &m.filterInputCursor, -1)
		return m, nil
	case keyName == "right":
		moveInputCursorASCII(m.filterInput, &m.filterInputCursor, 1)
		return m, nil
	}

	if next, cmd, handled := m.executeBoundCommandLocal(scopeFilterInput, msg); handled {
		return next, cmd
	}

	if isBackspaceKey(msg) {
		if deleteASCIIByteBeforeCursor(&m.filterInput, &m.filterInputCursor) {
			m.filterLastApplied = ""
			m.reparseFilterInput()
			m.cursor = 0
			m.topIndex = 0
		}
		return m, nil
	}

	if insertPrintableASCIIAtCursor(&m.filterInput, &m.filterInputCursor, msg.String()) {
		m.filterLastApplied = ""
		m.reparseFilterInput()
		m.cursor = 0
		m.topIndex = 0
	}
	return m, nil
}

func (m *model) reparseFilterInput() {
	if m == nil {
		return
	}
	if strings.TrimSpace(m.filterInput) == "" {
		m.filterInputCursor = 0
		m.filterExpr = nil
		m.filterInputErr = ""
		m.filterLastApplied = ""
		return
	}
	m.filterInputCursor = clampInputCursorASCII(m.filterInput, m.filterInputCursor)
	node, err := parseFilter(m.filterInput)
	if err != nil {
		m.filterExpr = fallbackPlainTextFilter(m.filterInput)
		m.filterInputErr = err.Error()
		return
	}
	if !filterContainsFieldPredicate(node) {
		node = markTextNodesAsMetadata(node)
	}
	m.filterExpr = node
	m.filterInputErr = ""
}

func (m model) updateDetail(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	if m.detailEditing == "notes" {
		return m.updateDetailNotes(msg)
	}
	switch {
	case m.isAction(scopeDetailModal, actionClose, msg):
		m.showDetail = false
		return m, nil
	case m.isAction(scopeDetailModal, actionQuit, msg) || m.isAction(scopeGlobal, actionQuit, msg):
		return m, tea.Quit
	case m.isAction(scopeDetailModal, actionEdit, msg):
		// Switch to notes editing
		m.detailEditing = "notes"
		return m, nil
	case m.isAction(scopeDetailModal, actionSelect, msg):
		// Save notes only.
		if m.db == nil {
			return m, nil
		}
		txnID := m.detailIdx
		notes := m.detailNotes
		return m, func() tea.Msg {
			return txnSavedMsg{err: updateTransactionNotes(m.db, txnID, notes)}
		}
	}
	return m, nil
}

func (m model) updateDetailNotes(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch {
	case m.isAction(scopeDetailModal, actionClose, msg):
		m.showDetail = false
		m.detailEditing = ""
		return m, nil
	case m.isAction(scopeDetailModal, actionSelect, msg):
		m.detailEditing = ""
		return m, nil
	case isBackspaceKey(msg):
		deleteLastASCIIByte(&m.detailNotes)
		return m, nil
	default:
		appendPrintableASCII(&m.detailNotes, msg.String())
		return m, nil
	}
}

// findDetailTxn finds the transaction being edited by ID.
func (m model) findDetailTxn() *transaction {
	for i := range m.rows {
		if m.rows[i].id == m.detailIdx {
			return &m.rows[i]
		}
	}
	return nil
}
