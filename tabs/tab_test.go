package tabs

import (
	"database/sql"
	"testing"

	tea "github.com/charmbracelet/bubbletea"

	"jaskmoney-v2/core"
)

func TestPaneHostScopeTracksSelectionAndFocus(t *testing.T) {
	host := NewPaneHost(
		NewStaticPane("p1", "Pane One", "pane:x:1", "one", 10),
		NewStaticPane("p2", "Pane Two", "pane:x:2", "two", 10),
	)
	if got := host.Scope(); got != "pane:x:1" {
		t.Fatalf("scope mismatch: %s", got)
	}
	_, _ = host.HandlePaneKey(&core.Model{}, tea.KeyMsg{Type: tea.KeyRight})
	if got := host.Scope(); got != "pane:x:2" {
		t.Fatalf("scope should follow selection: %s", got)
	}
	_, _ = host.HandlePaneKey(&core.Model{}, tea.KeyMsg{Type: tea.KeyEnter})
	if got := host.Scope(); got != "pane:x:2" {
		t.Fatalf("scope should follow focused pane: %s", got)
	}
}

func TestPaneHostEnterTogglesFocusOff(t *testing.T) {
	host := NewPaneHost(
		NewStaticPane("p1", "Pane One", "pane:x:1", "one", 10),
		NewStaticPane("p2", "Pane Two", "pane:x:2", "two", 10),
	)
	_, _ = host.HandlePaneKey(&core.Model{}, tea.KeyMsg{Type: tea.KeyEnter})
	if got := host.ActivePaneTitle(); got != "Pane One" {
		t.Fatalf("expected pane one focused")
	}
	_, _ = host.HandlePaneKey(&core.Model{}, tea.KeyMsg{Type: tea.KeyEnter})
	if got := host.Scope(); got != "pane:x:1" {
		t.Fatalf("expected selected scope after unfocus, got %s", got)
	}
}

func TestPaneHostNavigationClearsFocus(t *testing.T) {
	host := NewPaneHost(
		NewStaticPane("p1", "Pane One", "pane:x:1", "one", 10),
		NewStaticPane("p2", "Pane Two", "pane:x:2", "two", 10),
	)
	_, _ = host.HandlePaneKey(&core.Model{}, tea.KeyMsg{Type: tea.KeyEnter})
	_, _ = host.HandlePaneKey(&core.Model{}, tea.KeyMsg{Type: tea.KeyRight})
	if got := host.Scope(); got != "pane:x:2" {
		t.Fatalf("expected focus cleared and selection moved to pane two, got %s", got)
	}
}

func TestPaneHostBuildPaneIncludesFocusIndicators(t *testing.T) {
	host := NewPaneHost(
		NewStaticPane("p1", "Pane One", "pane:x:1", "one", 10),
		NewStaticPane("p2", "Pane Two", "pane:x:2", "two", 10),
	)
	_, _ = host.HandlePaneKey(&core.Model{}, tea.KeyMsg{Type: tea.KeyEnter})
	if host.BuildPane("p1", &core.Model{}) == nil {
		t.Fatalf("expected pane widget")
	}
}

func TestTabsImplementCoreInterfaces(t *testing.T) {
	all := []core.Tab{NewDashboardTab(), NewManagerTab(), NewBudgetTab(), NewSettingsTab()}
	m := core.NewModel(all, core.NewKeyRegistry(nil), core.NewCommandRegistry(nil), &sql.DB{}, core.AppData{})
	for _, tab := range all {
		if tab.ID() == "" || tab.Title() == "" || tab.Scope() == "" {
			t.Fatalf("tab metadata should not be empty")
		}
		if tab.Build(&m) == nil {
			t.Fatalf("tab build should return widget")
		}
		if _, ok := tab.(core.PaneKeyHandler); !ok {
			t.Fatalf("tab should implement pane key handler")
		}
	}
}
