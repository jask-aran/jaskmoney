package tabs

import (
	tea "github.com/charmbracelet/bubbletea"

	"jaskmoney-v2/core"
	"jaskmoney-v2/widgets"
)

type DashboardTab struct {
	host PaneHost
}

func NewDashboardTab() *DashboardTab {
	return &DashboardTab{host: NewPaneHost(
		NewStaticPane("summary", "Summary", "pane:dashboard:summary", 's', true, "Summary placeholder", 10),
		NewStaticPane("accounts", "Accounts", "pane:dashboard:accounts", 'a', true, "Accounts placeholder", 10),
		NewStaticPane("trend", "Trend", "pane:dashboard:trend", 't', true, "Trend placeholder", 10),
		NewStaticPane("alerts", "Alerts", "pane:dashboard:alerts", 'l', true, "Alerts placeholder", 10),
	)}
}

func (t *DashboardTab) ID() string              { return "dashboard" }
func (t *DashboardTab) Title() string           { return "Dashboard" }
func (t *DashboardTab) Scope() string           { return t.host.Scope() }
func (t *DashboardTab) ActivePaneTitle() string { return t.host.ActivePaneTitle() }
func (t *DashboardTab) JumpTargets() []core.JumpTarget {
	return t.host.JumpTargets()
}
func (t *DashboardTab) JumpToTarget(m *core.Model, key string) (bool, tea.Cmd) {
	return t.host.JumpToTarget(m, key)
}
func (t *DashboardTab) InitTab(m *core.Model) tea.Cmd {
	_ = m
	return t.host.Init()
}
func (t *DashboardTab) HandlePaneKey(m *core.Model, msg tea.KeyMsg) (bool, tea.Cmd) {
	return t.host.HandlePaneKey(m, msg)
}
func (t *DashboardTab) Update(m *core.Model, msg tea.Msg) tea.Cmd {
	return t.host.UpdateActive(m, msg)
}
func (t *DashboardTab) Build(m *core.Model) widgets.Widget {
	top := widgets.HStack{
		Widgets: []widgets.Widget{t.host.BuildPane("summary", m), t.host.BuildPane("accounts", m)},
		Ratios:  []float64{0.65, 0.35},
		Gap:     1,
	}
	bottom := widgets.HStack{
		Widgets: []widgets.Widget{t.host.BuildPane("trend", m), t.host.BuildPane("alerts", m)},
		Ratios:  []float64{0.55, 0.45},
		Gap:     1,
	}
	return widgets.VStack{Widgets: []widgets.Widget{top, bottom}, Ratios: []float64{0.58, 0.42}}
}
