package core

import (
	"testing"

	tea "github.com/charmbracelet/bubbletea"
)

func TestKeyRegistryScopeMatch(t *testing.T) {
	reg := NewKeyRegistry([]KeyBinding{
		{Keys: []string{"ctrl+k"}, Action: "palette", Scopes: []string{"tab:a"}},
		{Keys: []string{"q"}, Action: "quit", Scopes: []string{"*"}},
	})
	if !reg.IsAction(tea.KeyMsg{Type: tea.KeyCtrlK}, "palette", "tab:a") {
		t.Fatalf("expected ctrl+k in tab:a")
	}
	if reg.IsAction(tea.KeyMsg{Type: tea.KeyCtrlK}, "palette", "tab:b") {
		t.Fatalf("did not expect ctrl+k in tab:b")
	}
	if !reg.IsAction(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'q'}}, "quit", "tab:b") {
		t.Fatalf("expected q to match wildcard scope")
	}
}
