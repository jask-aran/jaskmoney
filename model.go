package main

import (
	"database/sql"
	"fmt"
	"io"
	"os"

	"github.com/charmbracelet/bubbles/key"
	"github.com/charmbracelet/bubbles/list"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

const (
	appName         = "Jaskmoney"
	screenDashboard = "Dashboard"
)

type transaction struct {
	dateRaw     string
	amount      float64
	description string
}

// ---------------------------------------------------------------------------
// File-picker item (implements list.Item)
// ---------------------------------------------------------------------------

type fileItem struct {
	name string
}

func (f fileItem) Title() string       { return f.name }
func (f fileItem) Description() string { return "" }
func (f fileItem) FilterValue() string { return f.name }

type fileItemDelegate struct{}

func (d fileItemDelegate) Height() int  { return 1 }
func (d fileItemDelegate) Spacing() int { return 0 }
func (d fileItemDelegate) Update(_ tea.Msg, _ *list.Model) tea.Cmd {
	return nil
}
func (d fileItemDelegate) Render(w io.Writer, m list.Model, index int, item list.Item) {
	entry, ok := item.(fileItem)
	if !ok {
		return
	}
	prefix := "  "
	if index == m.Index() {
		prefix = "> "
	}
	line := fmt.Sprintf("%s%s", prefix, entry.name)
	fmt.Fprint(w, padRight(line, m.Width()))
}

// ---------------------------------------------------------------------------
// Key bindings
// ---------------------------------------------------------------------------

type keyMap struct {
	Import key.Binding
	Quit   key.Binding
	UpDown key.Binding
	Enter  key.Binding
	Clear  key.Binding
	Close  key.Binding
}

func newKeyMap() keyMap {
	return keyMap{
		Import: key.NewBinding(key.WithKeys("i"), key.WithHelp("i", "import")),
		Quit:   key.NewBinding(key.WithKeys("q", "ctrl+c"), key.WithHelp("q", "quit")),
		UpDown: key.NewBinding(key.WithKeys("up", "down"), key.WithHelp("↑/↓", "scroll/select")),
		Enter:  key.NewBinding(key.WithKeys("enter"), key.WithHelp("enter", "import")),
		Clear:  key.NewBinding(key.WithKeys("c"), key.WithHelp("c", "clear db")),
		Close:  key.NewBinding(key.WithKeys("esc"), key.WithHelp("esc", "close")),
	}
}

func (k keyMap) ShortHelp() []key.Binding {
	return []key.Binding{k.Import, k.UpDown, k.Quit}
}

func (k keyMap) FullHelp() [][]key.Binding {
	return [][]key.Binding{{k.Import, k.UpDown, k.Quit}}
}

type modalKeyMap struct {
	keyMap
}

func (k modalKeyMap) ShortHelp() []key.Binding {
	return []key.Binding{k.Enter, k.Clear, k.Close, k.UpDown, k.Quit}
}

func (k modalKeyMap) FullHelp() [][]key.Binding {
	return [][]key.Binding{{k.Enter, k.Clear, k.Close, k.UpDown, k.Quit}}
}

// ---------------------------------------------------------------------------
// Bubble Tea messages
// ---------------------------------------------------------------------------

type dbReadyMsg struct {
	db  *sql.DB
	err error
}

type ingestDoneMsg struct {
	count int
	err   error
	file  string
}

type refreshDoneMsg struct {
	rows []transaction
	err  error
}

type filesLoadedMsg struct {
	items []list.Item
	err   error
}

type clearDoneMsg struct {
	err error
}

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

type model struct {
	db        *sql.DB
	status    string
	ready     bool
	basePath  string
	screen    string
	showPopup bool
	fileList  list.Model
	keys      keyMap
	modalKeys modalKeyMap
	rows      []transaction
	cursor    int
	topIndex  int
	width     int
	height    int
	listReady bool
}

func newModel() model {
	listModel := list.New([]list.Item{}, fileItemDelegate{}, 0, 0)
	listModel.Title = "Imports"
	listModel.Styles.Title = titleStyle
	listModel.Styles.NoItems = lipgloss.NewStyle()
	listModel.SetShowStatusBar(false)
	listModel.SetFilteringEnabled(false)
	listModel.SetShowHelp(false)
	listModel.DisableQuitKeybindings()

	cwd, _ := os.Getwd()
	return model{
		basePath: cwd,
		screen:   screenDashboard,
		fileList: listModel,
		keys:     newKeyMap(),
		modalKeys: modalKeyMap{
			keyMap: newKeyMap(),
		},
	}
}

// ---------------------------------------------------------------------------
// Bubble Tea interface: Init / Update / View
// ---------------------------------------------------------------------------

func (m model) Init() tea.Cmd {
	return func() tea.Msg {
		db, err := openDB("transactions.db")
		return dbReadyMsg{db: db, err: err}
	}
}

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case dbReadyMsg:
		return m.handleDBReady(msg)
	case refreshDoneMsg:
		return m.handleRefreshDone(msg)
	case filesLoadedMsg:
		return m.handleFilesLoaded(msg)
	case clearDoneMsg:
		return m.handleClearDone(msg)
	case ingestDoneMsg:
		return m.handleIngestDone(msg)
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		m.resizeList()
		m.ensureCursorInWindow()
		return m, nil
	case tea.KeyMsg:
		if m.showPopup {
			return m.updatePopup(msg)
		}
		return m.updateMain(msg)
	}
	return m, nil
}

func (m model) View() string {
	status := statusStyle.Render(m.status)

	if !m.ready {
		return status
	}

	overview := m.renderSection("Overview", renderOverview(m.rows, m.listContentWidth()))
	content := renderTable(m.rows, m.cursor, m.topIndex, m.visibleRows(), m.listContentWidth(), true)
	transactions := m.renderSection("Transactions", content)
	header := renderHeader(appName, m.screen, m.width)
	main := header + "\n\n" + overview + "\n\n" + transactions
	statusLine := m.renderStatus(m.status)
	footer := m.renderFooter(m.footerText())

	if m.showPopup {
		return m.composeModal(main, statusLine, footer)
	}
	return m.placeWithFooter(main, statusLine, footer)
}

// ---------------------------------------------------------------------------
// Message handlers (called from Update)
// ---------------------------------------------------------------------------

func (m model) handleDBReady(msg dbReadyMsg) (tea.Model, tea.Cmd) {
	if msg.err != nil {
		m.status = fmt.Sprintf("DB error: %v", msg.err)
		return m, nil
	}
	m.db = msg.db
	return m, refreshCmd(m.db)
}

func (m model) handleRefreshDone(msg refreshDoneMsg) (tea.Model, tea.Cmd) {
	if msg.err != nil {
		m.status = fmt.Sprintf("DB error: %v", msg.err)
		return m, nil
	}
	m.rows = msg.rows
	m.ready = true
	m.cursor = 0
	m.topIndex = 0
	if m.status == "" {
		m.status = "Transactions list ready. Press i to open the import popup."
	}
	return m, nil
}

func (m model) handleFilesLoaded(msg filesLoadedMsg) (tea.Model, tea.Cmd) {
	if msg.err != nil {
		m.status = fmt.Sprintf("File scan error: %v", msg.err)
		m.showPopup = false
		return m, nil
	}
	m.fileList.SetItems(msg.items)
	m.listReady = true
	return m, nil
}

func (m model) handleClearDone(msg clearDoneMsg) (tea.Model, tea.Cmd) {
	if msg.err != nil {
		m.status = fmt.Sprintf("Clear failed: %v", msg.err)
		return m, nil
	}
	m.status = "Database cleared."
	if m.db == nil {
		return m, nil
	}
	return m, refreshCmd(m.db)
}

func (m model) handleIngestDone(msg ingestDoneMsg) (tea.Model, tea.Cmd) {
	if msg.err != nil {
		m.status = fmt.Sprintf("Import failed: %v", msg.err)
		return m, nil
	}
	m.status = fmt.Sprintf("Imported %d transactions from %s", msg.count, msg.file)
	if m.db == nil {
		return m, nil
	}
	return m, refreshCmd(m.db)
}

// ---------------------------------------------------------------------------
// Key-input handlers
// ---------------------------------------------------------------------------

func (m model) updateMain(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "ctrl+c", "q":
		return m, tea.Quit
	case "i":
		m.showPopup = true
		m.listReady = false
		m.fileList.Select(0)
		return m, loadFilesCmd(m.basePath)
	case "up", "k", "ctrl+p":
		if m.cursor > 0 {
			m.cursor--
			if m.cursor < m.topIndex {
				m.topIndex--
			}
			if m.topIndex < 0 {
				m.topIndex = 0
			}
		}
		return m, nil
	case "down", "j", "ctrl+n":
		if m.cursor < len(m.rows)-1 {
			m.cursor++
			visible := m.visibleRows()
			if visible <= 0 {
				visible = 1
			}
			if m.cursor >= m.topIndex+visible {
				m.topIndex++
			}
			maxTop := len(m.rows) - visible
			if maxTop < 0 {
				maxTop = 0
			}
			if m.topIndex > maxTop {
				m.topIndex = maxTop
			}
		}
		return m, nil
	}
	return m, nil
}

func (m model) updatePopup(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "esc":
		m.showPopup = false
		return m, nil
	case "ctrl+c", "q":
		return m, tea.Quit
	case "c":
		if m.db == nil {
			m.status = "Database not ready."
			return m, nil
		}
		m.status = "Clearing database..."
		return m, clearCmd(m.db)
	case "enter":
		item, ok := m.fileList.SelectedItem().(fileItem)
		if !ok || item.name == "" {
			m.status = "No file selected."
			return m, nil
		}
		if m.db == nil {
			m.status = "Database not ready."
			return m, nil
		}
		m.status = "Importing..."
		m.showPopup = false
		return m, ingestCmd(m.db, item.name, m.basePath)
	}

	var cmd tea.Cmd
	m.fileList, cmd = m.fileList.Update(msg)
	return m, cmd
}

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

func (m model) footerText() string {
	if m.showPopup {
		return renderHelp(m.modalKeys.ShortHelp())
	}
	return renderHelp(m.keys.ShortHelp())
}

func (m *model) visibleRows() int {
	if m.height == 0 {
		return 10
	}
	frameV := listBoxStyle.GetVerticalFrameSize()
	headerHeight := headerLineCount()
	headerGap := 1
	sectionHeaderHeight := sectionHeaderLineCount()
	overviewHeight := frameV + sectionHeaderHeight + overviewLineCount()
	sectionGap := 1
	tableHeaderHeight := 1
	available := m.height - 2 - headerHeight - headerGap - overviewHeight - sectionGap - frameV - sectionHeaderHeight - tableHeaderHeight
	if available < 3 {
		available = 3
	}
	if available > 20 {
		available = 20
	}
	return available
}

func (m *model) listContentWidth() int {
	if m.width == 0 {
		return 80
	}
	contentWidth := m.sectionContentWidth()
	if contentWidth < 20 {
		return 20
	}
	return contentWidth
}

func (m *model) sectionContentWidth() int {
	if m.width == 0 {
		return 80
	}
	frameH := listBoxStyle.GetHorizontalFrameSize()
	contentWidth := m.sectionWidth() - frameH
	if contentWidth < 1 {
		contentWidth = 1
	}
	return contentWidth
}

func (m *model) sectionWidth() int {
	if m.width == 0 {
		return 80
	}
	width := m.width - 4
	if width < 20 {
		width = m.width
	}
	return width
}

func (m *model) resizeList() {
	if m.width == 0 || m.height == 0 {
		return
	}
	listWidth := min(70, m.width-6)
	if listWidth < 40 {
		listWidth = 40
	}
	m.fileList.SetWidth(listWidth)
	m.fileList.SetHeight(min(14, m.height-8))
}

func (m *model) ensureCursorInWindow() {
	visible := m.visibleRows()
	if visible <= 0 {
		return
	}
	if m.cursor < m.topIndex {
		m.topIndex = m.cursor
	} else if m.cursor >= m.topIndex+visible {
		m.topIndex = m.cursor - visible + 1
	}
	maxTop := len(m.rows) - visible
	if maxTop < 0 {
		maxTop = 0
	}
	if m.topIndex > maxTop {
		m.topIndex = maxTop
	}
	if m.topIndex < 0 {
		m.topIndex = 0
	}
}

func headerLineCount() int {
	return 2
}

func sectionHeaderLineCount() int {
	return 2
}
