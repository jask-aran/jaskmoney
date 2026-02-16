package screens

import (
	"fmt"
	"strings"

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

func (i CommandOption) DisplayName() string {
	if i.Disabled && i.Reason != "" {
		return fmt.Sprintf("%s (%s)", i.Name, i.Reason)
	}
	return i.Name
}

type CommandScreen struct {
	scope    string
	search   func(query string) []CommandOption
	onSelect func(id string) tea.Msg
	picker   *core.Picker
	byID     map[string]CommandOption
}

func NewCommandScreen(scope string, search func(query string) []CommandOption, onSelect func(id string) tea.Msg) *CommandScreen {
	s := &CommandScreen{
		scope:    scope,
		search:   search,
		onSelect: onSelect,
		picker:   core.NewPicker("Command Palette", nil),
		byID:     map[string]CommandOption{},
	}
	s.refresh()
	return s
}

func (s *CommandScreen) Title() string { return "Command Palette" }
func (s *CommandScreen) Scope() string { return "screen:command" }

func (s *CommandScreen) Update(msg tea.Msg) (core.Screen, tea.Cmd, bool) {
	keyMsg, ok := msg.(tea.KeyMsg)
	if !ok {
		return s, nil, false
	}

	result := s.picker.HandleKey(keyMsg.String())
	s.refresh()
	if result.Action != core.PickerActionSelected {
		if result.Action == core.PickerActionCancelled {
			return s, nil, true
		}
		return s, nil, false
	}

	option, exists := s.byID[result.Item.ID]
	if !exists {
		return s, nil, true
	}
	if option.Disabled {
		reason := strings.TrimSpace(option.Reason)
		if reason == "" {
			reason = "command is disabled"
		}
		return s, core.StatusCmd(reason), true
	}
	if s.onSelect != nil {
		return s, func() tea.Msg { return s.onSelect(option.ID) }, true
	}
	return s, nil, true
}

func (s *CommandScreen) refresh() {
	query := strings.TrimSpace(s.picker.Query())
	items := s.search(query)
	listItems := make([]core.PickerItem, 0, len(items))
	byID := make(map[string]CommandOption, len(items))
	for _, it := range items {
		byID[it.ID] = it
		meta := it.Desc
		if it.Disabled && strings.TrimSpace(it.Reason) != "" {
			if strings.TrimSpace(meta) == "" {
				meta = "disabled: " + strings.TrimSpace(it.Reason)
			} else {
				meta = meta + " | disabled: " + strings.TrimSpace(it.Reason)
			}
		}
		listItems = append(listItems, core.PickerItem{
			ID:     it.ID,
			Label:  it.DisplayName(),
			Meta:   meta,
			Search: it.ID + " " + it.Name + " " + it.Desc + " " + it.Reason,
		})
	}
	s.byID = byID
	s.picker.SetItems(listItems)
}

func (s *CommandScreen) View(width, height int) string {
	lines := []string{"Command Palette (scope: " + s.scope + ")"}
	query := s.picker.Query()
	if strings.TrimSpace(query) == "" {
		query = "(type to filter)"
	}
	lines = append(lines, "Filter: "+query, "")

	items := s.picker.Items()
	if len(items) == 0 {
		lines = append(lines, "  No matching commands")
	} else {
		cursor := s.picker.Cursor()
		for i, item := range items {
			prefix := "  "
			if i == cursor {
				prefix = "> "
			}
			row := item.Label
			if strings.TrimSpace(item.Meta) != "" {
				row += " - " + item.Meta
			}
			lines = append(lines, prefix+row)
		}
	}
	lines = append(lines, "", "Enter run. Esc close.")
	return core.ClipHeight(strings.Join(lines, "\n"), core.MaxInt(6, height))
}
