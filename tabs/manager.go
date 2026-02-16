package tabs

import (
	tea "github.com/charmbracelet/bubbletea"

	"jaskmoney-v2/core"
	"jaskmoney-v2/widgets"
)

type ManagerTab struct {
	host PaneHost
}

func NewManagerTab() *ManagerTab {
	return &ManagerTab{host: NewPaneHost(
		NewTransactionsPane("transactions", "Transactions", "pane:manager:transactions", 't', true),
		NewStaticPane("filters", "Filters", "pane:manager:filters", 'f', true, "Filters placeholder", 10),
		NewStaticPane("inspector", "Inspector", "pane:manager:inspector", 'i', true, "Inspector placeholder", 10),
	)}
}

func (t *ManagerTab) ID() string              { return "manager" }
func (t *ManagerTab) Title() string           { return "Manager" }
func (t *ManagerTab) Scope() string           { return t.host.Scope() }
func (t *ManagerTab) ActivePaneTitle() string { return t.host.ActivePaneTitle() }
func (t *ManagerTab) JumpTargets() []core.JumpTarget {
	return t.host.JumpTargets()
}
func (t *ManagerTab) JumpToTarget(m *core.Model, key string) (bool, tea.Cmd) {
	return t.host.JumpToTarget(m, key)
}
func (t *ManagerTab) InitTab(m *core.Model) tea.Cmd {
	_ = m
	return t.host.Init()
}
func (t *ManagerTab) HandlePaneKey(m *core.Model, msg tea.KeyMsg) (bool, tea.Cmd) {
	return t.host.HandlePaneKey(m, msg)
}
func (t *ManagerTab) Update(m *core.Model, msg tea.Msg) tea.Cmd {
	return t.host.UpdateActive(m, msg)
}
func (t *ManagerTab) Build(m *core.Model) widgets.Widget {
	top := widgets.HStack{
		Widgets: []widgets.Widget{t.host.BuildPane("transactions", m), t.host.BuildPane("filters", m)},
		Ratios:  []float64{0.72, 0.28},
		Gap:     1,
	}
	return widgets.VStack{
		Widgets: []widgets.Widget{top, t.host.BuildPane("inspector", m)},
		Ratios:  []float64{0.7, 0.3},
	}
}
