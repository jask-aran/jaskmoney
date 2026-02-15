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
	scopeTransactions             = "transactions"
	scopeDetailModal              = "detail_modal"
	scopeCategoryPicker           = "category_picker"
	scopeTagPicker                = "tag_picker"
	scopeFilterApplyPicker        = "filter_apply_picker"
	scopeFilterEdit               = "filter_edit"
	scopeFilePicker               = "file_picker"
	scopeDupeModal                = "dupe_modal"
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
	actionTimeframe                Action = "timeframe"
	actionImportAll                Action = "import_all"
	actionSkipDupes                Action = "skip_dupes"
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
	reg(scopeGlobal, actionCommandGoTransactions, "nav:manager", []string{"1"}, "manager")
	reg(scopeGlobal, actionCommandGoDashboard, "nav:dashboard", []string{"2"}, "dashboard")
	reg(scopeGlobal, actionCommandGoSettings, "nav:settings", []string{"3"}, "settings")
	reg(scopeGlobal, actionJumpMode, "jump:activate", []string{"v"}, "jump")
	reg(scopeGlobal, actionCommandPalette, "palette:open", []string{"ctrl+k"}, "commands")
	reg(scopeGlobal, actionCommandMode, "cmd:open", []string{":"}, "command")

	reg(scopeCommandPalette, actionUp, "", []string{"up", "ctrl+p", "k"}, "up")
	reg(scopeCommandPalette, actionDown, "", []string{"down", "ctrl+n", "j"}, "down")
	reg(scopeCommandPalette, actionSelect, "", []string{"enter"}, "run")
	reg(scopeCommandPalette, actionClose, "", []string{"esc"}, "close")
	reg(scopeCommandMode, actionUp, "", []string{"up", "ctrl+p", "k"}, "up")
	reg(scopeCommandMode, actionDown, "", []string{"down", "ctrl+n", "j"}, "down")
	reg(scopeCommandMode, actionSelect, "", []string{"enter"}, "run")
	reg(scopeCommandMode, actionClose, "", []string{"esc"}, "close")
	reg(scopeJumpOverlay, actionJumpCancel, "jump:cancel", []string{"esc"}, "cancel")

	// Manager transactions-primary footer additions.
	reg(scopeManagerTransactions, actionFocusAccounts, "", []string{"a"}, "accounts")
	// Manager accounts-active footer.
	reg(scopeManager, actionLeft, "", []string{"h", "left"}, "")
	reg(scopeManager, actionRight, "", []string{"l", "right"}, "")
	reg(scopeManager, actionBack, "", []string{"esc"}, "back")
	reg(scopeManager, actionSearch, "", []string{"/"}, "filter")
	reg(scopeManager, actionFilterLoad, "filter:apply", []string{"ctrl+l"}, "apply filter")
	reg(scopeManager, actionToggleSelect, "", []string{"space"}, "toggle active")
	reg(scopeManager, actionAdd, "", []string{"a"}, "add account")
	reg(scopeManager, actionSelect, "", []string{"enter"}, "edit account")
	reg(scopeManager, actionDelete, "", []string{"del"}, "account actions")
	reg(scopeManager, actionNextTab, "nav:next-tab", []string{"tab"}, "")
	reg(scopeManager, actionQuit, "", []string{"q", "ctrl+c"}, "quit")
	reg(scopeManagerModal, actionUp, "", []string{"k", "up", "ctrl+p"}, "")
	reg(scopeManagerModal, actionDown, "", []string{"j", "down", "ctrl+n"}, "")
	reg(scopeManagerModal, actionLeft, "", []string{"h", "left"}, "")
	reg(scopeManagerModal, actionRight, "", []string{"l", "right"}, "")
	reg(scopeManagerModal, actionToggleSelect, "", []string{"space"}, "toggle")
	reg(scopeManagerModal, actionConfirm, "", []string{"enter"}, "save")
	reg(scopeManagerModal, actionClose, "", []string{"esc"}, "cancel")
	reg(scopeManagerAccountAction, actionUp, "", []string{"k", "up", "ctrl+p"}, "")
	reg(scopeManagerAccountAction, actionDown, "", []string{"j", "down", "ctrl+n"}, "")
	reg(scopeManagerAccountAction, actionSelect, "", []string{"enter"}, "choose")
	reg(scopeManagerAccountAction, actionClose, "", []string{"esc"}, "cancel")

	// Dashboard footer: d, tab, shift+tab, q
	reg(scopeDashboard, actionTimeframe, "dash:timeframe", []string{"d"}, "timeframe")
	reg(scopeDashboard, actionNextTab, "nav:next-tab", []string{"tab"}, "next tab")
	reg(scopeDashboard, actionPrevTab, "nav:prev-tab", []string{"shift+tab"}, "prev tab")
	reg(scopeDashboard, actionQuit, "", []string{"q", "ctrl+c"}, "quit")
	reg(scopeDashboardFocused, actionDashboardModeNext, "dash:mode-next", []string{"]"}, "next mode")
	reg(scopeDashboardFocused, actionDashboardModePrev, "dash:mode-prev", []string{"["}, "prev mode")
	reg(scopeDashboardFocused, actionDashboardDrillDown, "dash:drill-down", []string{"enter"}, "drill down")
	reg(scopeDashboardFocused, actionCancel, "", []string{"esc"}, "unfocus")

	// Dashboard timeframe focus footer: left/right, enter, esc
	reg(scopeDashboardTimeframe, actionLeft, "", []string{"h", "left"}, "prev")
	reg(scopeDashboardTimeframe, actionRight, "", []string{"l", "right"}, "next")
	reg(scopeDashboardTimeframe, actionSelect, "", []string{"enter"}, "select")
	reg(scopeDashboardTimeframe, actionCancel, "", []string{"esc"}, "cancel")

	// Dashboard custom input footer: enter, esc
	reg(scopeDashboardCustomInput, actionConfirm, "", []string{"enter"}, "confirm")
	reg(scopeDashboardCustomInput, actionCancel, "", []string{"esc"}, "cancel")

	// Transactions footer.
	reg(scopeTransactions, actionSearch, "filter:open", []string{"/"}, "filter")
	reg(scopeTransactions, actionFilterSave, "filter:save", []string{"ctrl+s"}, "save filter")
	reg(scopeTransactions, actionFilterLoad, "filter:apply", []string{"ctrl+l"}, "apply filter")
	reg(scopeTransactions, actionSort, "txn:sort", []string{"s"}, "sort")
	reg(scopeTransactions, actionSortDirection, "txn:sort-dir", []string{"S"}, "sort dir")
	reg(scopeTransactions, actionQuickCategory, "txn:quick-category", []string{"c"}, "quick cat")
	reg(scopeTransactions, actionQuickTag, "txn:quick-tag", []string{"t"}, "quick tag")
	reg(scopeTransactions, actionToggleSelect, "txn:select", []string{"space", " "}, "toggle sel")
	reg(scopeTransactions, actionRangeHighlight, "", []string{"shift+up/down", "shift+up", "shift+down"}, "hl range")
	reg(scopeTransactions, actionCommandClearSelection, "txn:clear-selection", []string{"u"}, "clear sel")
	reg(scopeTransactions, actionJumpTop, "txn:jump-top", []string{"g"}, "top")
	reg(scopeTransactions, actionJumpBottom, "txn:jump-bottom", []string{"G"}, "bottom")
	reg(scopeTransactions, actionClearSearch, "filter:clear", []string{"esc"}, "clear")
	reg(scopeTransactions, actionSelect, "txn:detail", []string{"enter"}, "select")
	reg(scopeTransactions, actionUp, "", []string{"k", "up", "ctrl+p"}, "")
	reg(scopeTransactions, actionDown, "", []string{"j", "down", "ctrl+n"}, "")
	reg(scopeTransactions, actionNextTab, "nav:next-tab", []string{"tab"}, "")
	reg(scopeTransactions, actionQuit, "", []string{"q", "ctrl+c"}, "quit")

	// Category quick picker footer.
	reg(scopeCategoryPicker, actionUp, "", []string{"k", "up", "ctrl+p"}, "up")
	reg(scopeCategoryPicker, actionDown, "", []string{"j", "down", "ctrl+n"}, "down")
	reg(scopeCategoryPicker, actionSelect, "", []string{"enter"}, "apply")
	reg(scopeCategoryPicker, actionClose, "", []string{"esc"}, "cancel")
	reg(scopeTagPicker, actionUp, "", []string{"up", "ctrl+p", "k"}, "up")
	reg(scopeTagPicker, actionDown, "", []string{"down", "ctrl+n", "j"}, "down")
	reg(scopeTagPicker, actionToggleSelect, "", []string{"space"}, "toggle")
	reg(scopeTagPicker, actionSelect, "", []string{"enter"}, "apply")
	reg(scopeTagPicker, actionClose, "", []string{"esc"}, "cancel")
	reg(scopeFilterApplyPicker, actionUp, "", []string{"up", "ctrl+p", "k"}, "up")
	reg(scopeFilterApplyPicker, actionDown, "", []string{"down", "ctrl+n", "j"}, "down")
	reg(scopeFilterApplyPicker, actionSelect, "", []string{"enter"}, "apply")
	reg(scopeFilterApplyPicker, actionClose, "", []string{"esc"}, "cancel")

	// Detail / file picker footers: enter, esc, up/down, q
	reg(scopeDetailModal, actionSelect, "", []string{"enter"}, "select")
	reg(scopeDetailModal, actionEdit, "", []string{"n"}, "notes")
	reg(scopeDetailModal, actionClose, "", []string{"esc"}, "close")
	reg(scopeDetailModal, actionUp, "", []string{"k", "up", "ctrl+p"}, "up")
	reg(scopeDetailModal, actionDown, "", []string{"j", "down", "ctrl+n"}, "down")
	reg(scopeDetailModal, actionQuit, "", []string{"q", "ctrl+c"}, "quit")
	reg(scopeFilePicker, actionSelect, "", []string{"enter"}, "select")
	reg(scopeFilePicker, actionClose, "", []string{"esc"}, "close")
	reg(scopeFilePicker, actionUp, "", []string{"k", "up", "ctrl+p"}, "up")
	reg(scopeFilePicker, actionDown, "", []string{"j", "down", "ctrl+n"}, "down")
	reg(scopeFilePicker, actionQuit, "", []string{"q", "ctrl+c"}, "quit")

	// Dupe modal footer.
	reg(scopeDupeModal, actionImportAll, "", []string{"a"}, "import all")
	reg(scopeDupeModal, actionSkipDupes, "", []string{"s"}, "skip dupes")
	reg(scopeDupeModal, actionClose, "", []string{"esc", "c"}, "cancel")

	// Filter input footer.
	reg(scopeFilterInput, actionFilterSave, "filter:save", []string{"ctrl+s"}, "save filter")
	reg(scopeFilterInput, actionFilterLoad, "filter:apply", []string{"ctrl+l"}, "apply filter")
	reg(scopeFilterInput, actionLeft, "", []string{"left"}, "")
	reg(scopeFilterInput, actionRight, "", []string{"right"}, "")
	reg(scopeFilterInput, actionClearSearch, "", []string{"esc"}, "clear")
	reg(scopeFilterInput, actionConfirm, "", []string{"enter"}, "confirm")

	// Settings mode footers.
	reg(scopeSettingsModeCat, actionUp, "", []string{"k", "up", "ctrl+p"}, "prev field")
	reg(scopeSettingsModeCat, actionDown, "", []string{"j", "down", "ctrl+n"}, "next field")
	reg(scopeSettingsModeCat, actionLeft, "", []string{"h", "left"}, "prev color")
	reg(scopeSettingsModeCat, actionRight, "", []string{"l", "right"}, "next color")
	reg(scopeSettingsModeCat, actionSave, "", []string{"enter"}, "save")
	reg(scopeSettingsModeCat, actionClose, "", []string{"esc"}, "cancel")
	reg(scopeSettingsModeTag, actionUp, "", []string{"k", "up", "ctrl+p"}, "prev field")
	reg(scopeSettingsModeTag, actionDown, "", []string{"j", "down", "ctrl+n"}, "next field")
	reg(scopeSettingsModeTag, actionLeft, "", []string{"h", "left"}, "prev")
	reg(scopeSettingsModeTag, actionRight, "", []string{"l", "right"}, "next")
	reg(scopeSettingsModeTag, actionSave, "", []string{"enter"}, "save")
	reg(scopeSettingsModeTag, actionClose, "", []string{"esc"}, "cancel")
	reg(scopeRuleEditor, actionUp, "", []string{"k", "up", "ctrl+p"}, "up")
	reg(scopeRuleEditor, actionDown, "", []string{"j", "down", "ctrl+n"}, "down")
	reg(scopeRuleEditor, actionLeft, "", []string{"h", "left"}, "prev")
	reg(scopeRuleEditor, actionRight, "", []string{"l", "right"}, "next")
	reg(scopeRuleEditor, actionToggleSelect, "", []string{"space"}, "toggle")
	reg(scopeRuleEditor, actionSelect, "", []string{"enter"}, "save/next")
	reg(scopeRuleEditor, actionClose, "", []string{"esc"}, "cancel")
	reg(scopeDryRunModal, actionUp, "", []string{"k", "up", "ctrl+p"}, "up")
	reg(scopeDryRunModal, actionDown, "", []string{"j", "down", "ctrl+n"}, "down")
	reg(scopeDryRunModal, actionClose, "", []string{"esc"}, "close")

	// Settings active section footers.
	reg(scopeSettingsActiveCategories, actionUp, "", []string{"k", "up", "ctrl+p"}, "up")
	reg(scopeSettingsActiveCategories, actionDown, "", []string{"j", "down", "ctrl+n"}, "down")
	reg(scopeSettingsActiveCategories, actionBack, "", []string{"esc"}, "back")
	reg(scopeSettingsActiveCategories, actionAdd, "", []string{"a"}, "add")
	reg(scopeSettingsActiveCategories, actionSelect, "", []string{"enter"}, "edit")
	reg(scopeSettingsActiveCategories, actionDelete, "", []string{"del"}, "delete")
	reg(scopeSettingsActiveTags, actionUp, "", []string{"k", "up", "ctrl+p"}, "up")
	reg(scopeSettingsActiveTags, actionDown, "", []string{"j", "down", "ctrl+n"}, "down")
	reg(scopeSettingsActiveTags, actionBack, "", []string{"esc"}, "back")
	reg(scopeSettingsActiveTags, actionAdd, "", []string{"a"}, "add")
	reg(scopeSettingsActiveTags, actionSelect, "", []string{"enter"}, "edit")
	reg(scopeSettingsActiveTags, actionDelete, "", []string{"del"}, "delete")
	reg(scopeSettingsActiveRules, actionUp, "", []string{"k", "up", "ctrl+p"}, "up")
	reg(scopeSettingsActiveRules, actionDown, "", []string{"j", "down", "ctrl+n"}, "down")
	reg(scopeSettingsActiveRules, actionBack, "", []string{"esc"}, "back")
	reg(scopeSettingsActiveRules, actionAdd, "", []string{"a"}, "add")
	reg(scopeSettingsActiveRules, actionSelect, "", []string{"enter"}, "edit")
	reg(scopeSettingsActiveRules, actionRuleToggleEnabled, "", []string{"e"}, "toggle")
	reg(scopeSettingsActiveRules, actionDelete, "", []string{"del"}, "delete")
	reg(scopeSettingsActiveRules, actionRuleMoveUp, "", []string{"K"}, "move up")
	reg(scopeSettingsActiveRules, actionRuleMoveDown, "", []string{"J"}, "move down")
	reg(scopeSettingsActiveRules, actionApplyAll, "rules:apply", []string{"A"}, "apply all")
	reg(scopeSettingsActiveRules, actionRuleDryRun, "rules:dry-run", []string{"D"}, "dry run")
	reg(scopeSettingsActiveFilters, actionUp, "", []string{"k", "up", "ctrl+p"}, "up")
	reg(scopeSettingsActiveFilters, actionDown, "", []string{"j", "down", "ctrl+n"}, "down")
	reg(scopeSettingsActiveFilters, actionBack, "", []string{"esc"}, "back")
	reg(scopeSettingsActiveFilters, actionAdd, "", []string{"a"}, "add")
	reg(scopeSettingsActiveFilters, actionSelect, "", []string{"enter"}, "edit")
	reg(scopeSettingsActiveFilters, actionDelete, "", []string{"del"}, "delete")
	reg(scopeSettingsActiveChart, actionUp, "", []string{"k", "up", "ctrl+p"}, "up")
	reg(scopeSettingsActiveChart, actionDown, "", []string{"j", "down", "ctrl+n"}, "down")
	reg(scopeSettingsActiveChart, actionBack, "", []string{"esc"}, "back")
	reg(scopeSettingsActiveChart, actionLeft, "", []string{"h", "left"}, "toggle week boundary")
	reg(scopeSettingsActiveChart, actionRight, "", []string{"l", "right"}, "toggle week boundary")
	reg(scopeSettingsActiveChart, actionConfirm, "", []string{"enter"}, "toggle")
	reg(scopeSettingsActiveDBImport, actionUp, "", []string{"k", "up", "ctrl+p"}, "")
	reg(scopeSettingsActiveDBImport, actionDown, "", []string{"j", "down", "ctrl+n"}, "")
	reg(scopeSettingsActiveDBImport, actionBack, "", []string{"esc"}, "back")
	reg(scopeSettingsActiveDBImport, actionRowsPerPage, "", []string{"+/-", "+", "=", "-"}, "rows/page")
	reg(scopeSettingsActiveDBImport, actionCommandDefault, "", []string{"o"}, "cmd default")
	reg(scopeSettingsActiveDBImport, actionClearDB, "settings:clear-db", []string{"c"}, "clear db")
	reg(scopeSettingsActiveDBImport, actionImport, "import:start", []string{"i"}, "import")
	reg(scopeSettingsActiveDBImport, actionResetKeybindings, "", []string{"r"}, "reset keys")
	reg(scopeSettingsActiveImportHist, actionBack, "", []string{"esc"}, "back")
	reg(scopeSettingsActiveImportHist, actionUp, "", []string{"k", "up", "ctrl+p"}, "up")
	reg(scopeSettingsActiveImportHist, actionDown, "", []string{"j", "down", "ctrl+n"}, "down")
	reg(scopeFilterEdit, actionUp, "", []string{"k", "up", "ctrl+p"}, "prev field")
	reg(scopeFilterEdit, actionDown, "", []string{"j", "down", "ctrl+n"}, "next field")
	reg(scopeFilterEdit, actionLeft, "", []string{"left", "h"}, "left")
	reg(scopeFilterEdit, actionRight, "", []string{"right", "l"}, "right")
	reg(scopeFilterEdit, actionSave, "", []string{"enter"}, "save")
	reg(scopeFilterEdit, actionClose, "", []string{"esc"}, "cancel")

	// Settings navigation footer: left/right, up/down, enter, i, tab, q
	reg(scopeSettingsNav, actionLeft, "", []string{"h", "left"}, "column")
	reg(scopeSettingsNav, actionRight, "", []string{"l", "right"}, "column")
	reg(scopeSettingsNav, actionUp, "", []string{"k", "up", "ctrl+p"}, "section")
	reg(scopeSettingsNav, actionDown, "", []string{"j", "down", "ctrl+n"}, "section")
	reg(scopeSettingsNav, actionActivate, "", []string{"enter"}, "activate")
	reg(scopeSettingsNav, actionImport, "import:start", []string{"i"}, "import")
	reg(scopeSettingsNav, actionNextTab, "nav:next-tab", []string{"tab"}, "next tab")
	reg(scopeSettingsNav, actionQuit, "", []string{"q", "ctrl+c"}, "quit")

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
