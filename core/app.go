package core

import (
	"database/sql"

	tea "github.com/charmbracelet/bubbletea"

	"jaskmoney-v2/core/widgets"
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
	Update(m *Model, msg tea.Msg) tea.Cmd
	Build(m *Model) widgets.Widget
}

type PaneKeyHandler interface {
	HandlePaneKey(m *Model, msg tea.KeyMsg) (bool, tea.Cmd)
	ActivePaneTitle() string
}

type TabInitializer interface {
	InitTab(m *Model) tea.Cmd
}

type AppData struct {
	Accounts     int
	Categories   int
	Tags         int
	Transactions int
}

type Model struct {
	width               int
	height              int
	tabs                []Tab
	activeTab           int
	screens             ScreenStack
	keys                *KeyRegistry
	commands            *CommandRegistry
	status              string
	statusErr           bool
	quitting            bool
	Data                AppData
	DB                  *sql.DB
	OpenPickerModal     func(m *Model) Screen
	OpenCommandModal    func(m *Model, scope string) Screen
	OpenJumpPickerModal func(m *Model, targets []JumpTarget) Screen
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
	cmds := make([]tea.Cmd, 0, len(m.tabs))
	for _, t := range m.tabs {
		if initTab, ok := t.(TabInitializer); ok {
			if cmd := initTab.InitTab(&m); cmd != nil {
				cmds = append(cmds, cmd)
			}
		}
	}
	return tea.Batch(cmds...)
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
