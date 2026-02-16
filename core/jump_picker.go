package core

import (
	"fmt"
	"strings"
	"unicode"

	tea "github.com/charmbracelet/bubbletea"
)

type JumpTarget struct {
	Key   string
	Label string
}

type JumpTargetProvider interface {
	JumpTargets() []JumpTarget
	JumpToTarget(m *Model, key string) (bool, tea.Cmd)
}

type jumpPickerScreen struct {
	scope     string
	title     string
	targetByK map[string]JumpTarget
	picker    *Picker
}

func newJumpPickerScreen(targets []JumpTarget) *jumpPickerScreen {
	items := make([]PickerItem, 0, len(targets))
	targetByK := make(map[string]JumpTarget, len(targets))
	for _, target := range targets {
		key := normalizeJumpKey(target.Key)
		if key == "" {
			continue
		}
		target.Key = key
		targetByK[key] = target
		items = append(items, PickerItem{
			ID:     key,
			Label:  fmt.Sprintf("[%s] %s", key, target.Label),
			Meta:   "jump target",
			Search: key + " " + target.Label,
		})
	}
	return &jumpPickerScreen{
		scope:     "screen:jump-picker",
		title:     "Jump Picker",
		targetByK: targetByK,
		picker:    NewPicker("Jump Picker", items),
	}
}

func (s *jumpPickerScreen) Title() string { return s.title }
func (s *jumpPickerScreen) Scope() string { return s.scope }

func (s *jumpPickerScreen) Update(msg tea.Msg) (Screen, tea.Cmd, bool) {
	keyMsg, ok := msg.(tea.KeyMsg)
	if !ok {
		return s, nil, false
	}
	keyName := strings.ToLower(strings.TrimSpace(keyMsg.String()))
	if keyName == "esc" {
		return s, nil, true
	}
	if isJumpGlyph(keyName) {
		if target, found := s.targetByK[keyName]; found {
			return s, func() tea.Msg { return JumpTargetSelectedMsg{Key: target.Key} }, true
		}
	}
	result := s.picker.HandleKey(keyName)
	switch result.Action {
	case PickerActionCancelled:
		return s, nil, true
	case PickerActionSelected:
		if result.Item.ID == "" {
			return s, nil, true
		}
		return s, func() tea.Msg { return JumpTargetSelectedMsg{Key: result.Item.ID} }, true
	default:
		return s, nil, false
	}
}

func (s *jumpPickerScreen) View(width, height int) string {
	lines := make([]string, 0, len(s.picker.Items())+3)
	q := strings.TrimSpace(s.picker.Query())
	if q == "" {
		q = "(type to filter)"
	}
	lines = append(lines, "Filter: "+q, "")
	items := s.picker.Items()
	if len(items) == 0 {
		lines = append(lines, "  No jump targets")
	} else {
		cursor := s.picker.Cursor()
		for i, item := range items {
			prefix := "  "
			if i == cursor {
				prefix = "> "
			}
			lines = append(lines, prefix+item.Label)
		}
	}
	lines = append(lines, "", "Type pane key to jump. Enter selects row. Esc cancels.")
	view := strings.Join(lines, "\n")
	return clipHeight(trimToWidth(view, max(20, width)), max(6, height))
}

func normalizeJumpKey(k string) string {
	k = strings.ToLower(strings.TrimSpace(k))
	if !isJumpGlyph(k) {
		return ""
	}
	return k
}

func isJumpGlyph(k string) bool {
	r := []rune(k)
	if len(r) != 1 {
		return false
	}
	return unicode.IsLetter(r[0]) || unicode.IsDigit(r[0])
}
