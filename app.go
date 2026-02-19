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
	tabDashboard = 0
	tabBudget    = 1
	tabManager   = 2
	tabSettings  = 3
	tabCount     = 4
)

const (
	managerModeTransactions = iota
	managerModeAccounts
)

const (
	sectionUnfocused = -1

	sectionDashboardNetCashflow = 0
	sectionDashboardComposition = 1
	sectionDashboardDateRange   = 2

	sectionManagerAccounts     = 0
	sectionManagerTransactions = 1

	sectionSettingsCategories    = 0
	sectionSettingsTags          = 1
	sectionSettingsRules         = 2
	sectionSettingsDatabase      = 3
	sectionSettingsViews         = 4
	sectionSettingsImportHistory = 5
	sectionSettingsFilters       = 6
)

type transaction struct {
	id            int
	dateRaw       string
	dateISO       string
	amount        float64
	fullAmount    float64 // non-zero for parent rows when amount is remainder after allocations
	description   string
	categoryID    *int
	categoryName  string // denormalized from JOIN
	categoryColor string // denormalized from JOIN
	notes         string
	accountID     *int
	accountName   string
	accountType   string
	isAllocation  bool
	parentTxnID   int
	allocationID  int
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

	rulesApplied    bool
	rulesTxnUpdated int
	rulesCatChanges int
	rulesTagChanges int
	rulesFailed     int
}

type importPreviewParseError struct {
	rowIndex   int
	sourceLine int
	field      string
	message    string
}

type importPreviewRow struct {
	index       int
	sourceLine  int
	dateRaw     string
	dateISO     string
	amount      float64
	description string
	isDupe      bool

	previewCat      string
	previewTags     []string
	previewCatColor string
	previewTagObjs  []tag
}

type importPreviewLockedRules struct {
	ruleIDs    []int
	rules      []ruleV2
	lockReason string

	// Materialized resolved rules to guarantee preview/import parity.
	resolved []resolvedRuleV2
}

type importPreviewSnapshot struct {
	fileName    string
	createdAt   time.Time
	totalRows   int
	newCount    int
	dupeCount   int
	errorCount  int
	rows        []importPreviewRow
	parseErrors []importPreviewParseError
	lockedRules importPreviewLockedRules

	// Internal import context captured at preview-open.
	accountID int
}

type importPreviewMsg struct {
	snapshot *importPreviewSnapshot
	err      error
}

type refreshDoneMsg struct {
	rows             []transaction
	categories       []category
	rules            []ruleV2
	tags             []tag
	txnTags          map[int][]tag
	imports          []importRecord
	accounts         []account
	selectedAccounts map[int]bool
	info             dbInfo
	filterUsage      map[string]filterUsageState
	err              error
}

type filesLoadedMsg struct {
	files []string
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
	updatedTxns int
	catChanges  int
	tagChanges  int
	failedRules int
	scope       string
	err         error
}

type rulesDryRunMsg struct {
	results     []dryRunRuleResult
	summary     dryRunSummary
	failedRules int
	scope       string
	err         error
}

type settingsSavedMsg struct {
	err error
}

type keybindingsResetMsg struct {
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

type accountClearedMsg struct {
	accountName string
	deletedTxns int
	err         error
}

type accountScopeSavedMsg struct {
	err error
}

type confirmExpiredMsg struct{}
type budgetDeleteConfirmExpiredMsg struct{}

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
	"This",
	"Last",
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
	settSecFilters
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
	confirmActionDeleteFilter   settingsConfirmAction = "delete_filter"
	confirmActionClearDB        settingsConfirmAction = "clear_db"
)

type drillReturnState struct {
	returnTab             int
	focusedWidget         int
	activeMode            int
	scroll                int
	prevFilterInput       string
	prevFilterExpr        *filterNode
	prevFilterLastApplied string
	prevFilterInputErr    string
}

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

	// Import flow (file picker + preview modal)
	importPicking bool     // showing file picker
	importFiles   []string // CSV files in basePath
	importCursor  int      // cursor in file picker

	// Import preview overlay state
	importPreviewOpen      bool
	importPreviewPostRules bool // false=raw, true=rules-active
	importPreviewShowAll   bool // false=dupes-only compact, true=all rows compact
	importPreviewCursor    int
	importPreviewScroll    int
	importPreviewSnapshot  *importPreviewSnapshot

	// Filter input state
	filterInputMode   bool
	filterInput       string
	filterInputCursor int
	filterExpr        *filterNode
	filterInputErr    string
	filterLastApplied string
	savedFilters      []savedFilter
	filterUsage       map[string]filterUsageState
	customPaneModes   []customPaneMode
	filterApplyPicker *pickerState
	filterApplyOrder  []string
	filterEditOpen    bool
	filterEditID      string
	filterEditOrigID  string
	filterEditName    string
	filterEditExpr    string
	filterEditIDCur   int
	filterEditNameCur int
	filterEditExprCur int
	filterEditFocus   int
	filterEditIsNew   bool
	filterEditErr     string

	// Command UI (palette + colon command mode)
	commandOpen         bool
	commandUIKind       string // commandUIKind*
	commandQuery        string
	commandCursor       int
	commandScrollOffset int
	commandPageSize     int
	commandMatches      []CommandMatch
	lastCommandID       string
	commandDefault      string // commandUIKind*
	commandSourceScope  string

	// Sort
	sortColumn    int
	sortAscending bool

	// Transactions scope
	filterAccounts  map[int]bool // account ID -> enabled (nil = show all)
	selectedRows    map[int]bool // manager row ID (transaction or allocation) -> selected
	selectionAnchor int          // last toggled/selected row ID for range selection
	rangeSelecting  bool         // true when shift-range highlight is active
	rangeAnchorID   int          // anchor row ID for active highlight range
	rangeCursorID   int          // cursor row ID for active highlight range

	// Transaction detail modal
	showDetail           bool
	detailIdx            int // transaction ID being edited
	detailAllocationID   int
	detailRow            transaction
	detailRowValid       bool
	detailCatCursor      int // cursor in category picker
	detailNotes          string
	detailNotesCursor    int    // cursor position inside detailNotes when editing
	detailEditing        string // "category" or "notes" or ""
	catPicker            *pickerState
	catPickerFor         []int
	tagPicker            *pickerState
	tagPickerFor         []int
	allocationModalOpen  bool
	allocationParentID   int
	allocationEditID     int
	allocationAmount     string
	allocationAmountCur  int
	allocationNote       string
	allocationNoteCur    int
	allocationModalFocus int
	managerActionPicker  *pickerState
	managerActionAcctID  int
	managerActionName    string

	// Settings state
	rules           []ruleV2
	tags            []tag
	txnTags         map[int][]tag
	imports         []importRecord
	dbInfo          dbInfo
	settSection     int                   // which section is focused (settSec*)
	settColumn      int                   // 0 = left column, 1 = right column
	settActive      bool                  // true = interacting inside a section, false = navigating sections
	settItemCursor  int                   // cursor within the active section's item list
	settMode        string                // current editing mode (settMode*)
	settInput       string                // text input buffer for add/edit
	settInputCursor int                   // cursor position inside settInput for name editing
	settCatFocus    int                   // category editor focus: 0=name, 1=color
	settColorIdx    int                   // index into CategoryAccentColors() during add/edit
	settTagFocus    int                   // tag editor focus: 0=name, 1=color, 2=scope
	settTagScopeID  int                   // tag editor scope category id; 0 means global
	settEditID      int                   // ID of item being edited
	confirmAction   settingsConfirmAction // pending settings confirm action
	confirmID       int                   // ID for pending confirm (category or rule)
	confirmFilterID string                // filter ID for pending filter delete confirm

	// Rule editor modal (rules v2)
	ruleEditorOpen            bool
	ruleEditorStep            int
	ruleEditorID              int
	ruleEditorName            string
	ruleEditorFilterID        string
	ruleEditorCatID           *int
	ruleEditorAddTags         []int
	ruleEditorEnabled         bool
	ruleEditorNameCur         int
	ruleEditorErr             string
	ruleEditorPickingFilter   bool
	ruleEditorPickingCategory bool
	ruleEditorPickingTags     bool

	// Dry-run modal
	dryRunOpen       bool
	dryRunResults    []dryRunRuleResult
	dryRunSummary    dryRunSummary
	dryRunScopeLabel string
	dryRunScroll     int

	// Manager state
	managerCursor        int
	managerSelectedID    int
	managerMode          int
	managerModalOpen     bool
	managerModalIsNew    bool
	managerEditID        int
	managerEditSource    string
	managerEditName      string
	managerEditType      string
	managerEditPrefix    string
	managerEditActive    bool
	managerEditFocus     int // 0=name,1=type,2=prefix,3=active
	managerEditNameCur   int // cursor position inside managerEditName
	managerEditPrefixCur int // cursor position inside managerEditPrefix

	// Dashboard timeframe
	dashTimeframe       int
	dashMonthMode       bool
	dashTimeframeFocus  bool
	dashTimeframeCursor int
	dashAnchorMonth     string
	dashCustomStart     string
	dashCustomEnd       string
	dashCustomInput     string
	dashCustomEditing   bool
	dashWidgets         []widget
	dashCustomModeEdit  bool

	// Dashboard -> Manager drill-return context.
	drillReturn *drillReturnState

	// Budget tab state
	budgetMonth             string
	budgetYear              int
	budgetView              int
	budgetCursor            int
	budgetPlannerCol        int
	budgetEditing           bool
	budgetEditValue         string
	budgetEditCursor        int
	budgetDeleteArmedTarget int

	// Budget data
	categoryBudgets     []categoryBudget
	budgetOverrides     map[int][]budgetOverride
	spendingTargets     []spendingTarget
	targetOverrides     map[int][]targetOverride
	budgetLines         []budgetLine
	targetLines         []targetLine
	budgetAdherencePct  float64
	budgetOverCount     int
	budgetVarSparkline  []float64
	allocationsByParent map[int][]transactionAllocation
	allocationsByID     map[int]transactionAllocation
	allocationTagsByID  map[int][]tag

	// Configurable display
	maxVisibleRows     int          // max rows shown in transaction table (5-50, default 20)
	spendingWeekAnchor time.Weekday // week boundary marker for spending tracker (Sunday/Monday)

	// Jump mode
	jumpModeActive    bool
	jumpPreviousFocus int
	focusedSection    int
}

func newModel() model {
	cwd, cwdErr := os.Getwd()
	if cwdErr != nil || cwd == "" {
		cwd = "."
	}
	formats, appCfg, savedFilters, customPaneModes, cfgWarnings, fmtErr := loadAppConfigExtended()
	status := ""
	statusErr := false
	if fmtErr != nil {
		status = fmt.Sprintf("Format config error: %v", fmtErr)
		statusErr = true
	} else if len(cfgWarnings) > 0 {
		for _, warning := range cfgWarnings {
			fmt.Fprintf(os.Stderr, "Config warning: %s\n", warning)
		}
	}
	keys := NewKeyRegistry()
	if fmtErr == nil {
		keybindings, keyLoadErr := loadKeybindingsConfig()
		if keyLoadErr != nil {
			status = fmt.Sprintf("Shortcut config error: %v", keyLoadErr)
			statusErr = true
		} else if keyErr := keys.ApplyKeybindingConfig(keybindings); keyErr != nil {
			// User config may conflict with new scope map (e.g. tab reorder).
			// Fall back to defaults and report.
			keys = NewKeyRegistry()
			status = fmt.Sprintf("Key config conflict (using defaults): %v", keyErr)
			statusErr = true
		}
	}
	weekAnchor := time.Sunday
	if appCfg.SpendingWeekFrom == "monday" {
		weekAnchor = time.Monday
	}
	m := model{
		basePath:            cwd,
		activeTab:           tabDashboard,
		managerMode:         managerModeTransactions,
		maxVisibleRows:      appCfg.RowsPerPage,
		spendingWeekAnchor:  weekAnchor,
		dashTimeframe:       dashTimeframeThisMonth,
		dashAnchorMonth:     time.Now().Format("2006-01"),
		dashCustomStart:     appCfg.DashCustomStart,
		dashCustomEnd:       appCfg.DashCustomEnd,
		dashWidgets:         newDashboardWidgets(customPaneModes),
		budgetMonth:         time.Now().Format("2006-01"),
		budgetYear:          time.Now().Year(),
		keys:                keys,
		commands:            NewCommandRegistry(keys, savedFilters),
		formats:             formats,
		savedFilters:        savedFilters,
		filterUsage:         make(map[string]filterUsageState),
		customPaneModes:     customPaneModes,
		selectedRows:        make(map[int]bool),
		txnTags:             make(map[int][]tag),
		budgetOverrides:     make(map[int][]budgetOverride),
		targetOverrides:     make(map[int][]targetOverride),
		allocationsByParent: make(map[int][]transactionAllocation),
		allocationsByID:     make(map[int]transactionAllocation),
		allocationTagsByID:  make(map[int][]tag),
		status:              status,
		statusErr:           statusErr,
		commandDefault:      appCfg.CommandDefaultInterface,
		jumpPreviousFocus:   sectionUnfocused,
		focusedSection:      sectionUnfocused,
	}
	m.syncBudgetMonthFromDashboard()
	return m
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
	case tabDashboard:
		body = m.dashboardView()
	case tabBudget:
		body = m.budgetTabView()
	case tabManager:
		body = m.managerView()
	case tabSettings:
		body = m.settingsView()
	default:
		body = m.dashboardView()
	}

	if m.showDetail {
		if m.detailRowValid {
			detail := renderDetailWithAllocations(m, m.keys)
			return m.composeOverlay(header, body, statusLine, footer, detail)
		}
	}
	if m.importPicking {
		picker := renderFilePicker(m.importFiles, m.importCursor, m.keys)
		return m.composeOverlay(header, body, statusLine, footer, picker)
	}
	if m.importPreviewOpen {
		preview := renderImportPreview(
			m.importPreviewSnapshot,
			m.importPreviewPostRules,
			m.importPreviewShowAll,
			m.importPreviewCursor,
			m.importPreviewScroll,
			m.compactImportPreviewRows(),
			m.width,
			m.keys,
		)
		return m.composeOverlay(header, body, statusLine, footer, preview)
	}
	if m.catPicker != nil {
		picker := renderPicker(m.catPicker, min(56, m.width-10), m.keys, scopeCategoryPicker)
		return m.composeOverlay(header, body, statusLine, footer, picker)
	}
	if m.tagPicker != nil {
		picker := renderPicker(m.tagPicker, min(56, m.width-10), m.keys, scopeTagPicker)
		return m.composeOverlay(header, body, statusLine, footer, picker)
	}
	if m.allocationModalOpen {
		modal := renderAllocationAmountModal(m)
		return m.composeOverlay(header, body, statusLine, footer, modal)
	}
	if m.filterApplyPicker != nil {
		picker := renderPicker(m.filterApplyPicker, min(64, m.width-10), m.keys, scopeFilterApplyPicker)
		return m.composeOverlay(header, body, statusLine, footer, picker)
	}
	if m.managerActionPicker != nil {
		picker := renderPicker(m.managerActionPicker, min(56, m.width-10), m.keys, scopeManagerAccountAction)
		return m.composeOverlay(header, body, statusLine, footer, picker)
	}
	if m.filterEditOpen {
		modal := renderFilterEditorModal(m)
		return m.composeOverlay(header, body, statusLine, footer, modal)
	}
	if m.managerModalOpen {
		modal := renderManagerAccountModal(m)
		return m.composeOverlay(header, body, statusLine, footer, modal)
	}
	if m.ruleEditorOpen {
		modal := renderRuleEditorModal(m)
		return m.composeOverlay(header, body, statusLine, footer, modal)
	}
	if m.dryRunOpen {
		modal := renderDryRunResultsModal(m)
		return m.composeOverlay(header, body, statusLine, footer, modal)
	}
	if m.jumpModeActive {
		overlay := renderJumpOverlay(m.jumpTargetsForActiveTab())
		return m.composeOverlay(header, body, statusLine, footer, overlay)
	}
	if m.commandOpen && m.commandUIKind == commandUIKindPalette {
		palette := renderCommandPalette(m.commandQuery, m.commandMatches, m.commandCursor, m.commandScrollOffset, m.commandPageSize, min(76, m.width-6), m.keys)
		return m.composeOverlay(header, body, statusLine, footer, palette)
	}
	if m.commandOpen && m.commandUIKind == commandUIKindColon {
		suggestions := renderCommandSuggestions(m.commandMatches, m.commandCursor, m.commandScrollOffset, m.width, 5)
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
	if len(m.dashWidgets) != dashboardPaneCount {
		m.dashWidgets = newDashboardWidgets(m.customPaneModes)
	}
	rows := m.getDashboardRows()
	w := m.sectionBoxContentWidth(m.sectionWidth())
	datePane := renderDashboardDatePane(m, rows, m.sectionWidth())
	spendRows := dashboardSpendRows(rows, m.txnTags)
	summary := m.renderSectionSizedLeft("Overview", renderSummaryCards(rows, m.categories, w), m.sectionWidth(), false)
	totalWidth := m.sectionWidth()
	gap := 1
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
	out := datePane
	analytics := renderDashboardAnalyticsRegion(m)
	return out + "\n" + summary + "\n" + chartsRow + "\n" + analytics
}

func (m model) budgetTabView() string {
	datePane := renderBudgetDatePane(m, m.sectionWidth())
	scope := m.accountFilterLabel()
	scopeLine := infoLabelStyle.Render("  Accounts: ") + infoValueStyle.Render(scope)

	var body string
	if m.budgetView == 1 {
		body = renderBudgetPlanner(m)
	} else {
		body = renderBudgetTable(m)
	}
	return datePane + "\n" + scopeLine + "\n" + body
}

func (m model) managerView() string {
	accountsFocused := m.managerMode == managerModeAccounts
	accountsContent := renderManagerAccountStrip(m, accountsFocused, m.managerSectionContentWidth())
	accountsCard := renderManagerSectionBox("Accounts", accountsFocused, accountsFocused, m.sectionWidth(), accountsContent)
	allRows := m.managerRowsUnfiltered()
	rows := m.getFilteredRows()
	effectiveTags := m.effectiveTxnTags()
	txVisibleRows := m.managerVisibleRows()
	total := len(allRows)
	var txContent string
	if m.managerMode == managerModeTransactions {
		highlighted := m.highlightedRows(rows)
		cursorTxnID := 0
		if m.cursor >= 0 && m.cursor < len(rows) {
			cursorTxnID = rows[m.cursor].id
		}
		searchBar := m.transactionFilterBar()
		txContent = searchBar + renderTransactionTable(
			rows,
			m.categories,
			effectiveTags,
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
			effectiveTags,
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
	if pill := m.activeFilterPill(); pill != "" {
		title += " " + pill
	}
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

func (m model) transactionFilterBar() string {
	input := m.filterInput
	if !m.filterInputMode && strings.TrimSpace(input) == "" {
		return ""
	}
	dotColor := colorSuccess
	dotLabel := "ok"
	if m.filterInputErr != "" {
		dotColor = colorError
		dotLabel = "parse"
	}
	dot := lipgloss.NewStyle().Foreground(dotColor).Render("●")
	if m.filterInputMode {
		return searchPromptStyle.Render("/") + " " + searchInputStyle.Render(renderASCIIInputCursor(input, m.filterInputCursor)) + "  " + dot + " " + lipgloss.NewStyle().Foreground(dotColor).Render(dotLabel) + "\n"
	}
	return searchPromptStyle.Render("/") + " " + searchInputStyle.Render(input) + "  " + dot + " " + lipgloss.NewStyle().Foreground(dotColor).Render(dotLabel) + "  " + lipgloss.NewStyle().Foreground(colorOverlay1).Render("(esc clear)") + "\n"
}

func (m model) activeFilterPill() string {
	node := m.currentInputFilterNode()
	if strings.TrimSpace(m.filterInput) == "" || node == nil {
		return ""
	}
	expr := filterExprString(node)
	if strings.TrimSpace(expr) == "" {
		expr = strings.TrimSpace(m.filterInput)
	}
	maxWidth := m.sectionWidth() / 2
	if maxWidth < 24 {
		maxWidth = 24
	}
	expr = truncate(expr, maxWidth)
	style := lipgloss.NewStyle().Foreground(colorBlue)
	if m.filterInputErr != "" {
		style = lipgloss.NewStyle().Foreground(colorError)
	}
	pill := style.Render("[" + expr + "]")
	if m.activeTab == tabManager && m.drillReturn != nil {
		prefix := lipgloss.NewStyle().Foreground(colorAccent).Render("[Dashboard >]")
		return prefix + " " + pill
	}
	return pill
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
	modalContent := lipgloss.NewStyle().Render(content)
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
	overlay := lipgloss.NewStyle().Render(content)
	lines := splitLines(overlay)
	overlayWidth := maxLineWidth(lines)
	overlayHeight := len(lines)

	targetHeight := m.height - 2
	if targetHeight < 1 {
		targetHeight = 1
	}
	x := 0
	if x+overlayWidth > m.width {
		x = max(0, m.width-overlayWidth)
	}
	y := targetHeight - overlayHeight
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
	if m.dryRunOpen {
		return m.keys.HelpBindings(scopeDryRunModal)
	}
	if m.ruleEditorOpen {
		return m.keys.HelpBindings(scopeRuleEditor)
	}
	if m.settMode != settModeNone {
		switch m.settMode {
		case settModeAddCat, settModeEditCat:
			return m.keys.HelpBindings(scopeSettingsModeCat)
		case settModeAddTag, settModeEditTag:
			return m.keys.HelpBindings(scopeSettingsModeTag)
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
	// Primary tier: overlay/modal scope via shared precedence table.
	if scope := m.activeOverlayScope(true); scope != "" {
		return m.keys.HelpBindings(scope)
	}
	// Secondary tier: tab-level scope resolution.
	// Settings tab has special footer logic for confirm bindings.
	if m.activeTab == tabSettings {
		return m.settingsFooterBindings()
	}
	return m.keys.HelpBindings(m.tabScope())
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

func (m model) compactImportPreviewRows() int {
	return 20
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

func (m model) rulesScopeLabel() string {
	if len(m.filterAccounts) == 0 {
		return "All Accounts"
	}
	return fmt.Sprintf("%d selected accounts", len(m.filterAccounts))
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

func (m model) dashboardTimeframeBounds(now time.Time) (time.Time, time.Time, bool) {
	if m.dashMonthMode {
		month, _, err := parseMonthKey(m.dashAnchorMonth)
		if err != nil {
			month = time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.Local)
		} else {
			month = time.Date(month.Year(), month.Month(), 1, 0, 0, 0, 0, time.Local)
		}
		return month, month.AddDate(0, 1, 0), true
	}
	return timeframeBounds(m.dashTimeframe, m.dashCustomStart, m.dashCustomEnd, now)
}

func (m model) dashboardBudgetMonth() string {
	if m.dashMonthMode {
		if _, _, err := parseMonthKey(m.dashAnchorMonth); err == nil {
			return m.dashAnchorMonth
		}
	}
	start, endExcl, ok := m.dashboardTimeframeBounds(time.Now())
	if !ok {
		if _, _, err := parseMonthKey(m.dashAnchorMonth); err == nil {
			return m.dashAnchorMonth
		}
		return time.Now().Format("2006-01")
	}
	monthRef := endExcl.AddDate(0, 0, -1)
	if monthRef.Before(start) {
		monthRef = start
	}
	return monthRef.Format("2006-01")
}

func (m *model) syncBudgetMonthFromDashboard() bool {
	month := m.dashboardBudgetMonth()
	changed := month != m.budgetMonth
	m.budgetMonth = month
	if start, _, err := parseMonthKey(month); err == nil {
		m.budgetYear = start.Year()
	}
	return changed
}

func hasIgnoreTag(tags []tag) bool {
	for _, tg := range tags {
		if strings.EqualFold(strings.TrimSpace(tg.name), "IGNORE") {
			return true
		}
	}
	return false
}

func (m model) managerRowsUnfiltered() []transaction {
	parents := make([]transaction, len(m.rows))
	copy(parents, m.rows)
	for i := range parents {
		parents[i].fullAmount = parents[i].amount
		parents[i].isAllocation = false
		parents[i].parentTxnID = parents[i].id
		parents[i].allocationID = 0
		allocatedSum := 0.0
		for _, alloc := range m.allocationsByParent[parents[i].id] {
			allocatedSum += alloc.amount
		}
		parents[i].amount = parents[i].fullAmount - allocatedSum
	}
	sortTransactions(parents, m.sortColumn, m.sortAscending)

	totalChildren := 0
	for _, allocs := range m.allocationsByParent {
		totalChildren += len(allocs)
	}
	out := make([]transaction, 0, len(parents)+totalChildren)
	for _, parent := range parents {
		allocs := m.allocationsByParent[parent.id]
		out = append(out, parent)

		for _, alloc := range allocs {
			child := parent
			child.id = -alloc.id
			child.amount = alloc.amount
			child.fullAmount = 0
			child.isAllocation = true
			child.parentTxnID = parent.id
			child.allocationID = alloc.id
			child.notes = alloc.note
			if strings.TrimSpace(alloc.note) != "" {
				child.description = alloc.note
			} else {
				child.description = "Allocation"
			}
			child.categoryID = copyIntPtr(alloc.categoryID)
			child.categoryName = alloc.categoryName
			child.categoryColor = alloc.categoryColor
			if strings.TrimSpace(child.categoryName) == "" {
				child.categoryName = "Uncategorised"
			}
			if strings.TrimSpace(child.categoryColor) == "" {
				child.categoryColor = "#7f849c"
			}
			out = append(out, child)
		}
	}
	return out
}

func (m model) effectiveTxnTags() map[int][]tag {
	out := make(map[int][]tag, len(m.txnTags)+len(m.allocationTagsByID))
	for txnID, tags := range m.txnTags {
		out[txnID] = tags
	}
	for allocationID, tags := range m.allocationTagsByID {
		out[-allocationID] = tags
	}
	return out
}

// getFilteredRows returns the current filtered view of manager transaction rows.
func (m model) getFilteredRows() []transaction {
	rows := m.managerRowsUnfiltered()
	filter := m.buildTransactionFilter()
	tags := m.effectiveTxnTags()
	out := make([]transaction, 0, len(rows))
	for _, row := range rows {
		if evalFilter(filter, row, tags[row.id]) {
			out = append(out, row)
		}
	}
	return out
}

func (m model) getDashboardRows() []transaction {
	return filteredRows(m.rows, m.buildDashboardScopeFilter(), m.txnTags, sortByDate, false)
}

func (m model) dashboardChartRange(now time.Time) (time.Time, time.Time) {
	start, endExcl, ok := m.dashboardTimeframeBounds(now)
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
func filteredRows(rows []transaction, filter *filterNode, txnTags map[int][]tag, sortCol int, sortAsc bool) []transaction {
	var out []transaction
	for _, r := range rows {
		if !evalFilter(filter, r, txnTags[r.id]) {
			continue
		}
		out = append(out, r)
	}
	sortTransactions(out, sortCol, sortAsc)
	return out
}

func (m model) buildTransactionFilter() *filterNode {
	return andFilterNodes(m.currentInputFilterNode(), m.buildAccountScopeFilter())
}

func (m model) buildDashboardScopeFilter() *filterNode {
	accountScope := m.buildAccountScopeFilter()
	start, endExcl, ok := m.dashboardTimeframeBounds(time.Now())
	if !ok {
		return accountScope
	}
	endIncl := endExcl.AddDate(0, 0, -1)
	if endIncl.Before(start) {
		endIncl = start
	}
	timeframeNode := &filterNode{
		kind:    filterNodeField,
		field:   "date",
		op:      "..",
		valueLo: start.Format("2006-01-02"),
		valueHi: endIncl.Format("2006-01-02"),
	}
	return andFilterNodes(timeframeNode, accountScope)
}

func (m model) buildDashboardModeFilter(mode widgetMode) *filterNode {
	scope := m.buildDashboardScopeFilter()
	if strings.TrimSpace(mode.filterExpr) == "" {
		return scope
	}
	custom, err := parseFilterStrict(mode.filterExpr)
	if err != nil {
		return scope
	}
	return andFilterNodes(scope, custom)
}

func (m model) dashboardRowsForMode(mode widgetMode) []transaction {
	return filteredRows(m.rows, m.buildDashboardModeFilter(mode), m.txnTags, sortByDate, false)
}

func (m model) dashboardFocusedWidgetIndex() int {
	idx := dashboardWidgetIndexFromSection(m.focusedSection)
	if idx < 0 || idx >= len(m.dashWidgets) {
		return -1
	}
	return idx
}

func (m model) buildCustomModeFilter(paneID, modeName string) *filterNode {
	pane := strings.ToLower(strings.TrimSpace(paneID))
	name := strings.TrimSpace(modeName)
	for _, mode := range m.customPaneModes {
		if !strings.EqualFold(strings.TrimSpace(mode.Pane), pane) {
			continue
		}
		if !strings.EqualFold(strings.TrimSpace(mode.Name), name) {
			continue
		}
		node, err := parseFilterStrict(mode.Expr)
		if err != nil {
			return nil
		}
		return node
	}
	return nil
}

func (m model) buildAccountScopeFilter() *filterNode {
	if len(m.filterAccounts) == 0 {
		return nil
	}
	children := make([]*filterNode, 0, len(m.filterAccounts))
	for _, acc := range m.accounts {
		if !m.filterAccounts[acc.id] {
			continue
		}
		children = append(children, &filterNode{
			kind:  filterNodeField,
			field: "acc",
			op:    "=",
			value: strings.TrimSpace(acc.name),
		})
	}
	return orFilterNodes(children...)
}

func (m model) currentInputFilterNode() *filterNode {
	if strings.TrimSpace(m.filterInput) == "" {
		return nil
	}
	if m.filterExpr != nil {
		return m.filterExpr
	}
	node, err := parseFilter(m.filterInput)
	if err != nil {
		return fallbackPlainTextFilter(m.filterInput)
	}
	if !filterContainsFieldPredicate(node) {
		return markTextNodesAsMetadata(node)
	}
	return node
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
