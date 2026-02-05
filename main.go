package main

import (
	"database/sql"
	"encoding/csv"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/help"
	"github.com/charmbracelet/bubbles/key"
	"github.com/charmbracelet/bubbles/list"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	_ "modernc.org/sqlite"
)

const dateInputFormat = "2/01/2006"

var (
	titleStyle     = lipgloss.NewStyle().Bold(true)
	statusStyle    = lipgloss.NewStyle().Foreground(lipgloss.Color("241"))
	footerStyle    = lipgloss.NewStyle().Foreground(lipgloss.Color("255")).Background(lipgloss.Color("238")).Padding(0, 2)
	statusBarStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("252")).Background(lipgloss.Color("236")).Padding(0, 2)
	dimStyle       = lipgloss.NewStyle().Foreground(lipgloss.Color("240"))
	modalStyle     = lipgloss.NewStyle().Border(lipgloss.RoundedBorder()).Padding(1, 2).Background(lipgloss.Color("235"))
	listBoxStyle   = lipgloss.NewStyle().Border(lipgloss.RoundedBorder()).Padding(0, 1)
)

type transaction struct {
	dateRaw     string
	amount      float64
	description string
}

type fileItem struct {
	name string
}

func (f fileItem) Title() string       { return f.name }
func (f fileItem) Description() string { return "" }
func (f fileItem) FilterValue() string { return f.name }

type keyMap struct {
	Import key.Binding
	Quit   key.Binding
	UpDown key.Binding
	Enter  key.Binding
	Clear  key.Binding
	Close  key.Binding
	Filter key.Binding
}

func newKeyMap() keyMap {
	return keyMap{
		Import: key.NewBinding(key.WithKeys("i"), key.WithHelp("i", "import")),
		Quit:   key.NewBinding(key.WithKeys("q", "ctrl+c"), key.WithHelp("q", "quit")),
		UpDown: key.NewBinding(key.WithKeys("up", "down"), key.WithHelp("↑/↓", "scroll/select")),
		Enter:  key.NewBinding(key.WithKeys("enter"), key.WithHelp("enter", "import")),
		Clear:  key.NewBinding(key.WithKeys("c"), key.WithHelp("c", "clear db")),
		Close:  key.NewBinding(key.WithKeys("esc"), key.WithHelp("esc", "close")),
		Filter: key.NewBinding(key.WithKeys("/"), key.WithHelp("/", "filter")),
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
	return []key.Binding{k.Enter, k.Clear, k.Close, k.UpDown, k.Filter, k.Quit}
}

func (k modalKeyMap) FullHelp() [][]key.Binding {
	return [][]key.Binding{{k.Enter, k.Clear, k.Close, k.UpDown, k.Filter, k.Quit}}
}

type model struct {
	db        *sql.DB
	status    string
	ready     bool
	basePath  string
	showPopup bool
	fileList  list.Model
	help      help.Model
	keys      keyMap
	modalKeys modalKeyMap
	rows      []transaction
	cursor    int
	topIndex  int
	width     int
	height    int
	listReady bool
}

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

func main() {
	p := tea.NewProgram(newModel(), tea.WithAltScreen())
	if _, err := p.Run(); err != nil {
		fmt.Println("error:", err)
		os.Exit(1)
	}
}

func newModel() model {
	listModel := list.New([]list.Item{}, list.NewDefaultDelegate(), 0, 0)
	listModel.Title = "Import Popup"
	listModel.SetShowStatusBar(false)
	listModel.SetFilteringEnabled(true)
	listModel.SetShowHelp(false)
	listModel.DisableQuitKeybindings()

	cwd, _ := os.Getwd()
	helpModel := help.New()
	helpModel.ShortSeparator = "  "
	helpModel.Styles.ShortKey = lipgloss.NewStyle()
	helpModel.Styles.ShortDesc = lipgloss.NewStyle()
	helpModel.Styles.ShortSeparator = lipgloss.NewStyle()
	return model{
		basePath: cwd,
		fileList: listModel,
		help:     helpModel,
		keys:     newKeyMap(),
		modalKeys: modalKeyMap{
			keyMap: newKeyMap(),
		},
	}
}

func (m model) Init() tea.Cmd {
	return func() tea.Msg {
		db, err := openDB("transactions.db")
		return dbReadyMsg{db: db, err: err}
	}
}

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case dbReadyMsg:
		if msg.err != nil {
			m.status = fmt.Sprintf("DB error: %v", msg.err)
			return m, nil
		}
		m.db = msg.db
		return m, func() tea.Msg {
			rows, err := loadRows(m.db)
			return refreshDoneMsg{rows: rows, err: err}
		}
	case refreshDoneMsg:
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
	case filesLoadedMsg:
		if msg.err != nil {
			m.status = fmt.Sprintf("File scan error: %v", msg.err)
			m.showPopup = false
			return m, nil
		}
		m.fileList.SetItems(msg.items)
		m.listReady = true
		return m, nil
	case clearDoneMsg:
		if msg.err != nil {
			m.status = fmt.Sprintf("Clear failed: %v", msg.err)
			return m, nil
		}
		m.status = "Database cleared."
		if m.db == nil {
			return m, nil
		}
		return m, func() tea.Msg {
			rows, err := loadRows(m.db)
			return refreshDoneMsg{rows: rows, err: err}
		}
	case ingestDoneMsg:
		if msg.err != nil {
			m.status = fmt.Sprintf("Import failed: %v", msg.err)
			return m, nil
		}
		m.status = fmt.Sprintf("Imported %d transactions from %s", msg.count, msg.file)
		if m.db == nil {
			return m, nil
		}
		return m, func() tea.Msg {
			rows, err := loadRows(m.db)
			return refreshDoneMsg{rows: rows, err: err}
		}
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		m.help.Width = msg.Width
		m.resizeList()
		m.ensureCursorInWindow()
		return m, nil
	case tea.KeyMsg:
		if m.showPopup {
			return m.updatePopup(msg)
		}
		switch msg.String() {
		case "ctrl+c", "q":
			return m, tea.Quit
		case "i":
			m.showPopup = true
			m.listReady = false
			m.fileList.ResetFilter()
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

	return m, nil
}

func (m model) View() string {
	status := statusStyle.Render(m.status)

	if !m.ready {
		return status
	}

	content := renderTable(m.rows, m.cursor, m.topIndex, m.visibleRows(), m.listContentWidth())
	listView := listBoxStyle.Render(content)
	main := listView
	statusLine := m.renderStatus(m.status)
	footer := m.renderFooter(m.footerText())
	if m.showPopup {
		return m.composeModal(main, statusLine, footer)
	}
	return m.placeWithFooter(main, statusLine, footer)
}

func (m model) footerText() string {
	if m.showPopup {
		return m.help.View(m.modalKeys)
	}
	return m.help.View(m.keys)
}

func (m *model) visibleRows() int {
	if m.height == 0 {
		return 10
	}
	frameV := listBoxStyle.GetVerticalFrameSize()
	available := m.height - 2 - frameV - 1
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
	frameH := listBoxStyle.GetHorizontalFrameSize()
	contentWidth := m.width - frameH
	if contentWidth < 20 {
		contentWidth = 20
	}
	return contentWidth
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

func (m model) contentWidth() int {
	if m.width == 0 {
		return 80
	}
	return m.width
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
		return m, func() tea.Msg {
			_, err := m.db.Exec("DELETE FROM transactions")
			return clearDoneMsg{err: err}
		}
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

func (m model) composeModal(base, statusLine, footer string) string {
	baseDim := dimLines(base)
	baseView := m.placeWithFooter(baseDim, statusLine, footer)
	if m.height == 0 || m.width == 0 {
		return baseView + "\n\n" + m.popupView()
	}
	modalContent := lipgloss.NewStyle().Width(m.fileList.Width()).Render(m.popupView())
	modal := modalStyle.Render(modalContent)
	lines := splitLines(modal)
	modalWidth := maxLineWidth(lines)
	modalHeight := len(lines)

	targetHeight := m.height - 2
	if targetHeight < 1 {
		targetHeight = 1
	}
	x := (m.width - modalWidth) / 2
	if x < 0 {
		x = 0
	}
	y := (targetHeight - modalHeight) / 2
	if y < 0 {
		y = 0
	}
	return overlayAt(baseView, modal, x, y, m.width, targetHeight)
}

func (m model) popupView() string {
	if !m.listReady {
		return "Loading CSV files..."
	}
	return m.fileList.View()
}

func (m model) placeWithFooter(body, statusLine, footer string) string {
	if m.height == 0 {
		return body + "\n\n" + statusLine + "\n" + footer
	}
	contentHeight := m.height - 2
	if contentHeight < 1 {
		contentHeight = 1
	}
	if lipgloss.Height(body) >= contentHeight {
		return body + "\n" + statusLine + "\n" + footer
	}
	main := lipgloss.Place(m.width, contentHeight, lipgloss.Left, lipgloss.Top, body)
	return main + "\n" + statusLine + "\n" + footer
}

func (m *model) ensureCursorVisible() {
	m.ensureCursorInWindow()
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

func overlayAt(base, overlay string, x, y, width, height int) string {
	baseLines := splitLines(base)
	overlayLines := splitLines(overlay)
	overlayWidth := maxLineWidth(overlayLines)
	for i, line := range overlayLines {
		row := y + i
		if row < 0 || row >= len(baseLines) || row >= height {
			continue
		}
		target := padRight(baseLines[row], width)
		left := cutPlain(target, 0, x)
		right := ""
		if width > 0 {
			right = cutPlain(target, x+overlayWidth, width)
		}
		overlayLine := padRight(line, overlayWidth)
		baseLines[row] = left + overlayLine + right
	}
	return strings.Join(baseLines, "\n")
}

func splitLines(s string) []string {
	if s == "" {
		return []string{""}
	}
	return strings.Split(s, "\n")
}

func maxLineWidth(lines []string) int {
	max := 0
	for _, line := range lines {
		if w := lipgloss.Width(line); w > max {
			max = w
		}
	}
	return max
}

func padRight(s string, width int) string {
	if width <= 0 {
		return s
	}
	w := lipgloss.Width(s)
	if w >= width {
		return s
	}
	return s + strings.Repeat(" ", width-w)
}

func cutPlain(s string, left, right int) string {
	if right <= left {
		return ""
	}
	runes := []rune(s)
	if left < 0 {
		left = 0
	}
	if right > len(runes) {
		right = len(runes)
	}
	if left > len(runes) {
		return ""
	}
	return string(runes[left:right])
}

func dimLines(s string) string {
	lines := splitLines(s)
	for i, line := range lines {
		lines[i] = dimStyle.Render(line)
	}
	return strings.Join(lines, "\n")
}

func openDB(path string) (*sql.DB, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	if _, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS transactions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			date_raw TEXT NOT NULL,
			date_iso TEXT NOT NULL,
			amount REAL NOT NULL,
			description TEXT NOT NULL
		)`); err != nil {
		_ = db.Close()
		return nil, err
	}
	return db, nil
}

func ingestCmd(db *sql.DB, filename, basePath string) tea.Cmd {
	return func() tea.Msg {
		path := filename
		if !filepath.IsAbs(path) {
			path = filepath.Join(basePath, path)
		}
		count, err := importCSV(db, path)
		return ingestDoneMsg{count: count, err: err, file: filepath.Base(path)}
	}
}

func importCSV(db *sql.DB, path string) (int, error) {
	f, err := os.Open(path)
	if err != nil {
		return 0, err
	}
	defer f.Close()

	r := csv.NewReader(f)
	inserted := 0
	for {
		rec, err := r.Read()
		if err != nil {
			if err == io.EOF {
				break
			}
			return inserted, err
		}
		if len(rec) < 3 {
			continue
		}
		dateRaw := strings.TrimSpace(rec[0])
		amountRaw := strings.TrimSpace(rec[1])
		description := strings.TrimSpace(strings.Join(rec[2:], ","))
		if dateRaw == "" || amountRaw == "" {
			continue
		}
		dateISO, err := parseDateISO(dateRaw)
		if err != nil {
			return inserted, err
		}
		amount, err := parseAmount(amountRaw)
		if err != nil {
			return inserted, err
		}
		_, err = db.Exec(`
			INSERT INTO transactions (date_raw, date_iso, amount, description)
			VALUES (?, ?, ?, ?)
		`, dateRaw, dateISO, amount, description)
		if err != nil {
			return inserted, err
		}
		inserted++
	}
	return inserted, nil
}

func loadFilesCmd(basePath string) tea.Cmd {
	return func() tea.Msg {
		entries, err := os.ReadDir(basePath)
		if err != nil {
			return filesLoadedMsg{err: err}
		}
		var items []list.Item
		for _, entry := range entries {
			if entry.IsDir() {
				continue
			}
			name := entry.Name()
			if strings.HasSuffix(strings.ToLower(name), ".csv") {
				items = append(items, fileItem{name: name})
			}
		}
		return filesLoadedMsg{items: items, err: nil}
	}
}

func parseDateISO(input string) (string, error) {
	parsed, err := time.Parse(dateInputFormat, input)
	if err != nil {
		return "", err
	}
	return parsed.Format("2006-01-02"), nil
}

func parseAmount(input string) (float64, error) {
	input = strings.ReplaceAll(input, ",", "")
	return strconv.ParseFloat(input, 64)
}

func loadRows(db *sql.DB) ([]transaction, error) {
	rows, err := db.Query(`
		SELECT date_raw, amount, description
		FROM transactions
		ORDER BY id ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []transaction
	for rows.Next() {
		var dateRaw string
		var amount float64
		var description string
		if err := rows.Scan(&dateRaw, &amount, &description); err != nil {
			return nil, err
		}
		out = append(out, transaction{dateRaw: dateRaw, amount: amount, description: description})
	}
	return out, rows.Err()
}

func renderTable(rows []transaction, cursor int, topIndex int, visible int, width int) string {
	cursorWidth := 2
	dateWidth := 12
	amountWidth := 12
	descWidth := width - dateWidth - amountWidth - cursorWidth - 6
	if descWidth < 20 {
		descWidth = 20
	}

	header := fmt.Sprintf("  %-*s  %-*s  %-*s", dateWidth, "Date", amountWidth, "Amount", descWidth, "Description")
	lines := []string{header}
	end := topIndex + visible
	if end > len(rows) {
		end = len(rows)
	}
	for i := topIndex; i < end; i++ {
		row := rows[i]
		displayIndex := i
		amount := fmt.Sprintf("%.2f", row.amount)
		desc := truncate(row.description, descWidth)
		prefix := "  "
		if displayIndex == cursor {
			prefix = "> "
		}
		lines = append(lines, fmt.Sprintf("%s%-*s  %-*s  %-*s", prefix, dateWidth, row.dateRaw, amountWidth, amount, descWidth, desc))
	}
	content := strings.Join(lines, "\n")
	return content
}

func truncate(s string, width int) string {
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

func (m model) renderFooter(text string) string {
	if m.width == 0 {
		return footerStyle.Render(text)
	}
	flat := strings.ReplaceAll(text, "\n", " ")
	padded := padRight(flat, m.width)
	return footerStyle.Render(padded)
}

func (m model) renderStatus(text string) string {
	if m.width == 0 {
		return statusBarStyle.Render(text)
	}
	flat := strings.ReplaceAll(text, "\n", " ")
	padded := padRight(flat, m.width)
	return statusBarStyle.Render(padded)
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
