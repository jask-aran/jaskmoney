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

	"github.com/charmbracelet/bubbles/table"
	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/x/ansi"
	_ "modernc.org/sqlite"
)

const dateInputFormat = "2/01/2006"

var (
	titleStyle  = lipgloss.NewStyle().Bold(true)
	statusStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("241"))
	footerStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("239"))
	dimStyle    = lipgloss.NewStyle().Foreground(lipgloss.Color("240"))
	modalStyle  = lipgloss.NewStyle().Border(lipgloss.RoundedBorder()).Padding(1, 2).Background(lipgloss.Color("235"))
)

type model struct {
	db         *sql.DB
	table      table.Model
	status     string
	ready      bool
	basePath   string
	showPopup  bool
	popupInput textinput.Model
	files      []string
	filtered   []string
	cursor     int
	width      int
	height     int
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
	rows []table.Row
	err  error
}

type filesLoadedMsg struct {
	files []string
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
	tbl := table.New(
		table.WithColumns([]table.Column{
			{Title: "Date", Width: 12},
			{Title: "Amount", Width: 12},
			{Title: "Description", Width: 60},
		}),
		table.WithFocused(true),
	)
	styles := table.DefaultStyles()
	styles.Header = styles.Header.Bold(true)
	tbl.SetStyles(styles)

	cwd, _ := os.Getwd()
	popupInput := textinput.New()
	popupInput.Placeholder = "Filter CSV files..."
	popupInput.Prompt = "Find: "
	return model{
		table:      tbl,
		basePath:   cwd,
		popupInput: popupInput,
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
		if m.db == nil {
			return m, nil
		}
		m.table.SetRows(msg.rows)
		m.ready = true
		if m.status == "" {
			m.status = "Ready. Press Enter to import."
		}
		return m, nil
	case filesLoadedMsg:
		if msg.err != nil {
			m.status = fmt.Sprintf("File scan error: %v", msg.err)
			m.showPopup = false
			return m, nil
		}
		m.files = msg.files
		m.applyFilter()
		m.ready = true
		if len(m.filtered) == 0 {
			m.status = "No CSV files found."
		}
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
	case tea.KeyMsg:
		if m.showPopup {
			return m.updatePopup(msg)
		}
		switch msg.String() {
		case "ctrl+c", "q":
			return m, tea.Quit
		case "i":
			m.showPopup = true
			m.popupInput.SetValue("")
			m.popupInput.Focus()
			m.cursor = 0
			return m, loadFilesCmd(m.basePath)
		}
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		m.resizeTable()
		return m, nil
	}

	var cmd tea.Cmd
	m.table, _ = m.table.Update(msg)
	return m, cmd
}

func (m model) View() string {
	header := titleStyle.Render("Transactions")
	status := statusStyle.Render(m.status)

	if !m.ready {
		return fmt.Sprintf("%s\n\n%s", header, status)
	}

	main := fmt.Sprintf("%s\n\n%s\n\n%s", header, status, m.table.View())
	footer := footerStyle.Render(m.footerText())
	if m.showPopup {
		return m.composeModal(main, footer)
	}
	return m.placeWithFooter(main, footer)
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
		var files []string
		for _, entry := range entries {
			if entry.IsDir() {
				continue
			}
			name := entry.Name()
			if strings.HasSuffix(strings.ToLower(name), ".csv") {
				files = append(files, name)
			}
		}
		return filesLoadedMsg{files: files, err: nil}
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
	return strconvParseFloat(input)
}

func strconvParseFloat(input string) (float64, error) {
	return strconv.ParseFloat(input, 64)
}

func loadRows(db *sql.DB) ([]table.Row, error) {
	rows, err := db.Query(`
		SELECT date_raw, amount, description
		FROM transactions
		ORDER BY date_iso ASC, id ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []table.Row
	for rows.Next() {
		var dateRaw string
		var amount float64
		var description string
		if err := rows.Scan(&dateRaw, &amount, &description); err != nil {
			return nil, err
		}
		out = append(out, table.Row{dateRaw, fmt.Sprintf("%.2f", amount), description})
	}
	return out, rows.Err()
}

func (m *model) applyFilter() {
	query := strings.ToLower(strings.TrimSpace(m.popupInput.Value()))
	if query == "" {
		m.filtered = append([]string{}, m.files...)
		m.cursor = 0
		return
	}
	var out []string
	for _, f := range m.files {
		if strings.Contains(strings.ToLower(f), query) {
			out = append(out, f)
		}
	}
	m.filtered = out
	if m.cursor >= len(m.filtered) {
		m.cursor = 0
	}
}

func (m model) updatePopup(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "esc":
		m.showPopup = false
		return m, nil
	case "ctrl+c":
		return m, tea.Quit
	case "up", "k":
		if m.cursor > 0 {
			m.cursor--
		}
		return m, nil
	case "down", "j":
		if m.cursor < len(m.filtered)-1 {
			m.cursor++
		}
		return m, nil
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
		if len(m.filtered) == 0 {
			m.status = "No file selected."
			return m, nil
		}
		filename := m.filtered[m.cursor]
		if m.db == nil {
			m.status = "Database not ready."
			return m, nil
		}
		m.status = "Importing..."
		m.showPopup = false
		return m, ingestCmd(m.db, filename, m.basePath)
	}

	var cmd tea.Cmd
	m.popupInput, cmd = m.popupInput.Update(msg)
	m.applyFilter()
	return m, cmd
}

func (m model) popupView() string {
	var b strings.Builder
	b.WriteString(titleStyle.Render("Import CSV  •  Clear DB (c)  •  Close (esc)"))
	b.WriteString("\n")
	b.WriteString(m.popupInput.View())
	b.WriteString("\n\n")
	if len(m.filtered) == 0 {
		b.WriteString(statusStyle.Render("No matching CSV files."))
		return b.String()
	}
	for i, name := range m.filtered {
		cursor := "  "
		if i == m.cursor {
			cursor = "> "
		}
		b.WriteString(cursor + name + "\n")
	}
	return b.String()
}

func (m *model) resizeTable() {
	if m.height == 0 {
		return
	}
	// Header(1) + blank(1) + status(1) + blank(1) + footer(1) + padding(1)
	usable := m.height - 6
	if usable < 3 {
		usable = 3
	}
	m.table.SetHeight(usable)
	if m.width > 0 {
		descWidth := m.width - 12 - 12 - 6
		if descWidth < 20 {
			descWidth = 20
		}
		m.table.SetColumns([]table.Column{
			{Title: "Date", Width: 12},
			{Title: "Amount", Width: 12},
			{Title: "Description", Width: descWidth},
		})
	}
}

func (m model) placeWithFooter(body, footer string) string {
	if m.height == 0 {
		return body + "\n\n" + footer
	}
	contentHeight := m.height - 1
	if contentHeight < 1 {
		contentHeight = 1
	}
	main := lipgloss.Place(m.width, contentHeight, lipgloss.Left, lipgloss.Top, body)
	return main + "\n" + footer
}

func (m model) footerText() string {
	if m.showPopup {
		return "enter: import  c: clear db  esc: close  ↑/↓: select  type: filter  q: quit"
	}
	return "i: import  q: quit  ↑/↓: scroll"
}

func (m model) composeModal(body, footer string) string {
	basePlain := ansi.Strip(body)
	base := m.placeWithFooter(dimLines(basePlain), footer)
	if m.height == 0 || m.width == 0 {
		return base + "\n\n" + m.popupView()
	}
	modal := modalStyle.Render(m.popupView())
	lines := splitLines(modal)
	modalWidth := maxLineWidth(lines)
	modalHeight := len(lines)

	targetHeight := m.height - 1
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
	return overlayAt(base, modal, x, y, m.width, targetHeight)
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
