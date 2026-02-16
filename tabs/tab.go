package tabs

import (
	"fmt"
	"strings"
	"unicode"

	tea "github.com/charmbracelet/bubbletea"

	"jaskmoney-v2/core"
	"jaskmoney-v2/widgets"
)

type Pane interface {
	ID() string
	Title() string
	Scope() string
	JumpKey() byte
	Focusable() bool
	Init() tea.Cmd
	Update(msg tea.Msg) (Pane, tea.Cmd)
	View(width, height int, selected, focused bool) string
	OnSelect() tea.Cmd
	OnDeselect() tea.Cmd
	OnFocus() tea.Cmd
	OnBlur() tea.Cmd
}

type StaticPane struct {
	id     string
	title  string
	scope  string
	jump   byte
	focus  bool
	text   string
	height int
}

func NewStaticPane(id, title, scope string, jumpKey byte, focusable bool, text string, height int) *StaticPane {
	return &StaticPane{id: id, title: title, scope: scope, jump: jumpKey, focus: focusable, text: text, height: height}
}

func (p *StaticPane) ID() string    { return p.id }
func (p *StaticPane) Title() string { return p.title }
func (p *StaticPane) Scope() string { return p.scope }
func (p *StaticPane) JumpKey() byte { return p.jump }
func (p *StaticPane) Focusable() bool {
	return p.focus
}
func (p *StaticPane) Init() tea.Cmd { return nil }
func (p *StaticPane) Update(msg tea.Msg) (Pane, tea.Cmd) {
	return p, nil
}
func (p *StaticPane) View(width, height int, selected, focused bool) string {
	return widgets.Pane{Title: p.title, Height: p.height, Content: p.text, Selected: selected, Focused: focused}.Render(width, height)
}
func (p *StaticPane) OnSelect() tea.Cmd   { return nil }
func (p *StaticPane) OnDeselect() tea.Cmd { return nil }
func (p *StaticPane) OnFocus() tea.Cmd    { return nil }
func (p *StaticPane) OnBlur() tea.Cmd     { return nil }

type PaneHost struct {
	panes    []Pane
	selected int
	focused  int
}

func NewPaneHost(panes ...Pane) PaneHost {
	seen := make(map[byte]string, len(panes))
	for _, pane := range panes {
		if pane == nil {
			continue
		}
		key := normalizePaneJumpKey(pane.JumpKey())
		if key == 0 {
			panic(fmt.Sprintf("pane %q must declare a single alphanumeric jump key", pane.ID()))
		}
		if other, exists := seen[key]; exists {
			panic(fmt.Sprintf("duplicate jump key %q across panes %q and %q", string(key), other, pane.ID()))
		}
		seen[key] = pane.ID()
	}
	return PaneHost{panes: panes, selected: 0, focused: -1}
}

func (h *PaneHost) Init() tea.Cmd {
	cmds := make([]tea.Cmd, 0, len(h.panes))
	for _, p := range h.panes {
		if p == nil {
			continue
		}
		if cmd := p.Init(); cmd != nil {
			cmds = append(cmds, cmd)
		}
	}
	return tea.Batch(cmds...)
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

func (h *PaneHost) activeIndex() int {
	if h.focused >= 0 && h.focused < len(h.panes) {
		return h.focused
	}
	if h.selected >= 0 && h.selected < len(h.panes) {
		return h.selected
	}
	return -1
}

func (h *PaneHost) UpdateActive(m *core.Model, msg tea.Msg) tea.Cmd {
	_ = m
	idx := h.activeIndex()
	if idx < 0 || idx >= len(h.panes) {
		return nil
	}
	next, cmd := h.panes[idx].Update(msg)
	if next != nil {
		h.panes[idx] = next
	}
	return cmd
}

func (h *PaneHost) HandlePaneKey(m *core.Model, msg tea.KeyMsg) (bool, tea.Cmd) {
	if len(h.panes) == 0 {
		return false, nil
	}
	if h.focused >= 0 && h.focused < len(h.panes) {
		if msg.String() == "esc" {
			return true, h.unfocus(m)
		}
		// When focused, pane receives navigation keys directly.
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
	h.focused = -1
	m.SetStatus("Selected pane: " + h.panes[h.selected].Title())
	cmds := []tea.Cmd{h.panes[prev].OnDeselect(), h.panes[h.selected].OnSelect()}
	if prevFocused >= 0 && prevFocused < len(h.panes) {
		cmds = append(cmds, h.panes[prevFocused].OnBlur())
	}
	return tea.Batch(cmds...)
}

func (h *PaneHost) focusSelected(m *core.Model) tea.Cmd {
	if len(h.panes) == 0 || h.selected < 0 || h.selected >= len(h.panes) {
		return nil
	}
	prevFocused := h.focused
	h.focused = h.selected
	m.SetStatus("Focused pane: " + h.panes[h.focused].Title())
	if prevFocused >= 0 && prevFocused < len(h.panes) {
		return tea.Batch(h.panes[prevFocused].OnBlur(), h.panes[h.focused].OnFocus())
	}
	return h.panes[h.focused].OnFocus()
}

func (h *PaneHost) unfocus(m *core.Model) tea.Cmd {
	if h.focused < 0 || h.focused >= len(h.panes) {
		return nil
	}
	idx := h.focused
	h.focused = -1
	m.SetStatus("Pane unfocused: " + h.panes[idx].Title())
	return h.panes[idx].OnBlur()
}

type paneWidget struct {
	pane     Pane
	selected bool
	focused  bool
}

func (w paneWidget) Render(width, height int) string {
	if w.pane == nil {
		return widgets.Pane{Title: "Missing Pane", Height: 10, Content: ""}.Render(width, height)
	}
	return w.pane.View(width, height, w.selected, w.focused)
}

func (h *PaneHost) BuildPane(id string, m *core.Model) widgets.Widget {
	_ = m
	for idx, p := range h.panes {
		if p.ID() == id {
			return paneWidget{pane: p, selected: idx == h.selected, focused: idx == h.focused}
		}
	}
	return widgets.Pane{Title: "Missing Pane", Height: 10, Content: id}
}

func (h *PaneHost) JumpTargets() []core.JumpTarget {
	out := make([]core.JumpTarget, 0, len(h.panes))
	for _, pane := range h.panes {
		if pane == nil || !pane.Focusable() {
			continue
		}
		key := normalizePaneJumpKey(pane.JumpKey())
		if key == 0 {
			continue
		}
		out = append(out, core.JumpTarget{
			Key:   string(key),
			Label: pane.Title(),
		})
	}
	return out
}

func (h *PaneHost) JumpToTarget(m *core.Model, key string) (bool, tea.Cmd) {
	jumpKey := normalizeJumpTargetKey(key)
	if jumpKey == 0 {
		return false, nil
	}
	target := -1
	for idx, pane := range h.panes {
		if pane == nil || !pane.Focusable() {
			continue
		}
		if normalizePaneJumpKey(pane.JumpKey()) == jumpKey {
			target = idx
			break
		}
	}
	if target < 0 {
		return false, nil
	}

	prevSelected := h.selected
	prevFocused := h.focused
	h.selected = target
	h.focused = target
	m.SetStatus("Focused pane: " + h.panes[target].Title())

	cmds := make([]tea.Cmd, 0, 4)
	if prevSelected >= 0 && prevSelected < len(h.panes) && prevSelected != target {
		cmds = append(cmds, h.panes[prevSelected].OnDeselect(), h.panes[target].OnSelect())
	}
	if prevFocused >= 0 && prevFocused < len(h.panes) && prevFocused != target {
		cmds = append(cmds, h.panes[prevFocused].OnBlur(), h.panes[target].OnFocus())
	} else if prevFocused != target {
		cmds = append(cmds, h.panes[target].OnFocus())
	}
	return true, tea.Batch(cmds...)
}

func normalizePaneJumpKey(key byte) byte {
	if key == 0 {
		return 0
	}
	r := rune(key)
	if !unicode.IsLetter(r) && !unicode.IsDigit(r) {
		return 0
	}
	return byte(unicode.ToLower(r))
}

func normalizeJumpTargetKey(key string) byte {
	key = strings.TrimSpace(strings.ToLower(key))
	if len(key) != 1 {
		return 0
	}
	return normalizePaneJumpKey(key[0])
}
