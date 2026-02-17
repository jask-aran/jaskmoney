package main

import (
	"fmt"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case dbReadyMsg:
		return m.handleDBReady(msg)
	case refreshDoneMsg:
		return m.handleRefreshDone(msg)
	case filesLoadedMsg:
		return m.handleFilesLoaded(msg)
	case importPreviewMsg:
		return m.handleImportPreview(msg)
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
		m.setStatus("Transaction updated.")
		m.closeDetail()
		return m, refreshCmd(m.db)
	case categorySavedMsg:
		if msg.err != nil {
			m.setError(fmt.Sprintf("Category save failed: %v", msg.err))
			return m, nil
		}
		m.settMode = settModeNone
		m.settInput = ""
		m.settInputCursor = 0
		m.setStatus("Category saved.")
		return m, refreshCmd(m.db)
	case categoryDeletedMsg:
		if msg.err != nil {
			m.setError(fmt.Sprintf("Delete failed: %v", msg.err))
			return m, nil
		}
		m.clearSettingsConfirm()
		m.setStatus("Category deleted.")
		return m, refreshCmd(m.db)
	case tagSavedMsg:
		if msg.err != nil {
			m.setError(fmt.Sprintf("Tag save failed: %v", msg.err))
			return m, nil
		}
		m.settMode = settModeNone
		m.settInput = ""
		m.settInputCursor = 0
		m.setStatus("Tag saved.")
		return m, refreshCmd(m.db)
	case tagDeletedMsg:
		if msg.err != nil {
			m.setError(fmt.Sprintf("Delete failed: %v", msg.err))
			return m, nil
		}
		m.clearSettingsConfirm()
		m.setStatus("Tag deleted.")
		return m, refreshCmd(m.db)
	case ruleSavedMsg:
		if msg.err != nil {
			m.setError(fmt.Sprintf("Rule save failed: %v", msg.err))
			return m, nil
		}
		m.ruleEditorOpen = false
		m.ruleEditorErr = ""
		m.setStatus("Rule saved.")
		return m, refreshCmd(m.db)
	case ruleDeletedMsg:
		if msg.err != nil {
			m.setError(fmt.Sprintf("Delete failed: %v", msg.err))
			return m, nil
		}
		m.clearSettingsConfirm()
		m.setStatus("Rule deleted.")
		return m, refreshCmd(m.db)
	case rulesAppliedMsg:
		if msg.err != nil {
			m.setError(fmt.Sprintf("Apply rules failed: %v", msg.err))
			return m, nil
		}
		scope := strings.TrimSpace(msg.scope)
		if scope == "" {
			scope = "All Accounts"
		}
		m.setStatus(formatRulesSummary(scope, msg.updatedTxns, msg.catChanges, msg.tagChanges, msg.failedRules))
		return m, refreshCmd(m.db)
	case rulesDryRunMsg:
		if msg.err != nil {
			m.setError(fmt.Sprintf("Dry-run failed: %v", msg.err))
			return m, nil
		}
		m.dryRunOpen = true
		m.dryRunResults = msg.results
		m.dryRunSummary = msg.summary
		m.dryRunSummary.failedRules = msg.failedRules
		m.dryRunScopeLabel = msg.scope
		m.dryRunScroll = 0
		if strings.TrimSpace(m.dryRunScopeLabel) == "" {
			m.dryRunScopeLabel = "All Accounts"
		}
		m.setStatusf("Dry-run ready (%s).", m.dryRunScopeLabel)
		return m, nil
	case settingsSavedMsg:
		if msg.err != nil {
			m.setError(fmt.Sprintf("Save settings failed: %v", msg.err))
		}
		return m, nil
	case keybindingsResetMsg:
		if msg.err != nil {
			m.setError(fmt.Sprintf("Reset keybindings failed: %v", msg.err))
			return m, nil
		}
		bindings, err := loadKeybindingsConfig()
		if err != nil {
			m.setError(fmt.Sprintf("Reload keybindings failed: %v", err))
			return m, nil
		}
		keys := NewKeyRegistry()
		if err := keys.ApplyKeybindingConfig(bindings); err != nil {
			m.setError(fmt.Sprintf("Apply keybindings failed: %v", err))
			return m, nil
		}
		m.keys = keys
		m.commands = NewCommandRegistry(keys, m.savedFilters)
		m.setStatus("Keybindings reset to defaults.")
		return m, nil
	case quickCategoryAppliedMsg:
		return m.handleQuickCategoryApplied(msg)
	case quickTagsAppliedMsg:
		return m.handleQuickTagsApplied(msg)
	case quickOffsetsAppliedMsg:
		return m.handleQuickOffsetsApplied(msg)
	case accountNukedMsg:
		if msg.err != nil {
			m.setError(fmt.Sprintf("Account nuke failed: %v", msg.err))
			return m, nil
		}
		m.setStatusf("Nuked %q (%d transactions removed).", msg.accountName, msg.deletedTxns)
		if m.db == nil {
			return m, nil
		}
		return m, refreshCmd(m.db)
	case accountClearedMsg:
		if msg.err != nil {
			m.setError(fmt.Sprintf("Clear account transactions failed: %v", msg.err))
			return m, nil
		}
		m.setStatusf("Cleared %d transactions from %q.", msg.deletedTxns, msg.accountName)
		if m.db == nil {
			return m, nil
		}
		return m, refreshCmd(m.db)
	case accountScopeSavedMsg:
		if msg.err != nil {
			m.setError(fmt.Sprintf("Save account scope failed: %v", msg.err))
		}
		return m, nil
	case confirmExpiredMsg:
		m.clearSettingsConfirm()
		return m, nil
	case budgetDeleteConfirmExpiredMsg:
		m.budgetDeleteArmedTarget = 0
		return m, nil
	case tea.KeyMsg:
		// Primary tier: overlay/modal dispatch via shared precedence table.
		if next, cmd, handled := m.dispatchOverlayKey(msg); handled {
			return next, cmd
		}
		// No overlay active — try keybinding-to-command dispatch.
		if next, cmd, handled := m.executeBoundCommand(m.commandContextScope(), msg); handled {
			return next, cmd
		}
		// Tab-level dispatch.
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

func (m *model) setStatus(msg string) {
	m.status = msg
	m.statusErr = false
}

func (m *model) setStatusf(format string, args ...any) {
	m.setStatus(fmt.Sprintf(format, args...))
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
	m.txnTags = msg.txnTags
	if m.txnTags == nil {
		m.txnTags = make(map[int][]tag)
	}
	m.imports = msg.imports
	m.accounts = msg.accounts
	m.dbInfo = msg.info
	m.filterUsage = msg.filterUsage
	if m.filterUsage == nil {
		m.filterUsage = make(map[string]filterUsageState)
	}
	if len(msg.selectedAccounts) == 0 {
		m.filterAccounts = nil
	} else {
		m.filterAccounts = msg.selectedAccounts
	}
	if m.db != nil {
		if err := ensureCategoryBudgetRows(m.db); err != nil {
			m.setError(fmt.Sprintf("Load budget rows failed: %v", err))
		}
		if budgets, err := loadCategoryBudgets(m.db); err == nil {
			m.categoryBudgets = budgets
		}
		if overrides, err := loadBudgetOverrides(m.db); err == nil {
			m.budgetOverrides = overrides
		}
		if targets, err := loadSpendingTargets(m.db); err == nil {
			m.spendingTargets = targets
		}
		if targetOverrides, err := loadTargetOverrides(m.db); err == nil {
			m.targetOverrides = targetOverrides
		}
		if offsets, err := loadCreditOffsets(m.db); err == nil {
			m.creditOffsetsByDebit, m.creditOffsetsByCredit = indexCreditOffsets(offsets)
		}
		if lines, err := computeBudgetLines(m.db, m.categoryBudgets, m.budgetOverrides, m.creditOffsetsByDebit, m.budgetMonth, m.filterAccounts); err == nil {
			m.budgetLines = lines
			m.budgetOverCount = 0
			if len(lines) > 0 {
				within := 0
				for _, line := range lines {
					if line.overBudget {
						m.budgetOverCount++
					} else {
						within++
					}
				}
				m.budgetAdherencePct = (float64(within) / float64(len(lines))) * 100
			}
			m.budgetVarSparkline = m.computeBudgetVarianceSeries(6)
		}
		if targetLines, err := computeTargetLines(m.db, m.spendingTargets, m.targetOverrides, m.creditOffsetsByDebit, m.txnTags, m.savedFilters, m.filterAccounts); err == nil {
			m.targetLines = targetLines
		}
	}
	m.ready = true
	m.pruneSelections()
	// Clamp budget cursor to valid range after data refresh.
	budgetSize := len(m.budgetLines)
	if m.budgetView == 0 {
		budgetSize += len(m.targetLines)
	}
	if budgetSize > 0 {
		if m.budgetCursor >= budgetSize {
			m.budgetCursor = budgetSize - 1
		}
	} else {
		m.budgetCursor = 0
	}
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
		m.setStatus("Ready. Press tab to switch views, import from Settings.")
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
		m.setStatus("No CSV files found in current directory.")
		m.importPicking = false
	}
	return m, nil
}

func (m model) handleImportPreview(msg importPreviewMsg) (tea.Model, tea.Cmd) {
	if msg.err != nil {
		m.setError(fmt.Sprintf("Scan failed: %v", msg.err))
		return m, nil
	}
	if msg.snapshot == nil {
		m.setError("Scan failed: missing import preview snapshot.")
		return m, nil
	}
	m.importPreviewOpen = true
	m.importPreviewPostRules = true
	m.importPreviewShowAll = false
	m.importPreviewCursor = 0
	m.importPreviewScroll = 0
	m.importPreviewSnapshot = msg.snapshot
	return m, nil
}

func (m model) handleClearDone(msg clearDoneMsg) (tea.Model, tea.Cmd) {
	if msg.err != nil {
		m.setError(fmt.Sprintf("Clear failed: %v", msg.err))
		return m, nil
	}
	m.setStatus("Database cleared.")
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
	base := ""
	if msg.dupes > 0 {
		base = fmt.Sprintf("Imported %d transactions from %s (%d duplicates skipped)", msg.count, msg.file, msg.dupes)
	} else {
		base = fmt.Sprintf("Imported %d transactions from %s", msg.count, msg.file)
	}
	if msg.rulesApplied {
		base += " | " + formatRulesSummary("Import scope", msg.rulesTxnUpdated, msg.rulesCatChanges, msg.rulesTagChanges, msg.rulesFailed)
	}
	m.setStatus(base)
	if m.db == nil {
		return m, nil
	}
	return m, refreshCmd(m.db)
}

func formatRulesSummary(scope string, updatedTxns, catChanges, tagChanges, failedRules int) string {
	label := strings.TrimSpace(scope)
	if label == "" {
		label = "All Accounts"
	}
	failedPart := fmt.Sprintf("%d failed rules", failedRules)
	if failedRules > 0 {
		failedPart = lipgloss.NewStyle().Foreground(colorError).Render(failedPart)
	}
	return fmt.Sprintf(
		"Applied rules (%s): %d transactions updated, %d category changes, %d tag changes, %s.",
		label,
		updatedTxns,
		catChanges,
		tagChanges,
		failedPart,
	)
}

func (m model) handleQuickCategoryApplied(msg quickCategoryAppliedMsg) (tea.Model, tea.Cmd) {
	if msg.err != nil {
		m.setError(fmt.Sprintf("Quick categorize failed: %v", msg.err))
		return m, nil
	}
	m.catPicker = nil
	m.catPickerFor = nil
	if msg.created {
		m.setStatusf("Created %q and applied to %d transaction(s).", msg.categoryName, msg.count)
	} else {
		m.setStatusf("Category %q applied to %d transaction(s).", msg.categoryName, msg.count)
	}
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
	if msg.toggled {
		if msg.toggledOn {
			m.setStatusf("Tag %q added to %d transaction(s).", msg.tagName, msg.count)
		} else {
			m.setStatusf("Tag %q removed from %d transaction(s).", msg.tagName, msg.count)
		}
	} else {
		m.setStatusf("Updated tags for %d transaction(s).", msg.count)
	}
	if m.db == nil {
		return m, nil
	}
	return m, refreshCmd(m.db)
}

func (m model) handleQuickOffsetsApplied(msg quickOffsetsAppliedMsg) (tea.Model, tea.Cmd) {
	if msg.err != nil {
		m.setError(fmt.Sprintf("Quick offset failed: %v", msg.err))
		return m, nil
	}
	m.quickOffsetOpen = false
	m.quickOffsetFor = nil
	m.quickOffsetAmount = ""
	m.quickOffsetCursor = 0
	m.setStatusf("Applied offset %.2f to %d transaction(s).", msg.amount, msg.count)
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
	out.CommandDefaultInterface = m.commandDefault
	return normalizeSettings(out)
}

func saveSettingsCmd(s appSettings) tea.Cmd {
	return func() tea.Msg {
		return settingsSavedMsg{err: saveAppSettings(s)}
	}
}

func navDeltaFromKeyName(keyName string) int {
	switch keyName {
	case "j", "down", "ctrl+n", "ctrl+j", "l", "right", "shift+down", "shift+j":
		return 1
	case "k", "up", "ctrl+p", "ctrl+k", "h", "left", "shift+up", "shift+k":
		return -1
	default:
		return 0
	}
}

func rowsPerPageDeltaFromKeyName(keyName string) int {
	if delta := navDeltaFromKeyName(keyName); delta != 0 {
		return delta
	}
	switch keyName {
	case "+", "=":
		return 1
	case "-":
		return -1
	default:
		if strings.HasSuffix(keyName, "+") || strings.HasSuffix(keyName, "=") {
			return 1
		}
		if strings.HasSuffix(keyName, "-") {
			return -1
		}
		return 0
	}
}

func moveBoundedCursor(cursor, size, delta int) int {
	if size <= 0 {
		return 0
	}
	if cursor < 0 {
		cursor = 0
	}
	if cursor >= size {
		cursor = size - 1
	}
	if delta > 0 {
		if cursor < size-1 {
			cursor++
		}
		return cursor
	}
	if delta < 0 {
		if cursor > 0 {
			cursor--
		}
	}
	return cursor
}

func (m model) directionDelta(scope string, msg tea.KeyMsg) int {
	if suppressTextModalVimNav(scope, msg) {
		return 0
	}
	switch {
	case m.isAction(scope, actionUp, msg):
		return -1
	case m.isAction(scope, actionDown, msg):
		return 1
	case m.isAction(scope, actionLeft, msg):
		return -1
	case m.isAction(scope, actionRight, msg):
		return 1
	default:
		return 0
	}
}

func (m model) verticalDelta(scope string, msg tea.KeyMsg) int {
	if suppressTextModalVimNav(scope, msg) {
		return 0
	}
	switch {
	case m.isAction(scope, actionUp, msg):
		return -1
	case m.isAction(scope, actionDown, msg):
		return 1
	default:
		return 0
	}
}

func (m model) horizontalDelta(scope string, msg tea.KeyMsg) int {
	if suppressTextModalVimNav(scope, msg) {
		return 0
	}
	switch {
	case m.isAction(scope, actionLeft, msg):
		return -1
	case m.isAction(scope, actionRight, msg):
		return 1
	default:
		return 0
	}
}

func suppressTextModalVimNav(scope string, msg tea.KeyMsg) bool {
	if !isTextInputModalScope(scope) {
		return false
	}
	switch normalizeKeyName(msg.String()) {
	case "h", "j", "k", "l":
		return true
	default:
		return false
	}
}

func isTextInputModalScope(scope string) bool {
	return isTextInputModalScopeFromContract(scope)
}

func (m model) moveCursorForScope(scope string, msg tea.KeyMsg, cursor, size int) (int, bool) {
	delta := m.verticalDelta(scope, msg)
	if delta == 0 {
		return cursor, false
	}
	return moveBoundedCursor(cursor, size, delta), true
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

type settingsConfirmSpec struct {
	scope    string
	action   Action
	fallback string
}

func settingsConfirmSpecFor(action settingsConfirmAction) (settingsConfirmSpec, bool) {
	switch action {
	case confirmActionDeleteCategory:
		return settingsConfirmSpec{scope: scopeSettingsActiveCategories, action: actionDelete, fallback: "del"}, true
	case confirmActionDeleteTag:
		return settingsConfirmSpec{scope: scopeSettingsActiveTags, action: actionDelete, fallback: "del"}, true
	case confirmActionDeleteRule:
		return settingsConfirmSpec{scope: scopeSettingsActiveRules, action: actionDelete, fallback: "del"}, true
	case confirmActionDeleteFilter:
		return settingsConfirmSpec{scope: scopeSettingsActiveFilters, action: actionDelete, fallback: "del"}, true
	case confirmActionClearDB:
		return settingsConfirmSpec{scope: scopeSettingsActiveDBImport, action: actionClearDB, fallback: "c"}, true
	default:
		return settingsConfirmSpec{}, false
	}
}

func (m model) matchesSettingsConfirm(msg tea.KeyMsg) bool {
	spec, ok := settingsConfirmSpecFor(m.confirmAction)
	if !ok {
		return false
	}
	return m.isAction(spec.scope, spec.action, msg)
}

func (m *model) armSettingsConfirm(action settingsConfirmAction, id int, prompt string) tea.Cmd {
	m.confirmAction = action
	m.confirmID = id
	m.confirmFilterID = ""
	m.setStatus(prompt)
	return confirmTimerCmd()
}

func (m *model) armSettingsFilterConfirm(filterID, prompt string) tea.Cmd {
	m.confirmAction = confirmActionDeleteFilter
	m.confirmID = 0
	m.confirmFilterID = strings.TrimSpace(filterID)
	m.setStatus(prompt)
	return confirmTimerCmd()
}

func (m *model) clearSettingsConfirm() {
	m.confirmAction = confirmActionNone
	m.confirmID = 0
	m.confirmFilterID = ""
}

func (m *model) beginImportFlow() tea.Cmd {
	m.importPicking = true
	m.importFiles = nil
	m.importCursor = 0
	m.importPreviewOpen = false
	m.importPreviewSnapshot = nil
	m.importPreviewPostRules = true
	m.importPreviewShowAll = false
	m.importPreviewCursor = 0
	m.importPreviewScroll = 0
	return loadFilesCmd(m.basePath)
}

type jumpTarget struct {
	Key        string
	Label      string
	Section    int
	Activate   bool
	BudgetView int
}

func filterReservedJumpTargetKeys(targets []jumpTarget) []jumpTarget {
	if len(targets) == 0 {
		return nil
	}
	out := make([]jumpTarget, 0, len(targets))
	for _, target := range targets {
		if strings.EqualFold(strings.TrimSpace(target.Key), "v") {
			continue
		}
		out = append(out, target)
	}
	return out
}

func (m model) jumpTargetsForActiveTab() []jumpTarget {
	switch m.activeTab {
	case tabDashboard:
		return filterReservedJumpTargetKeys([]jumpTarget{
			{Key: "d", Label: "Date Range", Section: sectionDashboardDateRange, Activate: true, BudgetView: -1},
			{Key: "n", Label: "Net/Cashflow", Section: sectionDashboardNetCashflow, Activate: true, BudgetView: -1},
			{Key: "c", Label: "Composition", Section: sectionDashboardComposition, Activate: true, BudgetView: -1},
		})
	case tabBudget:
		return filterReservedJumpTargetKeys([]jumpTarget{
			{Key: "t", Label: "Budget Table", Section: sectionUnfocused, Activate: false, BudgetView: 0},
			{Key: "p", Label: "Planner", Section: sectionUnfocused, Activate: false, BudgetView: 1},
		})
	case tabManager:
		return filterReservedJumpTargetKeys([]jumpTarget{
			{Key: "a", Label: "Accounts", Section: sectionManagerAccounts, Activate: true, BudgetView: -1},
			{Key: "t", Label: "Transactions", Section: sectionManagerTransactions, Activate: true, BudgetView: -1},
		})
	case tabSettings:
		return filterReservedJumpTargetKeys([]jumpTarget{
			{Key: "c", Label: "Categories", Section: sectionSettingsCategories, Activate: true, BudgetView: -1},
			{Key: "t", Label: "Tags", Section: sectionSettingsTags, Activate: true, BudgetView: -1},
			{Key: "r", Label: "Rules", Section: sectionSettingsRules, Activate: true, BudgetView: -1},
			{Key: "f", Label: "Filters", Section: sectionSettingsFilters, Activate: true, BudgetView: -1},
			{Key: "d", Label: "Database", Section: sectionSettingsDatabase, Activate: true, BudgetView: -1},
			{Key: "w", Label: "Dashboard Views", Section: sectionSettingsViews, Activate: true, BudgetView: -1},
		})
	default:
		return nil
	}
}

func (m model) updateJumpOverlay(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	if m.isAction(scopeGlobal, actionJumpMode, msg) {
		m.jumpModeActive = false
		m.focusedSection = m.jumpPreviousFocus
		return m, nil
	}
	if next, cmd, handled := m.executeBoundCommand(scopeJumpOverlay, msg); handled {
		return next, cmd
	}
	keyName := normalizeKeyName(msg.String())
	if keyName == "" {
		return m, nil
	}
	for _, target := range m.jumpTargetsForActiveTab() {
		if normalizeKeyName(target.Key) != keyName {
			continue
		}
		if m.activeTab == tabManager && m.drillReturn != nil {
			m.drillReturn = nil
		}
		m.jumpModeActive = false
		m.focusedSection = target.Section
		if m.activeTab == tabBudget && target.BudgetView >= 0 {
			m.budgetView = target.BudgetView
			m.budgetEditing = false
		}
		m.applyFocusedSection(target.Activate)
		return m, nil
	}
	return m, nil
}

func (m *model) applyFocusedSection(activate bool) {
	switch m.activeTab {
	case tabDashboard:
		if m.focusedSection == sectionDashboardDateRange {
			m.dashTimeframeCursor = m.dashTimeframe
			m.dashTimeframeFocus = true
			return
		}
		if isDashboardAnalyticsSection(m.focusedSection) {
			m.dashTimeframeFocus = false
			if len(m.dashWidgets) != dashboardPaneCount {
				m.dashWidgets = newDashboardWidgets(m.customPaneModes)
			}
		}
	case tabManager:
		switch m.focusedSection {
		case sectionManagerAccounts:
			m.managerMode = managerModeAccounts
		case sectionManagerTransactions:
			m.managerMode = managerModeTransactions
			m.ensureCursorInWindow()
		}
	case tabSettings:
		switch m.focusedSection {
		case sectionSettingsCategories:
			m.settColumn = settColLeft
			m.settSection = settSecCategories
		case sectionSettingsTags:
			m.settColumn = settColLeft
			m.settSection = settSecTags
		case sectionSettingsRules:
			m.settColumn = settColLeft
			m.settSection = settSecRules
		case sectionSettingsFilters:
			m.settColumn = settColLeft
			m.settSection = settSecFilters
		case sectionSettingsImportHistory:
			m.settColumn = settColRight
			m.settSection = settSecImportHistory
		case sectionSettingsDatabase:
			m.settColumn = settColRight
			m.settSection = settSecDBImport
		case sectionSettingsViews:
			m.settColumn = settColRight
			m.settSection = settSecChart
		}
		if activate {
			m.settActive = true
			m.settItemCursor = 0
		}
	}
}

func (m *model) applyTabDefaultsOnSwitch() {
	if m.activeTab != tabManager {
		m.drillReturn = nil
	}
	// Leaving Settings always defocuses pane interaction state.
	if m.activeTab != tabSettings {
		m.settActive = false
	}
	if m.activeTab != tabDashboard {
		m.dashTimeframeFocus = false
		m.dashCustomEditing = false
		m.dashCustomInput = ""
		m.dashCustomModeEdit = false
	}
	switch m.activeTab {
	case tabManager:
		if m.focusedSection == sectionUnfocused {
			m.focusedSection = sectionManagerTransactions
		}
		m.applyFocusedSection(false)
	case tabSettings:
		// Entering Settings should never auto-activate a pane; keep last selected pane.
		m.settActive = false
		if m.settSection < 0 || m.settSection >= settSecCount {
			m.settSection = settSecCategories
		}
		col, _ := settColumnRow(m.settSection)
		m.settColumn = col
		m.focusedSection = settingsFocusSectionForSettSection(m.settSection)
	case tabDashboard:
		if m.focusedSection != sectionUnfocused {
			m.focusedSection = sectionUnfocused
		}
		m.dashTimeframeFocus = false
		m.dashCustomEditing = false
		m.dashCustomInput = ""
	case tabBudget:
		if m.focusedSection != sectionUnfocused {
			m.focusedSection = sectionUnfocused
		}
		// Clear any in-progress budget editing when switching to/from Budget tab.
		m.budgetEditing = false
		m.budgetEditValue = ""
		m.budgetEditCursor = 0
		m.budgetDeleteArmedTarget = 0
	}
}

func moveSettingsSection(section, delta int) int {
	col, row := settColumnRow(section)
	rowCount := 3
	if col == settColLeft {
		rowCount = 4
	}
	if rowCount <= 0 {
		return section
	}
	row = (row + delta + rowCount) % rowCount
	return settSectionForColumn(col, row)
}

func categoryColorIndex(color string) int {
	for i, c := range CategoryAccentColors() {
		if string(c) == color {
			return i
		}
	}
	return 0
}

func tagColorIndex(color string) int {
	for i, c := range TagAccentColors() {
		if string(c) == color {
			return i
		}
	}
	return 0
}

func (m model) computeBudgetVarianceSeries(points int) []float64 {
	if m.db == nil || points <= 0 {
		return nil
	}
	start, _, err := parseMonthKey(m.budgetMonth)
	if err != nil {
		start = time.Now()
	}
	series := make([]float64, 0, points)
	for i := points - 1; i >= 0; i-- {
		month := start.AddDate(0, -i, 0).Format("2006-01")
		lines, err := computeBudgetLines(m.db, m.categoryBudgets, m.budgetOverrides, m.creditOffsetsByDebit, month, m.filterAccounts)
		if err != nil {
			continue
		}
		total := 0.0
		for _, line := range lines {
			total += line.remaining
		}
		series = append(series, total)
	}
	return series
}

func categoryIndexByID(categories []category, id int) int {
	for i, c := range categories {
		if c.id == id {
			return i
		}
	}
	return 0
}

func (m *model) beginSettingsCategoryMode(cat *category) {
	if cat == nil {
		m.settMode = settModeAddCat
		m.settEditID = 0
		m.settInput = ""
		m.settInputCursor = 0
		m.settColorIdx = 0
		m.settCatFocus = 0
		return
	}
	m.settMode = settModeEditCat
	m.settEditID = cat.id
	m.settInput = cat.name
	m.settInputCursor = len(m.settInput)
	m.settColorIdx = categoryColorIndex(cat.color)
	m.settCatFocus = 0
}

func (m *model) beginSettingsTagMode(tg *tag) {
	if tg == nil {
		m.settMode = settModeAddTag
		m.settEditID = 0
		m.settInput = ""
		m.settInputCursor = 0
		m.settColorIdx = 0
		m.settTagFocus = 0
		m.settTagScopeID = 0
		return
	}
	m.settMode = settModeEditTag
	m.settEditID = tg.id
	m.settInput = tg.name
	m.settInputCursor = len(m.settInput)
	m.settColorIdx = tagColorIndex(tg.color)
	m.settTagFocus = 0
	if tg.categoryID == nil {
		m.settTagScopeID = 0
	} else {
		m.settTagScopeID = *tg.categoryID
	}
}

func (m *model) beginSettingsRuleMode(rule *ruleV2) {
	m.openRuleEditor(rule)
}

func isBackspaceKey(msg tea.KeyMsg) bool {
	return normalizeKeyName(msg.String()) == "backspace"
}

func deleteLastASCIIByte(s *string) bool {
	if len(*s) == 0 {
		return false
	}
	*s = (*s)[:len(*s)-1]
	return true
}

func appendPrintableASCII(s *string, key string) bool {
	if len(key) != 1 || key[0] < 32 || key[0] >= 127 {
		return false
	}
	*s += key
	return true
}

func clampInputCursorASCII(s string, cursor int) int {
	if cursor < 0 {
		return 0
	}
	if cursor > len(s) {
		return len(s)
	}
	return cursor
}

func moveInputCursorASCII(s string, cursor *int, delta int) bool {
	if cursor == nil {
		return false
	}
	before := clampInputCursorASCII(s, *cursor)
	after := clampInputCursorASCII(s, before+delta)
	*cursor = after
	return after != before
}

func insertPrintableASCIIAtCursor(s *string, cursor *int, key string) bool {
	if s == nil || cursor == nil {
		return false
	}
	if len(key) != 1 || key[0] < 32 || key[0] >= 127 {
		return false
	}
	idx := clampInputCursorASCII(*s, *cursor)
	*s = (*s)[:idx] + key + (*s)[idx:]
	*cursor = idx + 1
	return true
}

func deleteASCIIByteBeforeCursor(s *string, cursor *int) bool {
	if s == nil || cursor == nil {
		return false
	}
	idx := clampInputCursorASCII(*s, *cursor)
	if idx == 0 {
		return false
	}
	*s = (*s)[:idx-1] + (*s)[idx:]
	*cursor = idx - 1
	return true
}
