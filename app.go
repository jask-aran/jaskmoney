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
	tabManager   = 0
	tabDashboard = 1
	tabSettings  = 2
	// Legacy transactions tab constant retained for internal/tests-only flows.
	tabTransactions = 99
	tabCount        = 3
)

const (
	managerModeTransactions = iota
	managerModeAccounts
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
	accountID     *int
	accountName   string
	accountType   string
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
	rows             []transaction
	categories       []category
	rules            []categoryRule
	tags             []tag
	tagRules         []tagRule
	txnTags          map[int][]tag
	imports          []importRecord
	accounts         []account
	selectedAccounts map[int]bool
	info             dbInfo
	err              error
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

type tagSavedMsg struct {
	err error
}

type tagDeletedMsg struct {
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

type settingsSavedMsg struct {
	err error
}

type quickCategoryAppliedMsg struct {
	count        int
	categoryName string
	created      bool
	err          error
}

type quickTagsAppliedMsg struct {
	count int
	err   error
}

type accountNukedMsg struct {
	accountName string
	deletedTxns int
	err         error
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
	settSecTags
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
	settModeAddTag   = "add_tag"
	settModeEditTag  = "edit_tag"
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
	accounts   []account
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
	filterAccounts   map[int]bool // account ID -> enabled (nil = show all)
	selectedRows     map[int]bool // transaction ID -> selected
	selectionAnchor  int          // last toggled/selected transaction ID for range selection
	rangeSelecting   bool         // true when shift-range highlight is active
	rangeAnchorID    int          // anchor transaction ID for active highlight range
	rangeCursorID    int          // cursor transaction ID for active highlight range

	// Transaction detail modal
	showDetail        bool
	detailIdx         int // transaction ID being edited
	detailCatCursor   int // cursor in category picker
	detailNotes       string
	detailEditing     string // "category" or "notes" or ""
	catPicker         *pickerState
	catPickerFor      []int
	tagPicker         *pickerState
	tagPickerFor      []int
	accountNukePicker *pickerState

	// Settings state
	rules          []categoryRule
	tags           []tag
	tagRules       []tagRule
	txnTags        map[int][]tag
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

	// Manager state
	managerCursor     int
	managerSelectedID int
	managerMode       int
	managerModalOpen  bool
	managerModalIsNew bool
	managerEditID     int
	managerEditName   string
	managerEditType   string
	managerEditPrefix string
	managerEditActive bool
	managerEditFocus  int // 0=name,1=type,2=prefix,3=active

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
	formats, appCfg, fmtErr := loadAppConfig()
	status := ""
	statusErr := false
	if fmtErr != nil {
		status = fmt.Sprintf("Format config error: %v", fmtErr)
		statusErr = true
	}
	keys := NewKeyRegistry()
	if fmtErr == nil {
		keybindings, keyLoadErr := loadKeybindingsConfig()
		if keyLoadErr != nil {
			status = fmt.Sprintf("Shortcut config error: %v", keyLoadErr)
			statusErr = true
		}
		if keyErr := keys.ApplyKeybindingConfig(keybindings); keyErr != nil {
			status = fmt.Sprintf("Shortcut config error: %v", keyErr)
			statusErr = true
		}
	}
	weekAnchor := time.Sunday
	if appCfg.SpendingWeekFrom == "monday" {
		weekAnchor = time.Monday
	}
	return model{
		basePath:           cwd,
		activeTab:          tabManager,
		managerMode:        managerModeTransactions,
		maxVisibleRows:     appCfg.RowsPerPage,
		spendingWeekAnchor: weekAnchor,
		dashTimeframe:      appCfg.DashTimeframe,
		dashCustomStart:    appCfg.DashCustomStart,
		dashCustomEnd:      appCfg.DashCustomEnd,
		keys:               keys,
		formats:            formats,
		selectedRows:       make(map[int]bool),
		txnTags:            make(map[int][]tag),
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

	header := renderHeader(appName, m.activeTab, m.width, m.accountFilterLabel())
	statusLine := m.renderStatus(m.status, m.statusErr)
	footer := m.renderFooter(m.footerBindings())

	var body string
	switch m.activeTab {
	case tabManager:
		body = m.managerView()
	case tabDashboard:
		body = m.dashboardView()
	case tabSettings:
		body = m.settingsView()
	default:
		body = m.dashboardView()
	}

	main := header + "\n\n" + body

	if m.showDetail {
		txn := m.findDetailTxn()
		if txn != nil {
			detail := renderDetail(*txn, m.categories, m.txnTags[txn.id], m.detailCatCursor, m.detailNotes, m.detailEditing)
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
	if m.catPicker != nil {
		picker := renderPicker(m.catPicker, min(56, m.width-10))
		return m.composeOverlay(main, statusLine, footer, picker)
	}
	if m.tagPicker != nil {
		picker := renderPicker(m.tagPicker, min(56, m.width-10))
		return m.composeOverlay(main, statusLine, footer, picker)
	}
	if m.accountNukePicker != nil {
		picker := renderPicker(m.accountNukePicker, min(56, m.width-10))
		return m.composeOverlay(main, statusLine, footer, picker)
	}
	if m.managerModalOpen {
		modal := renderManagerAccountModal(m)
		return m.composeOverlay(main, statusLine, footer, modal)
	}
	return m.placeWithFooter(main, statusLine, footer)
}

// ---------------------------------------------------------------------------
// Per-tab views
// ---------------------------------------------------------------------------

func (m model) dashboardView() string {
	rows := m.getDashboardRows()
	w := m.listContentWidth()
	chips := renderDashboardControlsLine(
		renderDashboardTimeframeChips(dashTimeframeLabels, m.dashTimeframe, m.dashTimeframeCursor, m.dashTimeframeFocus),
		dashboardDateRange(rows),
		m.sectionWidth(),
	)
	customInput := renderDashboardCustomInput(m.dashCustomStart, m.dashCustomEnd, m.dashCustomInput, m.dashCustomEditing)
	summary := m.renderSectionSizedLeft("Overview", renderSummaryCards(rows, m.categories, w), m.sectionWidth(), false)
	spendRows := dashboardSpendRows(rows, m.txnTags)
	totalWidth := m.sectionWidth()
	gap := 2
	trackerWidth := (totalWidth - gap) * 60 / 100
	breakdownWidth := totalWidth - gap - trackerWidth
	if trackerWidth < 24 {
		trackerWidth = 24
	}
	if breakdownWidth < 24 {
		breakdownWidth = 24
	}
	if trackerWidth+gap+breakdownWidth > totalWidth {
		overflow := trackerWidth + gap + breakdownWidth - totalWidth
		if breakdownWidth-overflow >= 24 {
			breakdownWidth -= overflow
		} else {
			trackerWidth = max(24, trackerWidth-overflow)
		}
	}

	trackerContentWidth := trackerWidth - listBoxStyle.GetHorizontalFrameSize()
	if trackerContentWidth < 1 {
		trackerContentWidth = 1
	}
	breakdownContentWidth := breakdownWidth - listBoxStyle.GetHorizontalFrameSize()
	if breakdownContentWidth < 1 {
		breakdownContentWidth = 1
	}

	rangeStart, rangeEnd := m.dashboardChartRange(time.Now())
	trend := renderTitledSectionBox(
		"Spending Tracker",
		renderSpendingTrackerWithRange(spendRows, trackerContentWidth, m.spendingWeekAnchor, rangeStart, rangeEnd),
		trackerWidth,
		false,
	)
	breakdown := renderTitledSectionBox(
		"Spending by Category",
		renderCategoryBreakdown(spendRows, m.categories, breakdownContentWidth),
		breakdownWidth,
		false,
	)
	chartsRow := lipgloss.JoinHorizontal(lipgloss.Top, trend, strings.Repeat(" ", gap), breakdown)
	out := chips
	if customInput != "" {
		out += "\n" + customInput
	}
	return out + "\n" + summary + "\n" + chartsRow
}

func (m model) managerView() string {
	accountsFocused := m.managerMode == managerModeAccounts
	accountsContent := renderManagerAccountStrip(m, accountsFocused, m.managerSectionContentWidth())
	accountsCard := renderManagerSectionBox("Accounts", accountsFocused, accountsFocused, m.sectionWidth(), accountsContent)
	rows := m.getFilteredRows()
	txVisibleRows := m.managerVisibleRows()
	var txContent string
	if m.managerMode == managerModeTransactions {
		highlighted := m.highlightedRows(rows)
		cursorTxnID := 0
		if m.cursor >= 0 && m.cursor < len(rows) {
			cursorTxnID = rows[m.cursor].id
		}
		searchBar := ""
		if m.searchMode {
			searchBar = searchPromptStyle.Render("/") + " " + searchInputStyle.Render(m.searchQuery+"_") + "\n"
		} else if m.searchQuery != "" {
			searchBar = searchPromptStyle.Render("/") + " " + searchInputStyle.Render(m.searchQuery) + "  " + lipgloss.NewStyle().Foreground(colorOverlay1).Render("(esc clear)") + "\n"
		}
		txContent = searchBar + renderTransactionTable(
			rows,
			m.categories,
			m.txnTags,
			m.selectedRows,
			highlighted,
			cursorTxnID,
			m.topIndex,
			txVisibleRows,
			m.managerSectionContentWidth(),
			m.sortColumn,
			m.sortAscending,
		)
	} else {
		txContent = renderTransactionTable(
			rows,
			m.categories,
			m.txnTags,
			nil,
			nil,
			0,
			0,
			txVisibleRows,
			m.managerSectionContentWidth(),
			sortByDate,
			false,
		)
	}
	transactionsCard := renderManagerSectionBox("Transactions", !accountsFocused, !accountsFocused, m.sectionWidth(), txContent)
	return accountsCard + "\n" + transactionsCard
}

func (m model) managerFocusedIndex() int {
	if len(m.accounts) == 0 {
		return -1
	}
	if m.managerSelectedID != 0 {
		for i, acc := range m.accounts {
			if acc.id == m.managerSelectedID {
				return i
			}
		}
	}
	idx := m.managerCursor
	if idx < 0 {
		idx = 0
	}
	if idx >= len(m.accounts) {
		idx = len(m.accounts) - 1
	}
	return idx
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
		m.txnTags,
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

func (m model) placeWithFooter(body, statusLine, footer string) string {
	if m.height == 0 {
		return body + "\n\n" + statusLine + "\n" + footer
	}
	contentHeight := m.height - 2
	if contentHeight < 1 {
		contentHeight = 1
	}
	if lipgloss.Height(body) >= contentHeight {
		return body + "\n" + statusLine + "\n" + footer
	}
	main := lipgloss.Place(m.width, contentHeight, lipgloss.Left, lipgloss.Top, body)
	// Ensure every line is full-width to prevent ghosting from previous frames
	lines := splitLines(main)
	for i, line := range lines {
		lines[i] = padRight(line, m.width)
	}
	main = strings.Join(lines, "\n")
	return main + "\n" + statusLine + "\n" + footer
}

func (m model) composeOverlay(base, statusLine, footer, content string) string {
	baseView := m.placeWithFooter(base, statusLine, footer)
	if m.height == 0 || m.width == 0 {
		return baseView + "\n\n" + content
	}
	modalContent := lipgloss.NewStyle().Width(min(60, m.width-10)).Render(content)
	modal := modalStyle.Render(modalContent)
	lines := splitLines(modal)
	modalWidth := maxLineWidth(lines)
	modalHeight := len(lines)

	targetHeight := m.height - 2
	if targetHeight < 1 {
		targetHeight = 1
	}
	x := (m.width - modalWidth) / 2
	if x < 0 {
		x = 0
	}
	y := (targetHeight - modalHeight) / 2
	if y < 0 {
		y = 0
	}
	return overlayAt(baseView, modal, x, y, m.width, targetHeight)
}

// ---------------------------------------------------------------------------
// Settings footer bindings
// ---------------------------------------------------------------------------

func (m model) settingsFooterBindings() []key.Binding {
	if m.settMode != settModeNone {
		switch m.settMode {
		case settModeAddCat, settModeEditCat:
			return m.keys.HelpBindings(scopeSettingsModeCat)
		case settModeAddTag, settModeEditTag:
			return m.keys.HelpBindings(scopeSettingsModeTag)
		case settModeAddRule, settModeEditRule:
			return m.keys.HelpBindings(scopeSettingsModeRule)
		case settModeRuleCat:
			return m.keys.HelpBindings(scopeSettingsModeRuleCat)
		}
	}
	if m.confirmAction != "" {
		return m.keys.HelpBindings(scopeSettingsConfirm)
	}
	if m.settActive {
		switch m.settSection {
		case settSecCategories:
			return m.keys.HelpBindings(scopeSettingsActiveCategories)
		case settSecTags:
			return m.keys.HelpBindings(scopeSettingsActiveTags)
		case settSecRules:
			return m.keys.HelpBindings(scopeSettingsActiveRules)
		case settSecChart:
			return m.keys.HelpBindings(scopeSettingsActiveChart)
		case settSecDBImport:
			return m.keys.HelpBindings(scopeSettingsActiveDBImport)
		}
	}
	return m.keys.HelpBindings(scopeSettingsNav)
}

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

func (m model) footerBindings() []key.Binding {
	if m.showDetail {
		return m.keys.HelpBindings(scopeDetailModal)
	}
	if m.importPicking {
		return m.keys.HelpBindings(scopeFilePicker)
	}
	if m.importDupeModal {
		return m.keys.HelpBindings(scopeDupeModal)
	}
	if m.catPicker != nil {
		return m.keys.HelpBindings(scopeCategoryPicker)
	}
	if m.tagPicker != nil {
		return m.keys.HelpBindings(scopeTagPicker)
	}
	if m.accountNukePicker != nil {
		return m.keys.HelpBindings(scopeAccountNukePicker)
	}
	if m.managerModalOpen {
		return m.keys.HelpBindings(scopeManagerModal)
	}
	if m.searchMode {
		return m.keys.HelpBindings(scopeSearch)
	}
	if m.activeTab == tabDashboard {
		if m.dashCustomEditing {
			return m.keys.HelpBindings(scopeDashboardCustomInput)
		}
		if m.dashTimeframeFocus {
			return m.keys.HelpBindings(scopeDashboardTimeframe)
		}
	}
	if m.activeTab == tabManager {
		if m.managerMode == managerModeTransactions {
			b := append([]key.Binding{}, m.keys.HelpBindings(scopeTransactions)...)
			b = append(b, m.keys.HelpBindings(scopeManagerTransactions)...)
			return b
		}
		return m.keys.HelpBindings(scopeManager)
	}
	if m.activeTab == tabSettings {
		return m.settingsFooterBindings()
	}
	return m.keys.HelpBindings(scopeDashboard)
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

func (m *model) managerSectionContentWidth() int {
	if m.width == 0 {
		return 80
	}
	frameH := settingsActiveBorderStyle.GetHorizontalFrameSize()
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
	if m.width <= 2 {
		return m.width
	}
	// Keep a hard right-side margin to avoid border clipping.
	return m.width - 2
}

func (m *model) ensureCursorInWindow() {
	visible := m.visibleRows()
	if m.activeTab == tabManager && m.managerMode == managerModeTransactions {
		visible = m.managerVisibleRows()
	}
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

func (m *model) managerVisibleRows() int {
	v := m.visibleRows() - 4
	if v < 3 {
		v = 3
	}
	return v
}

func sectionHeaderLineCount() int {
	return 2
}

func dashTimeframeLabel(timeframe int) string {
	if timeframe >= 0 && timeframe < len(dashTimeframeLabels) {
		return dashTimeframeLabels[timeframe]
	}
	return dashTimeframeLabels[dashTimeframeThisMonth]
}

func (m model) accountFilterLabel() string {
	if len(m.filterAccounts) == 0 {
		return "All Accounts"
	}
	if len(m.filterAccounts) == 1 {
		for _, a := range m.accounts {
			if m.filterAccounts[a.id] {
				return a.name
			}
		}
	}
	return fmt.Sprintf("%d Accounts", len(m.filterAccounts))
}

func dashboardSpendRows(rows []transaction, txnTags map[int][]tag) []transaction {
	if len(rows) == 0 || len(txnTags) == 0 {
		return rows
	}
	out := make([]transaction, 0, len(rows))
	for _, r := range rows {
		if hasIgnoreTag(txnTags[r.id]) {
			continue
		}
		out = append(out, r)
	}
	return out
}

func hasIgnoreTag(tags []tag) bool {
	for _, tg := range tags {
		if strings.EqualFold(strings.TrimSpace(tg.name), "IGNORE") {
			return true
		}
	}
	return false
}

// getFilteredRows returns the current filtered/sorted view of transactions.
func (m model) getFilteredRows() []transaction {
	return filteredRows(m.rows, m.searchQuery, m.filterCategories, m.filterAccounts, m.txnTags, m.sortColumn, m.sortAscending)
}

func (m model) getDashboardRows() []transaction {
	rows := filteredRows(m.rows, "", nil, m.filterAccounts, m.txnTags, sortByDate, false)
	return filterByTimeframe(rows, m.dashTimeframe, m.dashCustomStart, m.dashCustomEnd, time.Now())
}

func (m model) dashboardChartRange(now time.Time) (time.Time, time.Time) {
	start, endExcl, ok := timeframeBounds(m.dashTimeframe, m.dashCustomStart, m.dashCustomEnd, now)
	if ok {
		end := endExcl.AddDate(0, 0, -1)
		if end.Before(start) {
			end = start
		}
		return start, end
	}

	// Fallback to the historical default if timeframe bounds are unavailable.
	end := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.Local)
	start = end.AddDate(0, 0, -(spendingTrackerDays - 1))
	return start, end
}

// filteredRows returns the subset of m.rows matching active transactions filters,
// sorted by the current sort column/direction.
func filteredRows(rows []transaction, searchQuery string, filterCats map[int]bool, filterAccounts map[int]bool, txnTags map[int][]tag, sortCol int, sortAsc bool) []transaction {
	var out []transaction
	for _, r := range rows {
		if !matchesSearch(r, searchQuery, txnTags[r.id]) {
			continue
		}
		if !matchesCategoryFilter(r, filterCats) {
			continue
		}
		if !matchesAccountFilter(r, filterAccounts) {
			continue
		}
		out = append(out, r)
	}
	sortTransactions(out, sortCol, sortAsc)
	return out
}

func filterByTimeframe(rows []transaction, timeframe int, customStart, customEnd string, now time.Time) []transaction {
	start, end, ok := timeframeBounds(timeframe, customStart, customEnd, now)
	if !ok {
		out := make([]transaction, 0, len(rows))
		out = append(out, rows...)
		return out
	}

	out := make([]transaction, 0, len(rows))
	for _, r := range rows {
		parsed, err := time.ParseInLocation("2006-01-02", r.dateISO, time.Local)
		if err != nil {
			// Keep unparsable rows visible; this matches current transaction filtering behavior.
			out = append(out, r)
			continue
		}
		if !parsed.Before(start) && parsed.Before(end) {
			out = append(out, r)
		}
	}
	return out
}

func timeframeBounds(timeframe int, customStart, customEnd string, now time.Time) (time.Time, time.Time, bool) {
	dayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.Local)
	switch timeframe {
	case dashTimeframeThisMonth:
		start := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.Local)
		end := start.AddDate(0, 1, 0)
		return start, end, true
	case dashTimeframeLastMonth:
		end := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.Local)
		start := end.AddDate(0, -1, 0)
		return start, end, true
	case dashTimeframe1Month:
		return dayStart.AddDate(0, -1, 0), dayStart.AddDate(0, 0, 1), true
	case dashTimeframe2Months:
		return dayStart.AddDate(0, -2, 0), dayStart.AddDate(0, 0, 1), true
	case dashTimeframe3Months:
		return dayStart.AddDate(0, -3, 0), dayStart.AddDate(0, 0, 1), true
	case dashTimeframe6Months:
		return dayStart.AddDate(0, -6, 0), dayStart.AddDate(0, 0, 1), true
	case dashTimeframeYTD:
		start := time.Date(now.Year(), time.January, 1, 0, 0, 0, 0, time.Local)
		return start, dayStart.AddDate(0, 0, 1), true
	case dashTimeframe1Year:
		return dayStart.AddDate(-1, 0, 0), dayStart.AddDate(0, 0, 1), true
	case dashTimeframeCustom:
		if customStart == "" || customEnd == "" {
			return time.Time{}, time.Time{}, false
		}
		start, err := time.ParseInLocation("2006-01-02", customStart, time.Local)
		if err != nil {
			return time.Time{}, time.Time{}, false
		}
		endIncl, err := time.ParseInLocation("2006-01-02", customEnd, time.Local)
		if err != nil {
			return time.Time{}, time.Time{}, false
		}
		if endIncl.Before(start) {
			return time.Time{}, time.Time{}, false
		}
		return start, endIncl.AddDate(0, 0, 1), true
	default:
		return time.Time{}, time.Time{}, false
	}
}

func matchesSearch(t transaction, query string, tags []tag) bool {
	if query == "" {
		return true
	}
	q := strings.ToLower(query)
	if strings.Contains(strings.ToLower(t.description), q) ||
		strings.Contains(strings.ToLower(t.categoryName), q) ||
		strings.Contains(t.dateISO, q) ||
		strings.Contains(t.dateRaw, q) {
		return true
	}
	for _, tg := range tags {
		if strings.Contains(strings.ToLower(tg.name), q) {
			return true
		}
	}
	return false
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

func matchesAccountFilter(t transaction, filterAccounts map[int]bool) bool {
	if len(filterAccounts) == 0 {
		return true
	}
	if t.accountID == nil {
		return false
	}
	return filterAccounts[*t.accountID]
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
