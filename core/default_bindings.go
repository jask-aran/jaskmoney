package core

import "strings"

func DefaultKeyBindings() []KeyBinding {
	return []KeyBinding{
		{Keys: []string{"q"}, Action: "quit", Description: "quit", Scopes: []string{"*"}},
		{Keys: []string{"v"}, Action: "jump", Description: "jump mode", Scopes: []string{"*"}},
		{Keys: []string{"left"}, Action: "pane-nav", Description: "pane prev", Scopes: []string{"*"}},
		{Keys: []string{"right"}, Action: "pane-nav", Description: "pane next", Scopes: []string{"*"}},
		{Keys: []string{"up"}, Action: "pane-nav", Description: "pane prev", Scopes: []string{"*"}},
		{Keys: []string{"down"}, Action: "pane-nav", Description: "pane next", Scopes: []string{"*"}},
		{Keys: []string{"enter"}, Action: "pane-focus", Description: "focus pane", Scopes: []string{"*"}},
		{Keys: []string{"j", "down"}, Action: "table-down", Description: "row down", Scopes: []string{"pane:manager:transactions"}},
		{Keys: []string{"k", "up"}, Action: "table-up", Description: "row up", Scopes: []string{"pane:manager:transactions"}},
		{Keys: []string{"/"}, Action: "table-filter", Description: "filter", Scopes: []string{"pane:manager:transactions"}},
		{Keys: []string{"s"}, Action: "table-sort", Description: "sort", Scopes: []string{"pane:manager:transactions"}},
		{Keys: []string{"S"}, Action: "table-sort-dir", Description: "sort dir", Scopes: []string{"pane:manager:transactions"}},
		{Keys: []string{"c"}, Action: "quick-category", Description: "quick cat", Scopes: []string{"pane:manager:transactions"}},
		{Keys: []string{"t"}, Action: "quick-tag", Description: "quick tag", Scopes: []string{"pane:manager:transactions"}},
		{Keys: []string{"left", "h", "up", "k"}, Action: "manager-account-prev", Description: "prev account", Scopes: []string{"pane:manager:accounts"}},
		{Keys: []string{"right", "l", "down", "j"}, Action: "manager-account-next", Description: "next account", Scopes: []string{"pane:manager:accounts"}},
		{Keys: []string{"a"}, Action: "manager-account-add", Description: "add account", Scopes: []string{"pane:manager:accounts"}},
		{Keys: []string{"e", "enter"}, Action: "manager-account-edit", Description: "edit account", Scopes: []string{"pane:manager:accounts"}},
		{Keys: []string{"space"}, Action: "manager-account-scope", Description: "toggle scope", Scopes: []string{"pane:manager:accounts"}},
		{Keys: []string{"del"}, Action: "manager-account-actions", Description: "account actions", Scopes: []string{"pane:manager:accounts"}},
		{Keys: []string{"r"}, Action: "manager-account-refresh", Description: "refresh", Scopes: []string{"pane:manager:accounts"}},
		{Keys: []string{"left", "h"}, Action: "dash-prev", Description: "prev range", Scopes: []string{"pane:dashboard:date-picker"}},
		{Keys: []string{"right", "l"}, Action: "dash-next", Description: "next range", Scopes: []string{"pane:dashboard:date-picker"}},
		{Keys: []string{"enter"}, Action: "dash-apply", Description: "apply range", Scopes: []string{"pane:dashboard:date-picker"}},
		{Keys: []string{"j", "k"}, Action: "budget-row", Description: "select row", Scopes: []string{"pane:budget:category-budgets", "pane:budget:spending-targets"}},
		{Keys: []string{"h", "l"}, Action: "budget-month", Description: "month +/-", Scopes: []string{"pane:budget:category-budgets"}},
		{Keys: []string{"r"}, Action: "budget-mode", Description: "raw/effective", Scopes: []string{"pane:budget:category-budgets"}},
		{Keys: []string{"e", "enter"}, Action: "budget-edit", Description: "edit", Scopes: []string{"pane:budget:category-budgets", "pane:budget:spending-targets"}},
		{Keys: []string{"o"}, Action: "budget-override", Description: "override", Scopes: []string{"pane:budget:category-budgets"}},
		{Keys: []string{"a"}, Action: "target-add", Description: "add target", Scopes: []string{"pane:budget:spending-targets", "pane:settings:filters"}},
		{Keys: []string{"del"}, Action: "target-delete", Description: "delete", Scopes: []string{"pane:budget:spending-targets", "pane:settings:filters"}},
		{Keys: []string{"j", "k"}, Action: "settings-nav", Description: "move", Scopes: []string{"pane:settings:rules", "pane:settings:filters"}},
		{Keys: []string{"a"}, Action: "rules-add", Description: "add rule", Scopes: []string{"pane:settings:rules"}},
		{Keys: []string{"e", "enter"}, Action: "rules-edit", Description: "edit rule", Scopes: []string{"pane:settings:rules"}},
		{Keys: []string{"space"}, Action: "rules-toggle", Description: "toggle rule", Scopes: []string{"pane:settings:rules"}},
		{Keys: []string{"u", "n"}, Action: "rules-reorder", Description: "reorder", Scopes: []string{"pane:settings:rules"}},
		{Keys: []string{"A"}, Action: "rules-apply", Description: "apply rules", Scopes: []string{"pane:settings:rules"}},
		{Keys: []string{"D"}, Action: "rules-dry-run", Description: "dry-run", Scopes: []string{"pane:settings:rules"}},
		{Keys: []string{"del"}, Action: "rules-delete", Description: "delete rule", Scopes: []string{"pane:settings:rules"}},
		{Keys: []string{"e", "enter"}, Action: "settings-edit", Description: "edit", Scopes: []string{"pane:settings:filters"}},
		{Keys: []string{"i"}, Action: "db-import", Description: "import", Scopes: []string{"pane:settings:database"}},
		{Keys: []string{"c"}, Action: "db-clear", Description: "clear db", Scopes: []string{"pane:settings:database"}},
		{Keys: []string{"z"}, Action: "db-seed", Description: "seed", Scopes: []string{"pane:settings:database"}},
		{Keys: []string{"ctrl+k"}, Action: "open-command-palette", Description: "commands", Scopes: []string{"*"}},
		{Keys: []string{"p"}, Action: "open-category-picker", Description: "categories", Scopes: []string{"*"}},
		{Keys: []string{"1"}, Action: "switch-tab-1", Description: "dashboard", Scopes: []string{"*"}},
		{Keys: []string{"2"}, Action: "switch-tab-2", Description: "manager", Scopes: []string{"*"}},
		{Keys: []string{"3"}, Action: "switch-tab-3", Description: "budget", Scopes: []string{"*"}},
		{Keys: []string{"4"}, Action: "switch-tab-4", Description: "settings", Scopes: []string{"*"}},
		{Keys: []string{"esc"}, Action: "close", Description: "close", Scopes: []string{"screen:picker", "screen:command", "screen:editor", "screen:jump-picker", "screen:txn-filter", "screen:txn-detail"}},
		{Keys: []string{"enter"}, Action: "select", Description: "select", Scopes: []string{"screen:picker", "screen:command", "screen:jump-picker", "screen:txn-filter", "screen:txn-detail"}},
		{Keys: []string{"j", "down"}, Action: "move", Description: "move", Scopes: []string{"screen:quick-category", "screen:quick-tag"}},
		{Keys: []string{"k", "up"}, Action: "move", Description: "move", Scopes: []string{"screen:quick-category", "screen:quick-tag"}},
		{Keys: []string{"space"}, Action: "toggle", Description: "toggle", Scopes: []string{"screen:quick-tag"}},
		{Keys: []string{"enter"}, Action: "apply", Description: "apply", Scopes: []string{"screen:quick-category", "screen:quick-tag"}},
		{Keys: []string{"esc"}, Action: "cancel", Description: "cancel", Scopes: []string{"screen:quick-category", "screen:quick-tag"}},
		{Keys: []string{"j", "down"}, Action: "scroll-down", Description: "down", Scopes: []string{"screen:rules-dry-run"}},
		{Keys: []string{"k", "up"}, Action: "scroll-up", Description: "up", Scopes: []string{"screen:rules-dry-run"}},
		{Keys: []string{"esc"}, Action: "close", Description: "close", Scopes: []string{"screen:rules-dry-run"}},
	}
}

func DefaultKeybindingsByAction(bindings []KeyBinding) map[string][]string {
	out := make(map[string][]string, len(bindings))
	for _, b := range bindings {
		if strings.TrimSpace(b.Action) == "" || len(b.Keys) == 0 {
			continue
		}
		if _, exists := out[b.Action]; exists {
			continue
		}
		out[b.Action] = append([]string(nil), b.Keys...)
	}
	return out
}

func ApplyActionKeybindings(bindings []KeyBinding, actionKeys map[string][]string) []KeyBinding {
	out := make([]KeyBinding, 0, len(bindings))
	for _, b := range bindings {
		next := KeyBinding{
			Keys:        append([]string(nil), b.Keys...),
			Action:      b.Action,
			Description: b.Description,
			Scopes:      append([]string(nil), b.Scopes...),
		}
		if keys, ok := actionKeys[b.Action]; ok && len(keys) > 0 {
			next.Keys = append([]string(nil), keys...)
		}
		out = append(out, next)
	}
	return out
}

func DefaultJumpKey(bindings []KeyBinding) string {
	for _, b := range bindings {
		if b.Action == "jump" && len(b.Keys) > 0 {
			return b.Keys[0]
		}
	}
	return "v"
}
