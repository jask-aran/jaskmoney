package main

import (
	"database/sql"
	"fmt"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/key"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

const appName = "Jaskmoney"

// Tab indices
const (
	tabDashboard    = 0
	tabTransactions = 1
	tabSettings     = 2
	tabCount        = 3
)

type transaction struct {
	id            int
	dateRaw       string
	dateISO       string
	amount        float64
	description   string
	categoryID    *int
	categoryName  string // denormalized from JOIN
	categoryColor string // denormalized from JOIN
	notes         string
}

// ---------------------------------------------------------------------------
// Key bindings
// ---------------------------------------------------------------------------

type keyMap struct {
	Quit    key.Binding
	UpDown  key.Binding
	Enter   key.Binding
	Clear   key.Binding
	Close   key.Binding
	NextTab key.Binding
	PrevTab key.Binding
	Search  key.Binding
	Sort    key.Binding
	SortRev key.Binding
	Filter  key.Binding
	DateFlt key.Binding
	Top     key.Binding
	Bottom  key.Binding
}

func newKeyMap() keyMap {
	return keyMap{
		Quit:    key.NewBinding(key.WithKeys("q", "ctrl+c"), key.WithHelp("q", "quit")),
		UpDown:  key.NewBinding(key.WithKeys("up", "down"), key.WithHelp("j/k", "navigate")),
		Enter:   key.NewBinding(key.WithKeys("enter"), key.WithHelp("enter", "select")),
		Clear:   key.NewBinding(key.WithKeys("c"), key.WithHelp("c", "clear db")),
		Close:   key.NewBinding(key.WithKeys("esc"), key.WithHelp("esc", "close")),
		NextTab: key.NewBinding(key.WithKeys("tab"), key.WithHelp("tab", "next tab")),
		PrevTab: key.NewBinding(key.WithKeys("shift+tab"), key.WithHelp("shift+tab", "prev tab")),
		Search:  key.NewBinding(key.WithKeys("/"), key.WithHelp("/", "search")),
		Sort:    key.NewBinding(key.WithKeys("s"), key.WithHelp("s", "sort")),
		SortRev: key.NewBinding(key.WithKeys("S"), key.WithHelp("S", "reverse sort")),
		Filter:  key.NewBinding(key.WithKeys("f"), key.WithHelp("f", "filter cat")),
		DateFlt: key.NewBinding(key.WithKeys("d"), key.WithHelp("d", "date range")),
		Top:     key.NewBinding(key.WithKeys("g"), key.WithHelp("g", "top")),
		Bottom:  key.NewBinding(key.WithKeys("G"), key.WithHelp("G", "bottom")),
	}
}

func (k keyMap) ShortHelp() []key.Binding {
	return []key.Binding{k.NextTab, k.PrevTab, k.UpDown, k.Quit}
}

func (k keyMap) TransactionsHelp() []key.Binding {
	return []key.Binding{k.Search, k.Sort, k.Filter, k.DateFlt, k.Enter, k.UpDown, k.NextTab, k.Quit}
}

func (k keyMap) FullHelp() [][]key.Binding {
	return [][]key.Binding{{k.NextTab, k.PrevTab, k.UpDown, k.Quit}}
}

// ---------------------------------------------------------------------------
// Bubble Tea messages
// ---------------------------------------------------------------------------

type dbReadyMsg struct {
	db  *sql.DB
	err error
}

type ingestDoneMsg struct {
	count int
	dupes int
	err   error
	file  string
}

type refreshDoneMsg struct {
	rows       []transaction
	categories []category
	rules      []categoryRule
	imports    []importRecord
	info       dbInfo
	err        error
}

type filesLoadedMsg struct {
	files []string
	err   error
}

type dupeScanMsg struct {
	total int
	dupes int
	file  string
	err   error
}

type clearDoneMsg struct {
	err error
}

type txnSavedMsg struct {
	err error
}

type categorySavedMsg struct {
	err error
}

type categoryDeletedMsg struct {
	err error
}

type ruleSavedMsg struct {
	err error
}

type ruleDeletedMsg struct {
	err error
}

type rulesAppliedMsg struct {
	count int
	err   error
}

type confirmExpiredMsg struct{}

// Sort columns
const (
	sortByDate = iota
	sortByAmount
	sortByCategory
	sortByDescription
	sortColumnCount
)

// Date range presets
const (
	dateRangeAll = iota
	dateRangeThisMonth
	dateRangeLastMonth
	dateRange3Months
	dateRange6Months
)

// Settings sections — flat index for navigation
const (
	settSecCategories = iota
	settSecRules
	settSecDBImport // combined Database + Import History
	settSecCount
)

// Column mapping: left column has Categories (row 0) and Rules (row 1).
// Right column has DB+Import (row 0 only).
const (
	settColLeft  = 0
	settColRight = 1
)

// Settings editing modes
const (
	settModeNone     = "" // browsing
	settModeAddCat   = "add_cat"
	settModeEditCat  = "edit_cat"
	settModeAddRule  = "add_rule"
	settModeEditRule = "edit_rule"
	settModeRuleCat  = "rule_cat" // picking category for a rule
)

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

type model struct {
	db         *sql.DB
	status     string
	statusErr  bool // true if status is an error (render in Red)
	ready      bool
	basePath   string
	activeTab  int
	keys       keyMap
	rows       []transaction
	categories []category
	formats    []csvFormat
	cursor     int
	topIndex   int
	width      int
	height     int

	// Import flow (file picker + dupe modal)
	importPicking   bool     // showing file picker
	importFiles     []string // CSV files in basePath
	importCursor    int      // cursor in file picker
	importDupeModal bool     // showing duplicate decision modal
	importDupeFile  string   // file being imported
	importDupeTotal int      // total rows in file
	importDupeCount int      // duplicate count

	// Search
	searchMode  bool
	searchQuery string

	// Sort
	sortColumn    int
	sortAscending bool

	// Filter
	filterCategories map[int]bool // category ID -> enabled (nil = show all)
	filterDateRange  int

	// Transaction detail modal
	showDetail      bool
	detailIdx       int // transaction ID being edited
	detailCatCursor int // cursor in category picker
	detailNotes     string
	detailEditing   string // "category" or "notes" or ""

	// Settings state
	rules          []categoryRule
	imports        []importRecord
	dbInfo         dbInfo
	settSection    int    // which section is focused (settSec*)
	settColumn     int    // 0 = left column, 1 = right column
	settActive     bool   // true = interacting inside a section, false = navigating sections
	settItemCursor int    // cursor within the active section's item list
	settMode       string // current editing mode (settMode*)
	settInput      string // text input buffer for add/edit
	settInput2     string // secondary input (e.g. color for category)
	settColorIdx   int    // index into CategoryAccentColors() during add/edit
	settRuleCatIdx int    // category cursor when picking for a rule
	settEditID     int    // ID of item being edited
	confirmAction  string // pending confirm action ("clear_db", "delete_cat", "delete_rule")
	confirmID      int    // ID for pending confirm (category or rule)

	// Configurable display
	maxVisibleRows int // max rows shown in transaction table (5-50, default 20)
}

func newModel() model {
	cwd, cwdErr := os.Getwd()
	if cwdErr != nil || cwd == "" {
		cwd = "."
	}
	formats, fmtErr := loadFormats()
	status := ""
	statusErr := false
	if fmtErr != nil {
		status = fmt.Sprintf("Format config error: %v", fmtErr)
		statusErr = true
	}
	return model{
		basePath:       cwd,
		activeTab:      tabDashboard,
		maxVisibleRows: 20,
		keys:           newKeyMap(),
		formats:        formats,
		status:         status,
		statusErr:      statusErr,
	}
}

// ---------------------------------------------------------------------------
// Bubble Tea interface: Init / Update / View
// ---------------------------------------------------------------------------

func (m model) Init() tea.Cmd {
	return func() tea.Msg {
		db, err := openDB("transactions.db")
		return dbReadyMsg{db: db, err: err}
	}
}

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

func (m model) View() string {
	status := statusStyle.Render(m.status)

	if !m.ready {
		return status
	}

	header := renderHeader(appName, m.activeTab, m.width)
	statusLine := m.renderStatus(m.status, m.statusErr)
	footer := m.renderFooter(m.footerBindings())

	var body string
	switch m.activeTab {
	case tabDashboard:
		body = m.dashboardView()
	case tabTransactions:
		body = m.transactionsView()
	case tabSettings:
		body = m.settingsView()
	default:
		body = m.dashboardView()
	}

	main := header + "\n\n" + body

	if m.showDetail {
		txn := m.findDetailTxn()
		if txn != nil {
			detail := renderDetail(*txn, m.categories, m.detailCatCursor, m.detailNotes, m.detailEditing)
			return m.composeOverlay(main, statusLine, footer, detail)
		}
	}
	if m.importPicking {
		picker := renderFilePicker(m.importFiles, m.importCursor)
		return m.composeOverlay(main, statusLine, footer, picker)
	}
	if m.importDupeModal {
		dupeModal := renderDupeModal(m.importDupeFile, m.importDupeTotal, m.importDupeCount)
		return m.composeOverlay(main, statusLine, footer, dupeModal)
	}
	return m.placeWithFooter(main, statusLine, footer)
}

// ---------------------------------------------------------------------------
// Per-tab views
// ---------------------------------------------------------------------------

func (m model) dashboardView() string {
	w := m.listContentWidth()
	summary := m.renderSection("Overview", renderSummaryCards(m.rows, m.categories, w))
	breakdown := m.renderSection("Spending by Category", renderCategoryBreakdown(m.rows, w))
	trend := m.renderSection("Cumulative Balance", renderMonthlyTrend(m.rows, w))
	return summary + "\n" + breakdown + "\n" + trend
}

func (m model) transactionsView() string {
	filtered := m.getFilteredRows()
	total := len(m.rows)

	// Build title with filter info
	title := fmt.Sprintf("Transactions (%d/%d)", len(filtered), total)
	if m.filterDateRange != dateRangeAll {
		title += " — " + dateRangeName(m.filterDateRange)
	}

	// Search bar
	var searchBar string
	if m.searchMode {
		searchBar = searchPromptStyle.Render("/") + " " + searchInputStyle.Render(m.searchQuery+"_") + "\n"
	} else if m.searchQuery != "" {
		searchBar = searchPromptStyle.Render("/") + " " + searchInputStyle.Render(m.searchQuery) + "  " + lipgloss.NewStyle().Foreground(colorOverlay1).Render("(esc clear)") + "\n"
	}

	content := searchBar + renderTransactionTable(filtered, m.categories, m.cursor, m.topIndex, m.visibleRows(), m.listContentWidth(), m.sortColumn, m.sortAscending)
	return m.renderSection(title, content)
}

func (m model) settingsView() string {
	content := renderSettingsContent(m)
	if m.width == 0 {
		return content
	}
	return lipgloss.Place(m.width, lipgloss.Height(content), lipgloss.Center, lipgloss.Top, content)
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
	switch msg.String() {
	case "up", "k", "ctrl+p":
		if m.cursor > 0 {
			m.cursor--
			if m.cursor < m.topIndex {
				m.topIndex = m.cursor
			}
		}
		return m, nil
	case "down", "j", "ctrl+n":
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
		m.cursor = 0
		m.topIndex = 0
		return m, nil
	case "G":
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
			m.searchMode = true
			m.searchQuery = ""
			return m, nil
		case "s":
			m.sortColumn = (m.sortColumn + 1) % sortColumnCount
			m.cursor = 0
			m.topIndex = 0
			return m, nil
		case "S":
			m.sortAscending = !m.sortAscending
			m.cursor = 0
			m.topIndex = 0
			return m, nil
		case "f":
			m.cycleCategoryFilter()
			m.cursor = 0
			m.topIndex = 0
			return m, nil
		case "d":
			m.filterDateRange = (m.filterDateRange + 1) % 5 // cycle through date presets
			m.cursor = 0
			m.topIndex = 0
			m.status = "Date filter: " + dateRangeName(m.filterDateRange)
			m.statusErr = false
			return m, nil
		case "esc":
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

func dateRangeName(r int) string {
	switch r {
	case dateRangeAll:
		return "all time"
	case dateRangeThisMonth:
		return "this month"
	case dateRangeLastMonth:
		return "last month"
	case dateRange3Months:
		return "last 3 months"
	case dateRange6Months:
		return "last 6 months"
	}
	return "all time"
}

// getFilteredRows returns the current filtered/sorted view of transactions.
func (m model) getFilteredRows() []transaction {
	return filteredRows(m.rows, m.searchQuery, m.filterCategories, m.filterDateRange, m.sortColumn, m.sortAscending)
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
		return settSecDBImport
	}
	// Left column: row 0 = Categories, row 1 = Rules
	if row == 0 {
		return settSecCategories
	}
	return settSecRules
}

// settColumnRow returns (column, row) for a given settSection.
func settColumnRow(sec int) (int, int) {
	switch sec {
	case settSecCategories:
		return settColLeft, 0
	case settSecRules:
		return settColLeft, 1
	case settSecDBImport:
		return settColRight, 0
	}
	return settColLeft, 0
}

func (m model) updateSettings(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	// Text input modes (always handled first)
	if m.settMode == settModeAddCat || m.settMode == settModeEditCat {
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
	switch msg.String() {
	case "ctrl+c", "q":
		return m, tea.Quit
	case "tab":
		m.activeTab = (m.activeTab + 1) % tabCount
		return m, nil
	case "shift+tab":
		m.activeTab = (m.activeTab - 1 + tabCount) % tabCount
		return m, nil
	case "h", "left":
		if m.settColumn == settColRight {
			m.settColumn = settColLeft
			// Default to first row in left column
			m.settSection = settSecCategories
		}
		return m, nil
	case "l", "right":
		if m.settColumn == settColLeft {
			m.settColumn = settColRight
			m.settSection = settSecDBImport
		}
		return m, nil
	case "j", "down":
		if m.settColumn == settColLeft {
			col, row := settColumnRow(m.settSection)
			row++
			if row > 1 {
				row = 0
			}
			m.settSection = settSectionForColumn(col, row)
		}
		// Right column has only one section, j does nothing
		return m, nil
	case "k", "up":
		if m.settColumn == settColLeft {
			col, row := settColumnRow(m.settSection)
			row--
			if row < 0 {
				row = 1
			}
			m.settSection = settSectionForColumn(col, row)
		}
		return m, nil
	case "enter":
		m.settActive = true
		m.settItemCursor = 0
		return m, nil
	case "i":
		m.importPicking = true
		m.importFiles = nil
		m.importCursor = 0
		return m, loadFilesCmd(m.basePath)
	}
	return m, nil
}

// updateSettingsActive handles keys when a section is activated (enter was pressed).
func (m model) updateSettingsActive(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "esc":
		m.settActive = false
		return m, nil
	case "ctrl+c", "q":
		return m, tea.Quit
	}

	switch m.settSection {
	case settSecCategories:
		return m.updateSettingsCategories(msg)
	case settSecRules:
		return m.updateSettingsRules(msg)
	case settSecDBImport:
		return m.updateSettingsDBImport(msg)
	}
	return m, nil
}

func (m model) updateSettingsCategories(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "j", "down":
		if m.settItemCursor < len(m.categories)-1 {
			m.settItemCursor++
		}
		return m, nil
	case "k", "up":
		if m.settItemCursor > 0 {
			m.settItemCursor--
		}
		return m, nil
	case "a":
		m.settMode = settModeAddCat
		m.settInput = ""
		m.settColorIdx = 0
		return m, nil
	case "e":
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
	case "d":
		if m.settItemCursor < len(m.categories) {
			cat := m.categories[m.settItemCursor]
			if cat.isDefault {
				m.status = "Cannot delete the default category."
				return m, nil
			}
			m.confirmAction = "delete_cat"
			m.confirmID = cat.id
			m.status = fmt.Sprintf("Press d again to delete %q", cat.name)
			return m, confirmTimerCmd()
		}
		return m, nil
	}
	return m, nil
}

func (m model) updateSettingsRules(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "j", "down":
		if m.settItemCursor < len(m.rules)-1 {
			m.settItemCursor++
		}
		return m, nil
	case "k", "up":
		if m.settItemCursor > 0 {
			m.settItemCursor--
		}
		return m, nil
	case "a":
		m.settMode = settModeAddRule
		m.settInput = ""
		m.settRuleCatIdx = 0
		m.settEditID = 0
		return m, nil
	case "e":
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
	case "d":
		if m.settItemCursor < len(m.rules) {
			rule := m.rules[m.settItemCursor]
			m.confirmAction = "delete_rule"
			m.confirmID = rule.id
			m.status = fmt.Sprintf("Press d again to delete rule %q", rule.pattern)
			return m, confirmTimerCmd()
		}
		return m, nil
	case "A":
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
	switch msg.String() {
	case "c":
		m.confirmAction = "clear_db"
		m.status = "Press c again to clear all data"
		return m, confirmTimerCmd()
	case "i":
		m.importPicking = true
		m.importFiles = nil
		m.importCursor = 0
		return m, loadFilesCmd(m.basePath)
	case "+", "=":
		if m.maxVisibleRows < 50 {
			m.maxVisibleRows++
			m.status = fmt.Sprintf("Rows per page: %d", m.maxVisibleRows)
		}
		return m, nil
	case "-":
		if m.maxVisibleRows > 5 {
			m.maxVisibleRows--
			m.status = fmt.Sprintf("Rows per page: %d", m.maxVisibleRows)
		}
		return m, nil
	}
	return m, nil
}

func (m model) updateSettingsConfirm(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	key := msg.String()
	switch m.confirmAction {
	case "delete_cat":
		if key == "d" {
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
		if key == "d" {
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
	case "clear_db":
		if key == "c" {
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
	switch msg.String() {
	case "esc":
		m.settMode = settModeNone
		m.settInput = ""
		m.settInput2 = ""
		return m, nil
	case "left", "h":
		colors := CategoryAccentColors()
		if len(colors) > 0 {
			m.settColorIdx = (m.settColorIdx - 1 + len(colors)) % len(colors)
		}
		return m, nil
	case "right", "l":
		colors := CategoryAccentColors()
		if len(colors) > 0 {
			m.settColorIdx = (m.settColorIdx + 1) % len(colors)
		}
		return m, nil
	case "enter":
		if m.settInput == "" {
			m.status = "Name cannot be empty."
			return m, nil
		}
		if m.db == nil {
			return m, nil
		}
		colors := CategoryAccentColors()
		color := string(colors[m.settColorIdx])
		name := m.settInput
		db := m.db
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
	case "backspace":
		if len(m.settInput) > 0 {
			m.settInput = m.settInput[:len(m.settInput)-1]
		}
		return m, nil
	case "ctrl+c":
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
	switch msg.String() {
	case "esc":
		m.settMode = settModeNone
		m.settInput = ""
		m.settEditID = 0
		return m, nil
	case "enter":
		if m.settInput == "" {
			m.status = "Pattern cannot be empty."
			return m, nil
		}
		// Move to category picker
		m.settMode = settModeRuleCat
		return m, nil
	case "backspace":
		if len(m.settInput) > 0 {
			m.settInput = m.settInput[:len(m.settInput)-1]
		}
		return m, nil
	case "ctrl+c":
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
	switch msg.String() {
	case "esc":
		m.settMode = settModeNone
		m.settInput = ""
		m.settEditID = 0
		return m, nil
	case "j", "down":
		if m.settRuleCatIdx < len(m.categories)-1 {
			m.settRuleCatIdx++
		}
		return m, nil
	case "k", "up":
		if m.settRuleCatIdx > 0 {
			m.settRuleCatIdx--
		}
		return m, nil
	case "enter":
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
	case "ctrl+c":
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

// ---------------------------------------------------------------------------
// Settings footer bindings
// ---------------------------------------------------------------------------

func (m model) settingsFooterBindings() []key.Binding {
	if m.settMode != settModeNone {
		switch m.settMode {
		case settModeAddCat, settModeEditCat:
			return []key.Binding{
				key.NewBinding(key.WithHelp("h/l", "color")),
				key.NewBinding(key.WithHelp("enter", "save")),
				key.NewBinding(key.WithHelp("esc", "cancel")),
			}
		case settModeAddRule, settModeEditRule:
			return []key.Binding{
				key.NewBinding(key.WithHelp("enter", "next")),
				key.NewBinding(key.WithHelp("esc", "cancel")),
			}
		case settModeRuleCat:
			return []key.Binding{
				key.NewBinding(key.WithHelp("j/k", "select")),
				key.NewBinding(key.WithHelp("enter", "save")),
				key.NewBinding(key.WithHelp("esc", "cancel")),
			}
		}
	}
	if m.confirmAction != "" {
		return []key.Binding{
			key.NewBinding(key.WithHelp("repeat", "confirm")),
			key.NewBinding(key.WithHelp("any", "cancel")),
		}
	}
	if m.settActive {
		base := []key.Binding{
			key.NewBinding(key.WithHelp("j/k", "navigate")),
			key.NewBinding(key.WithHelp("esc", "back")),
		}
		switch m.settSection {
		case settSecCategories:
			return append(base,
				key.NewBinding(key.WithHelp("a", "add")),
				key.NewBinding(key.WithHelp("e", "edit")),
				key.NewBinding(key.WithHelp("d", "delete")),
			)
		case settSecRules:
			return append(base,
				key.NewBinding(key.WithHelp("a", "add")),
				key.NewBinding(key.WithHelp("e", "edit")),
				key.NewBinding(key.WithHelp("d", "delete")),
				key.NewBinding(key.WithHelp("A", "apply all")),
			)
		case settSecDBImport:
			return append(base,
				key.NewBinding(key.WithHelp("+/-", "rows/page")),
				key.NewBinding(key.WithHelp("c", "clear db")),
				key.NewBinding(key.WithHelp("i", "import")),
			)
		}
	}
	return []key.Binding{
		key.NewBinding(key.WithHelp("h/l", "column")),
		key.NewBinding(key.WithHelp("j/k", "section")),
		key.NewBinding(key.WithHelp("enter", "activate")),
		key.NewBinding(key.WithHelp("i", "import")),
		key.NewBinding(key.WithHelp("tab", "next tab")),
		key.NewBinding(key.WithHelp("q", "quit")),
	}
}

// ---------------------------------------------------------------------------
// Filtering, sorting, searching
// ---------------------------------------------------------------------------

// filteredRows returns the subset of m.rows matching all active filters,
// sorted by the current sort column/direction.
func filteredRows(rows []transaction, searchQuery string, filterCats map[int]bool, dateRange int, sortCol int, sortAsc bool) []transaction {
	var out []transaction
	for _, r := range rows {
		if !matchesSearch(r, searchQuery) {
			continue
		}
		if !matchesCategoryFilter(r, filterCats) {
			continue
		}
		if !matchesDateRange(r, dateRange) {
			continue
		}
		out = append(out, r)
	}
	sortTransactions(out, sortCol, sortAsc)
	return out
}

func matchesSearch(t transaction, query string) bool {
	if query == "" {
		return true
	}
	q := strings.ToLower(query)
	return strings.Contains(strings.ToLower(t.description), q) ||
		strings.Contains(strings.ToLower(t.categoryName), q) ||
		strings.Contains(t.dateISO, q) ||
		strings.Contains(t.dateRaw, q)
}

func matchesCategoryFilter(t transaction, filterCats map[int]bool) bool {
	if len(filterCats) == 0 {
		return true // no filter = show all
	}
	if t.categoryID == nil {
		// Uncategorised: check if 0 (sentinel) is in the filter
		return filterCats[0]
	}
	return filterCats[*t.categoryID]
}

func matchesDateRange(t transaction, dateRange int) bool {
	if dateRange == dateRangeAll {
		return true
	}
	now := time.Now()
	var start time.Time
	switch dateRange {
	case dateRangeThisMonth:
		start = time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.Local)
	case dateRangeLastMonth:
		prev := now.AddDate(0, -1, 0)
		start = time.Date(prev.Year(), prev.Month(), 1, 0, 0, 0, 0, time.Local)
	case dateRange3Months:
		start = now.AddDate(0, -3, 0)
	case dateRange6Months:
		start = now.AddDate(0, -6, 0)
	default:
		return true
	}
	parsed, err := time.Parse("2006-01-02", t.dateISO)
	if err != nil {
		return true // can't parse = include
	}
	if dateRange == dateRangeLastMonth {
		end := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.Local)
		return !parsed.Before(start) && parsed.Before(end)
	}
	return !parsed.Before(start)
}

func sortTransactions(rows []transaction, col int, asc bool) {
	sort.SliceStable(rows, func(i, j int) bool {
		var less bool
		switch col {
		case sortByDate:
			less = rows[i].dateISO < rows[j].dateISO
		case sortByAmount:
			less = rows[i].amount < rows[j].amount
		case sortByCategory:
			less = strings.ToLower(rows[i].categoryName) < strings.ToLower(rows[j].categoryName)
		case sortByDescription:
			less = strings.ToLower(rows[i].description) < strings.ToLower(rows[j].description)
		default:
			less = rows[i].dateISO < rows[j].dateISO
		}
		if asc {
			return less
		}
		return !less
	})
}

func sortColumnName(col int) string {
	switch col {
	case sortByDate:
		return "date"
	case sortByAmount:
		return "amount"
	case sortByCategory:
		return "category"
	case sortByDescription:
		return "description"
	}
	return "date"
}

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

func (m model) footerBindings() []key.Binding {
	if m.showDetail {
		return []key.Binding{m.keys.Enter, m.keys.Close, m.keys.UpDown, m.keys.Quit}
	}
	if m.importPicking {
		return []key.Binding{m.keys.Enter, m.keys.Close, m.keys.UpDown, m.keys.Quit}
	}
	if m.importDupeModal {
		return []key.Binding{
			key.NewBinding(key.WithHelp("a", "import all")),
			key.NewBinding(key.WithHelp("s", "skip dupes")),
			key.NewBinding(key.WithHelp("esc", "cancel")),
		}
	}
	if m.searchMode {
		return []key.Binding{
			key.NewBinding(key.WithHelp("esc", "clear search")),
			key.NewBinding(key.WithHelp("enter", "confirm")),
		}
	}
	if m.activeTab == tabTransactions {
		return m.keys.TransactionsHelp()
	}
	if m.activeTab == tabSettings {
		return m.settingsFooterBindings()
	}
	return m.keys.ShortHelp()
}

func (m *model) visibleRows() int {
	maxRows := m.maxVisibleRows
	if maxRows <= 0 {
		maxRows = 20
	}
	if m.height == 0 {
		return min(10, maxRows)
	}
	frameV := listBoxStyle.GetVerticalFrameSize()
	headerHeight := 1
	headerGap := 1
	sectionHeaderHeight := sectionHeaderLineCount()
	tableHeaderHeight := 1
	scrollIndicator := 1
	available := m.height - 2 - headerHeight - headerGap - frameV - sectionHeaderHeight - tableHeaderHeight - scrollIndicator
	if available < 3 {
		available = 3
	}
	if available > maxRows {
		available = maxRows
	}
	return available
}

func (m *model) listContentWidth() int {
	if m.width == 0 {
		return 80
	}
	contentWidth := m.sectionContentWidth()
	if contentWidth < 20 {
		return 20
	}
	return contentWidth
}

func (m *model) sectionContentWidth() int {
	if m.width == 0 {
		return 80
	}
	frameH := listBoxStyle.GetHorizontalFrameSize()
	contentWidth := m.sectionWidth() - frameH
	if contentWidth < 1 {
		contentWidth = 1
	}
	return contentWidth
}

func (m *model) sectionWidth() int {
	if m.width == 0 {
		return 80
	}
	width := m.width - 4
	if width < 20 {
		width = m.width
	}
	return width
}

func (m *model) ensureCursorInWindow() {
	visible := m.visibleRows()
	if visible <= 0 {
		return
	}
	filtered := m.getFilteredRows()
	total := len(filtered)
	if m.cursor >= total {
		m.cursor = total - 1
	}
	if m.cursor < 0 {
		m.cursor = 0
	}
	if m.cursor < m.topIndex {
		m.topIndex = m.cursor
	} else if m.cursor >= m.topIndex+visible {
		m.topIndex = m.cursor - visible + 1
	}
	maxTop := total - visible
	if maxTop < 0 {
		maxTop = 0
	}
	if m.topIndex > maxTop {
		m.topIndex = maxTop
	}
	if m.topIndex < 0 {
		m.topIndex = 0
	}
}

func sectionHeaderLineCount() int {
	return 2
}
