package main

import (
	"fmt"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
)

func (m model) updateMain(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	if m.isAction(scopeGlobal, actionCommandGoTransactions, msg) {
		m.activeTab = tabManager
		m.managerMode = managerModeTransactions
		return m, nil
	}
	if m.isAction(scopeGlobal, actionCommandGoDashboard, msg) {
		m.activeTab = tabDashboard
		return m, nil
	}
	if m.isAction(scopeGlobal, actionCommandGoSettings, msg) {
		m.activeTab = tabSettings
		return m, nil
	}
	if m.isAction(scopeGlobal, actionQuit, msg) {
		return m, tea.Quit
	}
	if m.isAction(scopeGlobal, actionNextTab, msg) {
		m.activeTab = (m.activeTab + 1) % tabCount
		if m.activeTab == tabManager {
			m.managerMode = managerModeTransactions
		}
		return m, nil
	}
	if m.isAction(scopeGlobal, actionPrevTab, msg) {
		m.activeTab = (m.activeTab - 1 + tabCount) % tabCount
		if m.activeTab == tabManager {
			m.managerMode = managerModeTransactions
		}
		return m, nil
	}
	// Tab-specific keys
	if m.activeTab == tabDashboard {
		return m.updateDashboard(msg)
	}
	if m.activeTab == tabManager {
		return m.updateManager(msg)
	}
	return m, nil
}

func (m model) updateManager(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	if m.managerMode == managerModeTransactions {
		if m.isAction(scopeManagerTransactions, actionFocusAccounts, msg) {
			if m.rangeSelecting {
				m.clearRangeSelection()
			}
			m.managerMode = managerModeAccounts
			return m, nil
		}
		txnMode := m
		next, cmd := txnMode.updateNavigationWithVisible(msg, m.managerVisibleRows())
		out, ok := next.(model)
		if !ok {
			return m, cmd
		}
		out.managerMode = managerModeTransactions
		return out, cmd
	}

	if m.isAction(scopeManager, actionBack, msg) {
		m.managerMode = managerModeTransactions
		m.ensureCursorInWindow()
		return m, nil
	}

	if len(m.accounts) == 0 {
		if m.isAction(scopeManager, actionAdd, msg) {
			m.openManagerAccountModal(true, nil)
		}
		return m, nil
	}

	idx := m.managerFocusedIndex()
	if idx < 0 {
		return m, nil
	}
	switch {
	case m.verticalDelta(scopeManager, msg) != 0:
		idx = moveBoundedCursor(idx, len(m.accounts), m.verticalDelta(scopeManager, msg))
		m.managerCursor = idx
		m.managerSelectedID = m.accounts[idx].id
		return m, nil
	case m.isAction(scopeManager, actionAdd, msg):
		m.openManagerAccountModal(true, nil)
		return m, nil
	case m.isAction(scopeManager, actionQuickTag, msg):
		return m.openQuickTagPicker(m.getFilteredRows())
	case m.isAction(scopeManager, actionToggleSelect, msg):
		if m.filterAccounts == nil {
			m.filterAccounts = make(map[int]bool)
		}
		// "All accounts active" is represented by an empty map.
		// On first toggle, materialize current all-active state so a single
		// toggle only affects the focused account.
		if len(m.filterAccounts) == 0 {
			for _, acc := range m.accounts {
				m.filterAccounts[acc.id] = true
			}
		}
		id := m.accounts[idx].id
		if m.filterAccounts[id] {
			delete(m.filterAccounts, id)
		} else {
			m.filterAccounts[id] = true
		}
		return m, nil
	case m.isAction(scopeManager, actionSave, msg):
		if m.db == nil {
			m.setError("Database not ready.")
			return m, nil
		}
		ids := make([]int, 0, len(m.filterAccounts))
		for id := range m.filterAccounts {
			ids = append(ids, id)
		}
		db := m.db
		return m, func() tea.Msg {
			if err := saveSelectedAccounts(db, ids); err != nil {
				return refreshDoneMsg{err: err}
			}
			return refreshCmd(db)()
		}
	case m.isAction(scopeManager, actionSelect, msg) || m.isAction(scopeManager, actionEdit, msg):
		acc := m.accounts[idx]
		m.openManagerAccountModal(false, &acc)
		return m, nil
	case m.isAction(scopeManager, actionClearDB, msg):
		if m.db == nil {
			m.setError("Database not ready.")
			return m, nil
		}
		acc := m.accounts[idx]
		db := m.db
		return m, func() tea.Msg {
			if _, err := clearTransactionsForAccount(db, acc.id); err != nil {
				return refreshDoneMsg{err: err}
			}
			return refreshCmd(db)()
		}
	case m.isAction(scopeManager, actionDelete, msg):
		if m.db == nil {
			m.setError("Database not ready.")
			return m, nil
		}
		acc := m.accounts[idx]
		count, err := countTransactionsForAccount(m.db, acc.id)
		if err != nil {
			m.setError(fmt.Sprintf("Count failed: %v", err))
			return m, nil
		}
		if count > 0 {
			m.setStatusf("Account %q has %d transactions. Press c to clear, then del to delete.", acc.name, count)
			return m, nil
		}
		db := m.db
		return m, func() tea.Msg {
			if err := deleteAccountIfEmpty(db, acc.id); err != nil {
				return refreshDoneMsg{err: err}
			}
			if err := removeFormatForAccount(acc.name); err != nil {
				return refreshDoneMsg{err: err}
			}
			return refreshCmd(db)()
		}
	}
	return m, nil
}

func (m *model) openManagerAccountModal(isNew bool, acc *account) {
	m.managerModalOpen = true
	m.managerModalIsNew = isNew
	m.managerEditFocus = 0
	if isNew || acc == nil {
		m.managerEditID = 0
		m.managerEditSource = ""
		m.managerEditName = ""
		m.managerEditType = "debit"
		m.managerEditPrefix = ""
		m.managerEditActive = true
		return
	}
	m.managerEditID = acc.id
	m.managerEditSource = acc.name
	m.managerEditName = acc.name
	m.managerEditType = normalizeAccountType(acc.acctType)
	m.managerEditPrefix = strings.ToLower(acc.name)
	for _, f := range m.formats {
		if strings.EqualFold(f.Account, acc.name) || strings.EqualFold(f.Name, acc.name) {
			if strings.TrimSpace(f.ImportPrefix) != "" {
				m.managerEditPrefix = strings.TrimSpace(f.ImportPrefix)
			}
			break
		}
	}
	m.managerEditActive = acc.isActive
}

func (m *model) closeManagerAccountModal() {
	m.managerModalOpen = false
	m.managerModalIsNew = false
	m.managerEditSource = ""
}

func (m model) updateManagerModal(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch {
	case m.isAction(scopeManagerModal, actionClose, msg):
		m.closeManagerAccountModal()
		return m, nil
	case m.verticalDelta(scopeManagerModal, msg) != 0:
		delta := m.verticalDelta(scopeManagerModal, msg)
		if delta > 0 {
			m.managerEditFocus = (m.managerEditFocus + 1) % 4
		} else if delta < 0 {
			m.managerEditFocus = (m.managerEditFocus - 1 + 4) % 4
		}
		return m, nil
	case m.horizontalDelta(scopeManagerModal, msg) != 0 || m.isAction(scopeManagerModal, actionToggleSelect, msg):
		if m.managerEditFocus == 1 {
			if m.managerEditType == "credit" {
				m.managerEditType = "debit"
			} else {
				m.managerEditType = "credit"
			}
		} else if m.managerEditFocus == 3 {
			m.managerEditActive = !m.managerEditActive
		}
		return m, nil
	case isBackspaceKey(msg):
		if m.managerEditFocus == 0 {
			deleteLastASCIIByte(&m.managerEditName)
		}
		if m.managerEditFocus == 2 {
			deleteLastASCIIByte(&m.managerEditPrefix)
		}
		return m, nil
	case m.isAction(scopeManagerModal, actionSave, msg):
		name := strings.TrimSpace(m.managerEditName)
		if name == "" {
			m.setError("Account name cannot be empty.")
			return m, nil
		}
		prefix := strings.TrimSpace(m.managerEditPrefix)
		if prefix == "" {
			prefix = strings.ToLower(name)
		}
		if m.db == nil {
			m.setError("Database not ready.")
			return m, nil
		}
		db := m.db
		isNew := m.managerModalIsNew
		id := m.managerEditID
		sourceName := strings.TrimSpace(m.managerEditSource)
		acctType := normalizeAccountType(m.managerEditType)
		active := m.managerEditActive
		m.closeManagerAccountModal()
		return m, func() tea.Msg {
			if isNew {
				newID, err := insertAccount(db, name, acctType, active)
				if err != nil {
					return refreshDoneMsg{err: err}
				}
				id = newID
			} else {
				if err := updateAccount(db, id, name, acctType, active); err != nil {
					return refreshDoneMsg{err: err}
				}
				if sourceName != "" && !strings.EqualFold(sourceName, name) {
					if err := removeFormatForAccount(sourceName); err != nil {
						return refreshDoneMsg{err: err}
					}
				}
			}
			if err := upsertFormatForAccount(name, acctType); err != nil {
				return refreshDoneMsg{err: err}
			}
			formats, _, err := loadAppConfig()
			if err != nil {
				return refreshDoneMsg{err: err}
			}
			for i := range formats {
				if strings.EqualFold(formats[i].Account, name) || strings.EqualFold(formats[i].Name, name) {
					formats[i].ImportPrefix = prefix
				}
			}
			if err := saveFormats(formats); err != nil {
				return refreshDoneMsg{err: err}
			}
			return refreshCmd(db)()
		}
	default:
		r := msg.String()
		if m.managerEditFocus == 0 {
			appendPrintableASCII(&m.managerEditName, r)
		}
		if m.managerEditFocus == 2 {
			appendPrintableASCII(&m.managerEditPrefix, r)
		}
		return m, nil
	}
}

// updateFilePicker handles keys in the CSV file picker overlay.
func (m model) updateFilePicker(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch {
	case m.isAction(scopeFilePicker, actionClose, msg):
		m.importPicking = false
		return m, nil
	case m.isAction(scopeFilePicker, actionQuit, msg) || m.isAction(scopeGlobal, actionQuit, msg):
		return m, tea.Quit
	case m.verticalDelta(scopeFilePicker, msg) != 0:
		m.importCursor = moveBoundedCursor(m.importCursor, len(m.importFiles), m.verticalDelta(scopeFilePicker, msg))
		return m, nil
	case m.isAction(scopeFilePicker, actionSelect, msg):
		if len(m.importFiles) == 0 || m.importCursor >= len(m.importFiles) {
			m.setStatus("No file selected.")
			return m, nil
		}
		if m.db == nil {
			m.setError("Database not ready.")
			return m, nil
		}
		file := m.importFiles[m.importCursor]
		m.importPicking = false
		m.setStatus("Scanning for duplicates...")
		return m, scanDupesCmd(m.db, file, m.basePath, m.formats)
	}
	return m, nil
}

// updateDupeModal handles keys in the duplicate decision modal.
// a = force import all, s = skip duplicates, esc/c = cancel.
func (m model) updateDupeModal(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch {
	case m.isAction(scopeDupeModal, actionImportAll, msg):
		// Force import all (including dupes)
		m.importDupeModal = false
		m.setStatus("Importing all (including duplicates)...")
		return m, ingestCmd(m.db, m.importDupeFile, m.basePath, m.formats, false)
	case m.isAction(scopeDupeModal, actionSkipDupes, msg):
		// Skip duplicates
		m.importDupeModal = false
		m.setStatus("Importing (skipping duplicates)...")
		return m, ingestCmd(m.db, m.importDupeFile, m.basePath, m.formats, true)
	case m.isAction(scopeDupeModal, actionClose, msg):
		m.importDupeModal = false
		m.setStatus("Import cancelled.")
		return m, nil
	case m.isAction(scopeGlobal, actionQuit, msg):
		return m, tea.Quit
	}
	return m, nil
}
