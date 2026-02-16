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
		{Keys: []string{"ctrl+k"}, Action: "open-command-palette", Description: "commands", Scopes: []string{"*"}},
		{Keys: []string{"p"}, Action: "open-category-picker", Description: "categories", Scopes: []string{"*"}},
		{Keys: []string{"1"}, Action: "switch-tab-1", Description: "dashboard", Scopes: []string{"*"}},
		{Keys: []string{"2"}, Action: "switch-tab-2", Description: "manager", Scopes: []string{"*"}},
		{Keys: []string{"3"}, Action: "switch-tab-3", Description: "budget", Scopes: []string{"*"}},
		{Keys: []string{"4"}, Action: "switch-tab-4", Description: "settings", Scopes: []string{"*"}},
		{Keys: []string{"esc"}, Action: "close", Description: "close", Scopes: []string{"screen:picker", "screen:command", "screen:editor", "screen:jump-picker"}},
		{Keys: []string{"enter"}, Action: "select", Description: "select", Scopes: []string{"screen:picker", "screen:command", "screen:jump-picker"}},
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
