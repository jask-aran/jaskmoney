package main

import (
	"fmt"
	"math"
	"strconv"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
)

func (m *model) closeDetail() {
	m.showDetail = false
	m.detailEditing = ""
	m.offsetCreditTxnID = 0
	m.offsetDebitPicker = nil
	m.offsetDebitTxnID = 0
	m.offsetAmount = ""
	m.offsetAmountCursor = 0
}

func (m *model) openDetail(txn transaction) {
	m.showDetail = true
	m.detailIdx = txn.id
	m.detailNotes = txn.notes
	m.detailEditing = ""
	m.detailCatCursor = 0
	m.offsetCreditTxnID = 0
	m.offsetDebitPicker = nil
	m.offsetDebitTxnID = 0
	m.offsetAmount = ""
	m.offsetAmountCursor = 0
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
		if m.drillReturn != nil {
			if m.restoreDrillReturnToDashboard() {
				return m, nil
			}
		}
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
		if m.drillReturn != nil {
			m.drillReturn = nil
		}
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
	if m.detailEditing == "offset_amount" {
		return m.updateDetailOffsetAmount(msg)
	}
	switch {
	case m.isAction(scopeDetailModal, actionClose, msg):
		m.closeDetail()
		return m, nil
	case m.isAction(scopeDetailModal, actionQuit, msg) || m.isAction(scopeGlobal, actionQuit, msg):
		return m, tea.Quit
	case m.isAction(scopeDetailModal, actionEdit, msg):
		// Switch to notes editing; place cursor at end.
		m.detailEditing = "notes"
		m.detailNotesCursor = len(m.detailNotes)
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

func (m model) openOffsetDebitPicker() (model, error) {
	txn := m.findDetailTxn()
	if txn == nil {
		return m, fmt.Errorf("no transaction selected")
	}
	if txn.amount <= 0 {
		return m, fmt.Errorf("selected source transaction is not a credit")
	}
	if m.db == nil {
		return m, fmt.Errorf("database not ready")
	}
	candidates, err := loadOffsetDebitCandidates(m.db, txn.id)
	if err != nil {
		return m, err
	}
	if len(candidates) == 0 {
		return m, fmt.Errorf("no candidate debits in ±30 day window")
	}
	items := make([]pickerItem, 0, len(candidates))
	for _, c := range candidates {
		items = append(items, pickerItem{
			ID:    c.id,
			Label: fmt.Sprintf("%s  %s", c.dateISO, truncate(c.description, 28)),
			Meta:  fmt.Sprintf("$%.2f", -c.amount),
		})
	}
	m.offsetCreditTxnID = txn.id
	m.offsetDebitPicker = newPicker("Link Credit Offset", items, false, "")
	m.offsetDebitPicker.cursorOnly = true
	return m, nil
}

func (m model) updateOffsetDebitPicker(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	if m.offsetDebitPicker == nil {
		return m, nil
	}
	res := m.offsetDebitPicker.HandleMsg(msg, func(action Action, in tea.KeyMsg) bool {
		return m.isAction(scopeOffsetDebitPicker, action, in)
	})
	switch res.Action {
	case pickerActionCancelled:
		m.offsetDebitPicker = nil
		m.offsetDebitTxnID = 0
		m.offsetAmount = ""
		m.offsetAmountCursor = 0
		return m, nil
	case pickerActionSelected:
		if m.db == nil {
			m.setError("Database not ready.")
			return m, nil
		}
		m.offsetDebitTxnID = res.ItemID
		creditCap, err := remainingCreditCapacity(m.db, m.offsetCreditTxnID)
		if err != nil {
			m.setError(fmt.Sprintf("compute credit capacity: %v", err))
			return m, nil
		}
		debitCap, err := remainingDebitCapacity(m.db, m.offsetDebitTxnID)
		if err != nil {
			m.setError(fmt.Sprintf("compute debit capacity: %v", err))
			return m, nil
		}
		defaultAmt := math.Min(creditCap, debitCap)
		if defaultAmt <= 0 {
			m.setError("No remaining offset capacity for selected transactions.")
			return m, nil
		}
		m.offsetDebitPicker = nil
		m.offsetAmount = fmt.Sprintf("%.2f", defaultAmt)
		m.offsetAmountCursor = len(m.offsetAmount)
		m.detailEditing = "offset_amount"
		m.setStatus("Enter offset amount, then press Enter to link.")
		return m, nil
	}
	return m, nil
}

func (m model) updateDetailOffsetAmount(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	keyName := normalizeKeyName(msg.String())
	switch {
	case m.isAction(scopeDetailModal, actionClose, msg):
		m.detailEditing = ""
		m.offsetAmount = ""
		m.offsetAmountCursor = 0
		m.offsetDebitTxnID = 0
		return m, nil
	case m.isAction(scopeDetailModal, actionSelect, msg):
		if m.db == nil {
			m.setError("Database not ready.")
			return m, nil
		}
		amount, err := strconv.ParseFloat(strings.TrimSpace(m.offsetAmount), 64)
		if err != nil || amount <= 0 {
			m.setError("Invalid offset amount.")
			return m, nil
		}
		if err := insertCreditOffset(m.db, m.offsetCreditTxnID, m.offsetDebitTxnID, amount); err != nil {
			m.setError(fmt.Sprintf("Link offset failed: %v", err))
			return m, nil
		}
		m.detailEditing = ""
		m.offsetAmount = ""
		m.offsetAmountCursor = 0
		m.offsetDebitTxnID = 0
		m.setStatus("Offset linked.")
		return m, refreshCmd(m.db)
	case isBackspaceKey(msg):
		deleteASCIIByteBeforeCursor(&m.offsetAmount, &m.offsetAmountCursor)
		return m, nil
	case keyName == "left":
		moveInputCursorASCII(m.offsetAmount, &m.offsetAmountCursor, -1)
		return m, nil
	case keyName == "right":
		moveInputCursorASCII(m.offsetAmount, &m.offsetAmountCursor, 1)
		return m, nil
	default:
		insertPrintableASCIIAtCursor(&m.offsetAmount, &m.offsetAmountCursor, msg.String())
		return m, nil
	}
}

func (m model) updateDetailNotes(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	keyName := normalizeKeyName(msg.String())
	switch {
	case m.isAction(scopeDetailModal, actionClose, msg):
		m.closeDetail()
		return m, nil
	case m.isAction(scopeDetailModal, actionSelect, msg):
		m.detailEditing = ""
		return m, nil
	case isBackspaceKey(msg):
		deleteASCIIByteBeforeCursor(&m.detailNotes, &m.detailNotesCursor)
		return m, nil
	case keyName == "left":
		moveInputCursorASCII(m.detailNotes, &m.detailNotesCursor, -1)
		return m, nil
	case keyName == "right":
		moveInputCursorASCII(m.detailNotes, &m.detailNotesCursor, 1)
		return m, nil
	default:
		insertPrintableASCIIAtCursor(&m.detailNotes, &m.detailNotesCursor, msg.String())
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
