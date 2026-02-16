package tabs

import (
	tea "github.com/charmbracelet/bubbletea"

	"jaskmoney-v2/core"
	"jaskmoney-v2/widgets"
)

type SettingsTab struct {
	host PaneHost
}

func NewSettingsTab() *SettingsTab {
	return &SettingsTab{host: NewPaneHost(
		NewStaticPane("app", "Application", "pane:settings:app", "Application settings placeholder", 10),
		NewStaticPane("keys", "Keybindings", "pane:settings:keys", "Keybinding settings placeholder", 10),
		NewStaticPane("profile", "Profiles", "pane:settings:profile", "Profile settings placeholder", 10),
	)}
}

func (t *SettingsTab) ID() string              { return "settings" }
func (t *SettingsTab) Title() string           { return "Settings" }
func (t *SettingsTab) Scope() string           { return t.host.Scope() }
func (t *SettingsTab) JumpKey() byte           { return 's' }
func (t *SettingsTab) ActivePaneTitle() string { return t.host.ActivePaneTitle() }
func (t *SettingsTab) HandlePaneKey(m *core.Model, msg tea.KeyMsg) (bool, tea.Cmd) {
	return t.host.HandlePaneKey(m, msg)
}
func (t *SettingsTab) Update(m *core.Model, msg tea.Msg) tea.Cmd {
	return t.host.UpdateActive(m, msg)
}
func (t *SettingsTab) Build(m *core.Model) widgets.Widget {
	left := widgets.VStack{Widgets: []widgets.Widget{t.host.BuildPane("app", m), t.host.BuildPane("keys", m)}, Ratios: []float64{0.6, 0.4}, Spacing: 1}
	return widgets.HStack{Widgets: []widgets.Widget{left, t.host.BuildPane("profile", m)}, Ratios: []float64{0.62, 0.38}, Gap: 1}
}
