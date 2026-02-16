package core

import (
	"database/sql"
	"fmt"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"

	"jaskmoney-v2/widgets"
)

type Screen interface {
	Update(msg tea.Msg) (Screen, tea.Cmd, bool)
	View(width, height int) string
	Scope() string
	Title() string
}

type Tab interface {
	ID() string
	Title() string
	Scope() string
	JumpKey() byte
	Update(m *Model, msg tea.Msg) tea.Cmd
	Build(m *Model) widgets.Widget
}

type JumpTarget interface {
	JumpKey() byte
}

type PaneKeyHandler interface {
	HandlePaneKey(m *Model, msg tea.KeyMsg) (bool, tea.Cmd)
	ActivePaneTitle() string
}

type AppData struct {
	Accounts     int
	Categories   int
	Tags         int
	Transactions int
}

type Model struct {
	width      int
	height     int
	tabs       []Tab
	activeTab  int
	screens    ScreenStack
	keys       *KeyRegistry
	commands   *CommandRegistry
	status     string
	statusErr  bool
	jump       JumpMode
	quitting   bool
	Data       AppData
	DB         *sql.DB
	OpenPicker func(m *Model) Screen
	OpenCmd    func(m *Model, scope string) Screen
}

func NewModel(tabs []Tab, keys *KeyRegistry, commands *CommandRegistry, db *sql.DB, data AppData) Model {
	m := Model{
		tabs:      tabs,
		keys:      keys,
		commands:  commands,
		DB:        db,
		Data:      data,
		status:    "Ready",
		activeTab: 0,
		width:     100,
		height:    32,
	}
	return m
}

func (m Model) Init() tea.Cmd {
	return nil
}

func (m *Model) SetStatus(msg string) {
	m.status = msg
	m.statusErr = false
}

func (m *Model) SetError(err error) {
	if err == nil {
		m.status = ""
		m.statusErr = false
		return
	}
	m.status = err.Error()
	m.statusErr = true
}

func (m Model) ActiveScope() string {
	if top := m.screens.Top(); top != nil {
		return top.Scope()
	}
	if len(m.tabs) == 0 {
		return "app"
	}
	return m.tabs[m.activeTab].Scope()
}

func (m *Model) SwitchTab(index int) {
	if index < 0 || index >= len(m.tabs) {
		return
	}
	m.activeTab = index
}

func (m *Model) PushScreen(s Screen) {
	m.screens.Push(s)
}

func (m *Model) CommandRegistry() *CommandRegistry {
	return m.commands
}

func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width, m.height = msg.Width, msg.Height
		return m, nil
	case StatusMsg:
		m.status = msg.Text
		m.statusErr = msg.IsErr
		return m, nil
	case DataLoadedMsg:
		if msg.Err != nil {
			m.SetError(msg.Err)
		} else {
			m.SetStatus("Data loaded: " + msg.Key)
		}
		return m, nil
	case PushScreenMsg:
		m.screens.Push(msg.Screen)
		return m, nil
	case PopScreenMsg:
		m.screens.Pop()
		return m, nil
	case CommandExecuteMsg:
		return m, m.commands.Execute(msg.CommandID, &m)
	case TabSwitchMsg:
		m.SwitchTab(msg.Index)
		return m, nil
	case tea.KeyMsg:
		if msg.String() == "ctrl+c" {
			m.quitting = true
			return m, tea.Quit
		}

		if m.jumpHandleKey(msg) {
			return m, nil
		}

		if top := m.screens.Top(); top != nil {
			next, cmd, pop := top.Update(msg)
			if pop {
				m.screens.Pop()
				return m, cmd
			}
			if next != nil {
				m.screens.items[len(m.screens.items)-1] = next
			}
			return m, cmd
		}

		scope := m.ActiveScope()
		if m.keys.IsAction(msg, "quit", scope) {
			m.quitting = true
			return m, tea.Quit
		}
		if m.keys.IsAction(msg, "jump", scope) {
			m.toggleJumpMode()
			return m, nil
		}
		if len(m.tabs) > 0 {
			if handler, ok := m.tabs[m.activeTab].(PaneKeyHandler); ok {
				handled, cmd := handler.HandlePaneKey(&m, msg)
				if handled {
					return m, cmd
				}
			}
		}
		if m.keys.IsAction(msg, "open-command-palette", scope) && m.OpenCmd != nil {
			m.screens.Push(m.OpenCmd(&m, scope))
			return m, nil
		}
		if m.keys.IsAction(msg, "open-category-picker", scope) && m.OpenPicker != nil {
			m.screens.Push(m.OpenPicker(&m))
			return m, nil
		}
		for i := range m.tabs {
			if m.keys.IsAction(msg, fmt.Sprintf("switch-tab-%d", i+1), scope) {
				m.SwitchTab(i)
				return m, nil
			}
		}
		if len(m.tabs) > 0 {
			return m, m.tabs[m.activeTab].Update(&m, msg)
		}
	}

	if top := m.screens.Top(); top != nil {
		next, cmd, pop := top.Update(msg)
		if pop {
			m.screens.Pop()
			return m, cmd
		}
		if next != nil {
			m.screens.items[len(m.screens.items)-1] = next
		}
		return m, cmd
	}
	if len(m.tabs) > 0 {
		return m, m.tabs[m.activeTab].Update(&m, msg)
	}
	return m, nil
}

func (m Model) View() string {
	if m.quitting {
		return "Goodbye\n"
	}
	header := renderHeader(m)
	status := RenderStatusBar(m)
	footer := RenderFooter(m)
	available := m.height - lipgloss.Height(status) - lipgloss.Height(footer)
	if available < 0 {
		available = 0
	}
	header = clipHeight(header, available)
	bodyHeight := available - lipgloss.Height(header)
	if bodyHeight < 0 {
		bodyHeight = 0
	}
	var body string
	if len(m.tabs) > 0 && bodyHeight > 0 {
		body = m.tabs[m.activeTab].Build(&m).Render(max(1, m.width-2), bodyHeight)
	}
	if top := m.screens.Top(); top != nil && bodyHeight > 0 {
		body = widgets.RenderModal(body, top.View(max(20, m.width-12), max(8, m.height-8)), m.width-2, bodyHeight)
	}
	body = fitHeight(body, bodyHeight)
	main := strings.TrimSuffix(strings.Join([]string{header, body}, "\n"), "\n")
	main = fitHeight(main, available)
	view := strings.Join([]string{main, status, footer}, "\n")
	view = fitHeight(view, max(1, m.height))
	return appStyle.Width(max(1, m.width)).MaxWidth(max(1, m.width)).Render(view)
}

func renderHeader(m Model) string {
	tabs := make([]string, 0, len(m.tabs))
	for i, t := range m.tabs {
		label := fmt.Sprintf("%d:%s", i+1, t.Title())
		if m.jump.Active {
			label = fmt.Sprintf("%s (%c)", label, t.JumpKey())
		}
		if i == m.activeTab {
			tabs = append(tabs, "["+label+"]")
		} else {
			tabs = append(tabs, label)
		}
	}
	title := headerStyle.Render("JaskMoney v2")
	tabLine := trimToWidth(strings.Join(tabs, "  "), max(1, m.width-2))
	return title + "\n" + inactiveTabStyle.Render(tabLine)
}

func fitHeight(s string, height int) string {
	if height <= 0 {
		return ""
	}
	lines := strings.Split(s, "\n")
	if len(lines) > height {
		lines = lines[:height]
	}
	for len(lines) < height {
		lines = append(lines, "")
	}
	return strings.Join(lines, "\n")
}

func trimToWidth(s string, width int) string {
	if width <= 0 {
		return ""
	}
	runes := []rune(s)
	if len(runes) <= width {
		return s
	}
	if width <= 1 {
		return string(runes[:width])
	}
	return string(runes[:width-1]) + "…"
}

func clipHeight(s string, height int) string {
	if height <= 0 {
		return ""
	}
	lines := strings.Split(s, "\n")
	if len(lines) > height {
		lines = lines[:height]
	}
	return strings.Join(lines, "\n")
}
