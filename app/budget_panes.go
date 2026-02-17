package app

import (
	"database/sql"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/x/ansi"

	"jaskmoney-v2/core"
	coredb "jaskmoney-v2/core/db"
	"jaskmoney-v2/core/filtering"
	"jaskmoney-v2/core/screens"
	"jaskmoney-v2/core/widgets"
)

type budgetState struct {
	month          time.Time
	categoryCursor int
	targetCursor   int
	useRawSpend    bool
}

func newBudgetState() *budgetState {
	now := time.Now().UTC()
	return &budgetState{
		month: time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC),
	}
}

func (s *budgetState) monthKey() string {
	if s == nil || s.month.IsZero() {
		return time.Now().UTC().Format("2006-01")
	}
	return s.month.Format("2006-01")
}

func (s *budgetState) monthLabel() string {
	if s == nil || s.month.IsZero() {
		return time.Now().UTC().Format("Jan 2006")
	}
	return s.month.Format("Jan 2006")
}

func (s *budgetState) shiftMonth(delta int) {
	if s == nil {
		return
	}
	if s.month.IsZero() {
		s.month = time.Now().UTC()
	}
	s.month = s.month.AddDate(0, delta, 0)
	s.month = time.Date(s.month.Year(), s.month.Month(), 1, 0, 0, 0, 0, time.UTC)
}

func (s *budgetState) monthBounds() (string, string) {
	key := s.monthKey()
	start, err := time.Parse("2006-01", key)
	if err != nil {
		now := time.Now().UTC()
		start = time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
	}
	end := start.AddDate(0, 1, -1)
	return start.Format("2006-01-02"), end.Format("2006-01-02")
}

type budgetCategoryLine struct {
	BudgetID      int
	CategoryID    int
	CategoryName  string
	CategoryColor string
	Budgeted      float64
	Spent         float64
	Offsets       float64
	NetSpent      float64
	Remaining     float64
}

type budgetTargetLine struct {
	TargetID   int
	Name       string
	PeriodType string
	PeriodKey  string
	Budgeted   float64
	Spent      float64
	Offsets    float64
	NetSpent   float64
	Remaining  float64
	Err        string
}

type BudgetCategoryPane struct {
	id      string
	title   string
	scope   string
	jump    byte
	focus   bool
	focused bool
	state   *budgetState
	lines   []budgetCategoryLine
	errMsg  string
}

func NewBudgetCategoryPane(id, title, scope string, jumpKey byte, focusable bool, state *budgetState) *BudgetCategoryPane {
	return &BudgetCategoryPane{id: id, title: title, scope: scope, jump: jumpKey, focus: focusable, state: state}
}

func (p *BudgetCategoryPane) ID() string      { return p.id }
func (p *BudgetCategoryPane) Title() string   { return p.title }
func (p *BudgetCategoryPane) Scope() string   { return p.scope }
func (p *BudgetCategoryPane) JumpKey() byte   { return p.jump }
func (p *BudgetCategoryPane) Focusable() bool { return p.focus }
func (p *BudgetCategoryPane) Init() tea.Cmd   { return nil }
func (p *BudgetCategoryPane) OnSelect() tea.Cmd {
	return nil
}
func (p *BudgetCategoryPane) OnDeselect() tea.Cmd {
	return nil
}
func (p *BudgetCategoryPane) OnFocus() tea.Cmd {
	p.focused = true
	return nil
}
func (p *BudgetCategoryPane) OnBlur() tea.Cmd {
	p.focused = false
	return nil
}

func (p *BudgetCategoryPane) Update(msg tea.Msg) tea.Cmd {
	keyMsg, ok := msg.(tea.KeyMsg)
	if !ok || !p.focused {
		return nil
	}
	p.reload()
	key := strings.ToLower(keyMsg.String())
	switch key {
	case "j", "down":
		p.state.categoryCursor = boundedStep(p.state.categoryCursor, len(p.lines), 1)
		return nil
	case "k", "up":
		p.state.categoryCursor = boundedStep(p.state.categoryCursor, len(p.lines), -1)
		return nil
	case "h", "left":
		p.state.shiftMonth(-1)
		return core.StatusCmd("Budget month: " + p.state.monthLabel())
	case "l", "right":
		p.state.shiftMonth(1)
		return core.StatusCmd("Budget month: " + p.state.monthLabel())
	case "r":
		p.state.useRawSpend = !p.state.useRawSpend
		if p.state.useRawSpend {
			return core.StatusCmd("Budget spend mode: raw debits")
		}
		return core.StatusCmd("Budget spend mode: effective debits")
	case "e", "enter":
		if p.state.categoryCursor < 0 || p.state.categoryCursor >= len(p.lines) {
			return nil
		}
		line := p.lines[p.state.categoryCursor]
		screen := screens.NewEditorScreen(
			"Edit Category Budget",
			"screen:budget-edit-category",
			[]screens.EditorField{
				{Key: "amount", Label: line.CategoryName + " amount", Value: fmt.Sprintf("%.2f", line.Budgeted)},
			},
			func(values map[string]string) tea.Msg {
				dbConn := activeDB()
				if dbConn == nil {
					return core.StatusMsg{Text: "BUDGET_DB_NIL: database not ready", IsErr: true}
				}
				amount, err := strconv.ParseFloat(strings.TrimSpace(values["amount"]), 64)
				if err != nil {
					return core.StatusMsg{Text: "BUDGET_VALUE_INVALID: enter a numeric amount", IsErr: true}
				}
				if err := coredb.UpsertCategoryBudget(dbConn, line.CategoryID, amount); err != nil {
					return core.StatusMsg{Text: "BUDGET_SAVE_FAILED: " + err.Error(), IsErr: true}
				}
				return core.StatusMsg{Text: fmt.Sprintf("Budget updated: %s -> %.2f", line.CategoryName, amount)}
			},
		)
		return func() tea.Msg { return core.PushScreenMsg{Screen: screen} }
	case "o":
		if p.state.categoryCursor < 0 || p.state.categoryCursor >= len(p.lines) {
			return nil
		}
		line := p.lines[p.state.categoryCursor]
		screen := screens.NewEditorScreen(
			"Edit Monthly Override",
			"screen:budget-edit-override",
			[]screens.EditorField{
				{Key: "month", Label: "Month", Value: p.state.monthKey()},
				{Key: "amount", Label: "Override amount", Value: fmt.Sprintf("%.2f", line.Budgeted)},
			},
			func(values map[string]string) tea.Msg {
				dbConn := activeDB()
				if dbConn == nil {
					return core.StatusMsg{Text: "BUDGET_DB_NIL: database not ready", IsErr: true}
				}
				month := strings.TrimSpace(values["month"])
				amount, err := strconv.ParseFloat(strings.TrimSpace(values["amount"]), 64)
				if err != nil {
					return core.StatusMsg{Text: "BUDGET_VALUE_INVALID: enter a numeric amount", IsErr: true}
				}
				if err := coredb.UpsertCategoryBudget(dbConn, line.CategoryID, line.Budgeted); err != nil {
					return core.StatusMsg{Text: "BUDGET_BASE_SAVE_FAILED: " + err.Error(), IsErr: true}
				}
				budgets, err := coredb.LoadCategoryBudgets(dbConn)
				if err != nil {
					return core.StatusMsg{Text: "BUDGET_BASE_LOAD_FAILED: " + err.Error(), IsErr: true}
				}
				budgetID := 0
				for _, b := range budgets {
					if b.CategoryID == line.CategoryID {
						budgetID = b.ID
						break
					}
				}
				if budgetID == 0 {
					return core.StatusMsg{Text: "BUDGET_ID_MISSING: no base budget row found", IsErr: true}
				}
				if err := coredb.UpsertBudgetOverride(dbConn, budgetID, month, amount); err != nil {
					return core.StatusMsg{Text: "BUDGET_OVERRIDE_SAVE_FAILED: " + err.Error(), IsErr: true}
				}
				return core.StatusMsg{Text: fmt.Sprintf("Budget override saved: %s %s -> %.2f", line.CategoryName, month, amount)}
			},
		)
		return func() tea.Msg { return core.PushScreenMsg{Screen: screen} }
	}
	return nil
}

func (p *BudgetCategoryPane) View(width, height int, selected, focused bool) string {
	p.reload()
	lines := make([]string, 0, len(p.lines)+4)
	header := fmt.Sprintf("Month: %s  Mode:%s", p.state.monthLabel(), ternaryString(p.state.useRawSpend, "Raw", "Effective"))
	lines = append(lines, header)
	if p.errMsg != "" {
		lines = append(lines, lipgloss.NewStyle().Foreground(lipgloss.Color("#f38ba8")).Render(p.errMsg))
	}
	if len(p.lines) == 0 {
		lines = append(lines, lipgloss.NewStyle().Foreground(lipgloss.Color("#7f849c")).Render("No category budgets yet."))
	} else {
		for i, line := range p.lines {
			prefix := "  "
			if p.focused && i == p.state.categoryCursor {
				prefix = lipgloss.NewStyle().Foreground(lipgloss.Color("#89b4fa")).Bold(true).Render("> ")
			}
			name := ansi.Truncate(line.CategoryName, 14, "")
			budget := formatMoney(line.Budgeted)
			spent := formatMoney(line.displaySpent(p.state.useRawSpend))
			remain := formatMoney(line.Remaining)
			if line.Remaining < 0 {
				remain = lipgloss.NewStyle().Foreground(lipgloss.Color("#f38ba8")).Render(remain)
			}
			lines = append(lines, fmt.Sprintf("%s%-14s  b:%8s  s:%8s  r:%8s", prefix, name, budget, spent, remain))
		}
	}
	lines = append(lines, "j/k row  h/l month  r raw/effective  e edit budget  o edit override")
	content := core.ClipHeight(strings.Join(lines, "\n"), core.MaxInt(3, height))
	return widgets.Pane{
		Title:    p.title,
		Height:   height,
		Content:  content,
		Selected: selected,
		Focused:  focused,
	}.Render(width, height)
}

func (p *BudgetCategoryPane) reload() {
	dbConn := activeDB()
	if dbConn == nil {
		p.lines = nil
		p.errMsg = "database not ready"
		return
	}
	scopeIDs, err := currentAccountScopeIDs(dbConn)
	if err != nil {
		p.lines = nil
		p.errMsg = "scope load failed: " + err.Error()
		return
	}
	lines, err := computeBudgetCategoryLines(dbConn, p.state, scopeIDs)
	if err != nil {
		p.lines = nil
		p.errMsg = "budget load failed: " + err.Error()
		return
	}
	p.errMsg = ""
	p.lines = lines
	p.state.categoryCursor = clampCursor(p.state.categoryCursor, len(p.lines))
}

type BudgetTargetPane struct {
	id      string
	title   string
	scope   string
	jump    byte
	focus   bool
	focused bool
	state   *budgetState
	lines   []budgetTargetLine
	errMsg  string
}

func NewBudgetTargetPane(id, title, scope string, jumpKey byte, focusable bool, state *budgetState) *BudgetTargetPane {
	return &BudgetTargetPane{id: id, title: title, scope: scope, jump: jumpKey, focus: focusable, state: state}
}

func (p *BudgetTargetPane) ID() string      { return p.id }
func (p *BudgetTargetPane) Title() string   { return p.title }
func (p *BudgetTargetPane) Scope() string   { return p.scope }
func (p *BudgetTargetPane) JumpKey() byte   { return p.jump }
func (p *BudgetTargetPane) Focusable() bool { return p.focus }
func (p *BudgetTargetPane) Init() tea.Cmd   { return nil }
func (p *BudgetTargetPane) OnSelect() tea.Cmd {
	return nil
}
func (p *BudgetTargetPane) OnDeselect() tea.Cmd {
	return nil
}
func (p *BudgetTargetPane) OnFocus() tea.Cmd {
	p.focused = true
	return nil
}
func (p *BudgetTargetPane) OnBlur() tea.Cmd {
	p.focused = false
	return nil
}

func (p *BudgetTargetPane) Update(msg tea.Msg) tea.Cmd {
	keyMsg, ok := msg.(tea.KeyMsg)
	if !ok || !p.focused {
		return nil
	}
	p.reload()
	key := strings.ToLower(keyMsg.String())
	switch key {
	case "j", "down":
		p.state.targetCursor = boundedStep(p.state.targetCursor, len(p.lines), 1)
		return nil
	case "k", "up":
		p.state.targetCursor = boundedStep(p.state.targetCursor, len(p.lines), -1)
		return nil
	case "a":
		screen := screens.NewEditorScreen(
			"Add Spending Target",
			"screen:budget-add-target",
			[]screens.EditorField{
				{Key: "name", Label: "Name", Value: ""},
				{Key: "filter", Label: "Saved filter ID", Value: ""},
				{Key: "amount", Label: "Amount", Value: "0.00"},
				{Key: "period", Label: "Period (monthly|quarterly|annual)", Value: "monthly"},
			},
			func(values map[string]string) tea.Msg {
				return upsertTargetFromValues(values, 0)
			},
		)
		return func() tea.Msg { return core.PushScreenMsg{Screen: screen} }
	case "e", "enter":
		if p.state.targetCursor < 0 || p.state.targetCursor >= len(p.lines) {
			return nil
		}
		targetLine := p.lines[p.state.targetCursor]
		screen := screens.NewEditorScreen(
			"Edit Spending Target",
			"screen:budget-edit-target",
			[]screens.EditorField{
				{Key: "name", Label: "Name", Value: targetLine.Name},
				{Key: "filter", Label: "Saved filter ID", Value: targetLine.filterID(p.state, activeDB())},
				{Key: "amount", Label: "Amount", Value: fmt.Sprintf("%.2f", targetLine.Budgeted)},
				{Key: "period", Label: "Period", Value: targetLine.PeriodType},
			},
			func(values map[string]string) tea.Msg {
				return upsertTargetFromValues(values, targetLine.TargetID)
			},
		)
		return func() tea.Msg { return core.PushScreenMsg{Screen: screen} }
	case "delete", "del":
		if p.state.targetCursor < 0 || p.state.targetCursor >= len(p.lines) {
			return nil
		}
		line := p.lines[p.state.targetCursor]
		dbConn := activeDB()
		if dbConn == nil {
			return core.ErrorCmd(fmt.Errorf("TARGET_DB_NIL: database not ready"))
		}
		if err := coredb.DeleteSpendingTarget(dbConn, line.TargetID); err != nil {
			return core.ErrorCmd(fmt.Errorf("TARGET_DELETE_FAILED: %w", err))
		}
		return core.StatusCmd(fmt.Sprintf("Deleted target %q", line.Name))
	}
	return nil
}

func (p *BudgetTargetPane) View(width, height int, selected, focused bool) string {
	p.reload()
	lines := make([]string, 0, len(p.lines)+4)
	lines = append(lines, "Current window targets:")
	if p.errMsg != "" {
		lines = append(lines, lipgloss.NewStyle().Foreground(lipgloss.Color("#f38ba8")).Render(p.errMsg))
	}
	if len(p.lines) == 0 {
		lines = append(lines, lipgloss.NewStyle().Foreground(lipgloss.Color("#7f849c")).Render("No spending targets configured."))
	} else {
		for i, line := range p.lines {
			prefix := "  "
			if p.focused && i == p.state.targetCursor {
				prefix = lipgloss.NewStyle().Foreground(lipgloss.Color("#89b4fa")).Bold(true).Render("> ")
			}
			if line.Err != "" {
				lines = append(lines, prefix+line.Name+": "+line.Err)
				continue
			}
			remaining := formatMoney(line.Remaining)
			if line.Remaining < 0 {
				remaining = lipgloss.NewStyle().Foreground(lipgloss.Color("#f38ba8")).Render(remaining)
			}
			lines = append(lines, fmt.Sprintf(
				"%s%-12s [%s] b:%8s s:%8s r:%8s",
				prefix,
				ansi.Truncate(line.Name, 12, ""),
				line.PeriodType,
				formatMoney(line.Budgeted),
				formatMoney(line.displaySpent(p.state.useRawSpend)),
				remaining,
			))
		}
	}
	lines = append(lines, "j/k row  a add  e edit  del delete")
	content := core.ClipHeight(strings.Join(lines, "\n"), core.MaxInt(3, height))
	return widgets.Pane{
		Title:    p.title,
		Height:   height,
		Content:  content,
		Selected: selected,
		Focused:  focused,
	}.Render(width, height)
}

func (p *BudgetTargetPane) reload() {
	dbConn := activeDB()
	if dbConn == nil {
		p.lines = nil
		p.errMsg = "database not ready"
		return
	}
	scopeIDs, err := currentAccountScopeIDs(dbConn)
	if err != nil {
		p.lines = nil
		p.errMsg = "scope load failed: " + err.Error()
		return
	}
	lines, err := computeBudgetTargetLines(dbConn, p.state, scopeIDs)
	if err != nil {
		p.lines = nil
		p.errMsg = "target load failed: " + err.Error()
		return
	}
	p.errMsg = ""
	p.lines = lines
	p.state.targetCursor = clampCursor(p.state.targetCursor, len(p.lines))
}

type BudgetAnalyticsPane struct {
	id    string
	title string
	scope string
	jump  byte
	focus bool
	state *budgetState
}

func NewBudgetAnalyticsPane(id, title, scope string, jumpKey byte, focusable bool, state *budgetState) *BudgetAnalyticsPane {
	return &BudgetAnalyticsPane{id: id, title: title, scope: scope, jump: jumpKey, focus: focusable, state: state}
}

func (p *BudgetAnalyticsPane) ID() string      { return p.id }
func (p *BudgetAnalyticsPane) Title() string   { return p.title }
func (p *BudgetAnalyticsPane) Scope() string   { return p.scope }
func (p *BudgetAnalyticsPane) JumpKey() byte   { return p.jump }
func (p *BudgetAnalyticsPane) Focusable() bool { return p.focus }
func (p *BudgetAnalyticsPane) Init() tea.Cmd   { return nil }
func (p *BudgetAnalyticsPane) Update(msg tea.Msg) tea.Cmd {
	_ = msg
	return nil
}
func (p *BudgetAnalyticsPane) OnSelect() tea.Cmd   { return nil }
func (p *BudgetAnalyticsPane) OnDeselect() tea.Cmd { return nil }
func (p *BudgetAnalyticsPane) OnFocus() tea.Cmd    { return nil }
func (p *BudgetAnalyticsPane) OnBlur() tea.Cmd     { return nil }

func (p *BudgetAnalyticsPane) View(width, height int, selected, focused bool) string {
	dbConn := activeDB()
	content := "Database not ready."
	if dbConn != nil {
		scopeIDs, scopeErr := currentAccountScopeIDs(dbConn)
		if scopeErr != nil {
			content = "Scope load failed: " + scopeErr.Error()
		} else {
			categoryLines, _ := computeBudgetCategoryLines(dbConn, p.state, scopeIDs)
			targetLines, _ := computeBudgetTargetLines(dbConn, p.state, scopeIDs)
			var catBudget, catSpent, targetBudget, targetSpent float64
			for _, line := range categoryLines {
				catBudget += line.Budgeted
				catSpent += line.displaySpent(p.state.useRawSpend)
			}
			for _, line := range targetLines {
				if line.Err != "" {
					continue
				}
				targetBudget += line.Budgeted
				targetSpent += line.displaySpent(p.state.useRawSpend)
			}
			lines := []string{
				"Month: " + p.state.monthLabel(),
				"Scope: " + accountScopeLabel(scopeIDs),
				fmt.Sprintf("Category budgets: %s / spent %s", formatMoney(catBudget), formatMoney(catSpent)),
				fmt.Sprintf("Target budgets:   %s / spent %s", formatMoney(targetBudget), formatMoney(targetSpent)),
				fmt.Sprintf("Coverage: %d categories, %d targets", len(categoryLines), len(targetLines)),
				"Mode: " + ternaryString(p.state.useRawSpend, "Raw debits", "Effective debits"),
			}
			content = strings.Join(lines, "\n")
		}
	}
	return widgets.Pane{
		Title:    p.title,
		Height:   height,
		Content:  core.ClipHeight(content, core.MaxInt(3, height)),
		Selected: selected,
		Focused:  focused,
	}.Render(width, height)
}

func computeBudgetCategoryLines(dbConn *sql.DB, state *budgetState, scopeIDs []int) ([]budgetCategoryLine, error) {
	categories, err := coredb.GetCategories(dbConn)
	if err != nil {
		return nil, err
	}
	budgets, err := coredb.LoadCategoryBudgets(dbConn)
	if err != nil {
		return nil, err
	}
	budgetByCategory := make(map[int]coredb.CategoryBudget, len(budgets))
	for _, b := range budgets {
		budgetByCategory[b.CategoryID] = b
	}
	overrides, err := coredb.LoadBudgetOverrides(dbConn)
	if err != nil {
		return nil, err
	}
	startISO, endISO := state.monthBounds()
	spendRows, err := coredb.QueryCategoryDebitSpend(dbConn, startISO, endISO, scopeIDs)
	if err != nil {
		return nil, err
	}
	spentByCategory := map[int]float64{}
	for _, row := range spendRows {
		spentByCategory[row.CategoryID] = row.Value
	}
	offsetsByCategory, err := queryOffsetsByCategory(dbConn, startISO, endISO, scopeIDs)
	if err != nil {
		return nil, err
	}

	lines := make([]budgetCategoryLine, 0, len(categories))
	monthKey := state.monthKey()
	for _, cat := range categories {
		if strings.EqualFold(strings.TrimSpace(cat.Name), "Income") {
			continue
		}
		base := budgetByCategory[cat.ID]
		effective := base.Amount
		if rows := overrides[base.ID]; len(rows) > 0 {
			for _, row := range rows {
				if row.MonthKey == monthKey {
					effective = row.Amount
					break
				}
			}
		}
		spent := spentByCategory[cat.ID]
		offsets := offsetsByCategory[cat.ID]
		net := spent - offsets
		display := net
		if state.useRawSpend {
			display = spent
		}
		lines = append(lines, budgetCategoryLine{
			BudgetID:      base.ID,
			CategoryID:    cat.ID,
			CategoryName:  cat.Name,
			CategoryColor: cat.Color,
			Budgeted:      effective,
			Spent:         spent,
			Offsets:       offsets,
			NetSpent:      net,
			Remaining:     effective - display,
		})
	}
	sort.SliceStable(lines, func(i, j int) bool {
		if lines[i].CategoryName == lines[j].CategoryName {
			return lines[i].CategoryID < lines[j].CategoryID
		}
		return strings.ToLower(lines[i].CategoryName) < strings.ToLower(lines[j].CategoryName)
	})
	return lines, nil
}

func computeBudgetTargetLines(dbConn *sql.DB, state *budgetState, scopeIDs []int) ([]budgetTargetLine, error) {
	targets, err := coredb.LoadSpendingTargets(dbConn)
	if err != nil {
		return nil, err
	}
	overrides, err := coredb.LoadTargetOverrides(dbConn)
	if err != nil {
		return nil, err
	}
	filters, err := coredb.LoadSavedFilters(dbConn)
	if err != nil {
		return nil, err
	}
	filterByID := make(map[string]coredb.SavedFilter, len(filters))
	for _, sf := range filters {
		filterByID[strings.ToLower(strings.TrimSpace(sf.ID))] = sf
	}

	rows, err := coredb.QueryTransactionsJoined(dbConn, "", "", scopeIDs)
	if err != nil {
		return nil, err
	}
	offsetByDebit, err := queryOffsetsByDebitTxn(dbConn, scopeIDs)
	if err != nil {
		return nil, err
	}

	now := time.Now().UTC()
	lines := make([]budgetTargetLine, 0, len(targets))
	for _, target := range targets {
		periodKey, start, end := targetPeriodRange(target.PeriodType, now)
		effective := target.Amount
		for _, ov := range overrides[target.ID] {
			if strings.EqualFold(strings.TrimSpace(ov.PeriodKey), strings.TrimSpace(periodKey)) {
				effective = ov.Amount
				break
			}
		}
		row := budgetTargetLine{
			TargetID:   target.ID,
			Name:       target.Name,
			PeriodType: target.PeriodType,
			PeriodKey:  periodKey,
			Budgeted:   effective,
		}
		sf, ok := filterByID[strings.ToLower(strings.TrimSpace(target.SavedFilter))]
		if !ok {
			row.Err = "missing saved filter: " + target.SavedFilter
			lines = append(lines, row)
			continue
		}
		node, parseErr := filtering.ParseStrict(sf.Expr)
		if parseErr != nil {
			row.Err = "invalid filter: " + parseErr.Error()
			lines = append(lines, row)
			continue
		}
		if !filtering.ContainsFieldPredicate(node) {
			node = filtering.MarkTextMetadata(node)
		}
		var spent float64
		var offsets float64
		for _, txn := range rows {
			date, err := time.Parse("2006-01-02", txn.DateISO)
			if err != nil {
				continue
			}
			if date.Before(start) || date.After(end) {
				continue
			}
			filterRow := filtering.Row{
				Description:  txn.Description,
				CategoryName: txn.CategoryName,
				Notes:        txn.Notes,
				AccountName:  txn.AccountName,
				DateISO:      txn.DateISO,
				Amount:       txn.Amount,
				TagNames:     txn.TagNames,
			}
			if !filtering.Eval(node, filterRow) {
				continue
			}
			if txn.Amount >= 0 {
				continue
			}
			spent += -txn.Amount
			offsets += offsetByDebit[txn.ID]
		}
		net := spent - offsets
		display := net
		if state.useRawSpend {
			display = spent
		}
		row.Spent = spent
		row.Offsets = offsets
		row.NetSpent = net
		row.Remaining = effective - display
		lines = append(lines, row)
	}
	sort.SliceStable(lines, func(i, j int) bool {
		if lines[i].Name == lines[j].Name {
			return lines[i].TargetID < lines[j].TargetID
		}
		return strings.ToLower(lines[i].Name) < strings.ToLower(lines[j].Name)
	})
	return lines, nil
}

func queryOffsetsByCategory(dbConn *sql.DB, startISO, endISO string, scopeIDs []int) (map[int]float64, error) {
	query := `
		SELECT COALESCE(t.category_id, 0), COALESCE(SUM(co.amount), 0)
		FROM credit_offsets co
		JOIN transactions t ON t.id = co.debit_txn_id
		WHERE t.date_iso >= ? AND t.date_iso <= ?
	`
	args := []any{startISO, endISO}
	if len(scopeIDs) > 0 {
		placeholders, scopeArgs := intInClause(scopeIDs)
		query += ` AND t.account_id IN (` + placeholders + `)`
		args = append(args, scopeArgs...)
	}
	query += ` GROUP BY t.category_id`
	rows, err := dbConn.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int]float64{}
	for rows.Next() {
		var categoryID int
		var amount float64
		if err := rows.Scan(&categoryID, &amount); err != nil {
			return nil, err
		}
		out[categoryID] = amount
	}
	return out, rows.Err()
}

func queryOffsetsByDebitTxn(dbConn *sql.DB, scopeIDs []int) (map[int]float64, error) {
	query := `SELECT co.debit_txn_id, COALESCE(SUM(co.amount), 0)
		FROM credit_offsets co
		JOIN transactions t ON t.id = co.debit_txn_id`
	args := make([]any, 0, len(scopeIDs))
	if len(scopeIDs) > 0 {
		placeholders, scopeArgs := intInClause(scopeIDs)
		query += ` WHERE t.account_id IN (` + placeholders + `)`
		args = append(args, scopeArgs...)
	}
	query += ` GROUP BY co.debit_txn_id`
	rows, err := dbConn.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int]float64{}
	for rows.Next() {
		var txnID int
		var amount float64
		if err := rows.Scan(&txnID, &amount); err != nil {
			return nil, err
		}
		out[txnID] = amount
	}
	return out, rows.Err()
}

func targetPeriodRange(period string, now time.Time) (string, time.Time, time.Time) {
	now = now.UTC()
	switch strings.ToLower(strings.TrimSpace(period)) {
	case "quarterly":
		q := (int(now.Month())-1)/3 + 1
		startMonth := time.Month((q-1)*3 + 1)
		start := time.Date(now.Year(), startMonth, 1, 0, 0, 0, 0, time.UTC)
		end := start.AddDate(0, 3, -1)
		return fmt.Sprintf("%04d-Q%d", now.Year(), q), start, end
	case "annual", "yearly":
		start := time.Date(now.Year(), time.January, 1, 0, 0, 0, 0, time.UTC)
		end := start.AddDate(1, 0, -1)
		return fmt.Sprintf("%04d", now.Year()), start, end
	default:
		start := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
		end := start.AddDate(0, 1, -1)
		return start.Format("2006-01"), start, end
	}
}

func upsertTargetFromValues(values map[string]string, targetID int) tea.Msg {
	dbConn := activeDB()
	if dbConn == nil {
		return core.StatusMsg{Text: "TARGET_DB_NIL: database not ready", IsErr: true}
	}
	amount, err := strconv.ParseFloat(strings.TrimSpace(values["amount"]), 64)
	if err != nil {
		return core.StatusMsg{Text: "TARGET_VALUE_INVALID: enter a numeric amount", IsErr: true}
	}
	target := coredb.SpendingTarget{
		ID:          targetID,
		Name:        strings.TrimSpace(values["name"]),
		SavedFilter: strings.TrimSpace(values["filter"]),
		Amount:      amount,
		PeriodType:  strings.TrimSpace(values["period"]),
	}
	id, err := coredb.UpsertSpendingTarget(dbConn, target)
	if err != nil {
		return core.StatusMsg{Text: "TARGET_SAVE_FAILED: " + err.Error(), IsErr: true}
	}
	if targetID <= 0 {
		return core.StatusMsg{Text: fmt.Sprintf("Target created (id=%d)", id)}
	}
	return core.StatusMsg{Text: fmt.Sprintf("Target updated (id=%d)", id)}
}

func (l budgetCategoryLine) displaySpent(raw bool) float64 {
	if raw {
		return l.Spent
	}
	return l.NetSpent
}

func (l budgetTargetLine) displaySpent(raw bool) float64 {
	if raw {
		return l.Spent
	}
	return l.NetSpent
}

func (l budgetTargetLine) filterID(state *budgetState, dbConn *sql.DB) string {
	_ = state
	if dbConn == nil {
		return ""
	}
	targets, err := coredb.LoadSpendingTargets(dbConn)
	if err != nil {
		return ""
	}
	for _, target := range targets {
		if target.ID == l.TargetID {
			return target.SavedFilter
		}
	}
	return ""
}

func boundedStep(cursor, size, delta int) int {
	if size <= 0 {
		return 0
	}
	cursor += delta
	if cursor < 0 {
		cursor = 0
	}
	if cursor >= size {
		cursor = size - 1
	}
	return cursor
}

func clampCursor(cursor, size int) int {
	if size <= 0 {
		return 0
	}
	if cursor < 0 {
		return 0
	}
	if cursor >= size {
		return size - 1
	}
	return cursor
}

func ternaryString(ok bool, yes, no string) string {
	if ok {
		return yes
	}
	return no
}
