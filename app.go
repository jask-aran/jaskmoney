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
	"github.com/charmbracelet/x/ansi"
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
	tabCount     = 3
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

type tagRulesAppliedMsg struct {
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
	count     int
	tagName   string
	toggled   bool
	toggledOn bool
	err       error
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
	settSecDBImport
	settSecImportHistory
	settSecCount
)

// Column mapping: left column has Categories (row 0), Tags (row 1), Rules (row 2).
// Right column has Chart (row 0), Database (row 1), Import History (row 2).
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

type settingsConfirmAction string

const (
	confirmActionNone           settingsConfirmAction = ""
	confirmActionDeleteCategory settingsConfirmAction = "delete_cat"
	confirmActionDeleteTag      settingsConfirmAction = "delete_tag"
	confirmActionDeleteRule     settingsConfirmAction = "delete_rule"
	confirmActionClearDB        settingsConfirmAction = "clear_db"
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
	commands   *CommandRegistry
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

	// Command UI (palette + colon command mode)
	commandOpen    bool
	commandUIKind  string // commandUIKind*
	commandQuery   string
	commandCursor  int
	commandMatches []CommandMatch
	lastCommandID  string
	commandDefault string // commandUIKind*

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
	settSection    int                   // which section is focused (settSec*)
	settColumn     int                   // 0 = left column, 1 = right column
	settActive     bool                  // true = interacting inside a section, false = navigating sections
	settItemCursor int                   // cursor within the active section's item list
	settMode       string                // current editing mode (settMode*)
	settInput      string                // text input buffer for add/edit
	settCatFocus   int                   // category editor focus: 0=name, 1=color
	settColorIdx   int                   // index into CategoryAccentColors() during add/edit
	settTagFocus   int                   // tag editor focus: 0=name, 1=color, 2=scope
	settTagScopeID int                   // tag editor scope category id; 0 means global
	settRuleCatIdx int                   // category cursor when picking for a rule
	settEditID     int                   // ID of item being edited
	confirmAction  settingsConfirmAction // pending settings confirm action
	confirmID      int                   // ID for pending confirm (category or rule)

	// Manager state
	managerCursor     int
	managerSelectedID int
	managerMode       int
	managerModalOpen  bool
	managerModalIsNew bool
	managerEditID     int
	managerEditSource string
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
		commands:           NewCommandRegistry(keys),
		formats:            formats,
		selectedRows:       make(map[int]bool),
		txnTags:            make(map[int][]tag),
		status:             status,
		statusErr:          statusErr,
		commandDefault:     appCfg.CommandDefaultInterface,
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
	if m.commandOpen && m.commandUIKind == commandUIKindColon {
		footer = m.renderCommandFooter()
	}

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

	if m.showDetail {
		txn := m.findDetailTxn()
		if txn != nil {
			detail := renderDetail(*txn, m.txnTags[txn.id], m.detailNotes, m.detailEditing, m.keys)
			return m.composeOverlay(header, body, statusLine, footer, detail)
		}
	}
	if m.importPicking {
		picker := renderFilePicker(m.importFiles, m.importCursor, m.keys)
		return m.composeOverlay(header, body, statusLine, footer, picker)
	}
	if m.importDupeModal {
		dupeModal := renderDupeModal(m.importDupeFile, m.importDupeTotal, m.importDupeCount, m.keys)
		return m.composeOverlay(header, body, statusLine, footer, dupeModal)
	}
	if m.catPicker != nil {
		picker := renderPicker(m.catPicker, min(56, m.width-10), m.keys, scopeCategoryPicker)
		return m.composeOverlay(header, body, statusLine, footer, picker)
	}
	if m.tagPicker != nil {
		picker := renderPicker(m.tagPicker, min(56, m.width-10), m.keys, scopeTagPicker)
		return m.composeOverlay(header, body, statusLine, footer, picker)
	}
	if m.accountNukePicker != nil {
		picker := renderPicker(m.accountNukePicker, min(56, m.width-10), m.keys, scopeAccountNukePicker)
		return m.composeOverlay(header, body, statusLine, footer, picker)
	}
	if m.managerModalOpen {
		modal := renderManagerAccountModal(m)
		return m.composeOverlay(header, body, statusLine, footer, modal)
	}
	if m.commandOpen && m.commandUIKind == commandUIKindPalette {
		palette := renderCommandPalette(m.commandQuery, m.commandMatches, m.commandCursor, min(72, m.width-8), m.keys)
		return m.composeOverlay(header, body, statusLine, footer, palette)
	}
	if m.commandOpen && m.commandUIKind == commandUIKindColon {
		suggestions := renderCommandSuggestions(m.commandMatches, m.commandCursor, min(72, m.width-8), 5)
		if strings.TrimSpace(suggestions) != "" {
			return m.composeBottomOverlay(header, body, statusLine, footer, suggestions)
		}
	}
	return m.composeFrame(header, body, statusLine, footer)
}

// ---------------------------------------------------------------------------
// Per-tab views
// ---------------------------------------------------------------------------

func (m model) dashboardView() string {
	rows := m.getDashboardRows()
	w := m.sectionBoxContentWidth(m.sectionWidth())
	chips := renderDashboardControlsLine(
		renderDashboardTimeframeChips(dashTimeframeLabels, m.dashTimeframe, m.dashTimeframeCursor, m.dashTimeframeFocus),
		dashboardDateRange(rows, m.dashTimeframe, m.dashCustomStart, m.dashCustomEnd, time.Now()),
		m.sectionWidth(),
	)
	customInput := renderDashboardCustomInput(m.dashCustomStart, m.dashCustomEnd, m.dashCustomInput, m.dashCustomEditing)
	summary := m.renderSectionSizedLeft("Overview", renderSummaryCards(rows, m.categories, w), m.sectionWidth(), false)
	spendRows := dashboardSpendRows(rows, m.txnTags)
	totalWidth := m.sectionWidth()
	gap := 2
	trackerWidth, breakdownWidth := dashboardChartWidths(totalWidth, gap)

	trackerContentWidth := m.sectionBoxContentWidth(trackerWidth)
	breakdownContentWidth := m.sectionBoxContentWidth(breakdownWidth)

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
	total := len(m.rows)
	var txContent string
	if m.managerMode == managerModeTransactions {
		highlighted := m.highlightedRows(rows)
		cursorTxnID := 0
		if m.cursor >= 0 && m.cursor < len(rows) {
			cursorTxnID = rows[m.cursor].id
		}
		searchBar := m.transactionSearchBar()
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
	title := fmt.Sprintf("Transactions (%d/%d)", len(rows), total)
	if selected := m.selectedCount(); selected > 0 {
		visibleSelected, hiddenSelected := m.selectedVisibilityCounts(rows)
		if hiddenSelected > 0 {
			title = fmt.Sprintf("Transactions (%d selected, %d hidden)", selected, hiddenSelected)
		} else {
			title = fmt.Sprintf("Transactions (%d selected)", visibleSelected)
		}
	}
	transactionsCard := renderManagerSectionBox(title, !accountsFocused, !accountsFocused, m.sectionWidth(), txContent)
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

func (m model) settingsView() string {
	content := renderSettingsContent(m)
	if m.width == 0 {
		return content
	}
	return lipgloss.Place(m.width, lipgloss.Height(content), lipgloss.Center, lipgloss.Top, content)
}

func (m model) transactionSearchBar() string {
	if m.searchMode {
		return searchPromptStyle.Render("/") + " " + searchInputStyle.Render(m.searchQuery+"_") + "\n"
	}
	if m.searchQuery != "" {
		return searchPromptStyle.Render("/") + " " + searchInputStyle.Render(m.searchQuery) + "  " + lipgloss.NewStyle().Foreground(colorOverlay1).Render("(esc clear)") + "\n"
	}
	return ""
}

func (m model) composeFrame(header, body, statusLine, footer string) string {
	if m.height <= 0 {
		return header + "\n\n" + body + "\n" + statusLine + "\n" + footer
	}
	if m.height == 1 {
		return m.normalizeViewportLine(header)
	}
	if m.height == 2 {
		return m.normalizeViewportLine(header) + "\n" + m.normalizeViewportLine(footer)
	}
	topHeight := m.height - 2
	lines := make([]string, 0, m.height)
	lines = append(lines, m.composeTopAreaLines(header, body, topHeight)...)
	lines = append(lines, m.normalizeViewportLine(statusLine), m.normalizeViewportLine(footer))
	return strings.Join(lines, "\n")
}

func (m model) composeTopAreaLines(header, body string, topHeight int) []string {
	if topHeight <= 0 {
		return nil
	}
	lines := []string{m.normalizeViewportLine(header)}
	if topHeight == 1 {
		return lines
	}
	lines = append(lines, m.normalizeViewportLine(""))
	bodyLines := splitLines(body)
	bodyCap := topHeight - len(lines)
	for i := 0; i < bodyCap; i++ {
		if i < len(bodyLines) {
			lines = append(lines, m.normalizeBodyLine(bodyLines[i]))
			continue
		}
		lines = append(lines, m.normalizeBodyLine(""))
	}
	return lines
}

func (m model) normalizeViewportLine(line string) string {
	if m.width <= 0 {
		return line
	}
	return padRight(ansi.Truncate(line, m.width, ""), m.width)
}

func (m model) normalizeBodyLine(line string) string {
	return m.normalizeViewportLine(line)
}

func (m model) composeOverlay(header, body, statusLine, footer, content string) string {
	baseView := m.composeFrame(header, body, statusLine, footer)
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
	out := overlayAt(baseView, modal, x, y, m.width, targetHeight)
	lines = splitLines(out)
	for i := range lines {
		lines[i] = m.normalizeViewportLine(lines[i])
	}
	return strings.Join(lines, "\n")
}

func (m model) composeBottomOverlay(header, body, statusLine, footer, content string) string {
	baseView := m.composeFrame(header, body, statusLine, footer)
	if m.height == 0 || m.width == 0 {
		return baseView + "\n" + content
	}
	overlay := lipgloss.NewStyle().Width(min(72, m.width-4)).Render(content)
	lines := splitLines(overlay)
	overlayWidth := maxLineWidth(lines)
	overlayHeight := len(lines)

	targetHeight := m.height - 2
	if targetHeight < 1 {
		targetHeight = 1
	}
	x := 2
	if x+overlayWidth > m.width {
		x = max(0, m.width-overlayWidth)
	}
	y := targetHeight - overlayHeight - 1
	if y < 0 {
		y = 0
	}
	out := overlayAt(baseView, overlay, x, y, m.width, targetHeight)
	lines = splitLines(out)
	for i := range lines {
		lines[i] = m.normalizeViewportLine(lines[i])
	}
	return strings.Join(lines, "\n")
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
	if m.confirmAction != confirmActionNone {
		return m.settingsConfirmBindings()
	}
	if m.settActive {
		return m.keys.HelpBindings(settingsActiveScope(m.settSection))
	}
	return m.keys.HelpBindings(scopeSettingsNav)
}

func (m model) settingsConfirmBindings() []key.Binding {
	spec, ok := settingsConfirmSpecFor(m.confirmAction)
	if !ok {
		return nil
	}
	confirmKey := m.primaryActionKey(spec.scope, spec.action, spec.fallback)
	confirmLabel := prettyHelpKey(confirmKey)
	return []key.Binding{
		key.NewBinding(key.WithKeys(confirmKey), key.WithHelp(confirmLabel, "confirm")),
		key.NewBinding(key.WithKeys("other"), key.WithHelp("other", "cancel")),
	}
}

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

func (m model) footerBindings() []key.Binding {
	if m.commandOpen {
		if m.commandUIKind == commandUIKindPalette {
			return m.keys.HelpBindings(scopeCommandPalette)
		}
		return m.keys.HelpBindings(scopeCommandMode)
	}
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
	return m.width
}

func (m model) sectionBoxContentWidth(sectionWidth int) int {
	// renderSectionBox uses 1 char border + 1 char inner padding on each side.
	contentWidth := sectionWidth - 4
	if contentWidth < 1 {
		contentWidth = 1
	}
	return contentWidth
}

func dashboardChartWidths(totalWidth, gap int) (int, int) {
	avail := totalWidth - gap
	if avail < 2 {
		if totalWidth <= 1 {
			return 1, 1
		}
		return max(1, avail), 1
	}
	tracker := avail * 60 / 100
	if tracker < 1 {
		tracker = 1
	}
	breakdown := avail - tracker
	if breakdown < 1 {
		breakdown = 1
		tracker = avail - breakdown
	}
	if avail >= 48 {
		if tracker < 24 {
			tracker = 24
		}
		breakdown = avail - tracker
		if breakdown < 24 {
			breakdown = 24
			tracker = avail - breakdown
		}
	}
	return tracker, breakdown
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
	return m.visibleRows()
}

func (m model) selectedVisibilityCounts(filtered []transaction) (visible int, hidden int) {
	if len(m.selectedRows) == 0 {
		return 0, 0
	}
	visibleSet := make(map[int]bool, len(filtered))
	for _, txn := range filtered {
		visibleSet[txn.id] = true
	}
	for id := range m.selectedRows {
		if visibleSet[id] {
			visible++
		} else {
			hidden++
		}
	}
	return visible, hidden
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
		var (
			less bool
			eq   bool
		)
		switch col {
		case sortByDate:
			less = rows[i].dateISO < rows[j].dateISO
			eq = rows[i].dateISO == rows[j].dateISO
		case sortByAmount:
			less = rows[i].amount < rows[j].amount
			eq = rows[i].amount == rows[j].amount
		case sortByCategory:
			li := strings.ToLower(rows[i].categoryName)
			lj := strings.ToLower(rows[j].categoryName)
			less = li < lj
			eq = li == lj
		case sortByDescription:
			li := strings.ToLower(rows[i].description)
			lj := strings.ToLower(rows[j].description)
			less = li < lj
			eq = li == lj
		default:
			less = rows[i].dateISO < rows[j].dateISO
			eq = rows[i].dateISO == rows[j].dateISO
		}
		if asc {
			return less
		}
		if eq {
			return false
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
