package core

import (
	"database/sql"
	"testing"

	tea "github.com/charmbracelet/bubbletea"

	"jaskmoney-v2/core/widgets"
)

type routerTab struct{ hits int }

func (t *routerTab) ID() string                    { return "r" }
func (t *routerTab) Title() string                 { return "Router" }
func (t *routerTab) Scope() string                 { return "tab:r" }
func (t *routerTab) JumpKey() byte                 { return 'r' }
func (t *routerTab) Build(m *Model) widgets.Widget { return widgets.Box{Title: "t", Content: "x"} }
func (t *routerTab) Update(m *Model, msg tea.Msg) tea.Cmd {
	if _, ok := msg.(tea.KeyMsg); ok {
		t.hits++
	}
	return nil
}

type fakeScreen struct{ hits int }

func (s *fakeScreen) Title() string        { return "Screen" }
func (s *fakeScreen) Scope() string        { return "screen:test" }
func (s *fakeScreen) View(int, int) string { return "screen" }
func (s *fakeScreen) Update(msg tea.Msg) (Screen, tea.Cmd, bool) {
	if km, ok := msg.(tea.KeyMsg); ok {
		s.hits++
		if km.String() == "esc" {
			return s, nil, true
		}
	}
	return s, nil, false
}

func TestScreenGetsKeyBeforeTab(t *testing.T) {
	tab := &routerTab{}
	m := NewModel([]Tab{tab}, NewKeyRegistry(nil), NewCommandRegistry(nil), &sql.DB{}, AppData{})
	screen := &fakeScreen{}
	m.PushScreen(screen)

	next, _ := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'x'}})
	updated := next.(Model)
	if screen.hits != 1 {
		t.Fatalf("screen should handle key first")
	}
	if tab.hits != 0 {
		t.Fatalf("tab should not receive key when screen open")
	}
	if updated.screens.Len() != 1 {
		t.Fatalf("screen should remain open")
	}
}

func TestScreenCanPopItself(t *testing.T) {
	tab := &routerTab{}
	m := NewModel([]Tab{tab}, NewKeyRegistry(nil), NewCommandRegistry(nil), &sql.DB{}, AppData{})
	m.PushScreen(&fakeScreen{})
	next, _ := m.Update(tea.KeyMsg{Type: tea.KeyEsc})
	updated := next.(Model)
	if updated.screens.Len() != 0 {
		t.Fatalf("expected screen to pop on esc")
	}
}
