package main

import (
	"fmt"
	"sort"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
)

const (
	managerAccountActionClear = 1
	managerAccountActionNuke  = 2
)

func (m model) updateMain(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	if m.isAction(scopeGlobal, actionQuit, msg) {
		return m, tea.Quit
	}
	if next, cmd, handled := m.executeBoundCommand(scopeGlobal, msg); handled {
		return next, cmd
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
		m.focusedSection = sectionManagerTransactions
		txnMode := m
		next, cmd := txnMode.updateNavigationWithVisible(msg, m.managerVisibleRows())
		out, ok := next.(model)
		if !ok {
			return m, cmd
		}
		out.managerMode = managerModeTransactions
		out.focusedSection = sectionManagerTransactions
		return out, cmd
	}
	m.focusedSection = sectionManagerAccounts

	if m.isAction(scopeManager, actionBack, msg) {
		m.managerMode = managerModeTransactions
		m.focusedSection = sectionManagerTransactions
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
	case m.horizontalDelta(scopeManager, msg) != 0:
		idx = moveBoundedCursor(idx, len(m.accounts), m.horizontalDelta(scopeManager, msg))
		m.managerCursor = idx
		m.managerSelectedID = m.accounts[idx].id
		return m, nil
	case m.isAction(scopeManager, actionSearch, msg):
		m.managerMode = managerModeTransactions
		m.focusedSection = sectionManagerTransactions
		m.filterInputMode = true
		m.filterInputCursor = len(m.filterInput)
		return m, nil
	case m.isAction(scopeManager, actionAdd, msg):
		m.openManagerAccountModal(true, nil)
		return m, nil
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
		if len(m.filterAccounts) == 0 || len(m.filterAccounts) == len(m.accounts) {
			m.filterAccounts = nil
		}
		return m, m.persistManagerAccountScopeCmd()
	case m.isAction(scopeManager, actionSelect, msg) || m.isAction(scopeManager, actionEdit, msg):
		acc := m.accounts[idx]
		m.openManagerAccountModal(false, &acc)
		return m, nil
	case m.isAction(scopeManager, actionDelete, msg):
		acc := m.accounts[idx]
		meta := fmt.Sprintf("%d transactions", acc.txnCount)
		if acc.txnCount == 1 {
			meta = "1 transaction"
		}
		items := []pickerItem{
			{ID: managerAccountActionClear, Label: "Clear transactions", Meta: meta},
			{ID: managerAccountActionNuke, Label: "Nuke account", Meta: "Delete account + transactions"},
		}
		m.managerActionPicker = newPicker(fmt.Sprintf("Account Actions: %s", acc.name), items, false, "")
		m.managerActionAcctID = acc.id
		m.managerActionName = acc.name
		return m, nil
	}
	if next, cmd, handled := m.executeBoundCommand(scopeManager, msg); handled {
		return next, cmd
	}
	return m, nil
}

func (m model) persistManagerAccountScopeCmd() tea.Cmd {
	if m.db == nil {
		return nil
	}
	ids := selectedAccountIDsForPersistence(m.accounts, m.filterAccounts)
	db := m.db
	return func() tea.Msg {
		return accountScopeSavedMsg{err: saveSelectedAccounts(db, ids)}
	}
}

func selectedAccountIDsForPersistence(accounts []account, selected map[int]bool) []int {
	if len(selected) == 0 {
		return nil
	}
	ids := make([]int, 0, len(selected))
	for _, acc := range accounts {
		if selected[acc.id] {
			ids = append(ids, acc.id)
		}
	}
	if len(ids) == 0 || len(ids) == len(accounts) {
		return nil
	}
	sort.Ints(ids)
	return ids
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

func (m *model) closeManagerActionPicker() {
	m.managerActionPicker = nil
	m.managerActionAcctID = 0
	m.managerActionName = ""
}

func (m model) updateManagerModal(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	keyName := normalizeKeyName(msg.String())
	textFocus := m.managerEditFocus == 0 || m.managerEditFocus == 2
	if textFocus {
		switch keyName {
		case "esc":
			m.closeManagerAccountModal()
			return m, nil
		case "enter":
			// fall through to normal save path below
		case "backspace":
			if m.managerEditFocus == 0 {
				deleteLastASCIIByte(&m.managerEditName)
			}
			if m.managerEditFocus == 2 {
				deleteLastASCIIByte(&m.managerEditPrefix)
			}
			return m, nil
		case "left", "right":
			// Horizontal arrows do nothing while editing free text.
			return m, nil
		default:
			if m.managerEditFocus == 0 {
				if appendPrintableASCII(&m.managerEditName, msg.String()) {
					return m, nil
				}
			}
			if m.managerEditFocus == 2 {
				if appendPrintableASCII(&m.managerEditPrefix, msg.String()) {
					return m, nil
				}
			}
		}
	}

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
	case m.isAction(scopeManagerModal, actionConfirm, msg):
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

func (m model) updateManagerActionPicker(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	if m.managerActionPicker == nil {
		return m, nil
	}
	res := m.managerActionPicker.HandleMsg(msg, func(action Action, in tea.KeyMsg) bool {
		return m.isAction(scopeManagerAccountAction, action, in)
	})
	switch res.Action {
	case pickerActionCancelled:
		m.closeManagerActionPicker()
		m.setStatus("Account action cancelled.")
		return m, nil
	case pickerActionSelected:
		if m.db == nil {
			m.setError("Database not ready.")
			return m, nil
		}
		accountID := m.managerActionAcctID
		accountName := m.managerActionName
		db := m.db
		m.closeManagerActionPicker()
		switch res.ItemID {
		case managerAccountActionClear:
			return m, func() tea.Msg {
				n, err := clearTransactionsForAccount(db, accountID)
				return accountClearedMsg{accountName: accountName, deletedTxns: n, err: err}
			}
		case managerAccountActionNuke:
			return m, func() tea.Msg {
				n, err := nukeAccountWithTransactions(db, accountID)
				if err == nil {
					err = removeFormatForAccount(accountName)
				}
				return accountNukedMsg{accountName: accountName, deletedTxns: n, err: err}
			}
		default:
			m.setError("Unknown account action selected.")
			return m, nil
		}
	}
	return m, nil
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
