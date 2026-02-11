package main

import (
	"fmt"
	"sort"
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
	scopeCommandPalette           = "command_palette"
	scopeCommandMode              = "command_mode"
	scopeManagerTransactions      = "manager_transactions"
	scopeManager                  = "manager"
	scopeManagerModal             = "manager_modal"
	scopeDashboard                = "dashboard"
	scopeDashboardTimeframe       = "dashboard_timeframe"
	scopeDashboardCustomInput     = "dashboard_custom_input"
	scopeTransactions             = "transactions"
	scopeDetailModal              = "detail_modal"
	scopeCategoryPicker           = "category_picker"
	scopeTagPicker                = "tag_picker"
	scopeAccountNukePicker        = "account_nuke_picker"
	scopeFilePicker               = "file_picker"
	scopeDupeModal                = "dupe_modal"
	scopeSearch                   = "search"
	scopeSettingsNav              = "settings_nav"
	scopeSettingsModeCat          = "settings_mode_cat"
	scopeSettingsModeTag          = "settings_mode_tag"
	scopeSettingsModeRule         = "settings_mode_rule"
	scopeSettingsModeRuleCat      = "settings_mode_rule_cat"
	scopeSettingsActiveCategories = "settings_active_categories"
	scopeSettingsActiveTags       = "settings_active_tags"
	scopeSettingsActiveRules      = "settings_active_rules"
	scopeSettingsActiveChart      = "settings_active_chart"
	scopeSettingsActiveDBImport   = "settings_active_db_import"
	scopeSettingsActiveImportHist = "settings_active_import_history"
)

const (
	actionQuit                     Action = "quit"
	actionNextTab                  Action = "next_tab"
	actionPrevTab                  Action = "prev_tab"
	actionNavigate                 Action = "navigate"
	actionSelect                   Action = "select"
	actionClose                    Action = "close"
	actionCancel                   Action = "cancel"
	actionSearch                   Action = "search"
	actionSort                     Action = "sort"
	actionSortDirection            Action = "sort_direction"
	actionFilterCategory           Action = "filter_category"
	actionToggleSelect             Action = "toggle_select"
	actionRangeHighlight           Action = "range_highlight"
	actionQuickCategory            Action = "quick_category"
	actionQuickTag                 Action = "quick_tag"
	actionTimeframe                Action = "timeframe"
	actionMove                     Action = "move"
	actionImportAll                Action = "import_all"
	actionSkipDupes                Action = "skip_dupes"
	actionClearSearch              Action = "clear_search"
	actionConfirm                  Action = "confirm"
	actionColor                    Action = "color"
	actionSave                     Action = "save"
	actionNext                     Action = "next"
	actionSelectItem               Action = "select_item"
	actionAdd                      Action = "add"
	actionEdit                     Action = "edit"
	actionDelete                   Action = "delete"
	actionApplyAll                 Action = "apply_all"
	actionToggleWeekBoundary       Action = "toggle_week_boundary"
	actionRowsPerPage              Action = "rows_per_page"
	actionClearDB                  Action = "clear_db"
	actionImport                   Action = "import"
	actionNukeAccount              Action = "nuke_account"
	actionColumn                   Action = "column"
	actionSection                  Action = "section"
	actionActivate                 Action = "activate"
	actionBack                     Action = "back"
	actionFocusAccounts            Action = "focus_accounts"
	actionJumpTop                  Action = "jump_top"
	actionJumpBottom               Action = "jump_bottom"
	actionCommandPalette           Action = "command_palette"
	actionCommandMode              Action = "command_mode"
	actionCommandDefault           Action = "command_default"
	actionCommandGoDashboard       Action = "command_go_dashboard"
	actionCommandGoTransactions    Action = "command_go_transactions"
	actionCommandGoSettings        Action = "command_go_settings"
	actionCommandFocusAccounts     Action = "command_focus_accounts"
	actionCommandFocusTransactions Action = "command_focus_transactions"
	actionCommandApplyTagRules     Action = "command_apply_tag_rules"
	actionCommandClearFilters      Action = "command_clear_filters"
	actionCommandClearSelection    Action = "command_clear_selection"
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
	reg(scopeGlobal, actionCommandGoDashboard, []string{"1"}, "dashboard")
	reg(scopeGlobal, actionCommandGoTransactions, []string{"2"}, "transactions")
	reg(scopeGlobal, actionCommandGoSettings, []string{"3"}, "settings")
	reg(scopeGlobal, actionCommandPalette, []string{"ctrl+k"}, "commands")
	reg(scopeGlobal, actionCommandMode, []string{":"}, "command")

	reg(scopeCommandPalette, actionNavigate, []string{"j/k", "j", "k", "up", "down", "ctrl+p", "ctrl+n"}, "navigate")
	reg(scopeCommandPalette, actionSelect, []string{"enter"}, "run")
	reg(scopeCommandPalette, actionClose, []string{"esc"}, "close")
	reg(scopeCommandMode, actionNavigate, []string{"j/k", "j", "k", "up", "down", "ctrl+p", "ctrl+n"}, "navigate")
	reg(scopeCommandMode, actionSelect, []string{"enter"}, "run")
	reg(scopeCommandMode, actionClose, []string{"esc"}, "close")

	// Manager transactions-primary footer additions.
	reg(scopeManagerTransactions, actionFocusAccounts, []string{"A"}, "accounts")
	// Manager accounts-active footer.
	reg(scopeManager, actionNavigate, []string{"j/k", "j", "k", "up", "down"}, "navigate")
	reg(scopeManager, actionBack, []string{"esc"}, "back")
	reg(scopeManager, actionToggleSelect, []string{"space"}, "toggle active")
	reg(scopeManager, actionSave, []string{"s"}, "save active")
	reg(scopeManager, actionAdd, []string{"a"}, "add account")
	reg(scopeManager, actionSelect, []string{"enter"}, "edit account")
	reg(scopeManager, actionQuickTag, []string{"T"}, "quick tag")
	reg(scopeManager, actionClearDB, []string{"c"}, "clear txns")
	reg(scopeManager, actionDelete, []string{"d"}, "delete empty")
	reg(scopeManager, actionNextTab, []string{"tab"}, "next tab")
	reg(scopeManager, actionQuit, []string{"q", "ctrl+c"}, "quit")
	reg(scopeManagerModal, actionNavigate, []string{"j/k", "j", "k", "up", "down"}, "field")
	reg(scopeManagerModal, actionColor, []string{"h/l", "h", "left", "l", "right", "space"}, "toggle")
	reg(scopeManagerModal, actionSave, []string{"enter"}, "save")
	reg(scopeManagerModal, actionClose, []string{"esc"}, "cancel")

	// Dashboard footer: d, tab, shift+tab, q
	reg(scopeDashboard, actionTimeframe, []string{"d"}, "timeframe")
	reg(scopeDashboard, actionNextTab, []string{"tab"}, "next tab")
	reg(scopeDashboard, actionPrevTab, []string{"shift+tab"}, "prev tab")
	reg(scopeDashboard, actionQuit, []string{"q", "ctrl+c"}, "quit")

	// Dashboard timeframe focus footer: h/l, enter, esc
	reg(scopeDashboardTimeframe, actionColumn, []string{"h/l", "h", "left", "l", "right"}, "navigate")
	reg(scopeDashboardTimeframe, actionSelect, []string{"enter"}, "select")
	reg(scopeDashboardTimeframe, actionCancel, []string{"esc"}, "cancel")

	// Dashboard custom input footer: enter, esc
	reg(scopeDashboardCustomInput, actionConfirm, []string{"enter"}, "confirm")
	reg(scopeDashboardCustomInput, actionCancel, []string{"esc"}, "cancel")

	// Transactions footer.
	reg(scopeTransactions, actionSearch, []string{"/"}, "search")
	reg(scopeTransactions, actionSort, []string{"s"}, "sort")
	reg(scopeTransactions, actionSortDirection, []string{"S"}, "sort dir")
	reg(scopeTransactions, actionFilterCategory, []string{"f"}, "filter cat")
	reg(scopeTransactions, actionQuickCategory, []string{"c"}, "quick cat")
	reg(scopeTransactions, actionQuickTag, []string{"t"}, "quick tag")
	reg(scopeTransactions, actionToggleSelect, []string{"space", " "}, "toggle sel")
	reg(scopeTransactions, actionRangeHighlight, []string{"shift+up/down", "shift+up", "shift+down"}, "hl range")
	reg(scopeTransactions, actionCommandClearSelection, []string{"u"}, "clear sel")
	reg(scopeTransactions, actionJumpTop, []string{"g"}, "top")
	reg(scopeTransactions, actionJumpBottom, []string{"G"}, "bottom")
	reg(scopeTransactions, actionClearSearch, []string{"esc"}, "clear")
	reg(scopeTransactions, actionSelect, []string{"enter"}, "select")
	reg(scopeTransactions, actionNavigate, []string{"j/k", "j", "k", "up", "down", "ctrl+p", "ctrl+n"}, "navigate")
	reg(scopeTransactions, actionNextTab, []string{"tab"}, "next tab")
	reg(scopeTransactions, actionQuit, []string{"q", "ctrl+c"}, "quit")

	// Category quick picker footer.
	reg(scopeCategoryPicker, actionNavigate, []string{"j/k", "j", "k", "up", "down"}, "navigate")
	reg(scopeCategoryPicker, actionSelect, []string{"enter"}, "apply")
	reg(scopeCategoryPicker, actionClose, []string{"esc"}, "cancel")
	reg(scopeTagPicker, actionNavigate, []string{"j/k", "j", "k", "up", "down"}, "navigate")
	reg(scopeTagPicker, actionToggleSelect, []string{"space"}, "toggle")
	reg(scopeTagPicker, actionSelect, []string{"enter"}, "apply")
	reg(scopeTagPicker, actionClose, []string{"esc"}, "cancel")
	reg(scopeAccountNukePicker, actionNavigate, []string{"j/k", "j", "k", "up", "down"}, "navigate")
	reg(scopeAccountNukePicker, actionSelect, []string{"enter"}, "nuke")
	reg(scopeAccountNukePicker, actionClose, []string{"esc"}, "cancel")

	// Detail / file picker footers: enter, esc, j/k, q
	reg(scopeDetailModal, actionSelect, []string{"enter"}, "select")
	reg(scopeDetailModal, actionEdit, []string{"n"}, "notes")
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
	reg(scopeDupeModal, actionClose, []string{"esc", "c"}, "cancel")

	// Search footer.
	reg(scopeSearch, actionClearSearch, []string{"esc"}, "clear search")
	reg(scopeSearch, actionConfirm, []string{"enter"}, "confirm")

	// Settings mode footers.
	reg(scopeSettingsModeCat, actionNavigate, []string{"j/k", "j", "k", "up", "down"}, "field")
	reg(scopeSettingsModeCat, actionColor, []string{"h/l", "h", "left", "l", "right"}, "color")
	reg(scopeSettingsModeCat, actionSave, []string{"enter"}, "save")
	reg(scopeSettingsModeCat, actionClose, []string{"esc"}, "cancel")
	reg(scopeSettingsModeTag, actionNavigate, []string{"j/k", "j", "k", "up", "down"}, "field")
	reg(scopeSettingsModeTag, actionColor, []string{"h/l", "h", "left", "l", "right"}, "color")
	reg(scopeSettingsModeTag, actionSave, []string{"enter"}, "save")
	reg(scopeSettingsModeTag, actionClose, []string{"esc"}, "cancel")
	reg(scopeSettingsModeRule, actionNext, []string{"enter"}, "next")
	reg(scopeSettingsModeRule, actionClose, []string{"esc"}, "cancel")
	reg(scopeSettingsModeRuleCat, actionSelectItem, []string{"j/k", "j", "k", "up", "down"}, "select")
	reg(scopeSettingsModeRuleCat, actionSave, []string{"enter"}, "save")
	reg(scopeSettingsModeRuleCat, actionClose, []string{"esc"}, "cancel")

	// Settings active section footers.
	reg(scopeSettingsActiveCategories, actionNavigate, []string{"j/k", "j", "k", "up", "down"}, "navigate")
	reg(scopeSettingsActiveCategories, actionBack, []string{"esc"}, "back")
	reg(scopeSettingsActiveCategories, actionAdd, []string{"a"}, "add")
	reg(scopeSettingsActiveCategories, actionSelect, []string{"enter"}, "edit")
	reg(scopeSettingsActiveCategories, actionDelete, []string{"d"}, "delete")
	reg(scopeSettingsActiveTags, actionNavigate, []string{"j/k", "j", "k", "up", "down"}, "navigate")
	reg(scopeSettingsActiveTags, actionBack, []string{"esc"}, "back")
	reg(scopeSettingsActiveTags, actionAdd, []string{"a"}, "add")
	reg(scopeSettingsActiveTags, actionSelect, []string{"enter"}, "edit")
	reg(scopeSettingsActiveTags, actionDelete, []string{"d"}, "delete")
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
	reg(scopeSettingsActiveDBImport, actionCommandDefault, []string{"o"}, "cmd default")
	reg(scopeSettingsActiveDBImport, actionClearDB, []string{"c"}, "clear db")
	reg(scopeSettingsActiveDBImport, actionImport, []string{"i"}, "import")
	reg(scopeSettingsActiveDBImport, actionNukeAccount, []string{"N"}, "nuke account")
	reg(scopeSettingsActiveImportHist, actionBack, []string{"esc"}, "back")
	reg(scopeSettingsActiveImportHist, actionNavigate, []string{"j/k", "j", "k", "up", "down"}, "navigate")

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
