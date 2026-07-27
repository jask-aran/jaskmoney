//go:build reference_gen

package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/x/ansi"
	"github.com/muesli/termenv"
)

func main() {
	// Deterministic "now" so lookback presets (1Y/3M/…) include fixture rows.
	now := time.Date(2026, 2, 18, 12, 0, 0, 0, time.Local)
	setAppNow(now)

	// Prefer truecolor so PNG rasters keep category/tag hues.
	_ = os.Setenv("COLORTERM", "truecolor")
	_ = os.Setenv("TERM", "xterm-256color")
	_ = os.Setenv("CLICOLOR_FORCE", "1")
	lipgloss.SetColorProfile(termenv.TrueColor)

	captures := []captureDef{
		// ── Dashboard timeframes (populated) ─────────────────────────────
		{
			name:  "reference-dashboard-base",
			route: "dashboard.period.month",
			setup: func(m *model) {
				applyDashboardPeriod(m, dashPeriodMonth, "2026-02-01", "Dashboard period: Month")
			},
			important: []string{"overview summary with non-zero totals", "spending tracker with braille series", "category breakdown bars", "status bar above footer", "Month preset active"},
			ignore:    []string{"exact sparkline braille characters"},
		},
		{
			name:  "reference-dashboard-period-qtr",
			route: "dashboard.period.qtr",
			setup: func(m *model) {
				// Q4 2025: Oct–Dec
				applyDashboardPeriod(m, dashPeriodQuarter, "2025-10-01", "Dashboard period: QTR")
			},
			important: []string{"QTR preset active", "timeframe spans Oct–Dec 2025", "populated charts across quarter", "status bar"},
			ignore:    []string{"exact sparkline braille characters"},
		},
		{
			name:  "reference-dashboard-lookback-1y",
			route: "dashboard.lookback.1y",
			setup: func(m *model) {
				applyDashboardLookback(m, dashTimeframe1Year, "Dashboard timeframe: 1Y")
			},
			important: []string{"1Y lookback active", "multi-month spending tracker", "status bar", "nonzero overview"},
			ignore:    []string{"exact sparkline braille characters"},
		},
		{
			name:  "reference-dashboard-lookback-3m",
			route: "dashboard.lookback.3m",
			setup: func(m *model) {
				applyDashboardLookback(m, dashTimeframe3Months, "Dashboard timeframe: 3M")
			},
			important: []string{"3M lookback active", "Dec–Feb window", "status bar"},
			ignore:    []string{"exact sparkline braille characters"},
		},
		{
			name:  "reference-dashboard-date-focus",
			route: "dashboard.date-focus",
			setup: func(m *model) {
				applyDashboardPeriod(m, dashPeriodMonth, "2026-02-01", "Date range focused. ←→ move  enter apply  esc done")
				m.dashTimeframeFocus = true
				m.focusedSection = sectionDashboardDateRange
				m.dashPresetCursor = len(dashLookbackPresets) // Month chip
			},
			important: []string{"Date-Range pane focused", "status bar with focus hint", "populated overview"},
			ignore:    nil,
		},
		{
			name:  "reference-dashboard-cashflow-focus",
			route: "dashboard.cashflow-focus",
			setup: func(m *model) {
				applyDashboardPeriod(m, dashPeriodMonth, "2026-02-01", "Cashflow pane focused.")
				m.focusedSection = sectionDashboardNetCashflow
			},
			important: []string{"Cashflow [N] pane title highlighted", "status bar"},
			ignore:    nil,
		},
		{
			name:  "reference-dashboard-composition-focus",
			route: "dashboard.composition-focus",
			setup: func(m *model) {
				applyDashboardPeriod(m, dashPeriodMonth, "2026-02-01", "Composition pane focused.")
				m.focusedSection = sectionDashboardComposition
			},
			important: []string{"Composition pane title highlighted", "status bar"},
			ignore:    nil,
		},
		{
			name:  "reference-dashboard-narrow",
			route: "dashboard.narrow",
			setup: func(m *model) {
				applyDashboardPeriod(m, dashPeriodMonth, "2026-02-01", "Dashboard period: Month")
				m.width = 70
			},
			important: []string{"70-col viewport", "analytics panes stacked", "status bar still present"},
			ignore:    nil,
		},
		{
			name:  "reference-dashboard-drill-return",
			route: "manager.transactions.drill-return",
			setup: func(m *model) {
				m.activeTab = tabManager
				m.managerMode = managerModeTransactions
				m.drillReturn = &drillReturnState{returnTab: tabDashboard}
				m.cursor = 0
				m.status = "Drilled from Dashboard · esc returns"
			},
			important: []string{"drill-return breadcrumb", "status bar message", "transactions table"},
			ignore:    nil,
		},

		// ── Manager ──────────────────────────────────────────────────────
		{
			name:  "reference-manager-base",
			route: "manager.transactions",
			setup: func(m *model) {
				m.activeTab = tabManager
				m.managerMode = managerModeTransactions
				m.cursor = 0
				m.status = fmt.Sprintf("%d transactions loaded.", len(m.rows))
			},
			important: []string{"account strip", "transaction table", "status bar with load message", "footer actions"},
			ignore:    nil,
		},
		{
			name:  "reference-manager-accounts",
			route: "manager.accounts",
			setup: func(m *model) {
				m.activeTab = tabManager
				m.managerMode = managerModeAccounts
				m.managerCursor = 0
				m.status = "Accounts focused."
			},
			important: []string{"account strip focused", "status bar"},
			ignore:    nil,
		},
		{
			name:  "reference-manager-detail",
			route: "manager.transactions.detail",
			setup: func(m *model) {
				m.activeTab = tabManager
				m.managerMode = managerModeTransactions
				m.showDetail = true
				m.detailRow = m.rows[2]
				m.detailRowValid = true
				m.detailIdx = m.rows[2].id
				m.status = "Transaction detail."
			},
			important: []string{"detail modal", "status bar", "footer edit keys"},
			ignore:    nil,
		},
		{
			name:  "reference-manager-cat-picker",
			route: "manager.transactions.cat-picker",
			setup: func(m *model) {
				m.activeTab = tabManager
				m.managerMode = managerModeTransactions
				m.cursor = 2
				items := make([]pickerItem, 0, len(m.categories))
				for _, c := range m.categories {
					items = append(items, pickerItem{ID: c.id, Label: c.name, Color: c.color})
				}
				m.catPicker = newPicker("Quick Categorize", items, false, "")
				m.catPicker.cursorOnly = true
				m.status = "Quick categorize · Antipasti"
			},
			important: []string{"Quick Categorize modal", "category list with colors", "filter input", "status bar above footer", "modal footer actions"},
			ignore:    nil,
		},
		{
			name:  "reference-manager-tag-picker",
			route: "manager.transactions.tag-picker",
			setup: func(m *model) {
				m.activeTab = tabManager
				m.managerMode = managerModeTransactions
				m.cursor = 0
				m.tagPicker = buildTagPicker(m)
				m.tagPicker.selected = map[int]bool{4: true, 7: true}
				m.tagPicker.baseSelected = map[int]bool{4: true, 7: true}
				m.status = "Quick tags · UBER *TRIP"
			},
			important: []string{"simple on/off checkboxes", "scoped/global grouping", "CAR+FUEL selected", "status bar"},
			ignore:    nil,
		},
		{
			name:  "reference-manager-tag-picker-mixed",
			route: "manager.transactions.tag-picker-mixed",
			setup: func(m *model) {
				m.activeTab = tabManager
				m.managerMode = managerModeTransactions
				m.cursor = 0
				m.tagPicker = buildTagPicker(m)
				m.tagPicker.SetTriState(map[int]pickerCheckState{
					1: pickerStateAll, 2: pickerStateNone, 3: pickerStateNone,
					4: pickerStateSome, 5: pickerStateAll, 6: pickerStateNone,
					7: pickerStateAll, 8: pickerStateNone, 9: pickerStateSome,
					10: pickerStateNone,
				})
				m.tagPicker.dirty = map[int]bool{4: true, 9: true}
				m.status = "Quick tags · mixed selection (multi-row)"
			},
			important: []string{"tri-state checkboxes blank/check/fill", "dirty mixed state", "status bar"},
			ignore:    nil,
		},
		{
			name:  "reference-manager-allocation",
			route: "manager.transactions.allocation",
			setup: func(m *model) {
				m.activeTab = tabManager
				m.managerMode = managerModeTransactions
				m.cursor = 1
				m.allocationModalOpen = true
				m.allocationParentID = 2
				m.allocationEditID = 0
				m.allocationAmount = "50"
				m.allocationAmountCur = 2
				m.allocationNote = "for groceries"
				m.allocationNoteCur = 10
				m.allocationModalFocus = 0
				m.status = "Create allocation."
			},
			important: []string{"Create allocation modal", "amount+note fields", "status bar"},
			ignore:    nil,
		},
		{
			name:  "reference-manager-allocation-child-selected",
			route: "manager.transactions.allocation-child",
			setup: func(m *model) {
				m.activeTab = tabManager
				m.managerMode = managerModeTransactions
				parent := m.rows[1]
				child1 := transaction{
					id: -1, isAllocation: true, parentTxnID: parent.id, allocationID: 100,
					dateISO: parent.dateISO, amount: -30.00, fullAmount: parent.amount,
					description: "Split: fruit & veg", categoryName: "Groceries", categoryID: intPtr(2),
					accountName: parent.accountName,
				}
				child2 := transaction{
					id: -2, isAllocation: true, parentTxnID: parent.id, allocationID: 101,
					dateISO: parent.dateISO, amount: -72.50, fullAmount: parent.amount,
					description: "Split: meats", categoryName: "Groceries", categoryID: intPtr(2),
					accountName: parent.accountName,
				}
				newRows := make([]transaction, 0, len(m.rows)+2)
				newRows = append(newRows, m.rows[:2]...)
				newRows = append(newRows, child1, child2)
				newRows = append(newRows, m.rows[2:]...)
				m.rows = newRows
				m.cursor = 2
				m.selectedRows = map[int]bool{-1: true}
				m.status = "Allocation child selected."
			},
			important: []string{"↳ child rows", "selection on child", "status bar"},
			ignore:    nil,
		},
		{
			name:  "reference-manager-range-highlight",
			route: "manager.transactions.range",
			setup: func(m *model) {
				m.activeTab = tabManager
				m.managerMode = managerModeTransactions
				m.cursor = 3
				m.selectedRows = map[int]bool{3: true, 4: true, 5: true, 6: true, 7: true}
				m.rangeSelecting = true
				m.rangeAnchorID = 7
				m.rangeCursorID = 3
				m.status = "Range select: 5 rows"
			},
			important: []string{"three visual tiers", "selection count in status", "header selection count"},
			ignore:    nil,
		},
		{
			name:  "reference-manager-filter",
			route: "manager.transactions.filter",
			setup: func(m *model) {
				m.activeTab = tabManager
				m.managerMode = managerModeTransactions
				m.filterInputMode = true
				m.filterInput = "coffee"
				m.filterInputCursor = 6
				m.status = "Filter editing."
			},
			important: []string{"filter bar", "cursor in input", "status bar"},
			ignore:    nil,
		},
		{
			name:  "reference-manager-filter-picker",
			route: "manager.transactions.filter-picker",
			setup: func(m *model) {
				m.activeTab = tabManager
				m.managerMode = managerModeTransactions
				m.filterApplyPicker = newPicker(
					"Load Saved Filter",
					[]pickerItem{
						{ID: 0, Label: "Groceries only"},
						{ID: 1, Label: "Income > 100"},
						{ID: 2, Label: "Transport + Car"},
					},
					false, "",
				)
				m.status = "Load saved filter."
			},
			important: []string{"saved filter list", "status bar"},
			ignore:    nil,
		},
		{
			name:  "reference-manager-account-modal",
			route: "manager.accounts.modal",
			setup: func(m *model) {
				m.activeTab = tabManager
				m.managerMode = managerModeAccounts
				m.managerCursor = 0
				m.managerModalOpen = true
				m.managerModalIsNew = true
				m.managerEditName = "Savings Account"
				m.managerEditNameCur = 15
				m.managerEditType = "transaction"
				m.managerEditPrefix = "SAV"
				m.managerEditPrefixCur = 3
				m.managerEditActive = true
				m.managerEditFocus = 0
				m.status = "Create account."
			},
			important: []string{"Create Account modal", "status bar"},
			ignore:    nil,
		},
		{
			name:  "reference-dry-run-results",
			route: "manager.dry-run",
			setup: func(m *model) {
				m.activeTab = tabManager
				m.managerMode = managerModeTransactions
				m.rows = []transaction{
					{id: 101, dateISO: "2026-02-17", amount: -24.23, description: "UBER *TRIP, Sydney", categoryName: "Uncategorised"},
					{id: 102, dateISO: "2026-02-15", amount: -102.50, description: "WOOLWORTHS 3391, SPOTSWOOD", categoryName: "Uncategorised"},
					{id: 103, dateISO: "2026-02-13", amount: -66.46, description: "Antipasti", categoryName: "Uncategorised"},
					{id: 104, dateISO: "2026-02-12", amount: -204.00, description: "FINES VIC", categoryName: "Uncategorised"},
				}
				m.dryRunOpen = true
				m.dryRunScopeLabel = "All transactions (4)"
				m.dryRunSummary = dryRunSummary{totalModified: 3, totalCatChange: 3, totalTagChange: 2, failedRules: 0}
				m.dryRunResults = []dryRunRuleResult{
					{
						rule: ruleV2{id: 1, name: "Transport → Ubers", enabled: true},
						filterExpr: "description contains 'UBER'", filterName: "uber-descs",
						matchCount: 2, catChanges: 2,
						samples: []dryRunSample{
							{txn: transaction{dateISO: "2026-02-17", amount: -24.23, description: "UBER *TRIP, Sydney"}, currentCat: "Uncategorised", newCat: "Transport"},
							{txn: transaction{dateISO: "2026-02-12", amount: -204.00, description: "FINES VIC"}, currentCat: "Uncategorised", newCat: "Transport"},
						},
					},
					{
						rule: ruleV2{id: 2, name: "Groceries → Woolies", enabled: true},
						filterExpr: "description contains 'WOOLWORTHS'", filterName: "woolies",
						matchCount: 1, catChanges: 1, tagChanges: 2,
						samples: []dryRunSample{
							{txn: transaction{dateISO: "2026-02-15", amount: -102.50, description: "WOOLWORTHS 3391, SPOTSWOOD"}, currentCat: "Uncategorised", newCat: "Groceries", addedTags: []string{"WORKDAY", "ESSENTIALS"}},
						},
					},
				}
				m.status = "Dry-run complete: 3 modified."
			},
			important: []string{"dry-run modal summary", "per-rule samples", "status bar"},
			ignore:    nil,
		},

		// ── Budget (kept; not expanded further) ──────────────────────────
		{
			name:  "reference-budget-table",
			route: "budget.table",
			setup: func(m *model) {
				m.activeTab = tabBudget
				m.budgetView = 0
				m.budgetEditing = false
				m.budgetCursor = 0
				m.budgetDeleteArmedTarget = 0
				m.status = "Budget table."
			},
			important: []string{"category budget rows", "compare bars", "status bar"},
			ignore:    nil,
		},
		{
			name:  "reference-budget-planner",
			route: "budget.planner",
			setup: func(m *model) {
				m.activeTab = tabBudget
				m.budgetView = 1
				m.budgetCursor = 0
				m.budgetPlannerCol = 0
				m.status = "Budget planner."
			},
			important: []string{"planner calendar grid", "status bar"},
			ignore:    nil,
		},
		{
			name:  "reference-budget-edit",
			route: "budget.table.edit",
			setup: func(m *model) {
				m.activeTab = tabBudget
				m.budgetView = 0
				m.budgetCursor = 1
				m.budgetEditing = true
				m.budgetEditValue = "600"
				m.budgetEditCursor = 3
				m.budgetEditReplaceOnType = true
				m.status = "Editing budget amount."
			},
			important: []string{"inline edit brackets", "status bar"},
			ignore:    nil,
		},
		{
			name:  "reference-budget-delete-armed",
			route: "budget.table.delete-armed",
			setup: func(m *model) {
				m.activeTab = tabBudget
				m.budgetView = 0
				m.budgetEditing = false
				m.budgetCursor = 1
				if len(m.categoryBudgets) > 0 {
					m.budgetDeleteArmedTarget = m.categoryBudgets[0].id
				}
				m.status = "Delete budget? press del again to confirm"
			},
			important: []string{"delete-armed footer/status", "cursor on budget row"},
			ignore:    nil,
		},

		// ── Import ───────────────────────────────────────────────────────
		{
			name:  "reference-import-picker",
			route: "manager.import-picker",
			setup: func(m *model) {
				m.activeTab = tabManager
				m.managerMode = managerModeTransactions
				m.importPicking = true
				m.importFiles = []string{"UP 2025-2026.csv", "ANZ.csv", "ANZ DUPE.csv"}
				m.importCursor = 1
				m.status = "Choose a file to import."
			},
			important: []string{"file picker", "status bar"},
			ignore:    nil,
		},
		{
			name:  "reference-import-preview",
			route: "manager.import-preview",
			setup: func(m *model) {
				m.activeTab = tabManager
				m.managerMode = managerModeTransactions
				m.importPreviewOpen = true
				m.importPreviewPostRules = true
				m.importPreviewShowAll = false
				m.importPreviewCursor = 0
				m.importPreviewScroll = 0
				m.importPreviewSnapshot = &importPreviewSnapshot{
					fileName:   "ANZ.csv",
					totalRows:  112,
					newCount:   65,
					dupeCount:  45,
					errorCount: 2,
					rows: func() []importPreviewRow {
						rows := make([]importPreviewRow, 0, 45)
						for i := 0; i < 45; i++ {
							rows = append(rows, importPreviewRow{
								index: i + 1, sourceLine: i + 1,
								dateISO:     fmt.Sprintf("2026-02-%02d", (i%28)+1),
								amount:      -float64((i%50)+1) * 2.5,
								description: fmt.Sprintf("Row %d transaction", i+1),
								isDupe:      (i % 2) == 0,
								previewCat:  "Groceries",
								previewTags: []string{"WORKDAY"},
							})
						}
						return rows
					}(),
					parseErrors: []importPreviewParseError{
						{rowIndex: 87, sourceLine: 89, field: "date", message: "unrecognised date format 'Feb 15 26'"},
						{rowIndex: 93, sourceLine: 95, field: "amount", message: "missing value"},
					},
				}
				m.status = "Import preview · 2 parse errors block import"
			},
			important: []string{"preview summary", "error banner", "status bar"},
			ignore:    []string{"exact row descriptions"},
		},

		// ── Navigation overlays ──────────────────────────────────────────
		{
			name:  "reference-jump-mode",
			route: "manager.jump",
			setup: func(m *model) {
				m.activeTab = tabManager
				m.managerMode = managerModeTransactions
				m.jumpModeActive = true
				m.focusedSection = sectionUnfocused
				m.status = "Jump mode · press target letter"
			},
			important: []string{"jump badges", "status bar"},
			ignore:    nil,
		},
		{
			name:  "reference-jump-mode-settings",
			route: "settings.jump",
			setup: func(m *model) {
				m.activeTab = tabSettings
				m.settColumn = settColLeft
				m.settSection = settSecCategories
				m.settActive = false
				m.jumpModeActive = true
				m.focusedSection = sectionUnfocused
				m.status = "Jump mode · Settings"
			},
			important: []string{"6 jump targets on Settings", "status bar"},
			ignore:    nil,
		},
		{
			name:  "reference-command-palette",
			route: "manager.palette",
			setup: func(m *model) {
				m.activeTab = tabManager
				m.managerMode = managerModeTransactions
				m.commandOpen = true
				m.commandUIKind = commandUIKindPalette
				m.commandQuery = ""
				m.commandCursor = 0
				m.commandPageSize = 10
				m.status = "Command palette"
			},
			important: []string{"palette overlay", "status bar"},
			ignore:    nil,
		},
		{
			name:  "reference-colon-mode",
			route: "manager.colon",
			setup: func(m *model) {
				m.activeTab = tabManager
				m.managerMode = managerModeTransactions
				m.commandOpen = true
				m.commandUIKind = commandUIKindColon
				m.commandQuery = ":"
				m.commandCursor = 0
				m.commandPageSize = 5
				m.status = "Colon command mode"
			},
			important: []string{"colon footer", "suggestions", "status bar"},
			ignore:    nil,
		},

		// ── Settings ─────────────────────────────────────────────────────
		{
			name:  "reference-settings-base",
			route: "settings.nav",
			setup: func(m *model) {
				m.activeTab = tabSettings
				m.settColumn = settColLeft
				m.settSection = settSecCategories
				m.settActive = false
				m.confirmAction = confirmActionNone
				m.status = "Settings · navigate sections"
			},
			important: []string{"left/right cards", "status bar"},
			ignore:    nil,
		},
		{
			name:  "reference-settings-cats-active",
			route: "settings.categories.active",
			setup: func(m *model) {
				m.activeTab = tabSettings
				m.settColumn = settColLeft
				m.settSection = settSecCategories
				m.settActive = true
				m.settItemCursor = 2
				m.status = "Categories active."
			},
			important: []string{"* active marker", "cursor on third category", "status bar"},
			ignore:    nil,
		},
		{
			name:  "reference-settings-tags-active",
			route: "settings.tags.active",
			setup: func(m *model) {
				m.activeTab = tabSettings
				m.settColumn = settColLeft
				m.settSection = settSecTags
				m.settActive = true
				m.settItemCursor = 0
				m.status = "Tags active."
			},
			important: []string{"* active marker", "scoped tag refs", "status bar"},
			ignore:    nil,
		},
		{
			name:  "reference-settings-rules-list",
			route: "settings.rules.active",
			setup: func(m *model) {
				m.activeTab = tabSettings
				m.settColumn = settColLeft
				m.settSection = settSecRules
				m.settActive = true
				m.settItemCursor = 0
				m.status = "Rules active · empty"
			},
			important: []string{"empty rules message", "status bar"},
			ignore:    nil,
		},
		{
			name:  "reference-settings-rules-editor",
			route: "settings.rules.editor",
			setup: func(m *model) {
				m.activeTab = tabSettings
				m.settColumn = settColLeft
				m.settSection = settSecRules
				m.settActive = false
				m.ruleEditorOpen = true
				m.ruleEditorStep = 1
				m.ruleEditorName = ""
				m.ruleEditorNameCur = 0
				m.ruleEditorEnabled = true
				m.ruleEditorAddTags = nil
				m.status = "New rule · step 1/…"
			},
			important: []string{"rule editor step 1", "status bar"},
			ignore:    nil,
		},
		{
			name:  "reference-settings-filters-editor",
			route: "settings.filters.editor",
			setup: func(m *model) {
				m.activeTab = tabSettings
				m.settColumn = settColLeft
				m.settSection = settSecFilters
				m.settActive = false
				m.filterEditOpen = true
				m.filterEditIsNew = true
				m.filterEditID = "filter-1"
				m.filterEditIDCur = 8
				m.filterEditName = ""
				m.filterEditNameCur = 0
				m.filterEditExpr = "category == 'Groceries'"
				m.filterEditExprCur = 24
				m.filterEditFocus = 2
				m.filterEditErr = ""
				m.status = "Edit saved filter."
			},
			important: []string{"expression ok", "status bar"},
			ignore:    nil,
		},
		{
			name:  "reference-settings-filters-editor-invalid",
			route: "settings.filters.editor-invalid",
			setup: func(m *model) {
				m.activeTab = tabSettings
				m.settColumn = settColLeft
				m.settSection = settSecFilters
				m.settActive = false
				m.filterEditOpen = true
				m.filterEditIsNew = true
				m.filterEditID = "bad-filter"
				m.filterEditIDCur = 10
				m.filterEditName = "Broken Rule"
				m.filterEditNameCur = 11
				m.filterEditExpr = "category = Groceries"
				m.filterEditExprCur = 21
				m.filterEditFocus = 2
				m.filterEditErr = "expected ==, found = at position 9; use == for equality"
				m.status = "Filter expression invalid."
				m.statusErr = true
			},
			important: []string{"error banner in modal", "status bar error style"},
			ignore:    nil,
		},
	}

	outDir := "docs"
	if err := os.MkdirAll(outDir, 0o755); err != nil {
		fmt.Fprintf(os.Stderr, "ERROR creating %s: %v\n", outDir, err)
		os.Exit(1)
	}

	for _, c := range captures {
		m := baseFixture(now)
		c.setup(&m)

		raw := m.View()

		// Enforce exact viewport height (status + footer must stay).
		rawLines := strings.Split(raw, "\n")
		if len(rawLines) != m.height {
			fmt.Fprintf(os.Stderr, "WARN: %s output=%d lines, viewport=%d\n", c.name, len(rawLines), m.height)
			if len(rawLines) < m.height {
				raw += strings.Repeat("\n", m.height-len(rawLines))
			} else {
				raw = strings.Join(rawLines[:m.height], "\n")
			}
		}

		ansiPath := filepath.Join(outDir, c.name+".ansi")
		if err := os.WriteFile(ansiPath, []byte(raw), 0o644); err != nil {
			fmt.Fprintf(os.Stderr, "ERROR writing %s: %v\n", ansiPath, err)
			continue
		}
		txt := ansi.Strip(raw)
		txtPath := filepath.Join(outDir, c.name+".txt")
		if err := os.WriteFile(txtPath, []byte(txt), 0o644); err != nil {
			fmt.Fprintf(os.Stderr, "ERROR writing %s: %v\n", txtPath, err)
			continue
		}
		fmt.Printf("OK  %-48s  status=%q\n", c.name, m.status)
	}

	fmt.Printf("\nDone. %d captures → %s/\n", len(captures), outDir)
}

type captureDef struct {
	name      string
	route     string
	setup     func(m *model)
	important []string
	ignore    []string
}

func applyDashboardPeriod(m *model, period dashPeriodType, anchor, status string) {
	m.activeTab = tabDashboard
	m.dashWidgets = newDashboardWidgets(nil)
	m.dashPresetActive = dashPresetPeriod
	m.dashPeriodActive = period
	m.dashPeriodAnchor = anchor
	m.dashTimeframeFocus = false
	m.focusedSection = sectionUnfocused
	m.status = status
	m.statusErr = false
}

func applyDashboardLookback(m *model, timeframe int, status string) {
	m.activeTab = tabDashboard
	m.dashWidgets = newDashboardWidgets(nil)
	m.dashPresetActive = dashPresetLookback
	m.dashTimeframe = timeframe
	m.dashTimeframeFocus = false
	m.focusedSection = sectionUnfocused
	m.status = status
	m.statusErr = false
}

func buildTagPicker(m *model) *pickerState {
	items := make([]pickerItem, 0, len(m.tags))
	for _, tg := range m.tags {
		section := "Global"
		if tg.categoryID != nil {
			section = "Scoped"
		}
		items = append(items, pickerItem{
			ID: tg.id, Label: tg.name, Color: tg.color, Section: section,
		})
	}
	p := newPicker("Quick Tags", items, true, "Create")
	p.cursorOnly = true
	return p
}

// baseFixture returns a model with deterministic multi-month fixture data.
func baseFixture(now time.Time) model {
	m := newModel()
	m.ready = true
	m.width = 140
	m.height = 44
	m.keys = NewKeyRegistry()
	m.commands = NewCommandRegistry(m.keys, nil)
	m.status = ""
	m.statusErr = false

	m.categories = []category{
		{id: 1, name: "Income", color: "#a6e3a1"},
		{id: 2, name: "Groceries", color: "#94e2d5"},
		{id: 3, name: "Dining & Drinks", color: "#fab387"},
		{id: 4, name: "Transport", color: "#89b4fa"},
		{id: 5, name: "Bills & Utilities", color: "#f38ba8"},
		{id: 6, name: "Entertainment", color: "#cba6f7"},
		{id: 7, name: "Shopping", color: "#f5c2e7"},
		{id: 8, name: "Health", color: "#eba0ac"},
		{id: 9, name: "Transfers", color: "#b4befe"},
		{id: 10, name: "Uncategorised", color: "#7f849c"},
	}
	m.accounts = []account{
		{id: 1, name: "ANZ CREDIT", acctType: "credit", isActive: true},
		{id: 2, name: "UP DEBIT", acctType: "debit", isActive: true},
	}
	m.tags = []tag{
		{id: 1, name: "IGNORE"},
		{id: 2, name: "WORKDAY"},
		{id: 3, name: "PT"},
		{id: 4, name: "CAR"},
		{id: 5, name: "REIMBURSABLE"},
		{id: 6, name: "GIFTS"},
		{id: 7, name: "FUEL"},
		{id: 8, name: "GEORGIA"},
		{id: 9, name: "FAST FOOD", categoryID: intPtr(3)},
		{id: 10, name: "TRAVEL"},
	}

	// Multi-month fixture spanning Oct 2025 → Feb 2026 so Month/QTR/3M/1Y
	// all show non-empty charts under frozen now=2026-02-18.
	m.rows = fixtureTransactions()
	m.txnTags = map[int][]tag{
		1: {{id: 4, name: "CAR"}},
		2: {{id: 7, name: "FUEL"}},
		3: {{id: 9, name: "FAST FOOD"}},
		6: {{id: 5, name: "REIMBURSABLE"}},
		8: {{id: 4, name: "CAR"}, {id: 7, name: "FUEL"}},
	}

	m.dbInfo = dbInfo{
		schemaVersion: 7, transactionCount: len(m.rows), categoryCount: 10,
		ruleCount: 0, tagCount: 10, tagRuleCount: 0, importCount: 3, accountCount: 2,
	}
	m.maxVisibleRows = 20
	m.imports = []importRecord{
		{filename: "UP 2025-2026.csv", rowCount: 365, importedAt: "2026-02-18 11:41:19"},
		{filename: "ANZ.csv", rowCount: 112, importedAt: "2026-02-17 00:39:38"},
		{filename: "ANZ DUPE.csv", rowCount: 47, importedAt: "2026-02-15 21:31:34"},
	}

	m.activeTab = tabDashboard
	m.dashWidgets = newDashboardWidgets(nil)
	m.dashPresetActive = dashPresetPeriod
	m.dashPeriodActive = dashPeriodMonth
	m.dashPeriodAnchor = "2026-02-01"
	m.dashTimeframe = dashTimeframeThisMonth
	m.dashAnchorMonth = now.Format("2006-01")

	m.budgetMonth = now.Format("2006-01")
	m.budgetYear = now.Year()
	m.categoryBudgets = []categoryBudget{
		{id: 1, categoryID: 2, amount: 600},
		{id: 2, categoryID: 3, amount: 400},
		{id: 3, categoryID: 4, amount: 200},
	}
	m.budgetLines = []budgetLine{
		{categoryName: "Total", budgeted: 1200, spent: 470, remaining: 730},
		{categoryName: "Groceries", budgeted: 600, spent: 185, remaining: 415, categoryColor: "#94e2d5"},
		{categoryName: "Dining & Drinks", budgeted: 400, spent: 215, remaining: 185, categoryColor: "#fab387"},
		{categoryName: "Transport", budgeted: 200, spent: 70, remaining: 130, categoryColor: "#89b4fa"},
	}
	return m
}

// fixtureTransactions builds a deterministic multi-month set.
// First 20 rows keep the classic Feb manager-table identities (ids 1–20).
func fixtureTransactions() []transaction {
	feb := []transaction{
		{id: 1, dateISO: "2026-02-17", amount: -24.23, description: "UBER *TRIP, Sydney", accountName: "UP DEBIT", categoryName: "Transport", categoryID: intPtr(4)},
		{id: 2, dateISO: "2026-02-17", amount: -102.50, description: "WOOLWORTHS 3391, SPOTSWOOD", accountName: "UP DEBIT", categoryName: "Groceries", categoryID: intPtr(2)},
		{id: 3, dateISO: "2026-02-16", amount: -66.46, description: "Antipasti", accountName: "UP DEBIT", categoryName: "Dining & Drinks", categoryID: intPtr(3)},
		{id: 4, dateISO: "2026-02-15", amount: -204.00, description: "FINES VIC", accountName: "UP DEBIT", categoryName: "Bills & Utilities", categoryID: intPtr(5)},
		{id: 5, dateISO: "2026-02-14", amount: -12.99, description: "NETFLIX.COM", accountName: "ANZ CREDIT", categoryName: "Entertainment", categoryID: intPtr(6)},
		{id: 6, dateISO: "2026-02-14", amount: 1500.00, description: "SALARY FEB", accountName: "ANZ CREDIT", categoryName: "Income", categoryID: intPtr(1)},
		{id: 7, dateISO: "2026-02-13", amount: -55.30, description: "DAN MURPHYS, MELBOURNE", accountName: "UP DEBIT", categoryName: "Dining & Drinks", categoryID: intPtr(3)},
		{id: 8, dateISO: "2026-02-12", amount: -34.50, description: "7-ELEVEN FUEL, RICHMOND", accountName: "UP DEBIT", categoryName: "Transport", categoryID: intPtr(4)},
		{id: 9, dateISO: "2026-02-11", amount: -89.00, description: "CHEMIST WAREHOUSE", accountName: "UP DEBIT", categoryName: "Health", categoryID: intPtr(8)},
		{id: 10, dateISO: "2026-02-10", amount: -26.93, description: "WOOLWORTHS 3391, SPOTSWOOD", accountName: "UP DEBIT", categoryName: "Groceries", categoryID: intPtr(2)},
		{id: 11, dateISO: "2026-02-10", amount: -120.00, description: "ELECTRICITY BILL", accountName: "ANZ CREDIT", categoryName: "Bills & Utilities", categoryID: intPtr(5)},
		{id: 12, dateISO: "2026-02-09", amount: -42.50, description: "UBER EATS, MACCAS", accountName: "UP DEBIT", categoryName: "Dining & Drinks", categoryID: intPtr(3)},
		{id: 13, dateISO: "2026-02-08", amount: -15.00, description: "SPOTIFY PREMIUM", accountName: "ANZ CREDIT", categoryName: "Entertainment", categoryID: intPtr(6)},
		{id: 14, dateISO: "2026-02-07", amount: 2500.00, description: "SALARY JAN", accountName: "ANZ CREDIT", categoryName: "Income", categoryID: intPtr(1)},
		{id: 15, dateISO: "2026-02-06", amount: -65.00, description: "GAS BILL", accountName: "ANZ CREDIT", categoryName: "Bills & Utilities", categoryID: intPtr(5)},
		{id: 16, dateISO: "2026-02-05", amount: -78.30, description: "KMART, SPOTSWOOD", accountName: "UP DEBIT", categoryName: "Shopping", categoryID: intPtr(7)},
		{id: 17, dateISO: "2026-02-04", amount: -200.00, description: "TRANSFER TO SAVINGS", accountName: "UP DEBIT", categoryName: "Transfers", categoryID: intPtr(9)},
		{id: 18, dateISO: "2026-02-03", amount: -8.50, description: "COFFEE, LOCAL", accountName: "UP DEBIT", categoryName: "Dining & Drinks", categoryID: intPtr(3)},
		{id: 19, dateISO: "2026-02-02", amount: -95.00, description: "OPTUS BILL", accountName: "ANZ CREDIT", categoryName: "Bills & Utilities", categoryID: intPtr(5)},
		{id: 20, dateISO: "2026-02-01", amount: -22.10, description: "MYKI TOP UP", accountName: "UP DEBIT", categoryName: "Transport", categoryID: intPtr(4)},
	}

	// Older months for charts. Deterministic amounts via simple formula.
	type seed struct {
		date, desc, acct, cat string
		catID                 int
		amount                float64
	}
	extraSeeds := []seed{
		// Jan 2026
		{"2026-01-28", "WOOLWORTHS 3391", "UP DEBIT", "Groceries", 2, -84.20},
		{"2026-01-25", "SALARY JAN MID", "ANZ CREDIT", "Income", 1, 1500.00},
		{"2026-01-22", "UBER *TRIP", "UP DEBIT", "Transport", 4, -31.40},
		{"2026-01-18", "JB HI-FI", "ANZ CREDIT", "Shopping", 7, -249.00},
		{"2026-01-15", "RENT JANUARY", "UP DEBIT", "Bills & Utilities", 5, -1850.00},
		{"2026-01-12", "COLES EXPRESS", "UP DEBIT", "Transport", 4, -62.10},
		{"2026-01-08", "MCDONALDS", "UP DEBIT", "Dining & Drinks", 3, -18.90},
		{"2026-01-05", "OPTUS BILL", "ANZ CREDIT", "Bills & Utilities", 5, -95.00},
		{"2026-01-03", "COFFEE, LOCAL", "UP DEBIT", "Dining & Drinks", 3, -7.50},
		// Dec 2025
		{"2025-12-28", "XMAS SHOPPING", "ANZ CREDIT", "Shopping", 7, -420.00},
		{"2025-12-24", "DAN MURPHYS", "UP DEBIT", "Dining & Drinks", 3, -112.40},
		{"2025-12-20", "SALARY DEC", "ANZ CREDIT", "Income", 1, 2500.00},
		{"2025-12-15", "RENT DECEMBER", "UP DEBIT", "Bills & Utilities", 5, -1850.00},
		{"2025-12-12", "UBER EATS", "UP DEBIT", "Dining & Drinks", 3, -44.20},
		{"2025-12-08", "WOOLWORTHS", "UP DEBIT", "Groceries", 2, -96.30},
		{"2025-12-04", "MYKI TOP UP", "UP DEBIT", "Transport", 4, -30.00},
		{"2025-12-01", "NETFLIX.COM", "ANZ CREDIT", "Entertainment", 6, -12.99},
		// Nov 2025
		{"2025-11-28", "BLACK FRIDAY GEAR", "ANZ CREDIT", "Shopping", 7, -389.00},
		{"2025-11-22", "SALARY NOV", "ANZ CREDIT", "Income", 1, 2500.00},
		{"2025-11-18", "PETROL SHELL", "UP DEBIT", "Transport", 4, -71.20},
		{"2025-11-15", "RENT NOVEMBER", "UP DEBIT", "Bills & Utilities", 5, -1850.00},
		{"2025-11-10", "ALDI GROCERIES", "UP DEBIT", "Groceries", 2, -64.80},
		{"2025-11-05", "CINEMA TICKETS", "UP DEBIT", "Entertainment", 6, -42.00},
		// Oct 2025 (Q4 start)
		{"2025-10-28", "HALLOWEEN PARTY", "UP DEBIT", "Dining & Drinks", 3, -88.00},
		{"2025-10-22", "SALARY OCT", "ANZ CREDIT", "Income", 1, 2500.00},
		{"2025-10-18", "MECHANIC REPAIR", "UP DEBIT", "Transport", 4, -340.00},
		{"2025-10-15", "RENT OCTOBER", "UP DEBIT", "Bills & Utilities", 5, -1850.00},
		{"2025-10-10", "WOOLWORTHS", "UP DEBIT", "Groceries", 2, -73.40},
		{"2025-10-05", "SPOTIFY PREMIUM", "ANZ CREDIT", "Entertainment", 6, -15.00},
		{"2025-10-02", "COFFEE, LOCAL", "UP DEBIT", "Dining & Drinks", 3, -6.50},
		// Sep 2025 (for 6M/1Y depth)
		{"2025-09-20", "SALARY SEP", "ANZ CREDIT", "Income", 1, 2500.00},
		{"2025-09-15", "RENT SEPTEMBER", "UP DEBIT", "Bills & Utilities", 5, -1800.00},
		{"2025-09-08", "IKEA", "ANZ CREDIT", "Shopping", 7, -210.00},
		// Aug 2025
		{"2025-08-20", "SALARY AUG", "ANZ CREDIT", "Income", 1, 2500.00},
		{"2025-08-15", "RENT AUGUST", "UP DEBIT", "Bills & Utilities", 5, -1800.00},
		{"2025-08-05", "FLIGHTS SYD-MEL", "ANZ CREDIT", "Transport", 4, -189.00},
	}

	out := make([]transaction, 0, len(feb)+len(extraSeeds))
	out = append(out, feb...)
	nextID := 21
	for _, s := range extraSeeds {
		out = append(out, transaction{
			id: nextID, dateISO: s.date, amount: s.amount, description: s.desc,
			accountName: s.acct, categoryName: s.cat, categoryID: intPtr(s.catID),
		})
		nextID++
	}
	return out
}

func intPtr(n int) *int { return &n }
