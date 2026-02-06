package main

import (
	"strings"

	"github.com/charmbracelet/bubbles/key"
)

type Action string

type Binding struct {
	Action Action
	Keys   []string
	Help   string
	Scopes []string
}

type KeyRegistry struct {
	bindingsByScope map[string][]*Binding
	indexByScope    map[string]map[string]*Binding
}

const (
	scopeGlobal                   = "global"
	scopeDashboard                = "dashboard"
	scopeDashboardTimeframe       = "dashboard_timeframe"
	scopeDashboardCustomInput     = "dashboard_custom_input"
	scopeTransactions             = "transactions"
	scopeDetailModal              = "detail_modal"
	scopeCategoryPicker           = "category_picker"
	scopeFilePicker               = "file_picker"
	scopeDupeModal                = "dupe_modal"
	scopeSearch                   = "search"
	scopeSettingsNav              = "settings_nav"
	scopeSettingsModeCat          = "settings_mode_cat"
	scopeSettingsModeRule         = "settings_mode_rule"
	scopeSettingsModeRuleCat      = "settings_mode_rule_cat"
	scopeSettingsConfirm          = "settings_confirm"
	scopeSettingsActiveCategories = "settings_active_categories"
	scopeSettingsActiveRules      = "settings_active_rules"
	scopeSettingsActiveChart      = "settings_active_chart"
	scopeSettingsActiveDBImport   = "settings_active_db_import"
)

const (
	actionQuit               Action = "quit"
	actionNextTab            Action = "next_tab"
	actionPrevTab            Action = "prev_tab"
	actionNavigate           Action = "navigate"
	actionSelect             Action = "select"
	actionClose              Action = "close"
	actionCancel             Action = "cancel"
	actionSearch             Action = "search"
	actionSort               Action = "sort"
	actionFilterCategory     Action = "filter_category"
	actionToggleSelect       Action = "toggle_select"
	actionRangeHighlight     Action = "range_highlight"
	actionQuickCategory      Action = "quick_category"
	actionTimeframe          Action = "timeframe"
	actionMove               Action = "move"
	actionImportAll          Action = "import_all"
	actionSkipDupes          Action = "skip_dupes"
	actionClearSearch        Action = "clear_search"
	actionConfirm            Action = "confirm"
	actionColor              Action = "color"
	actionSave               Action = "save"
	actionNext               Action = "next"
	actionSelectItem         Action = "select_item"
	actionConfirmRepeat      Action = "confirm_repeat"
	actionCancelAny          Action = "cancel_any"
	actionAdd                Action = "add"
	actionEdit               Action = "edit"
	actionDelete             Action = "delete"
	actionApplyAll           Action = "apply_all"
	actionToggleWeekBoundary Action = "toggle_week_boundary"
	actionRowsPerPage        Action = "rows_per_page"
	actionClearDB            Action = "clear_db"
	actionImport             Action = "import"
	actionColumn             Action = "column"
	actionSection            Action = "section"
	actionActivate           Action = "activate"
	actionBack               Action = "back"
)

func NewKeyRegistry() *KeyRegistry {
	r := &KeyRegistry{
		bindingsByScope: make(map[string][]*Binding),
		indexByScope:    make(map[string]map[string]*Binding),
	}

	reg := func(scope string, action Action, keys []string, help string) {
		r.Register(Binding{Action: action, Keys: keys, Help: help, Scopes: []string{scope}})
	}

	// Global fallback lookup.
	reg(scopeGlobal, actionQuit, []string{"q", "ctrl+c"}, "quit")
	reg(scopeGlobal, actionNextTab, []string{"tab"}, "next tab")
	reg(scopeGlobal, actionPrevTab, []string{"shift+tab"}, "prev tab")

	// Dashboard footer: d, tab, shift+tab, q
	reg(scopeDashboard, actionTimeframe, []string{"d"}, "timeframe")
	reg(scopeDashboard, actionNextTab, []string{"tab"}, "next tab")
	reg(scopeDashboard, actionPrevTab, []string{"shift+tab"}, "prev tab")
	reg(scopeDashboard, actionQuit, []string{"q", "ctrl+c"}, "quit")

	// Dashboard timeframe focus footer: h/l, enter, esc
	reg(scopeDashboardTimeframe, actionMove, []string{"h/l", "h", "left", "l", "right"}, "navigate")
	reg(scopeDashboardTimeframe, actionSelect, []string{"enter"}, "select")
	reg(scopeDashboardTimeframe, actionCancel, []string{"esc"}, "cancel")

	// Dashboard custom input footer: enter, esc
	reg(scopeDashboardCustomInput, actionConfirm, []string{"enter"}, "confirm")
	reg(scopeDashboardCustomInput, actionCancel, []string{"esc"}, "cancel")

	// Transactions footer: /, s, f, enter, j/k, tab, q
	reg(scopeTransactions, actionSearch, []string{"/"}, "search")
	reg(scopeTransactions, actionSort, []string{"s"}, "sort")
	reg(scopeTransactions, actionFilterCategory, []string{"f"}, "filter cat")
	reg(scopeTransactions, actionQuickCategory, []string{"c"}, "quick cat")
	reg(scopeTransactions, actionToggleSelect, []string{"space", " "}, "toggle sel")
	reg(scopeTransactions, actionRangeHighlight, []string{"shift+up/down", "shift+up", "shift+down"}, "hl range")
	reg(scopeTransactions, actionSelect, []string{"enter"}, "select")
	reg(scopeTransactions, actionNavigate, []string{"j/k", "j", "k", "up", "down", "ctrl+p", "ctrl+n"}, "navigate")
	reg(scopeTransactions, actionNextTab, []string{"tab"}, "next tab")
	reg(scopeTransactions, actionQuit, []string{"q", "ctrl+c"}, "quit")

	// Category quick picker footer.
	reg(scopeCategoryPicker, actionNavigate, []string{"j/k", "j", "k", "up", "down"}, "navigate")
	reg(scopeCategoryPicker, actionSelect, []string{"enter"}, "apply")
	reg(scopeCategoryPicker, actionClose, []string{"esc"}, "cancel")

	// Detail / file picker footers: enter, esc, j/k, q
	reg(scopeDetailModal, actionSelect, []string{"enter"}, "select")
	reg(scopeDetailModal, actionClose, []string{"esc"}, "close")
	reg(scopeDetailModal, actionNavigate, []string{"j/k", "j", "k", "up", "down"}, "navigate")
	reg(scopeDetailModal, actionQuit, []string{"q", "ctrl+c"}, "quit")
	reg(scopeFilePicker, actionSelect, []string{"enter"}, "select")
	reg(scopeFilePicker, actionClose, []string{"esc"}, "close")
	reg(scopeFilePicker, actionNavigate, []string{"j/k", "j", "k", "up", "down"}, "navigate")
	reg(scopeFilePicker, actionQuit, []string{"q", "ctrl+c"}, "quit")

	// Dupe modal footer.
	reg(scopeDupeModal, actionImportAll, []string{"a"}, "import all")
	reg(scopeDupeModal, actionSkipDupes, []string{"s"}, "skip dupes")
	reg(scopeDupeModal, actionClose, []string{"esc"}, "cancel")

	// Search footer.
	reg(scopeSearch, actionClearSearch, []string{"esc"}, "clear search")
	reg(scopeSearch, actionConfirm, []string{"enter"}, "confirm")

	// Settings mode footers.
	reg(scopeSettingsModeCat, actionColor, []string{"h/l", "h", "left", "l", "right"}, "color")
	reg(scopeSettingsModeCat, actionSave, []string{"enter"}, "save")
	reg(scopeSettingsModeCat, actionClose, []string{"esc"}, "cancel")
	reg(scopeSettingsModeRule, actionNext, []string{"enter"}, "next")
	reg(scopeSettingsModeRule, actionClose, []string{"esc"}, "cancel")
	reg(scopeSettingsModeRuleCat, actionSelectItem, []string{"j/k", "j", "k", "up", "down"}, "select")
	reg(scopeSettingsModeRuleCat, actionSave, []string{"enter"}, "save")
	reg(scopeSettingsModeRuleCat, actionClose, []string{"esc"}, "cancel")

	// Settings confirm footer.
	reg(scopeSettingsConfirm, actionConfirmRepeat, []string{"repeat"}, "confirm")
	reg(scopeSettingsConfirm, actionCancelAny, []string{"any"}, "cancel")

	// Settings active section footers.
	reg(scopeSettingsActiveCategories, actionNavigate, []string{"j/k", "j", "k", "up", "down"}, "navigate")
	reg(scopeSettingsActiveCategories, actionBack, []string{"esc"}, "back")
	reg(scopeSettingsActiveCategories, actionAdd, []string{"a"}, "add")
	reg(scopeSettingsActiveCategories, actionEdit, []string{"e"}, "edit")
	reg(scopeSettingsActiveCategories, actionDelete, []string{"d"}, "delete")
	reg(scopeSettingsActiveRules, actionNavigate, []string{"j/k", "j", "k", "up", "down"}, "navigate")
	reg(scopeSettingsActiveRules, actionBack, []string{"esc"}, "back")
	reg(scopeSettingsActiveRules, actionAdd, []string{"a"}, "add")
	reg(scopeSettingsActiveRules, actionEdit, []string{"e"}, "edit")
	reg(scopeSettingsActiveRules, actionDelete, []string{"d"}, "delete")
	reg(scopeSettingsActiveRules, actionApplyAll, []string{"A"}, "apply all")
	reg(scopeSettingsActiveChart, actionNavigate, []string{"j/k", "j", "k", "up", "down"}, "navigate")
	reg(scopeSettingsActiveChart, actionBack, []string{"esc"}, "back")
	reg(scopeSettingsActiveChart, actionToggleWeekBoundary, []string{"h/l", "h", "left", "l", "right"}, "toggle week boundary")
	reg(scopeSettingsActiveChart, actionConfirm, []string{"enter"}, "toggle")
	reg(scopeSettingsActiveDBImport, actionNavigate, []string{"j/k", "j", "k", "up", "down"}, "navigate")
	reg(scopeSettingsActiveDBImport, actionBack, []string{"esc"}, "back")
	reg(scopeSettingsActiveDBImport, actionRowsPerPage, []string{"+/-", "+", "=", "-"}, "rows/page")
	reg(scopeSettingsActiveDBImport, actionClearDB, []string{"c"}, "clear db")
	reg(scopeSettingsActiveDBImport, actionImport, []string{"i"}, "import")

	// Settings navigation footer: h/l, j/k, enter, i, tab, q
	reg(scopeSettingsNav, actionColumn, []string{"h/l", "h", "left", "l", "right"}, "column")
	reg(scopeSettingsNav, actionSection, []string{"j/k", "j", "k", "up", "down"}, "section")
	reg(scopeSettingsNav, actionActivate, []string{"enter"}, "activate")
	reg(scopeSettingsNav, actionImport, []string{"i"}, "import")
	reg(scopeSettingsNav, actionNextTab, []string{"tab"}, "next tab")
	reg(scopeSettingsNav, actionQuit, []string{"q", "ctrl+c"}, "quit")

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
		if r.scopeHasAnyKey(scope, b.Keys) {
			continue
		}

		copyBinding := b
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
		if len(b.Keys) == 0 {
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
	return lookup[keyName]
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
