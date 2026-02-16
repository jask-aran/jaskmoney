package screens

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/bubbles/list"
	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"

	"jaskmoney-v2/core"
)

type CommandOption struct {
	ID       string
	Name     string
	Desc     string
	Disabled bool
	Reason   string
}

func (i CommandOption) Title() string {
	if i.Disabled && i.Reason != "" {
		return fmt.Sprintf("%s (%s)", i.Name, i.Reason)
	}
	return i.Name
}
func (i CommandOption) Description() string { return i.Desc }
func (i CommandOption) FilterValue() string { return i.Name + " " + i.Desc + " " + i.ID }

type CommandScreen struct {
	scope    string
	search   func(query string) []CommandOption
	onSelect func(id string) tea.Msg
	input    textinput.Model
	list     list.Model
}

func NewCommandScreen(scope string, search func(query string) []CommandOption, onSelect func(id string) tea.Msg) *CommandScreen {
	inp := textinput.New()
	inp.Placeholder = "Search commands"
	inp.Prompt = "cmd> "
	inp.Focus()
	lst := list.New(nil, list.NewDefaultDelegate(), 64, 14)
	lst.SetShowStatusBar(false)
	lst.SetFilteringEnabled(false)
	lst.SetShowHelp(false)
	s := &CommandScreen{scope: scope, search: search, onSelect: onSelect, input: inp, list: lst}
	s.refresh()
	return s
}

func (s *CommandScreen) Title() string { return "Command Palette" }
func (s *CommandScreen) Scope() string { return "screen:command" }

func (s *CommandScreen) Update(msg tea.Msg) (core.Screen, tea.Cmd, bool) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "esc":
			return s, nil, true
		case "enter":
			if it, ok := s.list.SelectedItem().(CommandOption); ok {
				if it.Disabled {
					return s, core.StatusCmd(it.Reason), true
				}
				if s.onSelect != nil {
					return s, func() tea.Msg { return s.onSelect(it.ID) }, true
				}
				return s, nil, true
			}
		}
	}
	var cmd1 tea.Cmd
	s.input, cmd1 = s.input.Update(msg)
	s.refresh()
	var cmd2 tea.Cmd
	s.list, cmd2 = s.list.Update(msg)
	return s, tea.Batch(cmd1, cmd2), false
}

func (s *CommandScreen) refresh() {
	query := strings.TrimSpace(s.input.Value())
	items := s.search(query)
	ls := make([]list.Item, 0, len(items))
	for _, it := range items {
		ls = append(ls, it)
	}
	_ = s.list.SetItems(ls)
}

func (s *CommandScreen) View(width, height int) string {
	s.list.SetWidth(width)
	s.list.SetHeight(max(6, height-4))
	return "Command Palette (scope: " + s.scope + ")\n" + s.input.View() + "\n" + s.list.View()
}
