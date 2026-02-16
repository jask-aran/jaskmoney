package tabs

import (
	tea "github.com/charmbracelet/bubbletea"

	"jaskmoney-v2/core"
	"jaskmoney-v2/widgets"
)

type BudgetTab struct {
	host PaneHost
}

func NewBudgetTab() *BudgetTab {
	return &BudgetTab{host: NewPaneHost(
		NewStaticPane("overview", "Budget Overview", "pane:budget:overview", "Overview placeholder", 10),
		NewStaticPane("categories", "Category Targets", "pane:budget:categories", "Category targets placeholder", 10),
		NewStaticPane("variance", "Variance", "pane:budget:variance", "Variance placeholder", 10),
		NewStaticPane("notes", "Notes", "pane:budget:notes", "Notes placeholder", 10),
	)}
}

func (t *BudgetTab) ID() string              { return "budget" }
func (t *BudgetTab) Title() string           { return "Budget" }
func (t *BudgetTab) Scope() string           { return t.host.Scope() }
func (t *BudgetTab) JumpKey() byte           { return 'b' }
func (t *BudgetTab) ActivePaneTitle() string { return t.host.ActivePaneTitle() }
func (t *BudgetTab) HandlePaneKey(m *core.Model, msg tea.KeyMsg) (bool, tea.Cmd) {
	return t.host.HandlePaneKey(m, msg)
}
func (t *BudgetTab) Update(m *core.Model, msg tea.Msg) tea.Cmd {
	return t.host.UpdateActive(m, msg)
}
func (t *BudgetTab) Build(m *core.Model) widgets.Widget {
	row1 := widgets.HStack{Widgets: []widgets.Widget{t.host.BuildPane("overview", m), t.host.BuildPane("categories", m)}, Ratios: []float64{0.5, 0.5}, Gap: 1}
	row2 := widgets.HStack{Widgets: []widgets.Widget{t.host.BuildPane("variance", m), t.host.BuildPane("notes", m)}, Ratios: []float64{0.35, 0.65}, Gap: 1}
	return widgets.VStack{Widgets: []widgets.Widget{row1, row2}, Ratios: []float64{0.45, 0.55}, Spacing: 1}
}
