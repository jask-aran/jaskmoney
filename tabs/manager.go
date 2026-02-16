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
		NewStaticPane("transactions", "Transactions", "pane:manager:transactions", "Transactions list placeholder", 10),
		NewStaticPane("filters", "Filters", "pane:manager:filters", "Filters placeholder", 10),
		NewStaticPane("inspector", "Inspector", "pane:manager:inspector", "Inspector placeholder", 10),
	)}
}

func (t *ManagerTab) ID() string              { return "manager" }
func (t *ManagerTab) Title() string           { return "Manager" }
func (t *ManagerTab) Scope() string           { return t.host.Scope() }
func (t *ManagerTab) JumpKey() byte           { return 'm' }
func (t *ManagerTab) ActivePaneTitle() string { return t.host.ActivePaneTitle() }
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
		Spacing: 1,
	}
}
