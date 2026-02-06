package main

import (
	"database/sql"
	"fmt"
	"os"
	"time"

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

// Dashboard timeframe presets
const (
	dashTimeframeThisMonth = iota
	dashTimeframeLastMonth
	dashTimeframe1Month
	dashTimeframe2Months
	dashTimeframe3Months
	dashTimeframe6Months
	dashTimeframeYTD
	dashTimeframe1Year
	dashTimeframeCustom
	dashTimeframeCount
)

var dashTimeframeLabels = []string{
	"This Month",
	"Last Month",
	"1M",
	"2M",
	"3M",
	"6M",
	"YTD",
	"1Y",
	"Custom",
}

// Settings sections — flat index for navigation
const (
	settSecCategories = iota
	settSecRules
	settSecChart
	settSecDBImport // combined Database + Import History
	settSecCount
)

// Column mapping: left column has Categories (row 0) and Rules (row 1).
// Right column has Chart (row 0) and DB+Import (row 1).
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
	keys       *KeyRegistry
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

	// Transactions filter
	filterCategories map[int]bool // category ID -> enabled (nil = show all)
	selectedRows     map[int]bool // transaction ID -> selected
	selectionAnchor  int          // last toggled/selected transaction ID for range selection
	rangeSelecting   bool         // true when shift-range highlight is active
	rangeAnchorID    int          // anchor transaction ID for active highlight range
	rangeCursorID    int          // cursor transaction ID for active highlight range

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

	// Dashboard timeframe
	dashTimeframe       int
	dashTimeframeFocus  bool
	dashTimeframeCursor int
	dashCustomStart     string
	dashCustomEnd       string
	dashCustomInput     string
	dashCustomEditing   bool

	// Configurable display
	maxVisibleRows     int          // max rows shown in transaction table (5-50, default 20)
	spendingWeekAnchor time.Weekday // week boundary marker for spending tracker (Sunday/Monday)
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
		basePath:           cwd,
		activeTab:          tabDashboard,
		maxVisibleRows:     20,
		spendingWeekAnchor: time.Sunday,
		dashTimeframe:      dashTimeframeThisMonth,
		keys:               NewKeyRegistry(),
		formats:            formats,
		selectedRows:       make(map[int]bool),
		status:             status,
		statusErr:          statusErr,
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
	rows := m.getDashboardRows()
	w := m.listContentWidth()
	chips := renderDashboardTimeframeChips(dashTimeframeLabels, m.dashTimeframe, m.dashTimeframeCursor, m.dashTimeframeFocus)
	customInput := renderDashboardCustomInput(m.dashCustomStart, m.dashCustomEnd, m.dashCustomInput, m.dashCustomEditing)
	summary := m.renderSectionNoSeparator("Overview", renderSummaryCards(rows, m.categories, w))
	narrowSectionWidth := m.sectionWidth() * 60 / 100
	if narrowSectionWidth < 24 {
		narrowSectionWidth = 24
	}
	if narrowSectionWidth > m.sectionWidth() {
		narrowSectionWidth = m.sectionWidth()
	}
	narrowContentWidth := narrowSectionWidth - listBoxStyle.GetHorizontalFrameSize()
	if narrowContentWidth < 1 {
		narrowContentWidth = 1
	}

	breakdown := m.renderSectionSizedLeft(
		"Spending by Category",
		renderCategoryBreakdown(rows, narrowContentWidth),
		narrowSectionWidth,
		false,
	)

	rangeStart, rangeEnd := m.dashboardChartRange(time.Now())
	trend := m.renderSectionSizedLeft(
		"Spending Tracker",
		renderSpendingTrackerWithRange(rows, narrowContentWidth, m.spendingWeekAnchor, rangeStart, rangeEnd),
		narrowSectionWidth,
		false,
	)
	out := chips
	if customInput != "" {
		out += "\n" + customInput
	}
	return out + "\n" + summary + "\n" + breakdown + "\n" + trend
}

func (m model) transactionsView() string {
	filtered := m.getFilteredRows()
	total := len(m.rows)
	highlighted := m.highlightedRows(filtered)
	cursorTxnID := 0
	if m.cursor >= 0 && m.cursor < len(filtered) {
		cursorTxnID = filtered[m.cursor].id
	}

	// Build title with count info
	title := fmt.Sprintf("Transactions (%d/%d)", len(filtered), total)
	if selected := m.selectedCount(); selected > 0 {
		title = fmt.Sprintf("Transactions (%d selected)", selected)
	}

	// Search bar
	var searchBar string
	if m.searchMode {
		searchBar = searchPromptStyle.Render("/") + " " + searchInputStyle.Render(m.searchQuery+"_") + "\n"
	} else if m.searchQuery != "" {
		searchBar = searchPromptStyle.Render("/") + " " + searchInputStyle.Render(m.searchQuery) + "  " + lipgloss.NewStyle().Foreground(colorOverlay1).Render("(esc clear)") + "\n"
	}

	content := searchBar + renderTransactionTable(
		filtered,
		m.categories,
		m.selectedRows,
		highlighted,
		cursorTxnID,
		m.topIndex,
		m.visibleRows(),
		m.listContentWidth(),
		m.sortColumn,
		m.sortAscending,
	)
	return m.renderSection(title, content)
}

func (m model) settingsView() string {
	content := renderSettingsContent(m)
	if m.width == 0 {
		return content
	}
	return lipgloss.Place(m.width, lipgloss.Height(content), lipgloss.Center, lipgloss.Top, content)
}
