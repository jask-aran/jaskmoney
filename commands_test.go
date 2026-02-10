package main

import (
	"testing"

	tea "github.com/charmbracelet/bubbletea"
)

func TestCommandRegistryHasExpectedCommands(t *testing.T) {
	reg := NewCommandRegistry(NewKeyRegistry())
	all := reg.All()
	want := map[string]bool{
		"go:dashboard":         true,
		"go:transactions":      true,
		"go:settings":          true,
		"focus:accounts":       true,
		"focus:transactions":   true,
		"import":               true,
		"apply:category-rules": true,
		"apply:tag-rules":      true,
		"clear:search":         true,
		"clear:filters":        true,
		"clear:selection":      true,
	}
	if len(all) != len(want) {
		t.Fatalf("command count = %d, want %d", len(all), len(want))
	}
	for _, cmd := range all {
		if !want[cmd.ID] {
			t.Fatalf("unexpected command ID %q", cmd.ID)
		}
	}
}

func TestCommandSearchIncludesDescriptionAndID(t *testing.T) {
	reg := NewCommandRegistry(NewKeyRegistry())
	m := newModel()
	m.db = nil

	byDesc := reg.Search("uncategorized", m, "")
	if len(byDesc) == 0 || byDesc[0].Command.ID != "apply:category-rules" {
		t.Fatalf("description search failed, got %+v", byDesc)
	}

	byID := reg.Search("go:set", m, "")
	found := false
	for _, match := range byID {
		if match.Command.ID == "go:settings" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected go:settings in ID search results, got %+v", byID)
	}
}

func TestCommandSearchPrefersMRUWhenMatched(t *testing.T) {
	reg := NewCommandRegistry(NewKeyRegistry())
	m := newModel()
	got := reg.Search("go", m, "go:transactions")
	if len(got) == 0 {
		t.Fatal("expected search results")
	}
	if got[0].Command.ID != "go:transactions" {
		t.Fatalf("top command = %q, want go:transactions", got[0].Command.ID)
	}
}

func TestExecuteSelectedCommandSkipsDisabledAtCursor(t *testing.T) {
	m := newModel()
	m.commandOpen = true
	m.commandCursor = 0
	m.commandMatches = []CommandMatch{
		{
			Command: Command{
				ID:      "disabled",
				Execute: func(m model) (model, tea.Cmd, error) { return m, nil, nil },
			},
			Enabled:        false,
			DisabledReason: "disabled",
		},
		{
			Command: Command{
				ID: "enabled",
				Execute: func(m model) (model, tea.Cmd, error) {
					m.activeTab = tabSettings
					return m, nil, nil
				},
			},
			Enabled: true,
		},
	}

	next, _ := m.executeSelectedCommand()
	got := next.(model)
	if got.activeTab != tabSettings {
		t.Fatalf("activeTab = %d, want %d", got.activeTab, tabSettings)
	}
	if got.lastCommandID != "enabled" {
		t.Fatalf("lastCommandID = %q, want enabled", got.lastCommandID)
	}
	if got.commandOpen {
		t.Fatal("command UI should close after successful execution")
	}
}

func TestCommandOpenHotkeys(t *testing.T) {
	m := newModel()
	m.ready = true
	m.activeTab = tabManager

	next, _ := m.Update(tea.KeyMsg{Type: tea.KeyCtrlK})
	got := next.(model)
	if !got.commandOpen || got.commandUIKind != commandUIKindPalette {
		t.Fatalf("ctrl+k should open palette, open=%v kind=%q", got.commandOpen, got.commandUIKind)
	}

	m2 := newModel()
	m2.ready = true
	m2.activeTab = tabManager
	next2, _ := m2.Update(keyMsg(":"))
	got2 := next2.(model)
	if !got2.commandOpen || got2.commandUIKind != commandUIKindColon {
		t.Fatalf(": should open colon mode, open=%v kind=%q", got2.commandOpen, got2.commandUIKind)
	}
}

func TestCommandOpenBlockedByModal(t *testing.T) {
	m := newModel()
	m.ready = true
	m.showDetail = true

	next, _ := m.Update(tea.KeyMsg{Type: tea.KeyCtrlK})
	got := next.(model)
	if got.commandOpen {
		t.Fatal("palette should not open while detail modal is active")
	}
}
