package core

import (
	"database/sql"
	"testing"

	tea "github.com/charmbracelet/bubbletea"

	"jaskmoney-v2/core/widgets"
)

type jumpPaneTab struct {
	jumped string
}

type stubJumpScreen struct{}

func (s *stubJumpScreen) Title() string        { return "Jump Picker" }
func (s *stubJumpScreen) Scope() string        { return "screen:jump-picker" }
func (s *stubJumpScreen) View(int, int) string { return "jump" }
func (s *stubJumpScreen) Update(msg tea.Msg) (Screen, tea.Cmd, bool) {
	if key, ok := msg.(tea.KeyMsg); ok && key.String() == "t" {
		return s, func() tea.Msg { return JumpTargetSelectedMsg{Key: "t"} }, true
	}
	return s, nil, false
}

func (t *jumpPaneTab) ID() string                           { return "jump-tab" }
func (t *jumpPaneTab) Title() string                        { return "JumpTab" }
func (t *jumpPaneTab) Scope() string                        { return "pane:jump:one" }
func (t *jumpPaneTab) Update(m *Model, msg tea.Msg) tea.Cmd { return nil }
func (t *jumpPaneTab) Build(m *Model) widgets.Widget {
	return widgets.Box{Title: "jump", Content: "body"}
}
func (t *jumpPaneTab) JumpTargets() []JumpTarget {
	return []JumpTarget{
		{Key: "a", Label: "Accounts"},
		{Key: "t", Label: "Transactions"},
	}
}
func (t *jumpPaneTab) JumpToTarget(m *Model, key string) (bool, tea.Cmd) {
	t.jumped = key
	return true, StatusCmd("Focused pane: " + key)
}

func TestJumpModeOpensPickerAndSelectsTarget(t *testing.T) {
	keys := NewKeyRegistry([]KeyBinding{
		{Keys: []string{"v"}, Action: "jump", Scopes: []string{"*"}},
	})
	tab := &jumpPaneTab{}
	m := NewModel([]Tab{tab}, keys, NewCommandRegistry(nil), &sql.DB{}, AppData{})
	m.OpenJumpPickerModal = func(_ *Model, _ []JumpTarget) Screen { return &stubJumpScreen{} }

	next, _ := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'v'}})
	updated := next.(Model)
	if updated.screens.Len() != 1 {
		t.Fatalf("expected jump picker to open")
	}

	next2, cmd := updated.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'t'}})
	updated2 := next2.(Model)
	if updated2.screens.Len() != 0 {
		t.Fatalf("expected jump picker to close after selecting target")
	}
	if cmd == nil {
		t.Fatalf("expected jump selection command")
	}
	msg := cmd()
	next3, _ := updated2.Update(msg)
	_ = next3.(Model)
	if tab.jumped != "t" {
		t.Fatalf("jump target mismatch: %s", tab.jumped)
	}
}
