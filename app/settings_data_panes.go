package app

import (
	"database/sql"
	"fmt"
	"sort"
	"strconv"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/x/ansi"

	"jaskmoney-v2/core"
	coredb "jaskmoney-v2/core/db"
	"jaskmoney-v2/core/filtering"
	"jaskmoney-v2/core/screens"
	"jaskmoney-v2/core/widgets"
)

type SettingsRulesPane struct {
	id      string
	title   string
	scope   string
	jump    byte
	focus   bool
	focused bool
	cursor  int
	rows    []coredb.RuleV2
	errMsg  string
}

func NewSettingsRulesPane(id, title, scope string, jumpKey byte, focusable bool) *SettingsRulesPane {
	return &SettingsRulesPane{id: id, title: title, scope: scope, jump: jumpKey, focus: focusable}
}

func (p *SettingsRulesPane) ID() string      { return p.id }
func (p *SettingsRulesPane) Title() string   { return p.title }
func (p *SettingsRulesPane) Scope() string   { return p.scope }
func (p *SettingsRulesPane) JumpKey() byte   { return p.jump }
func (p *SettingsRulesPane) Focusable() bool { return p.focus }
func (p *SettingsRulesPane) Init() tea.Cmd   { return nil }
func (p *SettingsRulesPane) OnSelect() tea.Cmd {
	return nil
}
func (p *SettingsRulesPane) OnDeselect() tea.Cmd {
	return nil
}
func (p *SettingsRulesPane) OnFocus() tea.Cmd {
	p.focused = true
	return nil
}
func (p *SettingsRulesPane) OnBlur() tea.Cmd {
	p.focused = false
	return nil
}
func (p *SettingsRulesPane) Update(msg tea.Msg) tea.Cmd {
	keyMsg, ok := msg.(tea.KeyMsg)
	if !ok || !p.focused {
		return nil
	}
	p.reload()
	rawKey := keyMsg.String()
	if rawKey == "A" {
		return p.applyRules(false)
	}
	if rawKey == "D" {
		return p.applyRules(true)
	}
	key := strings.ToLower(rawKey)
	switch key {
	case "j", "down":
		p.cursor = boundedStep(p.cursor, len(p.rows), 1)
		return nil
	case "k", "up":
		p.cursor = boundedStep(p.cursor, len(p.rows), -1)
		return nil
	case "a":
		return p.openRuleEditor(nil)
	case "e", "enter":
		row := p.selectedRule()
		if row == nil {
			return nil
		}
		return p.openRuleEditor(row)
	case " ":
		row := p.selectedRule()
		if row == nil {
			return nil
		}
		dbConn := activeDB()
		if dbConn == nil {
			return core.ErrorCmd(fmt.Errorf("RULE_DB_NIL: database not ready"))
		}
		if err := coredb.ToggleRuleV2Enabled(dbConn, row.ID, !row.Enabled); err != nil {
			return core.ErrorCmd(fmt.Errorf("RULE_TOGGLE_FAILED: %w", err))
		}
		state := "disabled"
		if !row.Enabled {
			state = "enabled"
		}
		return core.StatusCodeCmd("RULE_TOGGLE", fmt.Sprintf("Rule %s: %s", state, row.Name))
	case "delete", "del":
		row := p.selectedRule()
		if row == nil {
			return nil
		}
		dbConn := activeDB()
		if dbConn == nil {
			return core.ErrorCmd(fmt.Errorf("RULE_DB_NIL: database not ready"))
		}
		if err := coredb.DeleteRuleV2(dbConn, row.ID); err != nil {
			return core.ErrorCmd(fmt.Errorf("RULE_DELETE_FAILED: %w", err))
		}
		return core.StatusCodeCmd("RULE_DELETE", "Rule deleted: "+row.Name)
	case "u":
		return p.moveRule(-1)
	case "n":
		return p.moveRule(1)
	case "d":
		return p.applyRules(true)
	}
	return nil
}
func (p *SettingsRulesPane) View(width, height int, selected, focused bool) string {
	p.reload()
	scopeLabel := "all accounts"
	if dbConn := activeDB(); dbConn != nil {
		if scopeIDs, err := currentAccountScopeIDs(dbConn); err == nil {
			scopeLabel = accountScopeLabel(scopeIDs)
		}
	}
	lines := []string{"Rules v2:", "Scope: " + scopeLabel}
	if p.errMsg != "" {
		lines = append(lines, lipgloss.NewStyle().Foreground(lipgloss.Color("#f38ba8")).Render(p.errMsg))
	}
	if len(p.rows) == 0 {
		lines = append(lines, lipgloss.NewStyle().Foreground(lipgloss.Color("#7f849c")).Render("No rules configured."))
	} else {
		for i, row := range p.rows {
			prefix := "  "
			if p.focused && i == p.cursor {
				prefix = lipgloss.NewStyle().Foreground(lipgloss.Color("#89b4fa")).Bold(true).Render("> ")
			}
			state := "off"
			if row.Enabled {
				state = "on"
			}
			lines = append(lines, fmt.Sprintf("%s%-14s [%s] filter:%s", prefix, ansi.Truncate(row.Name, 14, ""), state, row.SavedFilter))
			lines = append(lines, "    "+ansi.Truncate(ruleActionSummary(row), 44, ""))
		}
	}
	lines = append(lines, "a add  e edit  space toggle  u/n reorder  A apply  D dry-run  del delete")
	content := core.ClipHeight(strings.Join(lines, "\n"), core.MaxInt(3, height))
	return widgets.Pane{Title: p.title, Height: height, Content: content, Selected: selected, Focused: focused}.Render(width, height)
}
func (p *SettingsRulesPane) reload() {
	dbConn := activeDB()
	if dbConn == nil {
		p.rows = nil
		p.errMsg = "database not ready"
		return
	}
	rows, err := coredb.LoadRulesV2(dbConn)
	if err != nil {
		p.rows = nil
		p.errMsg = "load failed: " + err.Error()
		return
	}
	p.errMsg = ""
	p.rows = rows
	p.cursor = clampCursor(p.cursor, len(p.rows))
}

func (p *SettingsRulesPane) selectedRule() *coredb.RuleV2 {
	if p.cursor < 0 || p.cursor >= len(p.rows) {
		return nil
	}
	return &p.rows[p.cursor]
}

func (p *SettingsRulesPane) openRuleEditor(existing *coredb.RuleV2) tea.Cmd {
	title := "Add Rule"
	initial := coredb.RuleV2{
		Enabled:      true,
		AddTagIDsRaw: "[]",
	}
	if existing != nil {
		title = "Edit Rule"
		initial = *existing
	}
	catID := ""
	if initial.SetCategory.Valid {
		catID = strconv.Itoa(int(initial.SetCategory.Int64))
	}
	tagIDs, _ := coredb.ParseRuleTagIDs(initial.AddTagIDsRaw)
	tagParts := make([]string, 0, len(tagIDs))
	for _, id := range tagIDs {
		tagParts = append(tagParts, strconv.Itoa(id))
	}
	screen := screens.NewEditorScreen(
		title,
		"screen:settings-rule-edit",
		[]screens.EditorField{
			{Key: "name", Label: "Name", Value: initial.Name},
			{Key: "filter_id", Label: "Saved filter ID", Value: initial.SavedFilter},
			{Key: "set_category_id", Label: "Set category ID (optional)", Value: catID},
			{Key: "add_tag_ids", Label: "Add tag IDs (csv)", Value: strings.Join(tagParts, ",")},
			{Key: "enabled", Label: "Enabled (true|false)", Value: strconv.FormatBool(initial.Enabled)},
		},
		func(values map[string]string) tea.Msg {
			dbConn := activeDB()
			if dbConn == nil {
				return core.StatusMsg{Text: "RULE_DB_NIL: database not ready", IsErr: true}
			}
			name := strings.TrimSpace(values["name"])
			filterID := strings.TrimSpace(values["filter_id"])
			if name == "" || filterID == "" {
				return core.StatusMsg{Text: "RULE_INVALID: name/filter_id are required", IsErr: true}
			}
			dbFilter, err := coredb.LoadSavedFilters(dbConn)
			if err != nil {
				return core.StatusMsg{Text: "RULE_FILTERS_LOAD_FAILED: " + err.Error(), IsErr: true}
			}
			filterExists := false
			for _, sf := range dbFilter {
				if strings.EqualFold(strings.TrimSpace(sf.ID), filterID) {
					filterExists = true
					break
				}
			}
			if !filterExists {
				return core.StatusMsg{Text: "RULE_FILTER_MISSING: saved filter not found", IsErr: true}
			}
			categoryRaw := strings.TrimSpace(values["set_category_id"])
			setCategory := sqlNullInt64(categoryRaw)
			tagIDs, parseErr := parseCSVInts(values["add_tag_ids"])
			if parseErr != nil {
				return core.StatusMsg{Text: "RULE_TAG_IDS_INVALID: " + parseErr.Error(), IsErr: true}
			}
			rule := coredb.RuleV2{
				ID:           initial.ID,
				Name:         name,
				SavedFilter:  strings.ToLower(filterID),
				SetCategory:  setCategory,
				AddTagIDsRaw: coredb.EncodeRuleTagIDs(tagIDs),
				Enabled:      strings.EqualFold(strings.TrimSpace(values["enabled"]), "true") || strings.TrimSpace(values["enabled"]) == "1",
			}
			id, err := coredb.UpsertRuleV2(dbConn, rule)
			if err != nil {
				return core.StatusMsg{Text: "RULE_SAVE_FAILED: " + err.Error(), IsErr: true}
			}
			return core.StatusMsg{Text: fmt.Sprintf("Rule saved: %s (id=%d)", name, id), Code: "RULE_SAVE"}
		},
	)
	return func() tea.Msg { return core.PushScreenMsg{Screen: screen} }
}

func (p *SettingsRulesPane) moveRule(delta int) tea.Cmd {
	if delta == 0 || len(p.rows) <= 1 {
		return nil
	}
	target := p.cursor + delta
	if target < 0 || target >= len(p.rows) {
		return nil
	}
	dbConn := activeDB()
	if dbConn == nil {
		return core.ErrorCmd(fmt.Errorf("RULE_DB_NIL: database not ready"))
	}
	ids := make([]int, 0, len(p.rows))
	for _, row := range p.rows {
		ids = append(ids, row.ID)
	}
	ids[p.cursor], ids[target] = ids[target], ids[p.cursor]
	if err := coredb.SaveRuleOrder(dbConn, ids); err != nil {
		return core.ErrorCmd(fmt.Errorf("RULE_REORDER_FAILED: %w", err))
	}
	p.cursor = target
	return core.StatusCodeCmd("RULE_REORDER", "Rule order updated.")
}

func (p *SettingsRulesPane) applyRules(dryRun bool) tea.Cmd {
	dbConn := activeDB()
	if dbConn == nil {
		return core.ErrorCmd(fmt.Errorf("RULE_DB_NIL: database not ready"))
	}
	scopeIDs, err := currentAccountScopeIDs(dbConn)
	if err != nil {
		return core.ErrorCmd(fmt.Errorf("RULE_SCOPE_LOAD_FAILED: %w", err))
	}
	scopeLabel := accountScopeLabel(scopeIDs)

	if dryRun {
		outcomes, summary, runErr := coredb.DryRunRulesV2Scoped(dbConn, scopeIDs)
		if runErr != nil {
			return core.ErrorCmd(fmt.Errorf("RULE_DRY_RUN_FAILED: %w", runErr))
		}
		screen := newRulesDryRunModal(scopeLabel, outcomes, summary)
		statusCode := "RULE_DRY_RUN"
		isErr := false
		if summary.FailedRules > 0 {
			statusCode = "RULE_DRY_RUN_WARN"
			isErr = true
		}
		statusText := fmt.Sprintf(
			"Dry-run (%s): %d modified, %d category changes, %d tag changes, %d failed rules",
			scopeLabel,
			summary.TotalModified,
			summary.TotalCategoryChanges,
			summary.TotalTagChanges,
			summary.FailedRules,
		)
		return tea.Batch(
			func() tea.Msg { return core.PushScreenMsg{Screen: screen} },
			func() tea.Msg { return core.StatusMsg{Text: statusText, IsErr: isErr, Code: statusCode} },
		)
	}

	summary, runErr := coredb.ApplyRulesV2Scoped(dbConn, scopeIDs)
	if runErr != nil {
		return core.ErrorCmd(fmt.Errorf("RULE_APPLY_FAILED: %w", runErr))
	}
	isErr := summary.FailedRules > 0
	statusCode := "RULE_APPLY"
	if isErr {
		statusCode = "RULE_APPLY_WARN"
	}
	return func() tea.Msg {
		return core.StatusMsg{
			Text: fmt.Sprintf(
				"Applied rules (%s): %d modified, %d category changes, %d tag changes, %d failed rules",
				scopeLabel,
				summary.TotalModified,
				summary.TotalCategoryChanges,
				summary.TotalTagChanges,
				summary.FailedRules,
			),
			IsErr: isErr,
			Code:  statusCode,
		}
	}
}

func ruleActionSummary(rule coredb.RuleV2) string {
	parts := make([]string, 0, 2)
	if rule.SetCategory.Valid {
		parts = append(parts, "set_cat="+strconv.Itoa(int(rule.SetCategory.Int64)))
	}
	tagIDs, err := coredb.ParseRuleTagIDs(rule.AddTagIDsRaw)
	if err == nil && len(tagIDs) > 0 {
		parts = append(parts, "add_tags="+joinIntIDs(tagIDs))
	}
	if len(parts) == 0 {
		return "no-op rule actions"
	}
	return strings.Join(parts, " ")
}

func joinIntIDs(ids []int) string {
	parts := make([]string, 0, len(ids))
	for _, id := range ids {
		parts = append(parts, strconv.Itoa(id))
	}
	return strings.Join(parts, ",")
}

type SettingsFiltersPane struct {
	id      string
	title   string
	scope   string
	jump    byte
	focus   bool
	focused bool
	cursor  int
	rows    []coredb.SavedFilter
	usage   map[string]coredb.FilterUsageState
	errMsg  string
}

func NewSettingsFiltersPane(id, title, scope string, jumpKey byte, focusable bool) *SettingsFiltersPane {
	return &SettingsFiltersPane{
		id: id, title: title, scope: scope, jump: jumpKey, focus: focusable,
		usage: map[string]coredb.FilterUsageState{},
	}
}

func (p *SettingsFiltersPane) ID() string      { return p.id }
func (p *SettingsFiltersPane) Title() string   { return p.title }
func (p *SettingsFiltersPane) Scope() string   { return p.scope }
func (p *SettingsFiltersPane) JumpKey() byte   { return p.jump }
func (p *SettingsFiltersPane) Focusable() bool { return p.focus }
func (p *SettingsFiltersPane) Init() tea.Cmd   { return nil }
func (p *SettingsFiltersPane) OnSelect() tea.Cmd {
	return nil
}
func (p *SettingsFiltersPane) OnDeselect() tea.Cmd {
	return nil
}
func (p *SettingsFiltersPane) OnFocus() tea.Cmd {
	p.focused = true
	return nil
}
func (p *SettingsFiltersPane) OnBlur() tea.Cmd {
	p.focused = false
	return nil
}

func (p *SettingsFiltersPane) Update(msg tea.Msg) tea.Cmd {
	keyMsg, ok := msg.(tea.KeyMsg)
	if !ok || !p.focused {
		return nil
	}
	p.reload()
	key := strings.ToLower(keyMsg.String())
	switch key {
	case "j", "down":
		p.cursor = boundedStep(p.cursor, len(p.rows), 1)
	case "k", "up":
		p.cursor = boundedStep(p.cursor, len(p.rows), -1)
	case "a":
		screen := screens.NewEditorScreen(
			"Add Saved Filter",
			"screen:settings-filter-add",
			[]screens.EditorField{
				{Key: "id", Label: "ID", Value: ""},
				{Key: "name", Label: "Name", Value: ""},
				{Key: "expr", Label: "Expr", Value: ""},
			},
			func(values map[string]string) tea.Msg {
				return saveFilterValues(values, "")
			},
		)
		return func() tea.Msg { return core.PushScreenMsg{Screen: screen} }
	case "e", "enter":
		if p.cursor < 0 || p.cursor >= len(p.rows) {
			return nil
		}
		selected := p.rows[p.cursor]
		screen := screens.NewEditorScreen(
			"Edit Saved Filter",
			"screen:settings-filter-edit",
			[]screens.EditorField{
				{Key: "id", Label: "ID", Value: selected.ID},
				{Key: "name", Label: "Name", Value: selected.Name},
				{Key: "expr", Label: "Expr", Value: selected.Expr},
			},
			func(values map[string]string) tea.Msg {
				return saveFilterValues(values, selected.ID)
			},
		)
		return func() tea.Msg { return core.PushScreenMsg{Screen: screen} }
	case "delete", "del":
		if p.cursor < 0 || p.cursor >= len(p.rows) {
			return nil
		}
		dbConn := activeDB()
		if dbConn == nil {
			return core.ErrorCmd(fmt.Errorf("FILTER_DB_NIL: database not ready"))
		}
		selected := p.rows[p.cursor]
		if err := coredb.DeleteSavedFilter(dbConn, selected.ID); err != nil {
			return core.ErrorCmd(fmt.Errorf("FILTER_DELETE_FAILED: %w", err))
		}
		return core.StatusCmd("Saved filter deleted: " + selected.ID)
	}
	return nil
}

func (p *SettingsFiltersPane) View(width, height int, selected, focused bool) string {
	p.reload()
	lines := []string{"Saved filters:"}
	if p.errMsg != "" {
		lines = append(lines, lipgloss.NewStyle().Foreground(lipgloss.Color("#f38ba8")).Render(p.errMsg))
	}
	if len(p.rows) == 0 {
		lines = append(lines, lipgloss.NewStyle().Foreground(lipgloss.Color("#7f849c")).Render("No saved filters. Press 'a' to add one."))
	} else {
		for i, row := range p.rows {
			prefix := "  "
			if p.focused && i == p.cursor {
				prefix = lipgloss.NewStyle().Foreground(lipgloss.Color("#89b4fa")).Bold(true).Render("> ")
			}
			state := p.usage[strings.ToLower(strings.TrimSpace(row.ID))]
			lines = append(lines, fmt.Sprintf(
				"%s%-12s uses:%-4d  %s",
				prefix,
				ansi.Truncate(row.ID, 12, ""),
				state.UseCount,
				ansi.Truncate(strings.TrimSpace(row.Name), 18, ""),
			))
			lines = append(lines, "    "+ansi.Truncate(strings.TrimSpace(row.Expr), 44, ""))
		}
	}
	lines = append(lines, "a add  e edit  del delete")
	content := core.ClipHeight(strings.Join(lines, "\n"), core.MaxInt(3, height))
	return widgets.Pane{Title: p.title, Height: height, Content: content, Selected: selected, Focused: focused}.Render(width, height)
}

func (p *SettingsFiltersPane) reload() {
	dbConn := activeDB()
	if dbConn == nil {
		p.rows = nil
		p.errMsg = "database not ready"
		return
	}
	rows, err := coredb.LoadSavedFilters(dbConn)
	if err != nil {
		p.rows = nil
		p.errMsg = "load failed: " + err.Error()
		return
	}
	usage, err := coredb.LoadFilterUsageState(dbConn)
	if err == nil {
		p.usage = usage
	}
	sort.SliceStable(rows, func(i, j int) bool {
		iUsage := p.usage[strings.ToLower(strings.TrimSpace(rows[i].ID))]
		jUsage := p.usage[strings.ToLower(strings.TrimSpace(rows[j].ID))]
		if iUsage.LastUsedUnix != jUsage.LastUsedUnix {
			return iUsage.LastUsedUnix > jUsage.LastUsedUnix
		}
		return strings.ToLower(rows[i].ID) < strings.ToLower(rows[j].ID)
	})
	p.rows = rows
	p.errMsg = ""
	p.cursor = clampCursor(p.cursor, len(p.rows))
}

type SettingsChartPane struct {
	id    string
	title string
	scope string
	jump  byte
	focus bool
}

func NewSettingsChartPane(id, title, scope string, jumpKey byte, focusable bool) *SettingsChartPane {
	return &SettingsChartPane{id: id, title: title, scope: scope, jump: jumpKey, focus: focusable}
}

func (p *SettingsChartPane) ID() string      { return p.id }
func (p *SettingsChartPane) Title() string   { return p.title }
func (p *SettingsChartPane) Scope() string   { return p.scope }
func (p *SettingsChartPane) JumpKey() byte   { return p.jump }
func (p *SettingsChartPane) Focusable() bool { return p.focus }
func (p *SettingsChartPane) Init() tea.Cmd   { return nil }
func (p *SettingsChartPane) Update(msg tea.Msg) tea.Cmd {
	_ = msg
	return nil
}
func (p *SettingsChartPane) OnSelect() tea.Cmd   { return nil }
func (p *SettingsChartPane) OnDeselect() tea.Cmd { return nil }
func (p *SettingsChartPane) OnFocus() tea.Cmd    { return nil }
func (p *SettingsChartPane) OnBlur() tea.Cmd     { return nil }
func (p *SettingsChartPane) View(width, height int, selected, focused bool) string {
	lines := []string{
		"Shared analytics settings",
		"- Budget pane supports raw/effective spend toggle (key: r).",
		"- Dashboard timeframe lives in the Date Picker pane.",
		"- Phase 1-N keeps these controls contextual to active panes.",
	}
	content := core.ClipHeight(strings.Join(lines, "\n"), core.MaxInt(3, height))
	return widgets.Pane{Title: p.title, Height: height, Content: content, Selected: selected, Focused: focused}.Render(width, height)
}

type SettingsDatabasePane struct {
	id      string
	title   string
	scope   string
	jump    byte
	focus   bool
	focused bool
	errMsg  string
	stats   coredb.DBStats
}

func NewSettingsDatabasePane(id, title, scope string, jumpKey byte, focusable bool) *SettingsDatabasePane {
	return &SettingsDatabasePane{id: id, title: title, scope: scope, jump: jumpKey, focus: focusable}
}

func (p *SettingsDatabasePane) ID() string      { return p.id }
func (p *SettingsDatabasePane) Title() string   { return p.title }
func (p *SettingsDatabasePane) Scope() string   { return p.scope }
func (p *SettingsDatabasePane) JumpKey() byte   { return p.jump }
func (p *SettingsDatabasePane) Focusable() bool { return p.focus }
func (p *SettingsDatabasePane) Init() tea.Cmd   { return nil }
func (p *SettingsDatabasePane) OnSelect() tea.Cmd {
	return nil
}
func (p *SettingsDatabasePane) OnDeselect() tea.Cmd {
	return nil
}
func (p *SettingsDatabasePane) OnFocus() tea.Cmd {
	p.focused = true
	return nil
}
func (p *SettingsDatabasePane) OnBlur() tea.Cmd {
	p.focused = false
	return nil
}

func (p *SettingsDatabasePane) Update(msg tea.Msg) tea.Cmd {
	keyMsg, ok := msg.(tea.KeyMsg)
	if !ok || !p.focused {
		return nil
	}
	key := strings.ToLower(keyMsg.String())
	switch key {
	case "i":
		return func() tea.Msg { return core.CommandExecuteMsg{CommandID: "manage-import"} }
	case "c":
		return func() tea.Msg { return core.CommandExecuteMsg{CommandID: "manage-clear-db"} }
	case "z":
		dbConn := activeDB()
		if dbConn == nil {
			return func() tea.Msg {
				return core.StatusMsg{Text: "SEED_DB_NIL: database not ready", IsErr: true}
			}
		}
		if err := coredb.SeedTestData(dbConn); err != nil {
			return func() tea.Msg {
				return core.StatusMsg{Text: "SEED_FAILED: " + err.Error(), IsErr: true}
			}
		}
		return func() tea.Msg {
			return core.StatusMsg{Text: "Seeded test data.", Code: "SEED"}
		}
	}
	return nil
}

func (p *SettingsDatabasePane) View(width, height int, selected, focused bool) string {
	p.reload()
	lines := []string{
		fmt.Sprintf("Accounts:     %d", p.stats.Accounts),
		fmt.Sprintf("Transactions: %d", p.stats.Transactions),
		fmt.Sprintf("Categories:   %d", p.stats.Categories),
		fmt.Sprintf("Tags:         %d", p.stats.Tags),
		fmt.Sprintf("Imports:      %d", p.stats.Imports),
		fmt.Sprintf("Rules:        %d", p.stats.Rules),
		fmt.Sprintf("SavedFilter:  %d", p.stats.Filters),
	}
	if p.errMsg != "" {
		lines = append(lines, lipgloss.NewStyle().Foreground(lipgloss.Color("#f38ba8")).Render(p.errMsg))
	}
	lines = append(lines, "i import  c clear-db  z seed-test-data")
	content := core.ClipHeight(strings.Join(lines, "\n"), core.MaxInt(3, height))
	return widgets.Pane{Title: p.title, Height: height, Content: content, Selected: selected, Focused: focused}.Render(width, height)
}

func (p *SettingsDatabasePane) reload() {
	dbConn := activeDB()
	if dbConn == nil {
		p.errMsg = "database not ready"
		p.stats = coredb.DBStats{}
		return
	}
	stats, err := coredb.LoadDBStats(dbConn)
	if err != nil {
		p.errMsg = "stats failed: " + err.Error()
		p.stats = coredb.DBStats{}
		return
	}
	p.errMsg = ""
	p.stats = stats
}

type SettingsImportHistoryPane struct {
	id     string
	title  string
	scope  string
	jump   byte
	focus  bool
	rows   []coredb.ImportRecord
	errMsg string
}

func NewSettingsImportHistoryPane(id, title, scope string, jumpKey byte, focusable bool) *SettingsImportHistoryPane {
	return &SettingsImportHistoryPane{id: id, title: title, scope: scope, jump: jumpKey, focus: focusable}
}

func (p *SettingsImportHistoryPane) ID() string      { return p.id }
func (p *SettingsImportHistoryPane) Title() string   { return p.title }
func (p *SettingsImportHistoryPane) Scope() string   { return p.scope }
func (p *SettingsImportHistoryPane) JumpKey() byte   { return p.jump }
func (p *SettingsImportHistoryPane) Focusable() bool { return p.focus }
func (p *SettingsImportHistoryPane) Init() tea.Cmd   { return nil }
func (p *SettingsImportHistoryPane) Update(msg tea.Msg) tea.Cmd {
	_ = msg
	return nil
}
func (p *SettingsImportHistoryPane) OnSelect() tea.Cmd   { return nil }
func (p *SettingsImportHistoryPane) OnDeselect() tea.Cmd { return nil }
func (p *SettingsImportHistoryPane) OnFocus() tea.Cmd    { return nil }
func (p *SettingsImportHistoryPane) OnBlur() tea.Cmd     { return nil }
func (p *SettingsImportHistoryPane) View(width, height int, selected, focused bool) string {
	p.reload()
	lines := []string{"Most recent imports:"}
	if p.errMsg != "" {
		lines = append(lines, lipgloss.NewStyle().Foreground(lipgloss.Color("#f38ba8")).Render(p.errMsg))
	}
	if len(p.rows) == 0 {
		lines = append(lines, lipgloss.NewStyle().Foreground(lipgloss.Color("#7f849c")).Render("No imports yet."))
	} else {
		for _, row := range p.rows {
			lines = append(lines, fmt.Sprintf("%-16s rows:%-5d %s", ansi.Truncate(row.Filename, 16, ""), row.RowCount, row.ImportedAt))
		}
	}
	content := core.ClipHeight(strings.Join(lines, "\n"), core.MaxInt(3, height))
	return widgets.Pane{Title: p.title, Height: height, Content: content, Selected: selected, Focused: focused}.Render(width, height)
}
func (p *SettingsImportHistoryPane) reload() {
	dbConn := activeDB()
	if dbConn == nil {
		p.rows = nil
		p.errMsg = "database not ready"
		return
	}
	rows, err := coredb.LoadImportHistory(dbConn, 20)
	if err != nil {
		p.rows = nil
		p.errMsg = "load failed: " + err.Error()
		return
	}
	p.rows = rows
	p.errMsg = ""
}

func sqlNullInt64(raw string) sql.NullInt64 {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return sql.NullInt64{}
	}
	id, err := strconv.Atoi(raw)
	if err != nil || id <= 0 {
		return sql.NullInt64{}
	}
	return sql.NullInt64{Int64: int64(id), Valid: true}
}

func parseCSVInts(raw string) ([]int, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	parts := strings.Split(raw, ",")
	out := make([]int, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		id, err := strconv.Atoi(part)
		if err != nil {
			return nil, err
		}
		if id <= 0 {
			continue
		}
		out = append(out, id)
	}
	return out, nil
}

func saveFilterValues(values map[string]string, originalID string) tea.Msg {
	dbConn := activeDB()
	if dbConn == nil {
		return core.StatusMsg{Text: "FILTER_DB_NIL: database not ready", IsErr: true}
	}
	id := strings.TrimSpace(strings.ToLower(values["id"]))
	name := strings.TrimSpace(values["name"])
	expr := strings.TrimSpace(values["expr"])
	if id == "" || name == "" || expr == "" {
		return core.StatusMsg{Text: "FILTER_INVALID: id/name/expr are required", IsErr: true}
	}
	if _, err := filtering.ParseStrict(expr); err != nil {
		return core.StatusMsg{Text: "FILTER_PARSE_FAILED: " + err.Error(), IsErr: true}
	}
	if originalID != "" && !strings.EqualFold(strings.TrimSpace(originalID), id) {
		if err := coredb.DeleteSavedFilter(dbConn, originalID); err != nil {
			return core.StatusMsg{Text: "FILTER_RENAME_FAILED: " + err.Error(), IsErr: true}
		}
	}
	if err := coredb.UpsertSavedFilter(dbConn, coredb.SavedFilter{ID: id, Name: name, Expr: expr}); err != nil {
		return core.StatusMsg{Text: "FILTER_SAVE_FAILED: " + err.Error(), IsErr: true}
	}
	return core.StatusMsg{Text: "Saved filter upserted: " + id, Code: "FILTER_SAVE"}
}
