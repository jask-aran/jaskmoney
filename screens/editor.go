package screens

import (
	"strings"

	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"

	"jaskmoney-v2/core"
)

type EditorField struct {
	Key   string
	Label string
	Value string
}

type EditorScreen struct {
	title    string
	scope    string
	fields   []EditorField
	inputs   []textinput.Model
	focus    int
	onSubmit func(values map[string]string) tea.Msg
}

func NewEditorScreen(title, scope string, fields []EditorField, onSubmit func(values map[string]string) tea.Msg) *EditorScreen {
	inputs := make([]textinput.Model, 0, len(fields))
	for i, f := range fields {
		inp := textinput.New()
		inp.Prompt = f.Label + ": "
		inp.SetValue(f.Value)
		if i == 0 {
			inp.Focus()
		}
		inputs = append(inputs, inp)
	}
	return &EditorScreen{title: title, scope: scope, fields: fields, inputs: inputs, onSubmit: onSubmit}
}

func (s *EditorScreen) Title() string { return s.title }
func (s *EditorScreen) Scope() string { return s.scope }

func (s *EditorScreen) Update(msg tea.Msg) (core.Screen, tea.Cmd, bool) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "esc":
			return s, nil, true
		case "tab", "shift+tab":
			dir := 1
			if msg.String() == "shift+tab" {
				dir = -1
			}
			s.inputs[s.focus].Blur()
			s.focus = (s.focus + dir + len(s.inputs)) % len(s.inputs)
			s.inputs[s.focus].Focus()
			return s, nil, false
		case "enter":
			vals := map[string]string{}
			for i, f := range s.fields {
				vals[f.Key] = s.inputs[i].Value()
			}
			if s.onSubmit != nil {
				return s, func() tea.Msg { return s.onSubmit(vals) }, true
			}
			return s, nil, true
		}
	}
	var cmd tea.Cmd
	s.inputs[s.focus], cmd = s.inputs[s.focus].Update(msg)
	return s, cmd, false
}

func (s *EditorScreen) View(width, height int) string {
	lines := []string{s.title}
	for _, in := range s.inputs {
		lines = append(lines, in.View())
	}
	lines = append(lines, "", "enter: save  esc: cancel  tab: next field")
	return strings.Join(lines, "\n")
}
