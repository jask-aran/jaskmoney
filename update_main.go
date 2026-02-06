package main

import (
	"fmt"
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
	m.imports = msg.imports
	m.dbInfo = msg.info
	m.ready = true
	m.pruneSelections()
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

// ---------------------------------------------------------------------------
// Key-input handlers
// ---------------------------------------------------------------------------

func (m model) updateMain(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "ctrl+c", "q":
		return m, tea.Quit
	case "tab":
		m.activeTab = (m.activeTab + 1) % tabCount
		return m, nil
	case "shift+tab":
		m.activeTab = (m.activeTab - 1 + tabCount) % tabCount
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
	return m, nil
}

// updateFilePicker handles keys in the CSV file picker overlay.
func (m model) updateFilePicker(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "esc":
		m.importPicking = false
		return m, nil
	case "ctrl+c", "q":
		return m, tea.Quit
	case "j", "down":
		if m.importCursor < len(m.importFiles)-1 {
			m.importCursor++
		}
		return m, nil
	case "k", "up":
		if m.importCursor > 0 {
			m.importCursor--
		}
		return m, nil
	case "enter":
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
	switch msg.String() {
	case "a":
		// Force import all (including dupes)
		m.importDupeModal = false
		m.status = "Importing all (including duplicates)..."
		m.statusErr = false
		return m, ingestCmd(m.db, m.importDupeFile, m.basePath, m.formats, false)
	case "s":
		// Skip duplicates
		m.importDupeModal = false
		m.status = "Importing (skipping duplicates)..."
		m.statusErr = false
		return m, ingestCmd(m.db, m.importDupeFile, m.basePath, m.formats, true)
	case "esc", "c":
		m.importDupeModal = false
		m.status = "Import cancelled."
		m.statusErr = false
		return m, nil
	case "ctrl+c", "q":
		return m, tea.Quit
	}
	return m, nil
}

func (m model) updateNavigation(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	filtered := m.getFilteredRows()
	m.ensureRangeSelectionValid(filtered)
	switch msg.String() {
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
	case "shift+up":
		m.moveCursorWithShift(-1, filtered)
		return m, nil
	case "shift+down":
		m.moveCursorWithShift(1, filtered)
		return m, nil
	case "g":
		if m.rangeSelecting {
			m.clearRangeSelection()
		}
		m.cursor = 0
		m.topIndex = 0
		return m, nil
	case "G":
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

	// These only apply on the Transactions tab
	if m.activeTab == tabTransactions {
		switch msg.String() {
		case "/":
			if m.rangeSelecting {
				m.clearRangeSelection()
			}
			m.searchMode = true
			m.searchQuery = ""
			return m, nil
		case "s":
			if m.rangeSelecting {
				m.clearRangeSelection()
			}
			m.sortColumn = (m.sortColumn + 1) % sortColumnCount
			m.cursor = 0
			m.topIndex = 0
			return m, nil
		case "S":
			if m.rangeSelecting {
				m.clearRangeSelection()
			}
			m.sortAscending = !m.sortAscending
			m.cursor = 0
			m.topIndex = 0
			return m, nil
		case "f":
			if m.rangeSelecting {
				m.clearRangeSelection()
			}
			m.cycleCategoryFilter()
			m.cursor = 0
			m.topIndex = 0
			return m, nil
		case " ", "space":
			highlighted := m.highlightedRows(filtered)
			if len(highlighted) > 0 {
				m.toggleSelectionForHighlighted(highlighted, filtered)
			} else {
				m.toggleSelectionAtCursor(filtered)
			}
			return m, nil
		case "esc":
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
		case "enter":
			if len(filtered) > 0 && m.cursor < len(filtered) {
				m.openDetail(filtered[m.cursor])
			}
			return m, nil
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

	switch msg.String() {
	case "d":
		m.dashTimeframeFocus = !m.dashTimeframeFocus
		if m.dashTimeframeFocus {
			m.dashTimeframeCursor = m.dashTimeframe
		}
		return m, nil
	}

	if !m.dashTimeframeFocus {
		return m, nil
	}

	switch msg.String() {
	case "h", "left":
		m.dashTimeframeCursor--
		if m.dashTimeframeCursor < 0 {
			m.dashTimeframeCursor = dashTimeframeCount - 1
		}
		return m, nil
	case "l", "right":
		m.dashTimeframeCursor = (m.dashTimeframeCursor + 1) % dashTimeframeCount
		return m, nil
	case "enter":
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
		return m, nil
	case "esc":
		m.dashTimeframeFocus = false
		m.status = "Timeframe selection cancelled."
		m.statusErr = false
		return m, nil
	}
	return m, nil
}

func (m model) updateDashboardCustomInput(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "esc":
		m.dashCustomEditing = false
		m.dashTimeframeFocus = false
		m.dashCustomInput = ""
		m.dashCustomStart = ""
		m.dashCustomEnd = ""
		m.status = "Custom timeframe cancelled."
		m.statusErr = false
		return m, nil
	case "backspace":
		if len(m.dashCustomInput) > 0 {
			m.dashCustomInput = m.dashCustomInput[:len(m.dashCustomInput)-1]
		}
		return m, nil
	case "enter":
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
		return m, nil
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
	switch msg.String() {
	case "esc":
		m.searchMode = false
		m.searchQuery = ""
		m.cursor = 0
		m.topIndex = 0
		return m, nil
	case "enter":
		m.searchMode = false
		// Keep the query active, just exit input mode
		return m, nil
	case "backspace":
		if len(m.searchQuery) > 0 {
			m.searchQuery = m.searchQuery[:len(m.searchQuery)-1]
			m.cursor = 0
			m.topIndex = 0
		}
		return m, nil
	case "ctrl+c":
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
	switch msg.String() {
	case "esc":
		m.showDetail = false
		return m, nil
	case "ctrl+c", "q":
		return m, tea.Quit
	case "j", "down":
		if m.detailCatCursor < len(m.categories)-1 {
			m.detailCatCursor++
		}
		return m, nil
	case "k", "up":
		if m.detailCatCursor > 0 {
			m.detailCatCursor--
		}
		return m, nil
	case "n":
		// Switch to notes editing
		m.detailEditing = "notes"
		return m, nil
	case "enter":
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
	switch msg.String() {
	case "esc", "enter":
		m.detailEditing = ""
		return m, nil
	case "backspace":
		if len(m.detailNotes) > 0 {
			m.detailNotes = m.detailNotes[:len(m.detailNotes)-1]
		}
		return m, nil
	case "ctrl+c":
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
