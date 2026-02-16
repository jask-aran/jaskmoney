package tabs

import (
	"github.com/charmbracelet/bubbles/table"
	tea "github.com/charmbracelet/bubbletea"

	"jaskmoney-v2/core"
	"jaskmoney-v2/widgets"
)

type TransactionsPane struct {
	id    string
	title string
	scope string
	jump  byte
	focus bool
	table table.Model
}

func NewTransactionsPane(id, title, scope string, jumpKey byte, focusable bool) *TransactionsPane {
	cols := []table.Column{
		{Title: "Date", Width: 10},
		{Title: "Description", Width: 26},
		{Title: "Amount", Width: 10},
	}
	rows := []table.Row{
		{"2026-02-01", "Coffee", "-4.50"},
		{"2026-02-02", "Salary", "+3200.00"},
		{"2026-02-03", "Groceries", "-84.12"},
		{"2026-02-04", "Fuel", "-52.90"},
		{"2026-02-05", "Insurance", "-120.00"},
		{"2026-02-06", "Dining", "-31.75"},
	}
	t := table.New(table.WithColumns(cols), table.WithRows(rows), table.WithFocused(true), table.WithHeight(6))
	styles := table.DefaultStyles()
	styles.Header = styles.Header.Bold(true)
	styles.Selected = styles.Selected.Bold(true)
	t.SetStyles(styles)
	return &TransactionsPane{id: id, title: title, scope: scope, jump: jumpKey, focus: focusable, table: t}
}

func (p *TransactionsPane) ID() string    { return p.id }
func (p *TransactionsPane) Title() string { return p.title }
func (p *TransactionsPane) Scope() string { return p.scope }
func (p *TransactionsPane) JumpKey() byte { return p.jump }
func (p *TransactionsPane) Focusable() bool {
	return p.focus
}
func (p *TransactionsPane) Init() tea.Cmd { return nil }

func (p *TransactionsPane) Update(msg tea.Msg) (Pane, tea.Cmd) {
	var cmd tea.Cmd
	p.table, cmd = p.table.Update(msg)
	return p, cmd
}

func (p *TransactionsPane) View(width, height int, selected, focused bool) string {
	innerW := width - 4
	if innerW < 12 {
		innerW = 12
	}
	innerH := height - 4
	if innerH < 3 {
		innerH = 3
	}
	p.table.SetWidth(innerW)
	p.table.SetHeight(innerH)
	content := p.table.View()
	if focused {
		content += "\n\nFocused: use j/k or arrows"
	} else {
		content += "\n\nPress enter to focus pane"
	}
	return widgets.Pane{Title: p.title, Height: height, Content: content, Selected: selected, Focused: focused}.Render(width, height)
}

func (p *TransactionsPane) OnSelect() tea.Cmd   { return nil }
func (p *TransactionsPane) OnDeselect() tea.Cmd { return nil }
func (p *TransactionsPane) OnFocus() tea.Cmd {
	return core.StatusCmd("Focused pane: " + p.title)
}
func (p *TransactionsPane) OnBlur() tea.Cmd { return nil }
