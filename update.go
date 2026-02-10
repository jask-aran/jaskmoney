package main

import (
	"fmt"
	"sort"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
)

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case dbReadyMsg:
		return m.handleDBReady(msg)
	case refreshDoneMsg:
		return m.handleRefreshDone(msg)
	case filesLoadedMsg:
		return m.handleFilesLoaded(msg)
	case dupeScanMsg:
		return m.handleDupeScan(msg)
	case clearDoneMsg:
		return m.handleClearDone(msg)
	case ingestDoneMsg:
		return m.handleIngestDone(msg)
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		m.ensureCursorInWindow()
		return m, nil
	case txnSavedMsg:
		if msg.err != nil {
			m.setError(fmt.Sprintf("Save failed: %v", msg.err))
			return m, nil
		}
		m.status = "Transaction updated."
		m.statusErr = false
		m.showDetail = false
		return m, refreshCmd(m.db)
	case categorySavedMsg:
		if msg.err != nil {
			m.setError(fmt.Sprintf("Category save failed: %v", msg.err))
			return m, nil
		}
		m.settMode = settModeNone
		m.settInput = ""
		m.settInput2 = ""
		m.status = "Category saved."
		m.statusErr = false
		return m, refreshCmd(m.db)
	case categoryDeletedMsg:
		if msg.err != nil {
			m.setError(fmt.Sprintf("Delete failed: %v", msg.err))
			return m, nil
		}
		m.confirmAction = ""
		m.status = "Category deleted."
		m.statusErr = false
		return m, refreshCmd(m.db)
	case tagSavedMsg:
		if msg.err != nil {
			m.setError(fmt.Sprintf("Tag save failed: %v", msg.err))
			return m, nil
		}
		m.settMode = settModeNone
		m.settInput = ""
		m.settInput2 = ""
		m.status = "Tag saved."
		m.statusErr = false
		return m, refreshCmd(m.db)
	case tagDeletedMsg:
		if msg.err != nil {
			m.setError(fmt.Sprintf("Delete failed: %v", msg.err))
			return m, nil
		}
		m.confirmAction = ""
		m.status = "Tag deleted."
		m.statusErr = false
		return m, refreshCmd(m.db)
	case ruleSavedMsg:
		if msg.err != nil {
			m.setError(fmt.Sprintf("Rule save failed: %v", msg.err))
			return m, nil
		}
		m.settMode = settModeNone
		m.settInput = ""
		m.status = "Rule saved."
		m.statusErr = false
		return m, refreshCmd(m.db)
	case ruleDeletedMsg:
		if msg.err != nil {
			m.setError(fmt.Sprintf("Delete failed: %v", msg.err))
			return m, nil
		}
		m.confirmAction = ""
		m.status = "Rule deleted."
		m.statusErr = false
		return m, refreshCmd(m.db)
	case rulesAppliedMsg:
		if msg.err != nil {
			m.setError(fmt.Sprintf("Apply rules failed: %v", msg.err))
			return m, nil
		}
		m.status = fmt.Sprintf("Applied rules: %d transactions updated.", msg.count)
		m.statusErr = false
		return m, refreshCmd(m.db)
	case settingsSavedMsg:
		if msg.err != nil {
			m.setError(fmt.Sprintf("Save settings failed: %v", msg.err))
		}
		return m, nil
	case quickCategoryAppliedMsg:
		return m.handleQuickCategoryApplied(msg)
	case quickTagsAppliedMsg:
		return m.handleQuickTagsApplied(msg)
	case accountNukedMsg:
		if msg.err != nil {
			m.setError(fmt.Sprintf("Account nuke failed: %v", msg.err))
			return m, nil
		}
		m.status = fmt.Sprintf("Nuked %q (%d transactions removed).", msg.accountName, msg.deletedTxns)
		m.statusErr = false
		if m.db == nil {
			return m, nil
		}
		return m, refreshCmd(m.db)
	case confirmExpiredMsg:
		m.confirmAction = ""
		m.confirmID = 0
		return m, nil
	case tea.KeyMsg:
		if m.showDetail {
			return m.updateDetail(msg)
		}
		if m.importDupeModal {
			return m.updateDupeModal(msg)
		}
		if m.importPicking {
			return m.updateFilePicker(msg)
		}
		if m.catPicker != nil {
			return m.updateCatPicker(msg)
		}
		if m.tagPicker != nil {
			return m.updateTagPicker(msg)
		}
		if m.accountNukePicker != nil {
			return m.updateAccountNukePicker(msg)
		}
		if m.managerModalOpen {
			return m.updateManagerModal(msg)
		}
		if m.searchMode {
			return m.updateSearch(msg)
		}
		if m.activeTab == tabSettings {
			return m.updateSettings(msg)
		}
		return m.updateMain(msg)
	}
	return m, nil
}

// setError sets the status as an error message (rendered in Red).
func (m *model) setError(msg string) {
	m.status = msg
	m.statusErr = true
}

// ---------------------------------------------------------------------------
// Message handlers (called from Update)
// ---------------------------------------------------------------------------

func (m model) handleDBReady(msg dbReadyMsg) (tea.Model, tea.Cmd) {
	if msg.err != nil {
		m.setError(fmt.Sprintf("DB error: %v", msg.err))
		return m, nil
	}
	m.db = msg.db
	if err := syncAccountsFromFormats(m.db, m.formats); err != nil {
		m.setError(fmt.Sprintf("Account sync error: %v", err))
		return m, nil
	}
	return m, refreshCmd(m.db)
}

func (m model) handleRefreshDone(msg refreshDoneMsg) (tea.Model, tea.Cmd) {
	if msg.err != nil {
		m.setError(fmt.Sprintf("DB error: %v", msg.err))
		return m, nil
	}
	m.rows = msg.rows
	m.categories = msg.categories
	m.rules = msg.rules
	m.tags = msg.tags
	m.tagRules = msg.tagRules
	m.txnTags = msg.txnTags
	if m.txnTags == nil {
		m.txnTags = make(map[int][]tag)
	}
	m.imports = msg.imports
	m.accounts = msg.accounts
	m.dbInfo = msg.info
	if len(msg.selectedAccounts) == 0 {
		m.filterAccounts = nil
	} else {
		m.filterAccounts = msg.selectedAccounts
	}
	m.ready = true
	m.pruneSelections()
	if m.managerCursor >= len(m.accounts) {
		m.managerCursor = len(m.accounts) - 1
	}
	if m.managerCursor < 0 {
		m.managerCursor = 0
	}
	idx := m.managerFocusedIndex()
	if idx >= 0 {
		m.managerCursor = idx
		m.managerSelectedID = m.accounts[idx].id
	}
	// Only reset cursor on first load, not on subsequent refreshes
	if m.status == "" {
		m.cursor = 0
		m.topIndex = 0
		m.status = "Ready. Press tab to switch views, import from Settings."
		m.statusErr = false
	}
	// Clamp cursor to valid range after data change
	filtered := m.getFilteredRows()
	if m.cursor >= len(filtered) {
		m.cursor = len(filtered) - 1
	}
	if m.cursor < 0 {
		m.cursor = 0
	}
	return m, nil
}

func (m model) handleFilesLoaded(msg filesLoadedMsg) (tea.Model, tea.Cmd) {
	if msg.err != nil {
		m.setError(fmt.Sprintf("File scan error: %v", msg.err))
		m.importPicking = false
		return m, nil
	}
	m.importFiles = msg.files
	m.importCursor = 0
	if len(msg.files) == 0 {
		m.status = "No CSV files found in current directory."
		m.statusErr = false
		m.importPicking = false
	}
	return m, nil
}

func (m model) handleDupeScan(msg dupeScanMsg) (tea.Model, tea.Cmd) {
	if msg.err != nil {
		m.setError(fmt.Sprintf("Scan failed: %v", msg.err))
		return m, nil
	}
	if msg.dupes == 0 {
		// No dupes — import directly (skip dupes mode doesn't matter)
		m.status = "Importing..."
		m.statusErr = false
		return m, ingestCmd(m.db, msg.file, m.basePath, m.formats, true)
	}
	// Show dupe modal
	m.importDupeModal = true
	m.importDupeFile = msg.file
	m.importDupeTotal = msg.total
	m.importDupeCount = msg.dupes
	return m, nil
}

func (m model) handleClearDone(msg clearDoneMsg) (tea.Model, tea.Cmd) {
	if msg.err != nil {
		m.setError(fmt.Sprintf("Clear failed: %v", msg.err))
		return m, nil
	}
	m.status = "Database cleared."
	m.statusErr = false
	if m.db == nil {
		return m, nil
	}
	return m, refreshCmd(m.db)
}

func (m model) handleIngestDone(msg ingestDoneMsg) (tea.Model, tea.Cmd) {
	if msg.err != nil {
		m.setError(fmt.Sprintf("Import failed: %v", msg.err))
		return m, nil
	}
	if msg.dupes > 0 {
		m.status = fmt.Sprintf("Imported %d transactions from %s (%d duplicates skipped)", msg.count, msg.file, msg.dupes)
	} else {
		m.status = fmt.Sprintf("Imported %d transactions from %s", msg.count, msg.file)
	}
	m.statusErr = false
	if m.db == nil {
		return m, nil
	}
	return m, refreshCmd(m.db)
}

func (m model) handleQuickCategoryApplied(msg quickCategoryAppliedMsg) (tea.Model, tea.Cmd) {
	if msg.err != nil {
		m.setError(fmt.Sprintf("Quick categorize failed: %v", msg.err))
		return m, nil
	}
	m.catPicker = nil
	m.catPickerFor = nil
	if msg.created {
		m.status = fmt.Sprintf("Created %q and applied to %d transaction(s).", msg.categoryName, msg.count)
	} else {
		m.status = fmt.Sprintf("Category %q applied to %d transaction(s).", msg.categoryName, msg.count)
	}
	m.statusErr = false
	if m.db == nil {
		return m, nil
	}
	return m, refreshCmd(m.db)
}

func (m model) handleQuickTagsApplied(msg quickTagsAppliedMsg) (tea.Model, tea.Cmd) {
	if msg.err != nil {
		m.setError(fmt.Sprintf("Quick tagging failed: %v", msg.err))
		return m, nil
	}
	m.tagPicker = nil
	m.tagPickerFor = nil
	m.status = fmt.Sprintf("Updated tags for %d transaction(s).", msg.count)
	m.statusErr = false
	if m.db == nil {
		return m, nil
	}
	return m, refreshCmd(m.db)
}

func (m model) currentAppSettings() appSettings {
	out := defaultSettings()
	out.RowsPerPage = m.maxVisibleRows
	if m.spendingWeekAnchor == time.Monday {
		out.SpendingWeekFrom = "monday"
	} else {
		out.SpendingWeekFrom = "sunday"
	}
	out.DashTimeframe = m.dashTimeframe
	out.DashCustomStart = m.dashCustomStart
	out.DashCustomEnd = m.dashCustomEnd
	return normalizeSettings(out)
}

func saveSettingsCmd(s appSettings) tea.Cmd {
	return func() tea.Msg {
		return settingsSavedMsg{err: saveAppSettings(s)}
	}
}

func (m model) isAction(scope string, action Action, msg tea.KeyMsg) bool {
	reg := m.keys
	if reg == nil {
		reg = NewKeyRegistry()
	}
	b := reg.Lookup(msg.String(), scope)
	return b != nil && b.Action == action
}

func (m model) primaryActionKey(scope string, action Action, fallback string) string {
	reg := m.keys
	if reg == nil {
		reg = NewKeyRegistry()
	}
	for _, b := range reg.BindingsForScope(scope) {
		if b.Action == action && len(b.Keys) > 0 {
			return b.Keys[0]
		}
	}
	return fallback
}

// ---------------------------------------------------------------------------
// Key-input handlers
// ---------------------------------------------------------------------------

func (m model) updateMain(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
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

	// Transactions-specific keys
	if m.activeTab == tabTransactions {
		return m.updateNavigation(msg)
	}
	// Dashboard-specific keys
	if m.activeTab == tabDashboard {
		return m.updateDashboard(msg)
	}
	if m.activeTab == tabManager {
		return m.updateManager(msg)
	}
	return m, nil
}

func (m model) updateManager(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	keyName := normalizeKeyName(msg.String())
	if m.managerMode == managerModeTransactions {
		if m.isAction(scopeManagerTransactions, actionFocusAccounts, msg) {
			if m.rangeSelecting {
				m.clearRangeSelection()
			}
			m.managerMode = managerModeAccounts
			return m, nil
		}
		txnMode := m
		txnMode.activeTab = tabTransactions
		// Keep navigation viewport in sync with manager rendering for this key event,
		// but do not persistently mutate configured rows-per-page.
		originalMaxRows := txnMode.maxVisibleRows
		txnMode.maxVisibleRows = m.managerVisibleRows()
		next, cmd := txnMode.updateNavigation(msg)
		out, ok := next.(model)
		if !ok {
			return m, cmd
		}
		out.maxVisibleRows = originalMaxRows
		out.activeTab = tabManager
		out.managerMode = managerModeTransactions
		return out, cmd
	}

	if m.isAction(scopeManager, actionBack, msg) || keyName == "esc" {
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
	case m.isAction(scopeManager, actionNavigate, msg) && (keyName == "j" || keyName == "down" || keyName == "ctrl+n"):
		if idx < len(m.accounts)-1 {
			idx++
		}
		m.managerCursor = idx
		m.managerSelectedID = m.accounts[idx].id
		return m, nil
	case m.isAction(scopeManager, actionNavigate, msg):
		if idx > 0 {
			idx--
		}
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
			m.status = fmt.Sprintf("Account %q has %d transactions. Press c to clear, then d to delete.", acc.name, count)
			m.statusErr = false
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
		m.managerEditName = ""
		m.managerEditType = "debit"
		m.managerEditPrefix = ""
		m.managerEditActive = true
		return
	}
	m.managerEditID = acc.id
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
}

func (m model) updateManagerModal(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	keyName := normalizeKeyName(msg.String())
	switch {
	case m.isAction(scopeManagerModal, actionClose, msg):
		m.closeManagerAccountModal()
		return m, nil
	case m.isAction(scopeManagerModal, actionNavigate, msg) && (keyName == "j" || keyName == "down" || keyName == "ctrl+n"):
		m.managerEditFocus = (m.managerEditFocus + 1) % 4
		return m, nil
	case m.isAction(scopeManagerModal, actionNavigate, msg):
		m.managerEditFocus = (m.managerEditFocus - 1 + 4) % 4
		return m, nil
	case m.isAction(scopeManagerModal, actionColor, msg):
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
	case keyName == "backspace":
		if m.managerEditFocus == 0 && len(m.managerEditName) > 0 {
			m.managerEditName = m.managerEditName[:len(m.managerEditName)-1]
		}
		if m.managerEditFocus == 2 && len(m.managerEditPrefix) > 0 {
			m.managerEditPrefix = m.managerEditPrefix[:len(m.managerEditPrefix)-1]
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
		if len(r) == 1 && r[0] >= 32 && r[0] < 127 {
			if m.managerEditFocus == 0 {
				m.managerEditName += r
			}
			if m.managerEditFocus == 2 {
				m.managerEditPrefix += r
			}
		}
		return m, nil
	}
}

// updateFilePicker handles keys in the CSV file picker overlay.
func (m model) updateFilePicker(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	keyName := normalizeKeyName(msg.String())
	switch {
	case m.isAction(scopeFilePicker, actionClose, msg):
		m.importPicking = false
		return m, nil
	case m.isAction(scopeFilePicker, actionQuit, msg) || m.isAction(scopeGlobal, actionQuit, msg):
		return m, tea.Quit
	case m.isAction(scopeFilePicker, actionNavigate, msg) && (keyName == "j" || keyName == "down" || keyName == "ctrl+n"):
		if m.importCursor < len(m.importFiles)-1 {
			m.importCursor++
		}
		return m, nil
	case m.isAction(scopeFilePicker, actionNavigate, msg):
		if m.importCursor > 0 {
			m.importCursor--
		}
		return m, nil
	case m.isAction(scopeFilePicker, actionSelect, msg):
		if len(m.importFiles) == 0 || m.importCursor >= len(m.importFiles) {
			m.status = "No file selected."
			m.statusErr = false
			return m, nil
		}
		if m.db == nil {
			m.setError("Database not ready.")
			return m, nil
		}
		file := m.importFiles[m.importCursor]
		m.importPicking = false
		m.status = "Scanning for duplicates..."
		m.statusErr = false
		return m, scanDupesCmd(m.db, file, m.basePath, m.formats)
	}
	return m, nil
}

// updateDupeModal handles keys in the duplicate decision modal.
// a = force import all, s = skip duplicates, esc/c = cancel.
func (m model) updateDupeModal(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	keyName := normalizeKeyName(msg.String())
	switch {
	case m.isAction(scopeDupeModal, actionImportAll, msg):
		// Force import all (including dupes)
		m.importDupeModal = false
		m.status = "Importing all (including duplicates)..."
		m.statusErr = false
		return m, ingestCmd(m.db, m.importDupeFile, m.basePath, m.formats, false)
	case m.isAction(scopeDupeModal, actionSkipDupes, msg):
		// Skip duplicates
		m.importDupeModal = false
		m.status = "Importing (skipping duplicates)..."
		m.statusErr = false
		return m, ingestCmd(m.db, m.importDupeFile, m.basePath, m.formats, true)
	case m.isAction(scopeDupeModal, actionClose, msg) || keyName == "c":
		m.importDupeModal = false
		m.status = "Import cancelled."
		m.statusErr = false
		return m, nil
	case m.isAction(scopeGlobal, actionQuit, msg):
		return m, tea.Quit
	}
	return m, nil
}

func (m model) updateNavigation(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	filtered := m.getFilteredRows()
	m.ensureRangeSelectionValid(filtered)
	rawKey := msg.String()
	keyName := normalizeKeyName(msg.String())
	switch keyName {
	case "up", "k", "ctrl+p":
		if m.rangeSelecting {
			m.clearRangeSelection()
		}
		if m.cursor > 0 {
			m.cursor--
			if m.cursor < m.topIndex {
				m.topIndex = m.cursor
			}
		}
		return m, nil
	case "down", "j", "ctrl+n":
		if m.rangeSelecting {
			m.clearRangeSelection()
		}
		if m.cursor < len(filtered)-1 {
			m.cursor++
			visible := m.visibleRows()
			if visible <= 0 {
				visible = 1
			}
			if m.cursor >= m.topIndex+visible {
				m.topIndex = m.cursor - visible + 1
			}
		}
		return m, nil
	case "g":
		if rawKey == "g" {
			if m.rangeSelecting {
				m.clearRangeSelection()
			}
			m.cursor = 0
			m.topIndex = 0
			return m, nil
		}
		if rawKey == "G" {
			if m.rangeSelecting {
				m.clearRangeSelection()
			}
			m.cursor = len(filtered) - 1
			if m.cursor < 0 {
				m.cursor = 0
			}
			visible := m.visibleRows()
			m.topIndex = m.cursor - visible + 1
			if m.topIndex < 0 {
				m.topIndex = 0
			}
			return m, nil
		}
	}
	if m.isAction(scopeTransactions, actionRangeHighlight, msg) {
		if keyName == "shift+up" {
			m.moveCursorWithShift(-1, filtered)
		} else {
			m.moveCursorWithShift(1, filtered)
		}
		return m, nil
	}

	// These only apply on the Transactions tab
	if m.activeTab == tabTransactions {
		switch {
		case m.isAction(scopeTransactions, actionSearch, msg):
			if m.rangeSelecting {
				m.clearRangeSelection()
			}
			m.searchMode = true
			m.searchQuery = ""
			return m, nil
		case m.isAction(scopeTransactions, actionSort, msg) && msg.String() != "S":
			if m.rangeSelecting {
				m.clearRangeSelection()
			}
			m.sortColumn = (m.sortColumn + 1) % sortColumnCount
			m.cursor = 0
			m.topIndex = 0
			return m, nil
		case msg.String() == "S":
			if m.rangeSelecting {
				m.clearRangeSelection()
			}
			m.sortAscending = !m.sortAscending
			m.cursor = 0
			m.topIndex = 0
			return m, nil
		case m.isAction(scopeTransactions, actionFilterCategory, msg):
			if m.rangeSelecting {
				m.clearRangeSelection()
			}
			m.cycleCategoryFilter()
			m.cursor = 0
			m.topIndex = 0
			return m, nil
		case m.isAction(scopeTransactions, actionToggleSelect, msg):
			highlighted := m.highlightedRows(filtered)
			if len(highlighted) > 0 {
				m.toggleSelectionForHighlighted(highlighted, filtered)
			} else {
				m.toggleSelectionAtCursor(filtered)
			}
			return m, nil
		case m.isAction(scopeTransactions, actionQuickCategory, msg):
			return m.openQuickCategoryPicker(filtered)
		case m.isAction(scopeTransactions, actionQuickTag, msg):
			return m.openQuickTagPicker(filtered)
		case keyName == "esc":
			if m.rangeSelecting {
				m.clearRangeSelection()
				m.status = "Range highlight cleared."
				m.statusErr = false
				return m, nil
			}
			if m.selectedCount() > 0 {
				m.clearSelections()
				m.status = "Selection cleared."
				m.statusErr = false
				return m, nil
			}
			if m.searchQuery != "" {
				m.searchQuery = ""
				m.cursor = 0
				m.topIndex = 0
				m.status = "Search cleared."
				m.statusErr = false
			}
			return m, nil
		case m.isAction(scopeTransactions, actionSelect, msg):
			if len(filtered) > 0 && m.cursor < len(filtered) {
				m.openDetail(filtered[m.cursor])
			}
			return m, nil
		}
	}
	return m, nil
}

func (m model) openQuickCategoryPicker(filtered []transaction) (tea.Model, tea.Cmd) {
	targetIDs := m.quickCategoryTargets(filtered)
	if len(targetIDs) == 0 {
		m.status = "No transaction selected."
		m.statusErr = false
		return m, nil
	}
	if len(m.categories) == 0 {
		m.status = "No categories available."
		m.statusErr = false
		return m, nil
	}

	items := make([]pickerItem, 0, len(m.categories))
	for _, c := range m.categories {
		items = append(items, pickerItem{
			ID:    c.id,
			Label: c.name,
			Color: c.color,
		})
	}
	m.catPicker = newPicker("Quick Categorize", items, false, "Create")
	m.catPickerFor = targetIDs
	return m, nil
}

func (m model) quickCategoryTargets(filtered []transaction) []int {
	if len(m.selectedRows) > 0 {
		out := make([]int, 0, len(m.selectedRows))
		for id := range m.selectedRows {
			out = append(out, id)
		}
		sort.Ints(out)
		return out
	}
	if len(filtered) == 0 || m.cursor < 0 || m.cursor >= len(filtered) {
		return nil
	}
	return []int{filtered[m.cursor].id}
}

func (m model) openQuickTagPicker(filtered []transaction) (tea.Model, tea.Cmd) {
	targetIDs := m.quickCategoryTargets(filtered)
	if len(targetIDs) == 0 {
		m.status = "No transaction selected."
		m.statusErr = false
		return m, nil
	}

	items := make([]pickerItem, 0, len(m.tags))
	var txnCategoryID *int
	if len(targetIDs) == 1 {
		if txn := m.findTxnByID(targetIDs[0]); txn != nil {
			txnCategoryID = txn.categoryID
		}
	}
	for _, tg := range m.tags {
		section := "Global"
		if tg.categoryID != nil {
			if txnCategoryID != nil && *txnCategoryID == *tg.categoryID {
				section = "Scoped"
			} else {
				section = "Other Scoped"
			}
		}
		items = append(items, pickerItem{
			ID:      tg.id,
			Label:   tg.name,
			Color:   tg.color,
			Section: section,
		})
	}
	m.tagPicker = newPicker("Quick Tags", items, true, "Create")
	m.tagPickerFor = targetIDs
	if len(targetIDs) == 1 {
		for _, tg := range m.txnTags[targetIDs[0]] {
			m.tagPicker.selected[tg.id] = true
		}
	}
	return m, nil
}

func (m model) findTxnByID(id int) *transaction {
	for i := range m.rows {
		if m.rows[i].id == id {
			return &m.rows[i]
		}
	}
	return nil
}

func (m model) updateCatPicker(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	if m.catPicker == nil {
		return m, nil
	}
	res := m.catPicker.HandleKey(msg.String())
	switch res.Action {
	case pickerActionCancelled:
		m.catPicker = nil
		m.catPickerFor = nil
		m.status = "Quick categorize cancelled."
		m.statusErr = false
		return m, nil
	case pickerActionSelected:
		if m.db == nil {
			m.setError("Database not ready.")
			return m, nil
		}
		targetIDs := append([]int(nil), m.catPickerFor...)
		catID := res.ItemID
		catName := res.ItemLabel
		db := m.db
		return m, func() tea.Msg {
			n, err := updateTransactionsCategory(db, targetIDs, &catID)
			return quickCategoryAppliedMsg{count: n, categoryName: catName, created: false, err: err}
		}
	case pickerActionCreate:
		if m.db == nil {
			m.setError("Database not ready.")
			return m, nil
		}
		name := strings.TrimSpace(res.CreatedQuery)
		if name == "" {
			m.setError("Category name cannot be empty.")
			return m, nil
		}
		targetIDs := append([]int(nil), m.catPickerFor...)
		db := m.db
		return m, func() tea.Msg {
			colors := CategoryAccentColors()
			color := "#a6e3a1"
			if len(colors) > 0 {
				color = string(colors[0])
			}

			created := true
			catID, err := insertCategory(db, name, color)
			if err != nil {
				created = false
				existing, lookupErr := loadCategoryByNameCI(db, name)
				if lookupErr != nil {
					return quickCategoryAppliedMsg{err: err}
				}
				if existing == nil {
					return quickCategoryAppliedMsg{err: err}
				}
				catID = existing.id
				name = existing.name
			}

			n, err := updateTransactionsCategory(db, targetIDs, &catID)
			return quickCategoryAppliedMsg{count: n, categoryName: name, created: created, err: err}
		}
	}
	return m, nil
}

func (m model) updateTagPicker(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	if m.tagPicker == nil {
		return m, nil
	}
	res := m.tagPicker.HandleKey(msg.String())
	switch res.Action {
	case pickerActionCancelled:
		m.tagPicker = nil
		m.tagPickerFor = nil
		m.status = "Quick tagging cancelled."
		m.statusErr = false
		return m, nil
	case pickerActionSubmitted:
		if m.db == nil {
			m.setError("Database not ready.")
			return m, nil
		}
		targetIDs := append([]int(nil), m.tagPickerFor...)
		selected := append([]int(nil), res.SelectedIDs...)
		db := m.db
		return m, func() tea.Msg {
			if len(targetIDs) == 1 {
				err := setTransactionTags(db, targetIDs[0], selected)
				return quickTagsAppliedMsg{count: len(targetIDs), err: err}
			}
			_, err := addTagsToTransactions(db, targetIDs, selected)
			return quickTagsAppliedMsg{count: len(targetIDs), err: err}
		}
	case pickerActionCreate:
		if m.db == nil {
			m.setError("Database not ready.")
			return m, nil
		}
		name := strings.TrimSpace(res.CreatedQuery)
		if name == "" {
			m.setError("Tag name cannot be empty.")
			return m, nil
		}
		targetIDs := append([]int(nil), m.tagPickerFor...)
		db := m.db
		return m, func() tea.Msg {
			tagID := 0
			created, err := insertTag(db, name, "", nil)
			if err != nil {
				existing, lookupErr := loadTagByNameCI(db, name)
				if lookupErr != nil {
					return quickTagsAppliedMsg{err: err}
				}
				if existing == nil {
					return quickTagsAppliedMsg{err: err}
				}
				tagID = existing.id
			} else {
				tagID = created
			}
			if len(targetIDs) == 1 {
				current, loadErr := loadTransactionTags(db)
				if loadErr != nil {
					return quickTagsAppliedMsg{err: loadErr}
				}
				desired := []int{tagID}
				for _, tg := range current[targetIDs[0]] {
					if tg.id != tagID {
						desired = append(desired, tg.id)
					}
				}
				return quickTagsAppliedMsg{count: 1, err: setTransactionTags(db, targetIDs[0], desired)}
			}
			_, err = addTagsToTransactions(db, targetIDs, []int{tagID})
			return quickTagsAppliedMsg{count: len(targetIDs), err: err}
		}
	}
	return m, nil
}

func (m *model) selectedCount() int {
	if m == nil || len(m.selectedRows) == 0 {
		return 0
	}
	return len(m.selectedRows)
}

func (m *model) clearSelections() {
	if m == nil {
		return
	}
	m.selectedRows = make(map[int]bool)
	m.selectionAnchor = 0
}

func (m *model) clearRangeSelection() {
	if m == nil {
		return
	}
	m.rangeSelecting = false
	m.rangeAnchorID = 0
	m.rangeCursorID = 0
}

func (m *model) pruneSelections() {
	if m == nil {
		return
	}
	if m.selectedRows == nil {
		m.selectedRows = make(map[int]bool)
	}
	if len(m.selectedRows) == 0 {
		return
	}

	keep := make(map[int]bool, len(m.rows))
	for _, r := range m.rows {
		keep[r.id] = true
	}
	for id := range m.selectedRows {
		if !keep[id] {
			delete(m.selectedRows, id)
		}
	}
	if m.selectionAnchor != 0 && !keep[m.selectionAnchor] {
		m.selectionAnchor = 0
	}
	if m.rangeAnchorID != 0 && !keep[m.rangeAnchorID] {
		m.clearRangeSelection()
	}
	if m.rangeCursorID != 0 && !keep[m.rangeCursorID] {
		m.clearRangeSelection()
	}
}

func (m *model) toggleSelectionAtCursor(filtered []transaction) {
	if m == nil || len(filtered) == 0 || m.cursor < 0 || m.cursor >= len(filtered) {
		return
	}
	if m.selectedRows == nil {
		m.selectedRows = make(map[int]bool)
	}

	id := filtered[m.cursor].id
	if m.selectedRows[id] {
		delete(m.selectedRows, id)
	} else {
		m.selectedRows[id] = true
	}
	m.selectionAnchor = id
}

func indexInFiltered(filtered []transaction, txnID int) int {
	if txnID == 0 {
		return -1
	}
	for i := range filtered {
		if filtered[i].id == txnID {
			return i
		}
	}
	return -1
}

func (m *model) moveCursorWithShift(delta int, filtered []transaction) {
	if m == nil || len(filtered) == 0 || delta == 0 {
		return
	}
	if !m.rangeSelecting {
		if m.cursor >= 0 && m.cursor < len(filtered) {
			m.rangeAnchorID = filtered[m.cursor].id
			m.rangeCursorID = filtered[m.cursor].id
		}
		m.rangeSelecting = true
	}

	next := m.cursor + delta
	if next < 0 {
		next = 0
	}
	if next > len(filtered)-1 {
		next = len(filtered) - 1
	}
	m.cursor = next
	visible := m.visibleRows()
	if visible <= 0 {
		visible = 1
	}
	if m.cursor < m.topIndex {
		m.topIndex = m.cursor
	} else if m.cursor >= m.topIndex+visible {
		m.topIndex = m.cursor - visible + 1
	}
	m.rangeCursorID = filtered[m.cursor].id
}

func (m *model) ensureRangeSelectionValid(filtered []transaction) bool {
	if m == nil || !m.rangeSelecting {
		return false
	}
	if len(filtered) == 0 {
		m.clearRangeSelection()
		return false
	}
	if indexInFiltered(filtered, m.rangeAnchorID) < 0 || indexInFiltered(filtered, m.rangeCursorID) < 0 {
		m.clearRangeSelection()
		return false
	}
	return true
}

func (m model) highlightedRows(filtered []transaction) map[int]bool {
	if !m.rangeSelecting || len(filtered) == 0 {
		return nil
	}
	anchorIdx := indexInFiltered(filtered, m.rangeAnchorID)
	cursorIdx := indexInFiltered(filtered, m.rangeCursorID)
	if anchorIdx < 0 || cursorIdx < 0 {
		return nil
	}
	start := anchorIdx
	end := cursorIdx
	if start > end {
		start, end = end, start
	}
	out := make(map[int]bool, end-start+1)
	for i := start; i <= end; i++ {
		out[filtered[i].id] = true
	}
	return out
}

func (m *model) toggleSelectionForHighlighted(highlighted map[int]bool, filtered []transaction) {
	if m == nil || len(highlighted) == 0 {
		return
	}
	if m.selectedRows == nil {
		m.selectedRows = make(map[int]bool)
	}

	allSelected := true
	for id := range highlighted {
		if !m.selectedRows[id] {
			allSelected = false
			break
		}
	}
	for id := range highlighted {
		if allSelected {
			delete(m.selectedRows, id)
		} else {
			m.selectedRows[id] = true
		}
	}
	if m.cursor >= 0 && m.cursor < len(filtered) {
		m.selectionAnchor = filtered[m.cursor].id
	}
}

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
	case m.isAction(scopeDashboardTimeframe, actionColumn, msg) && (keyName == "h" || keyName == "left"):
		m.dashTimeframeCursor--
		if m.dashTimeframeCursor < 0 {
			m.dashTimeframeCursor = dashTimeframeCount - 1
		}
		return m, nil
	case m.isAction(scopeDashboardTimeframe, actionColumn, msg):
		m.dashTimeframeCursor = (m.dashTimeframeCursor + 1) % dashTimeframeCount
		return m, nil
	case m.isAction(scopeDashboardTimeframe, actionSelect, msg):
		if m.dashTimeframeCursor == dashTimeframeCustom {
			m.dashCustomEditing = true
			m.dashCustomStart = ""
			m.dashCustomEnd = ""
			m.dashCustomInput = ""
			m.status = "Custom timeframe: enter start date (YYYY-MM-DD)."
			m.statusErr = false
			return m, nil
		}
		m.dashTimeframe = m.dashTimeframeCursor
		m.dashTimeframeFocus = false
		m.status = fmt.Sprintf("Dashboard timeframe: %s", dashTimeframeLabel(m.dashTimeframe))
		m.statusErr = false
		return m, saveSettingsCmd(m.currentAppSettings())
	case m.isAction(scopeDashboardTimeframe, actionCancel, msg):
		m.dashTimeframeFocus = false
		m.status = "Timeframe selection cancelled."
		m.statusErr = false
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
		m.status = "Custom timeframe cancelled."
		m.statusErr = false
		return m, nil
	case msg.String() == "backspace":
		if len(m.dashCustomInput) > 0 {
			m.dashCustomInput = m.dashCustomInput[:len(m.dashCustomInput)-1]
		}
		return m, nil
	case m.isAction(scopeDashboardCustomInput, actionConfirm, msg):
		if _, err := time.Parse("2006-01-02", m.dashCustomInput); err != nil {
			m.setError("Invalid date. Use YYYY-MM-DD.")
			return m, nil
		}
		if m.dashCustomStart == "" {
			m.dashCustomStart = m.dashCustomInput
			m.dashCustomInput = ""
			m.status = "Custom timeframe: enter end date (YYYY-MM-DD)."
			m.statusErr = false
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
		m.status = fmt.Sprintf("Dashboard timeframe: %s to %s", m.dashCustomStart, m.dashCustomEnd)
		m.statusErr = false
		return m, saveSettingsCmd(m.currentAppSettings())
	default:
		r := msg.String()
		if len(r) == 1 && r[0] >= 32 && r[0] < 127 {
			m.dashCustomInput += r
		}
		return m, nil
	}
}

func (m *model) cycleCategoryFilter() {
	if len(m.categories) == 0 {
		return
	}
	order := make([]int, 0, len(m.categories)+1)
	nameByID := make(map[int]string, len(m.categories)+1)
	for _, c := range m.categories {
		order = append(order, c.id)
		nameByID[c.id] = c.name
	}
	// Sentinel for uncategorised transactions
	order = append(order, 0)
	nameByID[0] = "Uncategorised"

	if m.filterCategories == nil {
		// First press: filter to first category only
		m.filterCategories = map[int]bool{order[0]: true}
		m.status = "Filter: " + nameByID[order[0]]
		m.statusErr = false
		return
	}
	// Find which single category is selected and advance to next
	for i, id := range order {
		if m.filterCategories[id] {
			next := (i + 1) % (len(order) + 1)
			if next == len(order) {
				// Wrapped around: clear filter
				m.filterCategories = nil
				m.status = "Filter: all categories"
				m.statusErr = false
				return
			}
			m.filterCategories = map[int]bool{order[next]: true}
			m.status = "Filter: " + nameByID[order[next]]
			m.statusErr = false
			return
		}
	}
	// Shouldn't reach here, reset
	m.filterCategories = nil
	m.status = "Filter: all categories"
	m.statusErr = false
}

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
	case msg.String() == "backspace":
		if len(m.searchQuery) > 0 {
			m.searchQuery = m.searchQuery[:len(m.searchQuery)-1]
			m.cursor = 0
			m.topIndex = 0
		}
		return m, nil
	case m.isAction(scopeGlobal, actionQuit, msg):
		return m, tea.Quit
	default:
		// Only add printable characters
		r := msg.String()
		if len(r) == 1 && r[0] >= 32 && r[0] < 127 {
			m.searchQuery += r
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
	keyName := normalizeKeyName(msg.String())
	switch {
	case m.isAction(scopeDetailModal, actionClose, msg):
		m.showDetail = false
		return m, nil
	case m.isAction(scopeDetailModal, actionQuit, msg) || m.isAction(scopeGlobal, actionQuit, msg):
		return m, tea.Quit
	case m.isAction(scopeDetailModal, actionNavigate, msg) && (keyName == "j" || keyName == "down" || keyName == "ctrl+n"):
		if m.detailCatCursor < len(m.categories)-1 {
			m.detailCatCursor++
		}
		return m, nil
	case m.isAction(scopeDetailModal, actionNavigate, msg):
		if m.detailCatCursor > 0 {
			m.detailCatCursor--
		}
		return m, nil
	case msg.String() == "n":
		// Switch to notes editing
		m.detailEditing = "notes"
		return m, nil
	case m.isAction(scopeDetailModal, actionSelect, msg):
		// Save category + notes
		if m.db == nil {
			return m, nil
		}
		var catID *int
		if m.detailCatCursor < len(m.categories) {
			id := m.categories[m.detailCatCursor].id
			catID = &id
		}
		txnID := m.detailIdx
		notes := m.detailNotes
		return m, func() tea.Msg {
			return txnSavedMsg{err: updateTransactionDetail(m.db, txnID, catID, notes)}
		}
	}
	return m, nil
}

func (m model) updateDetailNotes(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch {
	case m.isAction(scopeDetailModal, actionClose, msg) || m.isAction(scopeDetailModal, actionSelect, msg):
		m.detailEditing = ""
		return m, nil
	case msg.String() == "backspace":
		if len(m.detailNotes) > 0 {
			m.detailNotes = m.detailNotes[:len(m.detailNotes)-1]
		}
		return m, nil
	case m.isAction(scopeGlobal, actionQuit, msg):
		return m, tea.Quit
	default:
		r := msg.String()
		if len(r) == 1 && r[0] >= 32 && r[0] < 127 {
			m.detailNotes += r
		}
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

// ---------------------------------------------------------------------------
// Settings key handler
// ---------------------------------------------------------------------------

// settSectionForColumn returns the settSection index given current column and row.
func settSectionForColumn(col, row int) int {
	if col == settColRight {
		if row <= 0 {
			return settSecChart
		}
		return settSecDBImport
	}
	// Left column: row 0 = Categories, row 1 = Tags, row 2 = Rules
	if row <= 0 {
		return settSecCategories
	}
	if row == 1 {
		return settSecTags
	}
	return settSecRules
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
	case settSecChart:
		return settColRight, 0
	case settSecDBImport:
		return settColRight, 1
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
	case settSecDBImport:
		return scopeSettingsActiveDBImport
	default:
		return scopeSettingsActiveCategories
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
	if m.confirmAction != "" {
		return m.updateSettingsConfirm(msg)
	}

	// If a section is active, delegate to section-specific handler
	if m.settActive {
		return m.updateSettingsActive(msg)
	}

	// Section navigation mode
	keyName := normalizeKeyName(msg.String())
	switch {
	case m.isAction(scopeSettingsNav, actionQuit, msg) || m.isAction(scopeGlobal, actionQuit, msg):
		return m, tea.Quit
	case m.isAction(scopeSettingsNav, actionNextTab, msg):
		m.activeTab = (m.activeTab + 1) % tabCount
		return m, nil
	case m.isAction(scopeSettingsNav, actionPrevTab, msg) || m.isAction(scopeGlobal, actionPrevTab, msg):
		m.activeTab = (m.activeTab - 1 + tabCount) % tabCount
		return m, nil
	case m.isAction(scopeSettingsNav, actionColumn, msg) && (keyName == "h" || keyName == "left"):
		if m.settColumn == settColRight {
			m.settColumn = settColLeft
			// Default to first row in left column
			m.settSection = settSecCategories
		}
		return m, nil
	case m.isAction(scopeSettingsNav, actionColumn, msg):
		if m.settColumn == settColLeft {
			m.settColumn = settColRight
			m.settSection = settSecChart
		}
		return m, nil
	case m.isAction(scopeSettingsNav, actionSection, msg) && (keyName == "j" || keyName == "down" || keyName == "ctrl+n"):
		col, row := settColumnRow(m.settSection)
		row++
		maxRow := 2
		if col == settColRight {
			maxRow = 1
		}
		if row > maxRow {
			row = 0
		}
		m.settSection = settSectionForColumn(col, row)
		return m, nil
	case m.isAction(scopeSettingsNav, actionSection, msg):
		col, row := settColumnRow(m.settSection)
		row--
		if row < 0 {
			if col == settColRight {
				row = 1
			} else {
				row = 2
			}
		}
		m.settSection = settSectionForColumn(col, row)
		return m, nil
	case m.isAction(scopeSettingsNav, actionActivate, msg):
		m.settActive = true
		m.settItemCursor = 0
		return m, nil
	case m.isAction(scopeSettingsNav, actionImport, msg):
		m.importPicking = true
		m.importFiles = nil
		m.importCursor = 0
		return m, loadFilesCmd(m.basePath)
	}
	return m, nil
}

// updateSettingsActive handles keys when a section is activated (enter was pressed).
func (m model) updateSettingsActive(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch {
	case m.isAction(settingsActiveScope(m.settSection), actionBack, msg):
		m.settActive = false
		return m, nil
	case m.isAction(scopeGlobal, actionQuit, msg):
		return m, tea.Quit
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
	case settSecDBImport:
		return m.updateSettingsDBImport(msg)
	}
	return m, nil
}

func (m model) updateSettingsCategories(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	keyName := normalizeKeyName(msg.String())
	switch {
	case m.isAction(scopeSettingsActiveCategories, actionNavigate, msg) && (keyName == "j" || keyName == "down" || keyName == "ctrl+n"):
		if m.settItemCursor < len(m.categories)-1 {
			m.settItemCursor++
		}
		return m, nil
	case m.isAction(scopeSettingsActiveCategories, actionNavigate, msg):
		if m.settItemCursor > 0 {
			m.settItemCursor--
		}
		return m, nil
	case m.isAction(scopeSettingsActiveCategories, actionAdd, msg):
		m.settMode = settModeAddCat
		m.settInput = ""
		m.settColorIdx = 0
		return m, nil
	case m.isAction(scopeSettingsActiveCategories, actionEdit, msg):
		if m.settItemCursor < len(m.categories) {
			cat := m.categories[m.settItemCursor]
			m.settMode = settModeEditCat
			m.settEditID = cat.id
			m.settInput = cat.name
			m.settColorIdx = 0
			colors := CategoryAccentColors()
			for i, c := range colors {
				if string(c) == cat.color {
					m.settColorIdx = i
					break
				}
			}
		}
		return m, nil
	case m.isAction(scopeSettingsActiveCategories, actionDelete, msg):
		if m.settItemCursor < len(m.categories) {
			cat := m.categories[m.settItemCursor]
			if cat.isDefault {
				m.status = "Cannot delete the default category."
				return m, nil
			}
			m.confirmAction = "delete_cat"
			m.confirmID = cat.id
			keyLabel := m.primaryActionKey(scopeSettingsActiveCategories, actionDelete, "d")
			m.status = fmt.Sprintf("Press %s again to delete %q", keyLabel, cat.name)
			return m, confirmTimerCmd()
		}
		return m, nil
	}
	return m, nil
}

func (m model) updateSettingsTags(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	keyName := normalizeKeyName(msg.String())
	switch {
	case m.isAction(scopeSettingsActiveTags, actionNavigate, msg) && (keyName == "j" || keyName == "down" || keyName == "ctrl+n"):
		if m.settItemCursor < len(m.tags)-1 {
			m.settItemCursor++
		}
		return m, nil
	case m.isAction(scopeSettingsActiveTags, actionNavigate, msg):
		if m.settItemCursor > 0 {
			m.settItemCursor--
		}
		return m, nil
	case m.isAction(scopeSettingsActiveTags, actionAdd, msg):
		m.settMode = settModeAddTag
		m.settInput = ""
		m.settColorIdx = 0
		m.settEditID = 0
		return m, nil
	case m.isAction(scopeSettingsActiveTags, actionEdit, msg):
		if m.settItemCursor < len(m.tags) {
			tg := m.tags[m.settItemCursor]
			m.settMode = settModeEditTag
			m.settEditID = tg.id
			m.settInput = tg.name
			m.settColorIdx = 0
			colors := TagAccentColors()
			for i, c := range colors {
				if string(c) == tg.color {
					m.settColorIdx = i
					break
				}
			}
		}
		return m, nil
	case m.isAction(scopeSettingsActiveTags, actionDelete, msg):
		if m.settItemCursor < len(m.tags) {
			tg := m.tags[m.settItemCursor]
			m.confirmAction = "delete_tag"
			m.confirmID = tg.id
			keyLabel := m.primaryActionKey(scopeSettingsActiveTags, actionDelete, "d")
			m.status = fmt.Sprintf("Press %s again to delete tag %q", keyLabel, tg.name)
			return m, confirmTimerCmd()
		}
		return m, nil
	}
	return m, nil
}

func (m model) updateSettingsRules(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	keyName := normalizeKeyName(msg.String())
	switch {
	case m.isAction(scopeSettingsActiveRules, actionNavigate, msg) && (keyName == "j" || keyName == "down" || keyName == "ctrl+n"):
		if m.settItemCursor < len(m.rules)-1 {
			m.settItemCursor++
		}
		return m, nil
	case m.isAction(scopeSettingsActiveRules, actionNavigate, msg):
		if m.settItemCursor > 0 {
			m.settItemCursor--
		}
		return m, nil
	case m.isAction(scopeSettingsActiveRules, actionAdd, msg):
		m.settMode = settModeAddRule
		m.settInput = ""
		m.settRuleCatIdx = 0
		m.settEditID = 0
		return m, nil
	case m.isAction(scopeSettingsActiveRules, actionEdit, msg):
		if m.settItemCursor < len(m.rules) {
			rule := m.rules[m.settItemCursor]
			m.settMode = settModeEditRule
			m.settEditID = rule.id
			m.settInput = rule.pattern
			m.settRuleCatIdx = 0
			for i, c := range m.categories {
				if c.id == rule.categoryID {
					m.settRuleCatIdx = i
					break
				}
			}
		}
		return m, nil
	case m.isAction(scopeSettingsActiveRules, actionDelete, msg):
		if m.settItemCursor < len(m.rules) {
			rule := m.rules[m.settItemCursor]
			m.confirmAction = "delete_rule"
			m.confirmID = rule.id
			keyLabel := m.primaryActionKey(scopeSettingsActiveRules, actionDelete, "d")
			m.status = fmt.Sprintf("Press %s again to delete rule %q", keyLabel, rule.pattern)
			return m, confirmTimerCmd()
		}
		return m, nil
	case m.isAction(scopeSettingsActiveRules, actionApplyAll, msg):
		if m.db == nil {
			return m, nil
		}
		db := m.db
		return m, func() tea.Msg {
			count, err := applyCategoryRules(db)
			return rulesAppliedMsg{count: count, err: err}
		}
	}
	return m, nil
}

func (m model) updateSettingsDBImport(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch {
	case m.isAction(scopeSettingsActiveDBImport, actionClearDB, msg):
		m.confirmAction = "clear_db"
		keyLabel := m.primaryActionKey(scopeSettingsActiveDBImport, actionClearDB, "c")
		m.status = fmt.Sprintf("Press %s again to clear all data", keyLabel)
		return m, confirmTimerCmd()
	case m.isAction(scopeSettingsActiveDBImport, actionImport, msg):
		m.importPicking = true
		m.importFiles = nil
		m.importCursor = 0
		return m, loadFilesCmd(m.basePath)
	case m.isAction(scopeSettingsActiveDBImport, actionNukeAccount, msg):
		if len(m.accounts) == 0 {
			m.status = "No accounts available to nuke."
			m.statusErr = false
			return m, nil
		}
		items := make([]pickerItem, 0, len(m.accounts))
		for _, acc := range m.accounts {
			items = append(items, pickerItem{ID: acc.id, Label: acc.name, Meta: acc.acctType})
		}
		m.accountNukePicker = newPicker("Nuke Account", items, false, "")
		return m, nil
	case m.isAction(scopeSettingsActiveDBImport, actionRowsPerPage, msg) && (normalizeKeyName(msg.String()) == "+" || normalizeKeyName(msg.String()) == "="):
		if m.maxVisibleRows < 50 {
			m.maxVisibleRows++
			m.status = fmt.Sprintf("Rows per page: %d", m.maxVisibleRows)
			m.statusErr = false
			return m, saveSettingsCmd(m.currentAppSettings())
		}
		return m, nil
	case m.isAction(scopeSettingsActiveDBImport, actionRowsPerPage, msg):
		if m.maxVisibleRows > 5 {
			m.maxVisibleRows--
			m.status = fmt.Sprintf("Rows per page: %d", m.maxVisibleRows)
			m.statusErr = false
			return m, saveSettingsCmd(m.currentAppSettings())
		}
		return m, nil
	}
	return m, nil
}

func (m model) updateAccountNukePicker(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	if m.accountNukePicker == nil {
		return m, nil
	}
	res := m.accountNukePicker.HandleKey(msg.String())
	switch res.Action {
	case pickerActionCancelled:
		m.accountNukePicker = nil
		m.status = "Account nuke cancelled."
		m.statusErr = false
		return m, nil
	case pickerActionSelected:
		if m.db == nil {
			m.setError("Database not ready.")
			return m, nil
		}
		accountID := res.ItemID
		accountName := res.ItemLabel
		db := m.db
		m.accountNukePicker = nil
		return m, func() tea.Msg {
			n, err := nukeAccountWithTransactions(db, accountID)
			if err == nil {
				err = removeFormatForAccount(accountName)
			}
			return accountNukedMsg{accountName: accountName, deletedTxns: n, err: err}
		}
	}
	return m, nil
}

func (m model) updateSettingsChart(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch {
	case m.isAction(scopeSettingsActiveChart, actionToggleWeekBoundary, msg),
		m.isAction(scopeSettingsActiveChart, actionConfirm, msg):
		if m.spendingWeekAnchor == time.Monday {
			m.spendingWeekAnchor = time.Sunday
		} else {
			m.spendingWeekAnchor = time.Monday
		}
		m.status = fmt.Sprintf("Spending tracker week boundary: %s", spendingWeekAnchorLabel(m.spendingWeekAnchor))
		m.statusErr = false
		return m, saveSettingsCmd(m.currentAppSettings())
	}
	return m, nil
}

func (m model) updateSettingsConfirm(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch m.confirmAction {
	case "delete_cat":
		if m.isAction(scopeSettingsActiveCategories, actionDelete, msg) {
			if m.db == nil {
				return m, nil
			}
			db := m.db
			id := m.confirmID
			m.confirmAction = ""
			return m, func() tea.Msg {
				return categoryDeletedMsg{err: deleteCategory(db, id)}
			}
		}
	case "delete_rule":
		if m.isAction(scopeSettingsActiveRules, actionDelete, msg) {
			if m.db == nil {
				return m, nil
			}
			db := m.db
			id := m.confirmID
			m.confirmAction = ""
			return m, func() tea.Msg {
				return ruleDeletedMsg{err: deleteCategoryRule(db, id)}
			}
		}
	case "delete_tag":
		if m.isAction(scopeSettingsActiveTags, actionDelete, msg) {
			if m.db == nil {
				return m, nil
			}
			db := m.db
			id := m.confirmID
			m.confirmAction = ""
			return m, func() tea.Msg {
				return tagDeletedMsg{err: deleteTag(db, id)}
			}
		}
	case "clear_db":
		if m.isAction(scopeSettingsActiveDBImport, actionClearDB, msg) {
			if m.db == nil {
				return m, nil
			}
			db := m.db
			m.confirmAction = ""
			m.status = "Clearing database..."
			return m, func() tea.Msg {
				err := clearAllData(db)
				return clearDoneMsg{err: err}
			}
		}
	}
	// Any other key cancels the confirm
	m.confirmAction = ""
	m.confirmID = 0
	m.status = "Cancelled."
	return m, nil
}

// updateSettingsTextInput handles text input for add/edit category.
func (m model) updateSettingsTextInput(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	scope := scopeSettingsModeCat
	palette := CategoryAccentColors()
	isTagMode := m.settMode == settModeAddTag || m.settMode == settModeEditTag
	if isTagMode {
		scope = scopeSettingsModeTag
		palette = TagAccentColors()
	}

	keyName := normalizeKeyName(msg.String())
	switch {
	case m.isAction(scope, actionClose, msg):
		m.settMode = settModeNone
		m.settInput = ""
		m.settInput2 = ""
		return m, nil
	case m.isAction(scope, actionColor, msg) && (keyName == "left" || keyName == "h"):
		if len(palette) > 0 {
			m.settColorIdx = (m.settColorIdx - 1 + len(palette)) % len(palette)
		}
		return m, nil
	case m.isAction(scope, actionColor, msg):
		if len(palette) > 0 {
			m.settColorIdx = (m.settColorIdx + 1) % len(palette)
		}
		return m, nil
	case m.isAction(scope, actionSave, msg):
		if m.settInput == "" {
			m.status = "Name cannot be empty."
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
			if m.settMode == settModeAddTag {
				return m, func() tea.Msg {
					_, err := insertTag(db, name, color, nil)
					return tagSavedMsg{err: err}
				}
			}
			id := m.settEditID
			return m, func() tea.Msg {
				err := updateTag(db, id, name, color)
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
	case keyName == "backspace":
		if len(m.settInput) > 0 {
			m.settInput = m.settInput[:len(m.settInput)-1]
		}
		return m, nil
	case m.isAction(scopeGlobal, actionQuit, msg):
		return m, tea.Quit
	default:
		r := msg.String()
		if len(r) == 1 && r[0] >= 32 && r[0] < 127 {
			m.settInput += r
		}
		return m, nil
	}
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
			m.status = "Pattern cannot be empty."
			return m, nil
		}
		// Move to category picker
		m.settMode = settModeRuleCat
		return m, nil
	case normalizeKeyName(msg.String()) == "backspace":
		if len(m.settInput) > 0 {
			m.settInput = m.settInput[:len(m.settInput)-1]
		}
		return m, nil
	case m.isAction(scopeGlobal, actionQuit, msg):
		return m, tea.Quit
	default:
		r := msg.String()
		if len(r) == 1 && r[0] >= 32 && r[0] < 127 {
			m.settInput += r
		}
		return m, nil
	}
}

// updateSettingsRuleCatPicker handles category selection for a rule.
func (m model) updateSettingsRuleCatPicker(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	keyName := normalizeKeyName(msg.String())
	switch {
	case m.isAction(scopeSettingsModeRuleCat, actionClose, msg):
		m.settMode = settModeNone
		m.settInput = ""
		m.settEditID = 0
		return m, nil
	case m.isAction(scopeSettingsModeRuleCat, actionSelectItem, msg) && (keyName == "j" || keyName == "down" || keyName == "ctrl+n"):
		if m.settRuleCatIdx < len(m.categories)-1 {
			m.settRuleCatIdx++
		}
		return m, nil
	case m.isAction(scopeSettingsModeRuleCat, actionSelectItem, msg):
		if m.settRuleCatIdx > 0 {
			m.settRuleCatIdx--
		}
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
