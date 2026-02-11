package main

import tea "github.com/charmbracelet/bubbletea"

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

func (m model) updateSearch(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch {
	case m.isAction(scopeSearch, actionClearSearch, msg):
		m.searchMode = false
		m.searchQuery = ""
		m.cursor = 0
		m.topIndex = 0
		return m, nil
	case m.isAction(scopeSearch, actionConfirm, msg):
		m.searchMode = false
		// Keep the query active, just exit input mode
		return m, nil
	case isBackspaceKey(msg):
		if deleteLastASCIIByte(&m.searchQuery) {
			m.cursor = 0
			m.topIndex = 0
		}
		return m, nil
	case m.isAction(scopeGlobal, actionQuit, msg):
		return m, tea.Quit
	default:
		if appendPrintableASCII(&m.searchQuery, msg.String()) {
			m.cursor = 0
			m.topIndex = 0
		}
		return m, nil
	}
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
	case m.isAction(scopeDetailModal, actionClose, msg) || m.isAction(scopeDetailModal, actionSelect, msg):
		m.detailEditing = ""
		return m, nil
	case isBackspaceKey(msg):
		deleteLastASCIIByte(&m.detailNotes)
		return m, nil
	case m.isAction(scopeGlobal, actionQuit, msg):
		return m, tea.Quit
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
