package app

import (
	"database/sql"
	"fmt"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"

	"jaskmoney-v2/core"
	coredb "jaskmoney-v2/core/db"
	"jaskmoney-v2/core/widgets"
)

const (
	dashTimeframe30d = iota
	dashTimeframe90d
	dashTimeframeYTD
	dashTimeframeAll
)

var dashTimeframeLabels = []string{
	"30D",
	"90D",
	"YTD",
	"ALL",
}

type dashboardState struct {
	timeframe int
}

func newDashboardState() *dashboardState {
	return &dashboardState{timeframe: dashTimeframe30d}
}

func (s *dashboardState) bounds(now time.Time) (startISO, endISO, label string) {
	if s == nil {
		return "", "", "all time"
	}
	now = now.UTC()
	endISO = now.Format("2006-01-02")
	switch s.timeframe {
	case dashTimeframe30d:
		startISO = now.AddDate(0, 0, -29).Format("2006-01-02")
		label = startISO + " -> " + endISO
	case dashTimeframe90d:
		startISO = now.AddDate(0, 0, -89).Format("2006-01-02")
		label = startISO + " -> " + endISO
	case dashTimeframeYTD:
		start := time.Date(now.Year(), time.January, 1, 0, 0, 0, 0, time.UTC)
		startISO = start.Format("2006-01-02")
		label = "YTD " + startISO + " -> " + endISO
	default:
		startISO = ""
		endISO = ""
		label = "all time"
	}
	return startISO, endISO, label
}

func (s *dashboardState) timeframeLabel() string {
	if s == nil {
		return "30D"
	}
	idx := s.timeframe
	if idx < 0 || idx >= len(dashTimeframeLabels) {
		idx = 0
	}
	return dashTimeframeLabels[idx]
}

type DashboardDatePane struct {
	id      string
	title   string
	scope   string
	jump    byte
	focus   bool
	focused bool
	cursor  int
	state   *dashboardState
}

func NewDashboardDatePane(id, title, scope string, jumpKey byte, focusable bool, state *dashboardState) *DashboardDatePane {
	cursor := 0
	if state != nil {
		cursor = state.timeframe
	}
	return &DashboardDatePane{
		id: id, title: title, scope: scope, jump: jumpKey, focus: focusable,
		state: state, cursor: cursor,
	}
}

func (p *DashboardDatePane) ID() string      { return p.id }
func (p *DashboardDatePane) Title() string   { return p.title }
func (p *DashboardDatePane) Scope() string   { return p.scope }
func (p *DashboardDatePane) JumpKey() byte   { return p.jump }
func (p *DashboardDatePane) Focusable() bool { return p.focus }
func (p *DashboardDatePane) Init() tea.Cmd   { return nil }
func (p *DashboardDatePane) OnSelect() tea.Cmd {
	return nil
}
func (p *DashboardDatePane) OnDeselect() tea.Cmd {
	return nil
}
func (p *DashboardDatePane) OnFocus() tea.Cmd {
	p.focused = true
	return nil
}
func (p *DashboardDatePane) OnBlur() tea.Cmd {
	p.focused = false
	return nil
}

func (p *DashboardDatePane) Update(msg tea.Msg) tea.Cmd {
	keyMsg, ok := msg.(tea.KeyMsg)
	if !ok || !p.focused {
		return nil
	}
	switch strings.ToLower(keyMsg.String()) {
	case "left", "h":
		p.cursor--
		if p.cursor < 0 {
			p.cursor = len(dashTimeframeLabels) - 1
		}
		return nil
	case "right", "l":
		p.cursor = (p.cursor + 1) % len(dashTimeframeLabels)
		return nil
	case "enter", " ":
		if p.state != nil {
			p.state.timeframe = p.cursor
		}
		return core.StatusCmd("Dashboard timeframe: " + dashTimeframeLabels[p.cursor])
	}
	return nil
}

func (p *DashboardDatePane) View(width, height int, selected, focused bool) string {
	now := time.Now().UTC()
	startISO, endISO, label := p.state.bounds(now)
	chips := make([]string, 0, len(dashTimeframeLabels))
	for i, name := range dashTimeframeLabels {
		style := lipgloss.NewStyle().Foreground(lipgloss.Color("#bac2de"))
		if i == p.cursor && p.focused {
			style = lipgloss.NewStyle().Foreground(lipgloss.Color("#89b4fa")).Bold(true)
		}
		if p.state != nil && i == p.state.timeframe {
			style = style.Background(lipgloss.Color("#313244")).Bold(true)
		}
		chips = append(chips, style.Render(" "+name+" "))
	}
	rangeLine := "Range: " + label
	if startISO == "" && endISO == "" {
		rangeLine = "Range: all imported data"
	}
	content := strings.Join([]string{
		strings.Join(chips, " "),
		rangeLine,
		"left/right choose  enter apply",
	}, "\n")
	return widgets.Pane{
		Title:    p.title,
		Height:   5,
		Content:  core.ClipHeight(content, core.MaxInt(3, height)),
		Selected: selected,
		Focused:  focused,
	}.Render(width, height)
}

type DashboardOverviewPane struct {
	id    string
	title string
	scope string
	jump  byte
	focus bool
	state *dashboardState
}

func NewDashboardOverviewPane(id, title, scope string, jumpKey byte, focusable bool, state *dashboardState) *DashboardOverviewPane {
	return &DashboardOverviewPane{id: id, title: title, scope: scope, jump: jumpKey, focus: focusable, state: state}
}

func (p *DashboardOverviewPane) ID() string      { return p.id }
func (p *DashboardOverviewPane) Title() string   { return p.title }
func (p *DashboardOverviewPane) Scope() string   { return p.scope }
func (p *DashboardOverviewPane) JumpKey() byte   { return p.jump }
func (p *DashboardOverviewPane) Focusable() bool { return p.focus }
func (p *DashboardOverviewPane) Init() tea.Cmd   { return nil }
func (p *DashboardOverviewPane) Update(msg tea.Msg) tea.Cmd {
	_ = msg
	return nil
}
func (p *DashboardOverviewPane) OnSelect() tea.Cmd   { return nil }
func (p *DashboardOverviewPane) OnDeselect() tea.Cmd { return nil }
func (p *DashboardOverviewPane) OnFocus() tea.Cmd    { return nil }
func (p *DashboardOverviewPane) OnBlur() tea.Cmd     { return nil }

func (p *DashboardOverviewPane) View(width, height int, selected, focused bool) string {
	content := p.renderOverview(width - 4)
	return widgets.Pane{
		Title:    p.title,
		Height:   height,
		Content:  content,
		Selected: selected,
		Focused:  focused,
	}.Render(width, height)
}

func (p *DashboardOverviewPane) renderOverview(width int) string {
	dbConn := activeDB()
	if dbConn == nil {
		return "Database not ready."
	}
	scopeIDs, scopeErr := currentAccountScopeIDs(dbConn)
	if scopeErr != nil {
		return "Scope load failed: " + scopeErr.Error()
	}
	startISO, endISO, label := p.state.bounds(time.Now().UTC())
	rows, categories, err := loadDashboardRowsAndCategories(dbConn, startISO, endISO, scopeIDs)
	if err != nil {
		return "Overview query failed: " + err.Error()
	}
	summary := widgets.RenderRichSummaryCards(rows, categories, core.MaxInt(20, width))
	return strings.Join([]string{
		"Window: " + label,
		"Scope:  " + accountScopeLabel(scopeIDs),
		summary,
	}, "\n")
}

type DashboardTrackerPane struct {
	id    string
	title string
	scope string
	jump  byte
	focus bool
	state *dashboardState
}

func NewDashboardTrackerPane(id, title, scope string, jumpKey byte, focusable bool, state *dashboardState) *DashboardTrackerPane {
	return &DashboardTrackerPane{id: id, title: title, scope: scope, jump: jumpKey, focus: focusable, state: state}
}

func (p *DashboardTrackerPane) ID() string      { return p.id }
func (p *DashboardTrackerPane) Title() string   { return p.title }
func (p *DashboardTrackerPane) Scope() string   { return p.scope }
func (p *DashboardTrackerPane) JumpKey() byte   { return p.jump }
func (p *DashboardTrackerPane) Focusable() bool { return p.focus }
func (p *DashboardTrackerPane) Init() tea.Cmd   { return nil }
func (p *DashboardTrackerPane) Update(msg tea.Msg) tea.Cmd {
	_ = msg
	return nil
}
func (p *DashboardTrackerPane) OnSelect() tea.Cmd   { return nil }
func (p *DashboardTrackerPane) OnDeselect() tea.Cmd { return nil }
func (p *DashboardTrackerPane) OnFocus() tea.Cmd    { return nil }
func (p *DashboardTrackerPane) OnBlur() tea.Cmd     { return nil }

func (p *DashboardTrackerPane) View(width, height int, selected, focused bool) string {
	content := p.render(width-4, height-2)
	return widgets.Pane{
		Title:    p.title,
		Height:   height,
		Content:  content,
		Selected: selected,
		Focused:  focused,
	}.Render(width, height)
}

func (p *DashboardTrackerPane) render(width, height int) string {
	dbConn := activeDB()
	if dbConn == nil {
		return "Database not ready."
	}
	scopeIDs, scopeErr := currentAccountScopeIDs(dbConn)
	if scopeErr != nil {
		return "Scope load failed: " + scopeErr.Error()
	}
	startISO, endISO, _ := p.state.bounds(time.Now().UTC())
	rows, _, err := loadDashboardRowsAndCategories(dbConn, startISO, endISO, scopeIDs)
	if err != nil {
		return "Tracker query failed: " + err.Error()
	}
	if len(rows) == 0 {
		return "No spending data in range."
	}
	start, end := timeframeRangeFromRows(rows)
	if startISO != "" {
		if parsed, parseErr := time.Parse("2006-01-02", startISO); parseErr == nil {
			start = parsed
		}
	}
	if endISO != "" {
		if parsed, parseErr := time.Parse("2006-01-02", endISO); parseErr == nil {
			end = parsed
		}
	}
	content := widgets.RenderRichSpendingTrackerWithRange(rows, core.MaxInt(20, width), time.Sunday, start, end)
	return core.ClipHeight(content, core.MaxInt(3, height))
}

type DashboardCategoryPane struct {
	id    string
	title string
	scope string
	jump  byte
	focus bool
	state *dashboardState
}

func NewDashboardCategoryPane(id, title, scope string, jumpKey byte, focusable bool, state *dashboardState) *DashboardCategoryPane {
	return &DashboardCategoryPane{id: id, title: title, scope: scope, jump: jumpKey, focus: focusable, state: state}
}

func (p *DashboardCategoryPane) ID() string      { return p.id }
func (p *DashboardCategoryPane) Title() string   { return p.title }
func (p *DashboardCategoryPane) Scope() string   { return p.scope }
func (p *DashboardCategoryPane) JumpKey() byte   { return p.jump }
func (p *DashboardCategoryPane) Focusable() bool { return p.focus }
func (p *DashboardCategoryPane) Init() tea.Cmd   { return nil }
func (p *DashboardCategoryPane) Update(msg tea.Msg) tea.Cmd {
	_ = msg
	return nil
}
func (p *DashboardCategoryPane) OnSelect() tea.Cmd   { return nil }
func (p *DashboardCategoryPane) OnDeselect() tea.Cmd { return nil }
func (p *DashboardCategoryPane) OnFocus() tea.Cmd    { return nil }
func (p *DashboardCategoryPane) OnBlur() tea.Cmd     { return nil }

func (p *DashboardCategoryPane) View(width, height int, selected, focused bool) string {
	content := p.render(width-4, height-2)
	return widgets.Pane{
		Title:    p.title,
		Height:   height,
		Content:  content,
		Selected: selected,
		Focused:  focused,
	}.Render(width, height)
}

func (p *DashboardCategoryPane) render(width, height int) string {
	dbConn := activeDB()
	if dbConn == nil {
		return "Database not ready."
	}
	scopeIDs, scopeErr := currentAccountScopeIDs(dbConn)
	if scopeErr != nil {
		return "Scope load failed: " + scopeErr.Error()
	}
	startISO, endISO, _ := p.state.bounds(time.Now().UTC())
	rows, categories, err := loadDashboardRowsAndCategories(dbConn, startISO, endISO, scopeIDs)
	if err != nil {
		return "Category query failed: " + err.Error()
	}
	if len(rows) == 0 {
		return "No category spend in range."
	}
	content := widgets.RenderRichCategoryBreakdown(rows, categories, core.MaxInt(24, width))
	return core.ClipHeight(content, core.MaxInt(3, height))
}

func loadDashboardRowsAndCategories(dbConn *sql.DB, startISO, endISO string, scopeIDs []int) ([]widgets.DashboardRow, []widgets.DashboardCategory, error) {
	joined, err := coredb.QueryTransactionsJoined(dbConn, startISO, endISO, scopeIDs)
	if err != nil {
		return nil, nil, err
	}
	outRows := make([]widgets.DashboardRow, 0, len(joined))
	for _, row := range joined {
		outRows = append(outRows, widgets.DashboardRow{
			DateISO:       row.DateISO,
			Amount:        row.Amount,
			CategoryName:  row.CategoryName,
			CategoryColor: row.CategoryColor,
		})
	}
	cats, err := coredb.GetCategories(dbConn)
	if err != nil {
		return outRows, nil, err
	}
	outCats := make([]widgets.DashboardCategory, 0, len(cats))
	for _, cat := range cats {
		outCats = append(outCats, widgets.DashboardCategory{
			Name:  cat.Name,
			Color: cat.Color,
		})
	}
	return outRows, outCats, nil
}

func timeframeRangeFromRows(rows []widgets.DashboardRow) (time.Time, time.Time) {
	now := time.Now().UTC()
	if len(rows) == 0 {
		return now.AddDate(0, 0, -30), now
	}
	minDate := "9999-12-31"
	maxDate := "0000-01-01"
	for _, row := range rows {
		if row.DateISO < minDate {
			minDate = row.DateISO
		}
		if row.DateISO > maxDate {
			maxDate = row.DateISO
		}
	}
	start, errStart := time.Parse("2006-01-02", minDate)
	end, errEnd := time.Parse("2006-01-02", maxDate)
	if errStart != nil || errEnd != nil {
		return now.AddDate(0, 0, -30), now
	}
	return start, end
}

func formatMoney(v float64) string {
	sign := ""
	if v < 0 {
		sign = "-"
		v = -v
	}
	return fmt.Sprintf("%s$%.2f", sign, v)
}

func minIntDashboard(a, b int) int {
	if a < b {
		return a
	}
	return b
}
