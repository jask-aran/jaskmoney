package tabs

import (
	tea "github.com/charmbracelet/bubbletea"

	"jaskmoney-v2/core"
	"jaskmoney-v2/widgets"
)

type Pane interface {
	ID() string
	Title() string
	Scope() string
	Update(m *core.Model, msg tea.Msg) tea.Cmd
	Build(m *core.Model, selected, focused bool) widgets.Widget
	OnSelect(m *core.Model) tea.Cmd
	OnDeselect(m *core.Model) tea.Cmd
	OnFocus(m *core.Model) tea.Cmd
	OnBlur(m *core.Model) tea.Cmd
}

type StaticPane struct {
	id     string
	title  string
	scope  string
	text   string
	height int
}

func NewStaticPane(id, title, scope, text string, height int) StaticPane {
	return StaticPane{id: id, title: title, scope: scope, text: text, height: height}
}

func (p StaticPane) ID() string    { return p.id }
func (p StaticPane) Title() string { return p.title }
func (p StaticPane) Scope() string { return p.scope }
func (p StaticPane) Update(m *core.Model, msg tea.Msg) tea.Cmd {
	return nil
}
func (p StaticPane) Build(m *core.Model, selected, focused bool) widgets.Widget {
	return widgets.Pane{Title: p.title, Height: p.height, Content: p.text, Selected: selected, Focused: focused}
}
func (p StaticPane) OnSelect(m *core.Model) tea.Cmd   { return nil }
func (p StaticPane) OnDeselect(m *core.Model) tea.Cmd { return nil }
func (p StaticPane) OnFocus(m *core.Model) tea.Cmd {
	return core.StatusCmd("Focused pane: " + p.title)
}
func (p StaticPane) OnBlur(m *core.Model) tea.Cmd { return nil }

type PaneHost struct {
	panes    []Pane
	selected int
	focused  int
}

func NewPaneHost(panes ...Pane) PaneHost {
	return PaneHost{panes: panes, selected: 0, focused: -1}
}

func (h *PaneHost) Pane(id string) Pane {
	for _, p := range h.panes {
		if p.ID() == id {
			return p
		}
	}
	return nil
}

func (h *PaneHost) Scope() string {
	if h.focused >= 0 && h.focused < len(h.panes) {
		return h.panes[h.focused].Scope()
	}
	if h.selected >= 0 && h.selected < len(h.panes) {
		return h.panes[h.selected].Scope()
	}
	return ""
}

func (h *PaneHost) ActivePaneTitle() string {
	if h.focused >= 0 && h.focused < len(h.panes) {
		return h.panes[h.focused].Title()
	}
	if h.selected >= 0 && h.selected < len(h.panes) {
		return h.panes[h.selected].Title()
	}
	return ""
}

func (h *PaneHost) UpdateActive(m *core.Model, msg tea.Msg) tea.Cmd {
	if h.focused >= 0 && h.focused < len(h.panes) {
		return h.panes[h.focused].Update(m, msg)
	}
	if h.selected >= 0 && h.selected < len(h.panes) {
		return h.panes[h.selected].Update(m, msg)
	}
	return nil
}

func (h *PaneHost) HandlePaneKey(m *core.Model, msg tea.KeyMsg) (bool, tea.Cmd) {
	if len(h.panes) == 0 {
		return false, nil
	}
	switch msg.String() {
	case "left", "up":
		return true, h.move(m, -1)
	case "right", "down":
		return true, h.move(m, 1)
	case "enter":
		return true, h.focusSelected(m)
	default:
		return false, nil
	}
}

func (h *PaneHost) move(m *core.Model, delta int) tea.Cmd {
	if len(h.panes) <= 1 {
		return nil
	}
	prev := h.selected
	prevFocused := h.focused
	h.selected = (h.selected + delta + len(h.panes)) % len(h.panes)
	if prev == h.selected {
		return nil
	}
	// Match v1's focus contract: navigation leaves "active" mode.
	h.focused = -1
	m.SetStatus("Selected pane: " + h.panes[h.selected].Title())
	cmds := []tea.Cmd{
		h.panes[prev].OnDeselect(m),
		h.panes[h.selected].OnSelect(m),
	}
	if prevFocused >= 0 && prevFocused < len(h.panes) {
		cmds = append(cmds, h.panes[prevFocused].OnBlur(m))
	}
	return tea.Batch(cmds...)
}

func (h *PaneHost) focusSelected(m *core.Model) tea.Cmd {
	if len(h.panes) == 0 || h.selected < 0 || h.selected >= len(h.panes) {
		return nil
	}
	// Toggle focus on selected pane so users can deselect without extra keys.
	if h.focused == h.selected {
		h.focused = -1
		m.SetStatus("Pane unfocused: " + h.panes[h.selected].Title())
		return h.panes[h.selected].OnBlur(m)
	}
	prevFocused := h.focused
	h.focused = h.selected
	m.SetStatus("Focused pane: " + h.panes[h.focused].Title())
	if prevFocused >= 0 && prevFocused < len(h.panes) {
		return tea.Batch(h.panes[prevFocused].OnBlur(m), h.panes[h.focused].OnFocus(m))
	}
	return h.panes[h.focused].OnFocus(m)
}

func (h *PaneHost) BuildPane(id string, m *core.Model) widgets.Widget {
	for idx, p := range h.panes {
		if p.ID() == id {
			return p.Build(m, idx == h.selected, idx == h.focused)
		}
	}
	return widgets.Pane{Title: "Missing Pane", Height: 10, Content: id}
}
