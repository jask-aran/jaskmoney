package core

import (
	"database/sql"
	"testing"

	tea "github.com/charmbracelet/bubbletea"

	"jaskmoney-v2/core/widgets"
)

type paneNavTab struct {
	handled []string
}

func (t *paneNavTab) ID() string                           { return "p" }
func (t *paneNavTab) Title() string                        { return "PaneTab" }
func (t *paneNavTab) Scope() string                        { return "pane:test" }
func (t *paneNavTab) JumpKey() byte                        { return 'p' }
func (t *paneNavTab) Update(m *Model, msg tea.Msg) tea.Cmd { return nil }
func (t *paneNavTab) Build(m *Model) widgets.Widget        { return widgets.Pane{Title: "P", Height: 10} }
func (t *paneNavTab) ActivePaneTitle() string              { return "Pane" }
func (t *paneNavTab) HandlePaneKey(m *Model, msg tea.KeyMsg) (bool, tea.Cmd) {
	t.handled = append(t.handled, msg.String())
	if msg.String() == "right" || msg.String() == "left" || msg.String() == "enter" {
		return true, StatusCmd("pane key")
	}
	return false, nil
}

func TestPaneNavigationKeysRouteToActiveTab(t *testing.T) {
	tab := &paneNavTab{}
	keys := NewKeyRegistry([]KeyBinding{{Keys: []string{"q"}, Action: "quit", Scopes: []string{"*"}}})
	m := NewModel([]Tab{tab}, keys, NewCommandRegistry(nil), &sql.DB{}, AppData{})

	next, cmd := m.Update(tea.KeyMsg{Type: tea.KeyRight})
	updated := next.(Model)
	if len(tab.handled) == 0 || tab.handled[0] != "right" {
		t.Fatalf("expected pane handler to receive right key")
	}
	if cmd == nil {
		t.Fatalf("expected pane handler command")
	}
	if msg, ok := cmd().(StatusMsg); !ok || msg.Text == "" {
		t.Fatalf("expected status msg from pane handler")
	}
	if updated.statusErr {
		t.Fatalf("unexpected status error")
	}
}
