package main

import (
	"fmt"
	"sort"
	"strings"

	"github.com/charmbracelet/bubbles/key"
)

type Action string

type Binding struct {
	Action    Action
	CommandID string
	Keys      []string
	Help      string
	Scopes    []string
}

type KeyRegistry struct {
	bindingsByScope map[string][]*Binding
	indexByScope    map[string]map[string]*Binding
}

const (
	scopeGlobal                   = "global"
	scopeCommandPalette           = "command_palette"
	scopeCommandMode              = "command_mode"
	scopeJumpOverlay              = "jump_overlay"
	scopeManagerTransactions      = "manager_transactions"
	scopeManager                  = "manager"
	scopeManagerModal             = "manager_modal"
	scopeManagerAccountAction     = "manager_account_action"
	scopeDashboard                = "dashboard"
	scopeDashboardFocused         = "dashboard_focused"
	scopeDashboardTimeframe       = "dashboard_timeframe"
	scopeDashboardCustomInput     = "dashboard_custom_input"
	scopeBudget                   = "budget"
	scopeTransactions             = "transactions"
	scopeDetailModal              = "detail_modal"
	scopeCategoryPicker           = "category_picker"
	scopeTagPicker                = "tag_picker"
	scopeQuickOffset              = "quick_offset"
	scopeOffsetDebitPicker        = "offset_debit_picker"
	scopeFilterApplyPicker        = "filter_apply_picker"
	scopeFilterEdit               = "filter_edit"
	scopeFilePicker               = "file_picker"
	scopeImportPreview            = "import_preview"
	scopeFilterInput              = "filter_input"
	scopeSettingsNav              = "settings_nav"
	scopeSettingsModeCat          = "settings_mode_cat"
	scopeSettingsModeTag          = "settings_mode_tag"
	scopeSettingsModeRule         = "settings_mode_rule"
	scopeSettingsModeRuleCat      = "settings_mode_rule_cat"
	scopeRuleEditor               = "rule_editor"
	scopeDryRunModal              = "dry_run_modal"
	scopeSettingsActiveCategories = "settings_active_categories"
	scopeSettingsActiveTags       = "settings_active_tags"
	scopeSettingsActiveRules      = "settings_active_rules"
	scopeSettingsActiveFilters    = "settings_active_filters"
	scopeSettingsActiveChart      = "settings_active_chart"
	scopeSettingsActiveDBImport   = "settings_active_db_import"
	scopeSettingsActiveImportHist = "settings_active_import_history"
)

const (
	actionQuit                     Action = "quit"
	actionNextTab                  Action = "next_tab"
	actionPrevTab                  Action = "prev_tab"
	actionUp                       Action = "up"
	actionDown                     Action = "down"
	actionLeft                     Action = "left"
	actionRight                    Action = "right"
	actionConfirm                  Action = "confirm"
	actionSelect                   Action = actionConfirm
	actionActivate                 Action = actionConfirm
	actionNext                     Action = actionConfirm
	actionClose                    Action = actionCancel
	actionCancel                   Action = "cancel"
	actionBack                     Action = actionCancel
	actionClearSearch              Action = actionCancel
	actionSearch                   Action = "search"
	actionFilterSave               Action = "filter_save"
	actionFilterLoad               Action = "filter_load"
	actionSort                     Action = "sort"
	actionSortDirection            Action = "sort_direction"
	actionToggleSelect             Action = "toggle_select"
	actionRangeHighlight           Action = "range_highlight"
	actionQuickCategory            Action = "quick_category"
	actionQuickTag                 Action = "quick_tag"
	actionQuickOffset              Action = "quick_offset"
	actionImportAll                Action = "import_all"
	actionSkipDupes                Action = "skip_dupes"
	actionImportRawView            Action = "import_raw_view"
	actionImportPreviewToggle      Action = "import_preview_toggle"
	actionSave                     Action = "save"
	actionAdd                      Action = "add"
	actionEdit                     Action = "edit"
	actionDelete                   Action = "delete"
	actionApplyAll                 Action = "apply_all"
	actionToggleWeekBoundary       Action = "toggle_week_boundary"
	actionRowsPerPage              Action = "rows_per_page"
	actionClearDB                  Action = "clear_db"
	actionImport                   Action = "import"
	actionResetKeybindings         Action = "reset_keybindings"
	actionFocusAccounts            Action = "focus_accounts"
	actionJumpTop                  Action = "jump_top"
	actionJumpBottom               Action = "jump_bottom"
	actionCommandPalette           Action = "command_palette"
	actionCommandMode              Action = "command_mode"
	actionCommandDefault           Action = "command_default"
	actionCommandGoDashboard       Action = "command_go_dashboard"
	actionCommandGoTransactions    Action = "command_go_transactions"
	actionCommandGoSettings        Action = "command_go_settings"
	actionCommandGoBudget          Action = "command_go_budget"
	actionCommandFocusAccounts     Action = "command_focus_accounts"
	actionCommandFocusTransactions Action = "command_focus_transactions"
	actionJumpMode                 Action = "jump_mode"
	actionJumpCancel               Action = "jump_cancel"
	actionCommandApplyTagRules     Action = "command_apply_tag_rules"
	actionCommandClearFilters      Action = "command_clear_filters"
	actionCommandClearSelection    Action = "command_clear_selection"
	actionDashboardModeNext        Action = "dashboard_mode_next"
	actionDashboardModePrev        Action = "dashboard_mode_prev"
	actionDashboardDrillDown       Action = "dashboard_drill_down"
	actionRuleToggleEnabled        Action = "rule_toggle_enabled"
	actionRuleMoveUp               Action = "rule_move_up"
	actionRuleMoveDown             Action = "rule_move_down"
	actionRuleDryRun               Action = "rule_dry_run"
	actionBudgetPrevMonth          Action = "budget_prev_month"
	actionBudgetNextMonth          Action = "budget_next_month"
	actionBudgetToggleView         Action = "budget_toggle_view"
	actionBudgetEdit               Action = "budget_edit"
	actionBudgetAddTarget          Action = "budget_add_target"
	actionBudgetDeleteTarget       Action = "budget_delete_target"
	actionBudgetResetOverride      Action = "budget_reset_override"
	actionBudgetPrevYear           Action = "budget_prev_year"
	actionBudgetNextYear           Action = "budget_next_year"
)

func NewKeyRegistry() *KeyRegistry {
	r := &KeyRegistry{
		bindingsByScope: make(map[string][]*Binding),
		indexByScope:    make(map[string]map[string]*Binding),
	}

	reg := func(scope string, action Action, commandID string, keys []string, help string) {
		r.Register(Binding{Action: action, CommandID: commandID, Keys: keys, Help: help, Scopes: []string{scope}})
	}

	// Global fallback lookup.
	reg(scopeGlobal, actionQuit, "", []string{"q", "ctrl+c"}, "quit")
	reg(scopeGlobal, actionNextTab, "nav:next-tab", []string{"tab"}, "next tab")
	reg(scopeGlobal, actionPrevTab, "nav:prev-tab", []string{"shift+tab"}, "prev tab")
	reg(scopeGlobal, actionCommandGoDashboard, "nav:dashboard", []string{"1"}, "dashboard")
	reg(scopeGlobal, actionCommandGoBudget, "nav:budget", []string{"2"}, "budget")
	reg(scopeGlobal, actionCommandGoTransactions, "nav:manager", []string{"3"}, "manager")
	reg(scopeGlobal, actionCommandGoSettings, "nav:settings", []string{"4"}, "settings")
	reg(scopeGlobal, actionJumpMode, "jump:activate", []string{"v"}, "jump")
	reg(scopeGlobal, actionCommandPalette, "palette:open", []string{"ctrl+k"}, "commands")
	reg(scopeGlobal, actionCommandMode, "cmd:open", []string{":"}, "command")

	reg(scopeCommandPalette, actionUp, "", []string{"up", "ctrl+p", "k"}, "")
	reg(scopeCommandPalette, actionDown, "", []string{"down", "ctrl+n", "j"}, "")
	reg(scopeCommandPalette, actionSelect, "", []string{"enter"}, "run")
	reg(scopeCommandPalette, actionClose, "", []string{"esc"}, "close")
	reg(scopeCommandMode, actionUp, "", []string{"up", "ctrl+p", "k"}, "")
	reg(scopeCommandMode, actionDown, "", []string{"down", "ctrl+n", "j"}, "")
	reg(scopeCommandMode, actionSelect, "", []string{"enter"}, "run")
	reg(scopeCommandMode, actionClose, "", []string{"esc"}, "close")
	reg(scopeJumpOverlay, actionJumpCancel, "jump:cancel", []string{"esc"}, "cancel")

	// Manager transactions-primary footer additions.
	reg(scopeManagerTransactions, actionFocusAccounts, "", []string{"a"}, "accounts")
	// Manager accounts-active footer.
	reg(scopeManager, actionLeft, "", []string{"h", "left"}, "")
	reg(scopeManager, actionRight, "", []string{"l", "right"}, "")
	reg(scopeManager, actionBack, "", []string{"esc"}, "")
	reg(scopeManager, actionSearch, "", []string{"/"}, "filter")
	reg(scopeManager, actionFilterLoad, "filter:apply", []string{"ctrl+l"}, "load")
	reg(scopeManager, actionToggleSelect, "", []string{"space"}, "")
	reg(scopeManager, actionAdd, "", []string{"a"}, "add")
	reg(scopeManager, actionSelect, "", []string{"enter"}, "")
	reg(scopeManager, actionDelete, "", []string{"del"}, "actions")
	reg(scopeManager, actionNextTab, "nav:next-tab", []string{"tab"}, "")
	reg(scopeManager, actionQuit, "", []string{"q", "ctrl+c"}, "quit")
	reg(scopeManagerModal, actionUp, "", []string{"up", "ctrl+p"}, "")
	reg(scopeManagerModal, actionDown, "", []string{"down", "ctrl+n"}, "")
	reg(scopeManagerModal, actionLeft, "", []string{"left"}, "")
	reg(scopeManagerModal, actionRight, "", []string{"right"}, "")
	reg(scopeManagerModal, actionToggleSelect, "", []string{"space"}, "")
	reg(scopeManagerModal, actionConfirm, "", []string{"enter"}, "")
	reg(scopeManagerModal, actionClose, "", []string{"esc"}, "")
	reg(scopeManagerAccountAction, actionUp, "", []string{"k", "up", "ctrl+p"}, "")
	reg(scopeManagerAccountAction, actionDown, "", []string{"j", "down", "ctrl+n"}, "")
	reg(scopeManagerAccountAction, actionSelect, "", []string{"enter"}, "")
	reg(scopeManagerAccountAction, actionClose, "", []string{"esc"}, "")

	// Dashboard footer: tab, shift+tab, q
	reg(scopeDashboard, actionNextTab, "nav:next-tab", []string{"tab"}, "")
	reg(scopeDashboard, actionPrevTab, "nav:prev-tab", []string{"shift+tab"}, "")
	reg(scopeDashboard, actionQuit, "", []string{"q", "ctrl+c"}, "")
	reg(scopeDashboardFocused, actionDashboardModeNext, "dash:mode-next", []string{"]"}, "next")
	reg(scopeDashboardFocused, actionDashboardModePrev, "dash:mode-prev", []string{"["}, "prev")
	reg(scopeDashboardFocused, actionDashboardDrillDown, "dash:drill-down", []string{"enter"}, "drill")
	reg(scopeDashboardFocused, actionCancel, "", []string{"esc"}, "")

	reg(scopeBudget, actionBudgetPrevMonth, "budget:prev-month", []string{"h", "left"}, "")
	reg(scopeBudget, actionBudgetNextMonth, "budget:next-month", []string{"l", "right"}, "")
	reg(scopeBudget, actionBudgetToggleView, "budget:toggle-view", []string{"w"}, "view")
	reg(scopeBudget, actionBudgetEdit, "budget:edit", []string{"enter"}, "edit")
	reg(scopeBudget, actionBudgetAddTarget, "budget:add-target", []string{"a"}, "add")
	reg(scopeBudget, actionBudgetDeleteTarget, "budget:delete-target", []string{"del"}, "delete")
	reg(scopeBudget, actionBudgetResetOverride, "budget:reset-override", []string{"r"}, "reset")
	reg(scopeBudget, actionBudgetPrevYear, "budget:prev-year", []string{"["}, "")
	reg(scopeBudget, actionBudgetNextYear, "budget:next-year", []string{"]"}, "")
	reg(scopeBudget, actionUp, "", []string{"k", "up", "ctrl+p"}, "")
	reg(scopeBudget, actionDown, "", []string{"j", "down", "ctrl+n"}, "")
	reg(scopeBudget, actionNextTab, "nav:next-tab", []string{"tab"}, "")
	reg(scopeBudget, actionPrevTab, "nav:prev-tab", []string{"shift+tab"}, "")
	reg(scopeBudget, actionQuit, "", []string{"q", "ctrl+c"}, "")
	reg(scopeBudget, actionCancel, "", []string{"esc"}, "")

	// Dashboard timeframe focus footer: left/right, enter, esc
	reg(scopeDashboardTimeframe, actionUp, "", []string{"k", "up"}, "")
	reg(scopeDashboardTimeframe, actionDown, "", []string{"j", "down"}, "")
	reg(scopeDashboardTimeframe, actionLeft, "", []string{"h", "left"}, "")
	reg(scopeDashboardTimeframe, actionRight, "", []string{"l", "right"}, "")
	reg(scopeDashboardTimeframe, actionSelect, "", []string{"enter"}, "")
	reg(scopeDashboardTimeframe, actionCancel, "", []string{"esc"}, "")

	// Dashboard custom input footer: enter, esc
	reg(scopeDashboardCustomInput, actionConfirm, "", []string{"enter"}, "")
	reg(scopeDashboardCustomInput, actionCancel, "", []string{"esc"}, "")

	// Transactions footer.
	reg(scopeTransactions, actionSearch, "filter:open", []string{"/"}, "filter")
	reg(scopeTransactions, actionFilterSave, "filter:save", []string{"ctrl+s"}, "save")
	reg(scopeTransactions, actionFilterLoad, "filter:apply", []string{"ctrl+l"}, "load")
	reg(scopeTransactions, actionSort, "txn:sort", []string{"s"}, "sort")
	reg(scopeTransactions, actionSortDirection, "txn:sort-dir", []string{"S"}, "reverse")
	reg(scopeTransactions, actionQuickCategory, "txn:quick-category", []string{"c"}, "cat")
	reg(scopeTransactions, actionQuickTag, "txn:quick-tag", []string{"t"}, "tag")
	reg(scopeTransactions, actionQuickOffset, "txn:quick-offset", []string{"o"}, "offset")
	reg(scopeTransactions, actionToggleSelect, "txn:select", []string{"space", " "}, "")
	reg(scopeTransactions, actionRangeHighlight, "", []string{"shift+up/down", "shift+up", "shift+down"}, "")
	reg(scopeTransactions, actionCommandClearSelection, "txn:clear-selection", []string{"u"}, "clear")
	reg(scopeTransactions, actionJumpTop, "txn:jump-top", []string{"g"}, "top")
	reg(scopeTransactions, actionJumpBottom, "txn:jump-bottom", []string{"G"}, "bottom")
	reg(scopeTransactions, actionClearSearch, "filter:clear", []string{"esc"}, "")
	reg(scopeTransactions, actionSelect, "txn:detail", []string{"enter"}, "")
	reg(scopeTransactions, actionUp, "", []string{"k", "up", "ctrl+p"}, "")
	reg(scopeTransactions, actionDown, "", []string{"j", "down", "ctrl+n"}, "")
	reg(scopeTransactions, actionNextTab, "nav:next-tab", []string{"tab"}, "")
	reg(scopeTransactions, actionQuit, "", []string{"q", "ctrl+c"}, "")

	// Category quick picker footer.
	reg(scopeCategoryPicker, actionUp, "", []string{"k", "up", "ctrl+p"}, "")
	reg(scopeCategoryPicker, actionDown, "", []string{"j", "down", "ctrl+n"}, "")
	reg(scopeCategoryPicker, actionSelect, "", []string{"enter"}, "")
	reg(scopeCategoryPicker, actionClose, "", []string{"esc"}, "")
	reg(scopeTagPicker, actionUp, "", []string{"up", "ctrl+p", "k"}, "")
	reg(scopeTagPicker, actionDown, "", []string{"down", "ctrl+n", "j"}, "")
	reg(scopeTagPicker, actionToggleSelect, "", []string{"space"}, "")
	reg(scopeTagPicker, actionSelect, "", []string{"enter"}, "")
	reg(scopeTagPicker, actionClose, "", []string{"esc"}, "")
	reg(scopeQuickOffset, actionConfirm, "", []string{"enter"}, "apply")
	reg(scopeQuickOffset, actionClose, "", []string{"esc"}, "cancel")
	reg(scopeQuickOffset, actionLeft, "", []string{"left"}, "")
	reg(scopeQuickOffset, actionRight, "", []string{"right"}, "")
	reg(scopeFilterApplyPicker, actionUp, "", []string{"up", "ctrl+p", "k"}, "")
	reg(scopeFilterApplyPicker, actionDown, "", []string{"down", "ctrl+n", "j"}, "")
	reg(scopeFilterApplyPicker, actionSelect, "", []string{"enter"}, "")
	reg(scopeFilterApplyPicker, actionClose, "", []string{"esc"}, "")
	reg(scopeOffsetDebitPicker, actionUp, "", []string{"up", "ctrl+p", "k"}, "")
	reg(scopeOffsetDebitPicker, actionDown, "", []string{"down", "ctrl+n", "j"}, "")
	reg(scopeOffsetDebitPicker, actionSelect, "", []string{"enter"}, "")
	reg(scopeOffsetDebitPicker, actionClose, "", []string{"esc"}, "")

	// Detail / file picker footers: enter, esc, up/down, q
	reg(scopeDetailModal, actionSelect, "", []string{"enter"}, "")
	reg(scopeDetailModal, actionEdit, "", []string{"n"}, "notes")
	reg(scopeDetailModal, actionClose, "", []string{"esc"}, "")
	reg(scopeDetailModal, actionUp, "", []string{"k", "up", "ctrl+p"}, "")
	reg(scopeDetailModal, actionDown, "", []string{"j", "down", "ctrl+n"}, "")
	reg(scopeDetailModal, actionQuit, "", []string{"q", "ctrl+c"}, "")
	reg(scopeFilePicker, actionSelect, "", []string{"enter"}, "")
	reg(scopeFilePicker, actionClose, "", []string{"esc"}, "")
	reg(scopeFilePicker, actionUp, "", []string{"k", "up", "ctrl+p"}, "")
	reg(scopeFilePicker, actionDown, "", []string{"j", "down", "ctrl+n"}, "")
	reg(scopeFilePicker, actionQuit, "", []string{"q", "ctrl+c"}, "")

	// Import preview footer.
	reg(scopeImportPreview, actionUp, "", []string{"k", "up", "ctrl+p"}, "")
	reg(scopeImportPreview, actionDown, "", []string{"j", "down", "ctrl+n"}, "")
	reg(scopeImportPreview, actionImportAll, "import:all", []string{"a"}, "all")
	reg(scopeImportPreview, actionSkipDupes, "import:skip-dupes", []string{"s"}, "skip")
	reg(scopeImportPreview, actionImportRawView, "import:raw-view", []string{"r"}, "rules")
	reg(scopeImportPreview, actionImportPreviewToggle, "import:preview-toggle", []string{"p"}, "preview")
	reg(scopeImportPreview, actionClose, "import:cancel", []string{"esc"}, "")

	// Filter input footer.
	reg(scopeFilterInput, actionFilterSave, "filter:save", []string{"ctrl+s"}, "save")
	reg(scopeFilterInput, actionFilterLoad, "filter:apply", []string{"ctrl+l"}, "load")
	reg(scopeFilterInput, actionLeft, "", []string{"left"}, "")
	reg(scopeFilterInput, actionRight, "", []string{"right"}, "")
	reg(scopeFilterInput, actionClearSearch, "", []string{"esc"}, "")
	reg(scopeFilterInput, actionConfirm, "", []string{"enter"}, "")

	// Settings mode footers.
	reg(scopeSettingsModeCat, actionUp, "", []string{"up", "ctrl+p"}, "")
	reg(scopeSettingsModeCat, actionDown, "", []string{"down", "ctrl+n"}, "")
	reg(scopeSettingsModeCat, actionLeft, "", []string{"left"}, "")
	reg(scopeSettingsModeCat, actionRight, "", []string{"right"}, "")
	reg(scopeSettingsModeCat, actionSave, "", []string{"enter"}, "")
	reg(scopeSettingsModeCat, actionClose, "", []string{"esc"}, "")
	reg(scopeSettingsModeTag, actionUp, "", []string{"up", "ctrl+p"}, "")
	reg(scopeSettingsModeTag, actionDown, "", []string{"down", "ctrl+n"}, "")
	reg(scopeSettingsModeTag, actionLeft, "", []string{"left"}, "")
	reg(scopeSettingsModeTag, actionRight, "", []string{"right"}, "")
	reg(scopeSettingsModeTag, actionSave, "", []string{"enter"}, "")
	reg(scopeSettingsModeTag, actionClose, "", []string{"esc"}, "")
	reg(scopeRuleEditor, actionUp, "", []string{"up", "ctrl+p"}, "")
	reg(scopeRuleEditor, actionDown, "", []string{"down", "ctrl+n"}, "")
	reg(scopeRuleEditor, actionLeft, "", []string{"left"}, "")
	reg(scopeRuleEditor, actionRight, "", []string{"right"}, "")
	reg(scopeRuleEditor, actionToggleSelect, "", []string{"space"}, "")
	reg(scopeRuleEditor, actionSelect, "", []string{"enter"}, "")
	reg(scopeRuleEditor, actionClose, "", []string{"esc"}, "")
	reg(scopeDryRunModal, actionUp, "", []string{"k", "up", "ctrl+p"}, "")
	reg(scopeDryRunModal, actionDown, "", []string{"j", "down", "ctrl+n"}, "")
	reg(scopeDryRunModal, actionClose, "", []string{"esc"}, "")

	// Settings active section footers.
	reg(scopeSettingsActiveCategories, actionUp, "", []string{"k", "up", "ctrl+p"}, "")
	reg(scopeSettingsActiveCategories, actionDown, "", []string{"j", "down", "ctrl+n"}, "")
	reg(scopeSettingsActiveCategories, actionBack, "", []string{"esc"}, "")
	reg(scopeSettingsActiveCategories, actionAdd, "", []string{"a"}, "add")
	reg(scopeSettingsActiveCategories, actionSelect, "", []string{"enter"}, "")
	reg(scopeSettingsActiveCategories, actionDelete, "", []string{"del"}, "delete")
	reg(scopeSettingsActiveTags, actionUp, "", []string{"k", "up", "ctrl+p"}, "")
	reg(scopeSettingsActiveTags, actionDown, "", []string{"j", "down", "ctrl+n"}, "")
	reg(scopeSettingsActiveTags, actionBack, "", []string{"esc"}, "")
	reg(scopeSettingsActiveTags, actionAdd, "", []string{"a"}, "add")
	reg(scopeSettingsActiveTags, actionSelect, "", []string{"enter"}, "")
	reg(scopeSettingsActiveTags, actionDelete, "", []string{"del"}, "delete")
	reg(scopeSettingsActiveRules, actionUp, "", []string{"k", "up", "ctrl+p"}, "")
	reg(scopeSettingsActiveRules, actionDown, "", []string{"j", "down", "ctrl+n"}, "")
	reg(scopeSettingsActiveRules, actionBack, "", []string{"esc"}, "")
	reg(scopeSettingsActiveRules, actionAdd, "", []string{"a"}, "add")
	reg(scopeSettingsActiveRules, actionSelect, "", []string{"enter"}, "")
	reg(scopeSettingsActiveRules, actionRuleToggleEnabled, "", []string{"space"}, "")
	reg(scopeSettingsActiveRules, actionDelete, "", []string{"del"}, "delete")
	reg(scopeSettingsActiveRules, actionRuleMoveUp, "", []string{"K"}, "move up")
	reg(scopeSettingsActiveRules, actionRuleMoveDown, "", []string{"J"}, "move down")
	reg(scopeSettingsActiveRules, actionApplyAll, "rules:apply", []string{"A"}, "apply all")
	reg(scopeSettingsActiveRules, actionRuleDryRun, "rules:dry-run", []string{"D"}, "dry run")
	reg(scopeSettingsActiveFilters, actionUp, "", []string{"k", "up", "ctrl+p"}, "")
	reg(scopeSettingsActiveFilters, actionDown, "", []string{"j", "down", "ctrl+n"}, "")
	reg(scopeSettingsActiveFilters, actionBack, "", []string{"esc"}, "")
	reg(scopeSettingsActiveFilters, actionAdd, "", []string{"a"}, "add")
	reg(scopeSettingsActiveFilters, actionSelect, "", []string{"enter"}, "")
	reg(scopeSettingsActiveFilters, actionDelete, "", []string{"del"}, "delete")
	reg(scopeSettingsActiveChart, actionUp, "", []string{"k", "up", "ctrl+p"}, "")
	reg(scopeSettingsActiveChart, actionDown, "", []string{"j", "down", "ctrl+n"}, "")
	reg(scopeSettingsActiveChart, actionBack, "", []string{"esc"}, "")
	reg(scopeSettingsActiveChart, actionLeft, "", []string{"h", "left"}, "week")
	reg(scopeSettingsActiveChart, actionRight, "", []string{"l", "right"}, "week")
	reg(scopeSettingsActiveChart, actionConfirm, "", []string{"enter"}, "")
	reg(scopeSettingsActiveDBImport, actionUp, "", []string{"k", "up", "ctrl+p"}, "")
	reg(scopeSettingsActiveDBImport, actionDown, "", []string{"j", "down", "ctrl+n"}, "")
	reg(scopeSettingsActiveDBImport, actionBack, "", []string{"esc"}, "")
	reg(scopeSettingsActiveDBImport, actionRowsPerPage, "", []string{"+/-", "+", "=", "-"}, "rows")
	reg(scopeSettingsActiveDBImport, actionCommandDefault, "", []string{"o"}, "default")
	reg(scopeSettingsActiveDBImport, actionClearDB, "settings:clear-db", []string{"c"}, "clear")
	reg(scopeSettingsActiveDBImport, actionImport, "import:start", []string{"i"}, "import")
	reg(scopeSettingsActiveDBImport, actionResetKeybindings, "", []string{"r"}, "reset")
	reg(scopeSettingsActiveImportHist, actionBack, "", []string{"esc"}, "")
	reg(scopeSettingsActiveImportHist, actionUp, "", []string{"k", "up", "ctrl+p"}, "")
	reg(scopeSettingsActiveImportHist, actionDown, "", []string{"j", "down", "ctrl+n"}, "")
	reg(scopeFilterEdit, actionUp, "", []string{"up", "ctrl+p"}, "")
	reg(scopeFilterEdit, actionDown, "", []string{"down", "ctrl+n"}, "")
	reg(scopeFilterEdit, actionLeft, "", []string{"left"}, "")
	reg(scopeFilterEdit, actionRight, "", []string{"right"}, "")
	reg(scopeFilterEdit, actionSave, "", []string{"enter"}, "")
	reg(scopeFilterEdit, actionClose, "", []string{"esc"}, "")

	// Settings navigation footer: left/right, up/down, enter, i, tab, q
	reg(scopeSettingsNav, actionLeft, "", []string{"h", "left"}, "")
	reg(scopeSettingsNav, actionRight, "", []string{"l", "right"}, "")
	reg(scopeSettingsNav, actionUp, "", []string{"k", "up", "ctrl+p"}, "")
	reg(scopeSettingsNav, actionDown, "", []string{"j", "down", "ctrl+n"}, "")
	reg(scopeSettingsNav, actionActivate, "", []string{"enter"}, "")
	reg(scopeSettingsNav, actionImport, "import:start", []string{"i"}, "import")
	reg(scopeSettingsNav, actionNextTab, "nav:next-tab", []string{"tab"}, "")
	reg(scopeSettingsNav, actionQuit, "", []string{"q", "ctrl+c"}, "")

	return r
}

func (r *KeyRegistry) Register(b Binding) {
	if r == nil {
		return
	}
	for _, scope := range b.Scopes {
		scope = strings.TrimSpace(scope)
		if scope == "" {
			continue
		}
		if len(b.Keys) == 0 {
			continue
		}
		if _, ok := r.bindingsByScope[scope]; !ok {
			r.bindingsByScope[scope] = nil
		}
		if _, ok := r.indexByScope[scope]; !ok {
			r.indexByScope[scope] = make(map[string]*Binding)
		}
		normKeys := normalizeKeyList(b.Keys)
		if len(normKeys) == 0 {
			continue
		}
		if r.scopeHasAnyKey(scope, normKeys) {
			continue
		}

		copyBinding := b
		copyBinding.Keys = normKeys
		copyBinding.Scopes = []string{scope}
		r.bindingsByScope[scope] = append(r.bindingsByScope[scope], &copyBinding)
		for _, k := range copyBinding.Keys {
			r.indexByScope[scope][k] = &copyBinding
		}
	}
}

func (r *KeyRegistry) BindingsForScope(scope string) []Binding {
	if r == nil {
		return nil
	}
	items := r.bindingsByScope[scope]
	out := make([]Binding, 0, len(items))
	for _, b := range items {
		out = append(out, *b)
	}
	return out
}

func (r *KeyRegistry) Lookup(keyName, scope string) *Binding {
	if r == nil || keyName == "" {
		return nil
	}
	keyName = normalizeKeyName(keyName)
	if b := r.lookupInScope(keyName, scope); b != nil {
		return b
	}
	if scope != scopeGlobal {
		if b := r.lookupInScope(keyName, scopeGlobal); b != nil {
			return b
		}
	}
	return nil
}

func (r *KeyRegistry) HelpBindings(scope string) []key.Binding {
	items := r.BindingsForScope(scope)
	out := make([]key.Binding, 0, len(items))
	for _, b := range items {
		if len(b.Keys) == 0 || strings.TrimSpace(b.Help) == "" {
			continue
		}
		helpKey := b.Keys[0]
		out = append(out, key.NewBinding(key.WithKeys(b.Keys...), key.WithHelp(helpKey, b.Help)))
	}
	return out
}

func (r *KeyRegistry) lookupInScope(keyName, scope string) *Binding {
	if scope == "" {
		return nil
	}
	lookup, ok := r.indexByScope[scope]
	if !ok {
		return nil
	}
	if b := lookup[keyName]; b != nil {
		return b
	}
	// Terminal/caps-lock behavior can vary across environments for single
	// alphabetic keys. If exact-case lookup misses, try opposite-case fallback.
	if len(keyName) == 1 {
		ch := keyName[0]
		switch {
		case ch >= 'a' && ch <= 'z':
			if b := lookup[strings.ToUpper(keyName)]; b != nil {
				return b
			}
		case ch >= 'A' && ch <= 'Z':
			if b := lookup[strings.ToLower(keyName)]; b != nil {
				return b
			}
		}
	}
	return nil
}

func (r *KeyRegistry) scopeHasAnyKey(scope string, keys []string) bool {
	lookup := r.indexByScope[scope]
	for _, k := range keys {
		if _, exists := lookup[k]; exists {
			return true
		}
	}
	return false
}

func normalizeKeyList(keys []string) []string {
	out := make([]string, 0, len(keys))
	seen := make(map[string]bool)
	for _, k := range keys {
		n := normalizeKeyName(k)
		if n == "" || seen[n] {
			continue
		}
		seen[n] = true
		out = append(out, n)
	}
	return out
}

func normalizeKeyName(k string) string {
	if k == " " {
		return "space"
	}
	trimmed := strings.TrimSpace(k)
	if trimmed == "" {
		return ""
	}
	if len(trimmed) == 1 {
		ch := trimmed[0]
		if ch >= 'A' && ch <= 'Z' {
			// Preserve single uppercase rune so uppercase/lowercase bindings
			// can be distinct actions within the same scope.
			return trimmed
		}
	}
	s := strings.ToLower(trimmed)
	if s == "" {
		return ""
	}
	s = strings.ReplaceAll(s, " ", "")
	s = strings.ReplaceAll(s, "control+", "ctrl+")
	s = strings.ReplaceAll(s, "ctl+", "ctrl+")
	s = strings.ReplaceAll(s, "return", "enter")
	s = strings.ReplaceAll(s, "spacebar", "space")
	if s == "delete" {
		s = "del"
	}
	return s
}

func (r *KeyRegistry) ApplyOverrides(overrides []shortcutOverride) error {
	items := make([]keybindingConfig, 0, len(overrides))
	for _, o := range overrides {
		items = append(items, keybindingConfig{
			Scope:  o.Scope,
			Action: o.Action,
			Keys:   o.Keys,
		})
	}
	return r.ApplyKeybindingConfig(items)
}

func (r *KeyRegistry) ApplyKeybindingConfig(items []keybindingConfig) error {
	if r == nil || len(items) == 0 {
		return nil
	}
	type pair struct {
		scope  string
		action Action
	}
	seenPair := make(map[pair]bool)
	for _, o := range items {
		scope := strings.TrimSpace(o.Scope)
		if scope == "" {
			return fmt.Errorf("shortcut override: scope is required")
		}
		action := Action(strings.TrimSpace(o.Action))
		if action == "" {
			return fmt.Errorf("shortcut override scope=%q: action is required", scope)
		}
		keys := normalizeKeyList(o.Keys)
		if len(keys) == 0 {
			return fmt.Errorf("shortcut override scope=%q action=%q: keys are required", scope, action)
		}
		if action == actionSearch {
			hasSlash := false
			for _, k := range keys {
				if normalizeKeyName(k) == "/" {
					hasSlash = true
					break
				}
			}
			if !hasSlash {
				keys = append([]string{"/"}, keys...)
				keys = normalizeKeyList(keys)
			}
		}

		bindings := r.bindingsByScope[scope]
		if len(bindings) == 0 {
			return fmt.Errorf("shortcut override scope=%q action=%q: unknown scope", scope, action)
		}
		var target *Binding
		for _, b := range bindings {
			if b.Action == action {
				target = b
				break
			}
		}
		if target == nil {
			return fmt.Errorf("shortcut override scope=%q action=%q: unknown action in scope", scope, action)
		}
		p := pair{scope: scope, action: action}
		if seenPair[p] {
			return fmt.Errorf("shortcut override scope=%q action=%q: duplicated override entry", scope, action)
		}
		seenPair[p] = true
		target.Keys = keys
	}

	r.rebuildIndex()
	for scope, bindings := range r.bindingsByScope {
		seen := make(map[string]Action)
		for _, b := range bindings {
			for _, k := range b.Keys {
				if prev, ok := seen[k]; ok {
					return fmt.Errorf("shortcut override conflict in scope=%q: key %q used by both %q and %q", scope, k, prev, b.Action)
				}
				seen[k] = b.Action
			}
		}
	}
	return nil
}

func (r *KeyRegistry) ExportKeybindingConfig() []keybindingConfig {
	if r == nil {
		return nil
	}
	var out []keybindingConfig
	for scope, bindings := range r.bindingsByScope {
		for _, b := range bindings {
			out = append(out, keybindingConfig{
				Scope:  scope,
				Action: string(b.Action),
				Keys:   append([]string(nil), b.Keys...),
			})
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Scope != out[j].Scope {
			return out[i].Scope < out[j].Scope
		}
		return out[i].Action < out[j].Action
	})
	return out
}

func (r *KeyRegistry) rebuildIndex() {
	r.indexByScope = make(map[string]map[string]*Binding, len(r.bindingsByScope))
	for scope, bindings := range r.bindingsByScope {
		r.indexByScope[scope] = make(map[string]*Binding)
		for _, b := range bindings {
			for _, k := range b.Keys {
				r.indexByScope[scope][k] = b
			}
		}
	}
}
