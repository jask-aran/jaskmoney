package screens

import (
	"strings"

	tea "github.com/charmbracelet/bubbletea"

	"jaskmoney-v2/core"
)

type PickerItem struct {
	ID    string
	Label string
	Desc  string
}

type PickerScreen struct {
	title      string
	scope      string
	picker     *core.Picker
	allItems   map[string]PickerItem
	onSelected func(PickerItem) tea.Msg
}

func NewPickerScreen(title, scope string, items []PickerItem, onSelected func(PickerItem) tea.Msg) *PickerScreen {
	listItems := make([]core.PickerItem, 0, len(items))
	all := make(map[string]PickerItem, len(items))
	for _, it := range items {
		all[it.ID] = it
		listItems = append(listItems, core.PickerItem{
			ID:     it.ID,
			Label:  it.Label,
			Meta:   it.Desc,
			Search: it.Label + " " + it.Desc,
		})
	}
	return &PickerScreen{
		title:      title,
		scope:      scope,
		picker:     core.NewPicker(title, listItems),
		allItems:   all,
		onSelected: onSelected,
	}
}

func (s *PickerScreen) Title() string { return s.title }
func (s *PickerScreen) Scope() string { return s.scope }

func (s *PickerScreen) Update(msg tea.Msg) (core.Screen, tea.Cmd, bool) {
	keyMsg, ok := msg.(tea.KeyMsg)
	if !ok {
		return s, nil, false
	}
	result := s.picker.HandleKey(keyMsg.String())
	switch result.Action {
	case core.PickerActionCancelled:
		return s, nil, true
	case core.PickerActionSelected:
		item, exists := s.allItems[result.Item.ID]
		if !exists {
			return s, nil, true
		}
		if s.onSelected != nil {
			return s, func() tea.Msg { return s.onSelected(item) }, true
		}
		return s, nil, true
	default:
		return s, nil, false
	}
}

func (s *PickerScreen) View(width, height int) string {
	lines := []string{s.title}
	filter := s.picker.Query()
	if filter == "" {
		filter = "(type to filter)"
	}
	lines = append(lines, "Filter: "+filter, "")
	items := s.picker.Items()
	if len(items) == 0 {
		lines = append(lines, "  No items")
	} else {
		for idx, item := range items {
			prefix := "  "
			if idx == s.picker.Cursor() {
				prefix = "> "
			}
			label := item.Label
			if item.Meta != "" {
				label += " - " + item.Meta
			}
			lines = append(lines, prefix+label)
		}
	}
	lines = append(lines, "", "Enter select. Esc cancel.")
	return clipHeight(strings.Join(lines, "\n"), max(6, height))
}

func clipHeight(s string, h int) string {
	if h <= 0 {
		return ""
	}
	lines := strings.Split(s, "\n")
	if len(lines) > h {
		lines = lines[:h]
	}
	return strings.Join(lines, "\n")
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
