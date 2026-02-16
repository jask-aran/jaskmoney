package screens

import (
	"strings"

	"github.com/charmbracelet/bubbles/list"
	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"

	"jaskmoney-v2/core"
)

type PickerItem struct {
	ID    string
	Label string
	Desc  string
}

func (i PickerItem) Title() string       { return i.Label }
func (i PickerItem) Description() string { return i.Desc }
func (i PickerItem) FilterValue() string { return i.Label + " " + i.Desc }

type PickerScreen struct {
	title      string
	scope      string
	input      textinput.Model
	list       list.Model
	allItems   []PickerItem
	onSelected func(PickerItem) tea.Msg
}

func NewPickerScreen(title, scope string, items []PickerItem, onSelected func(PickerItem) tea.Msg) *PickerScreen {
	inp := textinput.New()
	inp.Placeholder = "filter"
	inp.Focus()
	inp.Prompt = "> "
	litems := make([]list.Item, 0, len(items))
	for _, it := range items {
		litems = append(litems, it)
	}
	lst := list.New(litems, list.NewDefaultDelegate(), 40, 12)
	lst.SetShowStatusBar(false)
	lst.SetFilteringEnabled(false)
	lst.SetShowHelp(false)
	return &PickerScreen{title: title, scope: scope, input: inp, list: lst, allItems: items, onSelected: onSelected}
}

func (s *PickerScreen) Title() string { return s.title }
func (s *PickerScreen) Scope() string { return s.scope }

func (s *PickerScreen) Update(msg tea.Msg) (core.Screen, tea.Cmd, bool) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "esc":
			return s, nil, true
		case "enter":
			if it, ok := s.list.SelectedItem().(PickerItem); ok {
				if s.onSelected != nil {
					return s, func() tea.Msg { return s.onSelected(it) }, true
				}
			}
			return s, nil, true
		}
	}
	var cmd1 tea.Cmd
	s.input, cmd1 = s.input.Update(msg)
	s.refreshFiltered()
	var cmd2 tea.Cmd
	s.list, cmd2 = s.list.Update(msg)
	return s, tea.Batch(cmd1, cmd2), false
}

func (s *PickerScreen) refreshFiltered() {
	q := strings.ToLower(strings.TrimSpace(s.input.Value()))
	items := make([]list.Item, 0, len(s.allItems))
	for _, it := range s.allItems {
		h := strings.ToLower(it.Label + " " + it.Desc)
		if q == "" || strings.Contains(h, q) {
			items = append(items, it)
		}
	}
	_ = s.list.SetItems(items)
}

func (s *PickerScreen) View(width, height int) string {
	s.list.SetWidth(width)
	s.list.SetHeight(max(6, height-4))
	return s.title + "\n" + s.input.View() + "\n" + s.list.View()
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
