package core

import (
	"fmt"
	"strings"
	"unicode"

	tea "github.com/charmbracelet/bubbletea"

	"jaskmoney-v2/widgets"
)

type Pane interface {
	ID() string
	Title() string
	Scope() string
	JumpKey() byte
	Focusable() bool
	Init() tea.Cmd
	Update(msg tea.Msg) tea.Cmd
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

func (p *StaticPane) ID() string                 { return p.id }
func (p *StaticPane) Title() string              { return p.title }
func (p *StaticPane) Scope() string              { return p.scope }
func (p *StaticPane) JumpKey() byte              { return p.jump }
func (p *StaticPane) Focusable() bool            { return p.focus }
func (p *StaticPane) Init() tea.Cmd              { return nil }
func (p *StaticPane) Update(msg tea.Msg) tea.Cmd { return nil }
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

func (h *PaneHost) UpdateActive(m *Model, msg tea.Msg) tea.Cmd {
	_ = m
	idx := h.activeIndex()
	if idx < 0 || idx >= len(h.panes) {
		return nil
	}
	return h.panes[idx].Update(msg)
}

func (h *PaneHost) HandlePaneKey(m *Model, msg tea.KeyMsg) (bool, tea.Cmd) {
	if len(h.panes) == 0 {
		return false, nil
	}
	if h.focused >= 0 && h.focused < len(h.panes) {
		if msg.String() == "esc" {
			return true, h.unfocus(m)
		}
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

func (h *PaneHost) move(m *Model, delta int) tea.Cmd {
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

func (h *PaneHost) focusSelected(m *Model) tea.Cmd {
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

func (h *PaneHost) unfocus(m *Model) tea.Cmd {
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

func (h *PaneHost) BuildPane(id string, m *Model) widgets.Widget {
	_ = m
	for idx, p := range h.panes {
		if p.ID() == id {
			return paneWidget{pane: p, selected: idx == h.selected, focused: idx == h.focused}
		}
	}
	return widgets.Pane{Title: "Missing Pane", Height: 10, Content: id}
}

func (h *PaneHost) JumpTargets() []JumpTarget {
	out := make([]JumpTarget, 0, len(h.panes))
	for _, pane := range h.panes {
		if pane == nil || !pane.Focusable() {
			continue
		}
		key := normalizePaneJumpKey(pane.JumpKey())
		if key == 0 {
			continue
		}
		out = append(out, JumpTarget{Key: string(key), Label: pane.Title()})
	}
	return out
}

func (h *PaneHost) JumpToTarget(m *Model, key string) (bool, tea.Cmd) {
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

type paneSpec struct {
	ID        string
	Title     string
	Scope     string
	JumpKey   byte
	Focusable bool
	Text      string
	Height    int
	Factory   func(spec paneSpec) Pane
}

type layoutBuilder func(host *PaneHost, m *Model) widgets.Widget

type generatedTab struct {
	id     string
	title  string
	host   PaneHost
	layout layoutBuilder
}

func newGeneratedTab(id, title string, specs []paneSpec, layout layoutBuilder) *generatedTab {
	panes := make([]Pane, 0, len(specs))
	for _, spec := range specs {
		if spec.Factory != nil {
			panes = append(panes, spec.Factory(spec))
			continue
		}
		panes = append(panes, NewStaticPane(spec.ID, spec.Title, spec.Scope, spec.JumpKey, spec.Focusable, spec.Text, spec.Height))
	}
	return &generatedTab{id: id, title: title, host: NewPaneHost(panes...), layout: layout}
}

func (t *generatedTab) ID() string              { return t.id }
func (t *generatedTab) Title() string           { return t.title }
func (t *generatedTab) Scope() string           { return t.host.Scope() }
func (t *generatedTab) ActivePaneTitle() string { return t.host.ActivePaneTitle() }
func (t *generatedTab) JumpTargets() []JumpTarget {
	return t.host.JumpTargets()
}
func (t *generatedTab) JumpToTarget(m *Model, key string) (bool, tea.Cmd) {
	return t.host.JumpToTarget(m, key)
}
func (t *generatedTab) InitTab(m *Model) tea.Cmd {
	_ = m
	return t.host.Init()
}
func (t *generatedTab) HandlePaneKey(m *Model, msg tea.KeyMsg) (bool, tea.Cmd) {
	return t.host.HandlePaneKey(m, msg)
}
func (t *generatedTab) Update(m *Model, msg tea.Msg) tea.Cmd {
	return t.host.UpdateActive(m, msg)
}
func (t *generatedTab) Build(m *Model) widgets.Widget {
	if t.layout == nil {
		return widgets.Pane{Title: t.title, Height: 10, Content: ""}
	}
	return t.layout(&t.host, m)
}

func NewDashboardTab() Tab {
	specs := []paneSpec{
		{ID: "summary", Title: "Summary", Scope: "pane:dashboard:summary", JumpKey: 's', Focusable: true, Text: "Summary placeholder", Height: 10},
		{ID: "accounts", Title: "Accounts", Scope: "pane:dashboard:accounts", JumpKey: 'a', Focusable: true, Text: "Accounts placeholder", Height: 10},
		{ID: "trend", Title: "Trend", Scope: "pane:dashboard:trend", JumpKey: 't', Focusable: true, Text: "Trend placeholder", Height: 10},
		{ID: "alerts", Title: "Alerts", Scope: "pane:dashboard:alerts", JumpKey: 'l', Focusable: true, Text: "Alerts placeholder", Height: 10},
	}
	layout := func(host *PaneHost, m *Model) widgets.Widget {
		top := widgets.HStack{Widgets: []widgets.Widget{host.BuildPane("summary", m), host.BuildPane("accounts", m)}, Ratios: []float64{0.65, 0.35}, Gap: 1}
		bottom := widgets.HStack{Widgets: []widgets.Widget{host.BuildPane("trend", m), host.BuildPane("alerts", m)}, Ratios: []float64{0.55, 0.45}, Gap: 1}
		return widgets.VStack{Widgets: []widgets.Widget{top, bottom}, Ratios: []float64{0.58, 0.42}}
	}
	return newGeneratedTab("dashboard", "Dashboard", specs, layout)
}

func NewManagerTab() Tab {
	specs := []paneSpec{
		{ID: "transactions", Title: "Transactions", Scope: "pane:manager:transactions", JumpKey: 't', Focusable: true, Factory: func(spec paneSpec) Pane {
			return widgets.NewTransactionPane(spec.ID, spec.Title, spec.Scope, spec.JumpKey, spec.Focusable)
		}},
		{ID: "filters", Title: "Filters", Scope: "pane:manager:filters", JumpKey: 'f', Focusable: true, Text: "Filters placeholder", Height: 10},
		{ID: "inspector", Title: "Inspector", Scope: "pane:manager:inspector", JumpKey: 'i', Focusable: true, Text: "Inspector placeholder", Height: 10},
	}
	layout := func(host *PaneHost, m *Model) widgets.Widget {
		top := widgets.HStack{Widgets: []widgets.Widget{host.BuildPane("transactions", m), host.BuildPane("filters", m)}, Ratios: []float64{0.72, 0.28}, Gap: 1}
		return widgets.VStack{Widgets: []widgets.Widget{top, host.BuildPane("inspector", m)}, Ratios: []float64{0.7, 0.3}}
	}
	return newGeneratedTab("manager", "Manager", specs, layout)
}

func NewBudgetTab() Tab {
	specs := []paneSpec{
		{ID: "overview", Title: "Budget Overview", Scope: "pane:budget:overview", JumpKey: 'o', Focusable: true, Text: "Overview placeholder", Height: 10},
		{ID: "categories", Title: "Category Targets", Scope: "pane:budget:categories", JumpKey: 'c', Focusable: true, Text: "Category targets placeholder", Height: 10},
		{ID: "variance", Title: "Variance", Scope: "pane:budget:variance", JumpKey: 'v', Focusable: true, Text: "Variance placeholder", Height: 10},
		{ID: "notes", Title: "Notes", Scope: "pane:budget:notes", JumpKey: 'n', Focusable: true, Text: "Notes placeholder", Height: 10},
	}
	layout := func(host *PaneHost, m *Model) widgets.Widget {
		row1 := widgets.HStack{Widgets: []widgets.Widget{host.BuildPane("overview", m), host.BuildPane("categories", m)}, Ratios: []float64{0.5, 0.5}, Gap: 1}
		row2 := widgets.HStack{Widgets: []widgets.Widget{host.BuildPane("variance", m), host.BuildPane("notes", m)}, Ratios: []float64{0.35, 0.65}, Gap: 1}
		return widgets.VStack{Widgets: []widgets.Widget{row1, row2}, Ratios: []float64{0.45, 0.55}}
	}
	return newGeneratedTab("budget", "Budget", specs, layout)
}

func NewSettingsTab() Tab {
	specs := []paneSpec{
		{ID: "app", Title: "Application", Scope: "pane:settings:app", JumpKey: 'a', Focusable: true, Text: "Application settings placeholder", Height: 10},
		{ID: "keys", Title: "Keybindings", Scope: "pane:settings:keys", JumpKey: 'k', Focusable: true, Text: "Keybinding settings placeholder", Height: 10},
		{ID: "profile", Title: "Profiles", Scope: "pane:settings:profile", JumpKey: 'p', Focusable: true, Text: "Profile settings placeholder", Height: 10},
	}
	layout := func(host *PaneHost, m *Model) widgets.Widget {
		left := widgets.VStack{Widgets: []widgets.Widget{host.BuildPane("app", m), host.BuildPane("keys", m)}, Ratios: []float64{0.6, 0.4}}
		return widgets.HStack{Widgets: []widgets.Widget{left, host.BuildPane("profile", m)}, Ratios: []float64{0.62, 0.38}, Gap: 1}
	}
	return newGeneratedTab("settings", "Settings", specs, layout)
}
