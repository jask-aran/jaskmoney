package tabs

import (
	"database/sql"
	"testing"

	tea "github.com/charmbracelet/bubbletea"

	"jaskmoney-v2/core"
)

func TestPaneHostScopeTracksSelectionAndFocus(t *testing.T) {
	host := NewPaneHost(
		NewStaticPane("p1", "Pane One", "pane:x:1", 'o', true, "one", 10),
		NewStaticPane("p2", "Pane Two", "pane:x:2", 't', true, "two", 10),
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

func TestPaneHostEscDefocuses(t *testing.T) {
	host := NewPaneHost(
		NewStaticPane("p1", "Pane One", "pane:x:1", 'o', true, "one", 10),
		NewStaticPane("p2", "Pane Two", "pane:x:2", 't', true, "two", 10),
	)
	_, _ = host.HandlePaneKey(&core.Model{}, tea.KeyMsg{Type: tea.KeyEnter})
	if got := host.ActivePaneTitle(); got != "Pane One" {
		t.Fatalf("expected pane one focused")
	}
	handled, _ := host.HandlePaneKey(&core.Model{}, tea.KeyMsg{Type: tea.KeyEsc})
	if !handled {
		t.Fatalf("expected esc to be handled by pane host")
	}
	if got := host.Scope(); got != "pane:x:1" {
		t.Fatalf("expected selected scope after unfocus, got %s", got)
	}
}

func TestPaneHostNavigationClearsFocus(t *testing.T) {
	host := NewPaneHost(
		NewStaticPane("p1", "Pane One", "pane:x:1", 'o', true, "one", 10),
		NewStaticPane("p2", "Pane Two", "pane:x:2", 't', true, "two", 10),
	)
	_, _ = host.HandlePaneKey(&core.Model{}, tea.KeyMsg{Type: tea.KeyEnter})
	_, _ = host.HandlePaneKey(&core.Model{}, tea.KeyMsg{Type: tea.KeyRight})
	if got := host.Scope(); got != "pane:x:1" {
		t.Fatalf("expected focus retained on pane one; got %s", got)
	}
}

func TestPaneHostFocusedDoesNotCaptureArrowKeys(t *testing.T) {
	host := NewPaneHost(
		NewStaticPane("p1", "Pane One", "pane:x:1", 'o', true, "one", 10),
		NewStaticPane("p2", "Pane Two", "pane:x:2", 't', true, "two", 10),
	)
	_, _ = host.HandlePaneKey(&core.Model{}, tea.KeyMsg{Type: tea.KeyEnter})
	handled, _ := host.HandlePaneKey(&core.Model{}, tea.KeyMsg{Type: tea.KeyDown})
	if handled {
		t.Fatalf("expected down key to pass through when pane is focused")
	}
}

func TestPaneHostBuildPaneIncludesFocusIndicators(t *testing.T) {
	host := NewPaneHost(
		NewStaticPane("p1", "Pane One", "pane:x:1", 'o', true, "one", 10),
		NewStaticPane("p2", "Pane Two", "pane:x:2", 't', true, "two", 10),
	)
	_, _ = host.HandlePaneKey(&core.Model{}, tea.KeyMsg{Type: tea.KeyEnter})
	if host.BuildPane("p1", &core.Model{}) == nil {
		t.Fatalf("expected pane widget")
	}
}

func TestPaneHostJumpTargetsAndFocus(t *testing.T) {
	host := NewPaneHost(
		NewStaticPane("p1", "Pane One", "pane:x:1", 'o', true, "one", 10),
		NewStaticPane("p2", "Pane Two", "pane:x:2", 't', false, "two", 10),
		NewStaticPane("p3", "Pane Three", "pane:x:3", 'h', true, "three", 10),
	)
	targets := host.JumpTargets()
	if len(targets) != 2 {
		t.Fatalf("jump target count = %d, want 2", len(targets))
	}
	handled, _ := host.JumpToTarget(&core.Model{}, "h")
	if !handled {
		t.Fatalf("expected jump target to be handled")
	}
	if got := host.ActivePaneTitle(); got != "Pane Three" {
		t.Fatalf("active pane mismatch: %s", got)
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
