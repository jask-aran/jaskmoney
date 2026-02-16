package widgets

import (
	"github.com/charmbracelet/bubbles/table"
	tea "github.com/charmbracelet/bubbletea"
)

type TransactionPane struct {
	id    string
	title string
	scope string
	jump  byte
	focus bool
	table table.Model
}

func NewTransactionPane(id, title, scope string, jumpKey byte, focusable bool) *TransactionPane {
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
	return &TransactionPane{id: id, title: title, scope: scope, jump: jumpKey, focus: focusable, table: t}
}

func (p *TransactionPane) ID() string      { return p.id }
func (p *TransactionPane) Title() string   { return p.title }
func (p *TransactionPane) Scope() string   { return p.scope }
func (p *TransactionPane) JumpKey() byte   { return p.jump }
func (p *TransactionPane) Focusable() bool { return p.focus }
func (p *TransactionPane) Init() tea.Cmd   { return nil }
func (p *TransactionPane) Update(msg tea.Msg) tea.Cmd {
	var cmd tea.Cmd
	p.table, cmd = p.table.Update(msg)
	return cmd
}

func (p *TransactionPane) View(width, height int, selected, focused bool) string {
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
	return Pane{Title: p.title, Height: height, Content: content, Selected: selected, Focused: focused}.Render(width, height)
}

func (p *TransactionPane) OnSelect() tea.Cmd   { return nil }
func (p *TransactionPane) OnDeselect() tea.Cmd { return nil }
func (p *TransactionPane) OnFocus() tea.Cmd    { return nil }
func (p *TransactionPane) OnBlur() tea.Cmd     { return nil }
