package main

import (
	"fmt"
	"sort"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
)

const (
	commandUIKindPalette = "palette"
	commandUIKindColon   = "colon"
)

type Command struct {
	ID          string
	Label       string
	Description string
	Category    string
	Hidden      bool
	Scopes      []string
	Enabled     func(m model) (bool, string)
	Execute     func(m model) (model, tea.Cmd, error)
}

type CommandMatch struct {
	Command        Command
	Score          int
	Enabled        bool
	DisabledReason string
}

type CommandRegistry struct {
	commands []Command
	byID     map[string]Command
}

var transactionSortCycle = []int{
	sortByDate,
	sortByAmount,
	sortByDescription,
	sortByCategory,
}

func NewCommandRegistry(keys *KeyRegistry, savedFilters []savedFilter) *CommandRegistry {
	r := &CommandRegistry{}
	r.commands = []Command{
		{
			ID:          "nav:next-tab",
			Label:       "Next Tab",
			Description: "Switch to the next tab",
			Category:    "Navigation",
			Enabled:     commandAlwaysEnabled,
			Execute: func(m model) (model, tea.Cmd, error) {
				m.activeTab = (m.activeTab + 1) % tabCount
				m.applyTabDefaultsOnSwitch()
				return m, nil, nil
			},
		},
		{
			ID:          "nav:prev-tab",
			Label:       "Previous Tab",
			Description: "Switch to the previous tab",
			Category:    "Navigation",
			Enabled:     commandAlwaysEnabled,
			Execute: func(m model) (model, tea.Cmd, error) {
				m.activeTab = (m.activeTab - 1 + tabCount) % tabCount
				m.applyTabDefaultsOnSwitch()
				return m, nil, nil
			},
		},
		{
			ID:          "nav:dashboard",
			Label:       "Go to Dashboard",
			Description: "Switch to Dashboard tab",
			Category:    "Navigation",
			Enabled:     commandAlwaysEnabled,
			Execute: func(m model) (model, tea.Cmd, error) {
				m.activeTab = tabDashboard
				m.applyTabDefaultsOnSwitch()
				return m, nil, nil
			},
		},
		{
			ID:          "nav:manager",
			Label:       "Go to Manager",
			Description: "Switch to Manager tab",
			Category:    "Navigation",
			Enabled:     commandAlwaysEnabled,
			Execute: func(m model) (model, tea.Cmd, error) {
				m.activeTab = tabManager
				m.managerMode = managerModeTransactions
				m.focusedSection = sectionManagerTransactions
				m.ensureCursorInWindow()
				m.applyTabDefaultsOnSwitch()
				return m, nil, nil
			},
		},
		{
			ID:          "nav:budget",
			Label:       "Go to Budget",
			Description: "Switch to Budget tab",
			Category:    "Navigation",
			Enabled: func(m model) (bool, string) {
				return false, "Budget tab is not available yet."
			},
			Execute: func(m model) (model, tea.Cmd, error) {
				return m, nil, fmt.Errorf("budget tab is not available yet")
			},
		},
		{
			ID:          "nav:settings",
			Label:       "Go to Settings",
			Description: "Switch to Settings tab",
			Category:    "Navigation",
			Enabled:     commandAlwaysEnabled,
			Execute: func(m model) (model, tea.Cmd, error) {
				m.activeTab = tabSettings
				m.applyTabDefaultsOnSwitch()
				return m, nil, nil
			},
		},
		{
			ID:          "jump:activate",
			Label:       "Jump Mode",
			Description: "Show jump targets for the current tab",
			Category:    "Navigation",
			Enabled: func(m model) (bool, string) {
				if m.jumpModeActive {
					return false, "Jump mode is already active."
				}
				if len(m.jumpTargetsForActiveTab()) == 0 {
					return false, "No jump targets for the current tab."
				}
				return true, ""
			},
			Execute: func(m model) (model, tea.Cmd, error) {
				if len(m.jumpTargetsForActiveTab()) == 0 {
					return m, nil, fmt.Errorf("no jump targets for active tab")
				}
				m.jumpModeActive = true
				m.jumpPreviousFocus = m.focusedSection
				m.setStatus("Jump: press key to focus. ESC cancel.")
				return m, nil, nil
			},
		},
		{
			ID:          "jump:cancel",
			Label:       "Cancel Jump",
			Description: "Dismiss jump overlay",
			Category:    "Navigation",
			Scopes:      []string{scopeJumpOverlay},
			Enabled: func(m model) (bool, string) {
				if !m.jumpModeActive {
					return false, "Jump mode is not active."
				}
				return true, ""
			},
			Execute: func(m model) (model, tea.Cmd, error) {
				m.jumpModeActive = false
				m.focusedSection = m.jumpPreviousFocus
				return m, nil, nil
			},
		},
		{
			ID:          "txn:sort",
			Label:       "Cycle Sort Column",
			Description: "Cycle transaction sort column",
			Category:    "Transactions",
			Scopes:      []string{scopeTransactions},
			Enabled:     commandAlwaysEnabled,
			Execute: func(m model) (model, tea.Cmd, error) {
				if m.rangeSelecting {
					m.clearRangeSelection()
				}
				m.sortColumn = nextTransactionSortColumn(m.sortColumn)
				m.cursor = 0
				m.topIndex = 0
				return m, nil, nil
			},
		},
		{
			ID:          "txn:sort-dir",
			Label:       "Toggle Sort Direction",
			Description: "Reverse transaction sort direction",
			Category:    "Transactions",
			Scopes:      []string{scopeTransactions},
			Enabled:     commandAlwaysEnabled,
			Execute: func(m model) (model, tea.Cmd, error) {
				if m.rangeSelecting {
					m.clearRangeSelection()
				}
				m.sortAscending = !m.sortAscending
				m.cursor = 0
				m.topIndex = 0
				return m, nil, nil
			},
		},
		{
			ID:          "txn:select",
			Label:       "Toggle Selection",
			Description: "Toggle selection for current row or highlighted range",
			Category:    "Transactions",
			Scopes:      []string{scopeTransactions},
			Enabled: func(m model) (bool, string) {
				if len(m.getFilteredRows()) == 0 {
					return false, "No transactions to select."
				}
				return true, ""
			},
			Execute: func(m model) (model, tea.Cmd, error) {
				filtered := m.getFilteredRows()
				highlighted := m.highlightedRows(filtered)
				if len(highlighted) > 0 {
					m.toggleSelectionForHighlighted(highlighted, filtered)
				} else {
					m.toggleSelectionAtCursor(filtered)
				}
				return m, nil, nil
			},
		},
		{
			ID:          "txn:clear-selection",
			Label:       "Clear Selection",
			Description: "Clear selected/highlighted transactions",
			Category:    "Transactions",
			Scopes:      []string{scopeTransactions},
			Enabled: func(m model) (bool, string) {
				if m.selectedCount() == 0 && !m.rangeSelecting {
					return false, "No selected transactions."
				}
				return true, ""
			},
			Execute: func(m model) (model, tea.Cmd, error) {
				if m.rangeSelecting {
					m.clearRangeSelection()
				}
				if m.selectedCount() > 0 {
					m.clearSelections()
				}
				m.setStatus("Selection cleared.")
				return m, nil, nil
			},
		},
		{
			ID:          "txn:quick-category",
			Label:       "Quick Categorize",
			Description: "Open quick category picker",
			Category:    "Transactions",
			Scopes:      []string{scopeTransactions},
			Enabled:     commandAlwaysEnabled,
			Execute: func(m model) (model, tea.Cmd, error) {
				next, cmd := m.openQuickCategoryPicker(m.getFilteredRows())
				out, _ := next.(model)
				return out, cmd, nil
			},
		},
		{
			ID:          "txn:quick-tag",
			Label:       "Quick Tag",
			Description: "Open quick tag picker",
			Category:    "Transactions",
			Scopes:      []string{scopeTransactions, scopeManager},
			Enabled:     commandAlwaysEnabled,
			Execute: func(m model) (model, tea.Cmd, error) {
				next, cmd := m.openQuickTagPicker(m.getFilteredRows())
				out, _ := next.(model)
				return out, cmd, nil
			},
		},
		{
			ID:          "txn:detail",
			Label:       "Open Detail",
			Description: "Open transaction detail modal",
			Category:    "Transactions",
			Scopes:      []string{scopeTransactions},
			Enabled: func(m model) (bool, string) {
				filtered := m.getFilteredRows()
				if len(filtered) == 0 || m.cursor < 0 || m.cursor >= len(filtered) {
					return false, "No transaction selected."
				}
				return true, ""
			},
			Execute: func(m model) (model, tea.Cmd, error) {
				filtered := m.getFilteredRows()
				if len(filtered) == 0 || m.cursor < 0 || m.cursor >= len(filtered) {
					return m, nil, fmt.Errorf("no transaction selected")
				}
				m.openDetail(filtered[m.cursor])
				return m, nil, nil
			},
		},
		{
			ID:          "txn:jump-top",
			Label:       "Jump to Top",
			Description: "Move transaction cursor to top",
			Category:    "Transactions",
			Scopes:      []string{scopeTransactions},
			Enabled:     commandAlwaysEnabled,
			Execute: func(m model) (model, tea.Cmd, error) {
				if m.rangeSelecting {
					m.clearRangeSelection()
				}
				m.cursor = 0
				m.topIndex = 0
				return m, nil, nil
			},
		},
		{
			ID:          "txn:jump-bottom",
			Label:       "Jump to Bottom",
			Description: "Move transaction cursor to bottom",
			Category:    "Transactions",
			Scopes:      []string{scopeTransactions},
			Enabled:     commandAlwaysEnabled,
			Execute: func(m model) (model, tea.Cmd, error) {
				filtered := m.getFilteredRows()
				if m.rangeSelecting {
					m.clearRangeSelection()
				}
				m.cursor = len(filtered) - 1
				if m.cursor < 0 {
					m.cursor = 0
				}
				visible := m.visibleRows()
				m.topIndex = m.cursor - visible + 1
				if m.topIndex < 0 {
					m.topIndex = 0
				}
				return m, nil, nil
			},
		},
		{
			ID:          "filter:open",
			Label:       "Open Filter",
			Description: "Open filter input",
			Category:    "Filter",
			Scopes:      []string{scopeTransactions, scopeManager},
			Enabled:     commandAlwaysEnabled,
			Execute: func(m model) (model, tea.Cmd, error) {
				if m.rangeSelecting {
					m.clearRangeSelection()
				}
				if m.activeTab == tabManager && m.managerMode == managerModeAccounts {
					m.managerMode = managerModeTransactions
					m.focusedSection = sectionManagerTransactions
				}
				m.filterInputMode = true
				m.filterInputCursor = len(m.filterInput)
				return m, nil, nil
			},
		},
		{
			ID:          "filter:clear",
			Label:       "Clear All Filters",
			Description: "Clear transaction filter/selection state",
			Category:    "Filter",
			Scopes:      []string{scopeTransactions},
			Enabled: func(m model) (bool, string) {
				if strings.TrimSpace(m.filterInput) == "" && !m.filterInputMode && !m.rangeSelecting && m.selectedCount() == 0 {
					return false, "No active filter state."
				}
				return true, ""
			},
			Execute: func(m model) (model, tea.Cmd, error) {
				if m.filterInputMode || m.filterInput != "" {
					m.filterInputMode = false
					m.filterInput = ""
					m.filterInputCursor = 0
					m.filterExpr = nil
					m.filterInputErr = ""
					m.filterLastApplied = ""
					m.cursor = 0
					m.topIndex = 0
					m.setStatus("Filter cleared.")
					return m, nil, nil
				}
				if m.rangeSelecting {
					m.clearRangeSelection()
					m.setStatus("Range highlight cleared.")
					return m, nil, nil
				}
				if m.selectedCount() > 0 {
					m.clearSelections()
					m.setStatus("Selection cleared.")
					return m, nil, nil
				}
				return m, nil, nil
			},
		},
		{
			ID:          "filter:save",
			Label:       "Save Current Filter",
			Description: "Open save modal for current filter expression",
			Category:    "Filter",
			Scopes:      []string{scopeFilterInput, scopeTransactions},
			Enabled: func(m model) (bool, string) {
				expr := strings.TrimSpace(m.filterInput)
				if expr == "" {
					return false, "No active filter expression."
				}
				node, err := parseFilterStrict(expr)
				if err != nil {
					return false, fmt.Sprintf("Current filter is invalid: %v", err)
				}
				if strings.TrimSpace(m.filterLastApplied) == "" {
					return false, "Apply filter with Enter before saving."
				}
				if filterExprString(node) != strings.TrimSpace(m.filterLastApplied) {
					return false, "Re-apply filter with Enter before saving."
				}
				return true, ""
			},
			Execute: func(m model) (model, tea.Cmd, error) {
				m.openFilterEditor(nil, strings.TrimSpace(m.filterInput))
				return m, nil, nil
			},
		},
		{
			ID:          "filter:apply",
			Label:       "Apply Saved Filter",
			Description: "Open saved filter picker",
			Category:    "Filter",
			Scopes:      []string{scopeFilterInput, scopeTransactions, scopeManager},
			Enabled: func(m model) (bool, string) {
				if len(m.savedFilters) == 0 {
					return false, "No saved filters."
				}
				return true, ""
			},
			Execute: func(m model) (model, tea.Cmd, error) {
				m.openFilterApplyPicker("")
				return m, nil, nil
			},
		},
		{
			ID:          "import:start",
			Label:       "Import CSV",
			Description: "Open CSV import picker",
			Category:    "Actions",
			Scopes:      []string{scopeSettingsNav, scopeSettingsActiveDBImport, scopeGlobal},
			Enabled:     commandAlwaysEnabled,
			Execute: func(m model) (model, tea.Cmd, error) {
				m.activeTab = tabSettings
				m.settColumn = settColRight
				m.settSection = settSecDBImport
				m.settActive = true
				m.focusedSection = sectionSettingsDatabase
				return m, m.beginImportFlow(), nil
			},
		},
		{
			ID:          "rules:apply",
			Label:       "Apply All Rules",
			Description: "Apply all enabled rules",
			Category:    "Rules",
			Scopes:      []string{scopeSettingsActiveRules, scopeGlobal},
			Enabled: func(m model) (bool, string) {
				if m.db == nil {
					return false, "Database not ready."
				}
				if len(m.rules) == 0 {
					return false, "No rules available."
				}
				return true, ""
			},
			Execute: func(m model) (model, tea.Cmd, error) {
				if m.db == nil {
					return m, nil, fmt.Errorf("database not ready")
				}
				db := m.db
				scope := m.rulesScopeLabel()
				savedFilters := append([]savedFilter(nil), m.savedFilters...)
				accountFilter := map[int]bool(nil)
				if len(m.filterAccounts) > 0 {
					accountFilter = make(map[int]bool, len(m.filterAccounts))
					for id, on := range m.filterAccounts {
						if on {
							accountFilter[id] = true
						}
					}
				}
				return m, func() tea.Msg {
					rules, err := loadRulesV2(db)
					if err != nil {
						return rulesAppliedMsg{scope: scope, err: err}
					}
					txnTags, err := loadTransactionTags(db)
					if err != nil {
						return rulesAppliedMsg{scope: scope, err: err}
					}
					updatedTxns, catChanges, tagChanges, failedRules, err := applyRulesV2ToScope(db, rules, txnTags, accountFilter, savedFilters)
					return rulesAppliedMsg{
						updatedTxns: updatedTxns,
						catChanges:  catChanges,
						tagChanges:  tagChanges,
						failedRules: failedRules,
						scope:       scope,
						err:         err,
					}
				}, nil
			},
		},
		{
			ID:          "rules:dry-run",
			Label:       "Dry-Run Rules",
			Description: "Preview rules without writing changes",
			Category:    "Rules",
			Scopes:      []string{scopeSettingsActiveRules, scopeGlobal},
			Enabled: func(m model) (bool, string) {
				if m.db == nil {
					return false, "Database not ready."
				}
				if len(m.rules) == 0 {
					return false, "No rules available."
				}
				return true, ""
			},
			Execute: func(m model) (model, tea.Cmd, error) {
				if m.db == nil {
					return m, nil, fmt.Errorf("database not ready")
				}
				db := m.db
				scope := m.rulesScopeLabel()
				savedFilters := append([]savedFilter(nil), m.savedFilters...)
				accountFilter := map[int]bool(nil)
				if len(m.filterAccounts) > 0 {
					accountFilter = make(map[int]bool, len(m.filterAccounts))
					for id, on := range m.filterAccounts {
						if on {
							accountFilter[id] = true
						}
					}
				}
				return m, func() tea.Msg {
					rules, err := loadRulesV2(db)
					if err != nil {
						return rulesDryRunMsg{scope: scope, err: err}
					}
					rows, err := loadRowsForAccountScope(db, accountFilter)
					if err != nil {
						return rulesDryRunMsg{scope: scope, err: err}
					}
					txnTags, err := loadTransactionTags(db)
					if err != nil {
						return rulesDryRunMsg{scope: scope, err: err}
					}
					results, summary := dryRunRulesV2(db, rules, rows, txnTags, savedFilters)
					return rulesDryRunMsg{
						results:     results,
						summary:     summary,
						failedRules: summary.failedRules,
						scope:       scope,
					}
				}, nil
			},
		},
		{
			ID:          "settings:clear-db",
			Label:       "Clear Database",
			Description: "Clear all transaction/import data",
			Category:    "Settings",
			Scopes:      []string{scopeSettingsActiveDBImport},
			Enabled:     commandAlwaysEnabled,
			Execute: func(m model) (model, tea.Cmd, error) {
				keyLabel := m.primaryActionKey(scopeSettingsActiveDBImport, actionClearDB, "c")
				cmd := m.armSettingsConfirm(confirmActionClearDB, 0, fmt.Sprintf("Press %s again to clear all data", keyLabel))
				return m, cmd, nil
			},
		},
		{
			ID:          "dash:timeframe",
			Label:       "Focus Timeframe",
			Description: "Focus dashboard timeframe chips",
			Category:    "Dashboard",
			Scopes:      []string{scopeDashboard},
			Enabled:     commandAlwaysEnabled,
			Execute: func(m model) (model, tea.Cmd, error) {
				m.dashTimeframeFocus = !m.dashTimeframeFocus
				if m.dashTimeframeFocus {
					m.dashTimeframeCursor = m.dashTimeframe
				}
				return m, nil, nil
			},
		},
		{
			ID:          "dash:mode-next",
			Label:       "Next Widget Mode",
			Description: "Cycle dashboard pane mode forward",
			Category:    "Dashboard",
			Scopes:      []string{scopeDashboardFocused},
			Enabled: func(m model) (bool, string) {
				return false, "Dashboard focused widget modes ship in a later phase."
			},
			Execute: func(m model) (model, tea.Cmd, error) {
				return m, nil, fmt.Errorf("dashboard focused modes not implemented")
			},
		},
		{
			ID:          "dash:mode-prev",
			Label:       "Previous Widget Mode",
			Description: "Cycle dashboard pane mode backward",
			Category:    "Dashboard",
			Scopes:      []string{scopeDashboardFocused},
			Enabled: func(m model) (bool, string) {
				return false, "Dashboard focused widget modes ship in a later phase."
			},
			Execute: func(m model) (model, tea.Cmd, error) {
				return m, nil, fmt.Errorf("dashboard focused modes not implemented")
			},
		},
		{
			ID:          "dash:drill-down",
			Label:       "Drill Down",
			Description: "Drill into focused dashboard pane",
			Category:    "Dashboard",
			Scopes:      []string{scopeDashboardFocused},
			Enabled: func(m model) (bool, string) {
				return false, "Dashboard drill-down ships in a later phase."
			},
			Execute: func(m model) (model, tea.Cmd, error) {
				return m, nil, fmt.Errorf("dashboard drill-down not implemented")
			},
		},
		{
			ID:          "palette:open",
			Label:       "Command Palette",
			Description: "Open command palette",
			Category:    "Command",
			Enabled: func(m model) (bool, string) {
				if !m.canOpenCommandUI() {
					return false, "Command UI unavailable in current context."
				}
				return true, ""
			},
			Execute: func(m model) (model, tea.Cmd, error) {
				if !m.canOpenCommandUI() {
					return m, nil, fmt.Errorf("command UI unavailable")
				}
				m.openCommandUI(commandUIKindPalette)
				return m, nil, nil
			},
		},
		{
			ID:          "cmd:open",
			Label:       "Command Mode",
			Description: "Open colon command mode",
			Category:    "Command",
			Enabled: func(m model) (bool, string) {
				if !m.canOpenCommandUI() {
					return false, "Command UI unavailable in current context."
				}
				return true, ""
			},
			Execute: func(m model) (model, tea.Cmd, error) {
				if !m.canOpenCommandUI() {
					return m, nil, fmt.Errorf("command UI unavailable")
				}
				m.openCommandUI(commandUIKindColon)
				return m, nil, nil
			},
		},
	}
	for _, sf := range savedFilters {
		saved := sf
		r.commands = append(r.commands, Command{
			ID:          fmt.Sprintf("filter:apply:%s", strings.TrimSpace(saved.ID)),
			Label:       fmt.Sprintf("Apply %q", strings.TrimSpace(saved.ID)),
			Description: "Apply saved filter expression by ID",
			Category:    "Filters",
			Hidden:      true,
			Scopes:      []string{scopeTransactions, scopeManager, scopeFilterInput},
			Enabled:     commandAlwaysEnabled,
			Execute: func(m model) (model, tea.Cmd, error) {
				next, err := m.applySavedFilter(saved, true)
				if err != nil {
					return m, nil, err
				}
				return next, nil, nil
			},
		})
	}
	r.byID = make(map[string]Command, len(r.commands))
	for _, cmd := range r.commands {
		r.byID[cmd.ID] = cmd
	}
	return r
}

func commandAlwaysEnabled(model) (bool, string) {
	return true, ""
}

func (r *CommandRegistry) All() []Command {
	if r == nil {
		return nil
	}
	out := make([]Command, len(r.commands))
	copy(out, r.commands)
	return out
}

func (r *CommandRegistry) Search(query, scope string, m model, lastCommandID string) []CommandMatch {
	if r == nil {
		return nil
	}
	q := strings.TrimSpace(query)
	out := make([]CommandMatch, 0, len(r.commands))
	for _, cmd := range r.commands {
		if cmd.Hidden {
			continue
		}
		if !commandInScope(cmd, scope) {
			continue
		}
		matched, score := commandMatchScore(cmd, q)
		if !matched {
			continue
		}
		enabled := true
		reason := ""
		if cmd.Enabled != nil {
			enabled, reason = cmd.Enabled(m)
		}
		out = append(out, CommandMatch{
			Command:        cmd,
			Score:          score,
			Enabled:        enabled,
			DisabledReason: reason,
		})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Enabled != out[j].Enabled {
			return out[i].Enabled
		}
		iMRU := lastCommandID != "" && out[i].Command.ID == lastCommandID
		jMRU := lastCommandID != "" && out[j].Command.ID == lastCommandID
		if iMRU != jMRU {
			return iMRU
		}
		if out[i].Score != out[j].Score {
			return out[i].Score > out[j].Score
		}
		li := strings.ToLower(out[i].Command.Label)
		lj := strings.ToLower(out[j].Command.Label)
		if li != lj {
			return li < lj
		}
		return out[i].Command.ID < out[j].Command.ID
	})
	return out
}

func (r *CommandRegistry) ExecuteByID(id, scope string, m model) (model, tea.Cmd, error) {
	if r == nil {
		return m, nil, fmt.Errorf("command registry is not initialized")
	}
	cmd, ok := r.byID[id]
	if !ok {
		return m, nil, fmt.Errorf("unknown command %q", id)
	}
	if !commandInScope(cmd, scope) {
		return m, nil, fmt.Errorf("command %q unavailable in scope %q", id, scope)
	}
	if cmd.Enabled != nil {
		enabled, reason := cmd.Enabled(m)
		if !enabled {
			if strings.TrimSpace(reason) == "" {
				reason = "command is disabled"
			}
			return m, nil, fmt.Errorf("%s", reason)
		}
	}
	if cmd.Execute == nil {
		return m, nil, fmt.Errorf("command %q has no executor", id)
	}
	return cmd.Execute(m)
}

func commandInScope(cmd Command, scope string) bool {
	if len(cmd.Scopes) == 0 {
		return true
	}
	for _, s := range cmd.Scopes {
		if strings.EqualFold(strings.TrimSpace(s), scopeGlobal) {
			return true
		}
	}
	for _, s := range cmd.Scopes {
		if strings.EqualFold(strings.TrimSpace(s), strings.TrimSpace(scope)) {
			return true
		}
	}
	return false
}

func commandMatchScore(cmd Command, query string) (bool, int) {
	if query == "" {
		return true, 0
	}
	best := -1
	fields := []string{cmd.Label, cmd.ID, cmd.Description}
	for _, field := range fields {
		matched, score := fuzzyMatchScore(field, query)
		if !matched {
			continue
		}
		if strings.EqualFold(field, query) {
			score += 15
		}
		if score > best {
			best = score
		}
	}
	if best < 0 {
		return false, 0
	}
	return true, best
}

func (m *model) openCommandUI(kind string) {
	m.commandOpen = true
	m.commandUIKind = kind
	m.commandQuery = ""
	m.commandCursor = 0
	m.commandScrollOffset = 0
	if kind == commandUIKindPalette {
		m.commandPageSize = 10
	} else {
		m.commandPageSize = 5
	}
	m.commandSourceScope = m.commandContextScope()
	m.rebuildCommandMatches()
}

func (m *model) closeCommandUI() {
	m.commandOpen = false
	m.commandUIKind = ""
	m.commandQuery = ""
	m.commandCursor = 0
	m.commandScrollOffset = 0
	m.commandPageSize = 0
	m.commandMatches = nil
	m.commandSourceScope = ""
}

func (m *model) rebuildCommandMatches() {
	if m.commands == nil {
		m.commandMatches = nil
		m.commandCursor = 0
		return
	}
	scope := m.commandSourceScope
	if strings.TrimSpace(scope) == "" {
		scope = m.commandContextScope()
	}
	m.commandMatches = m.commands.Search(m.commandQuery, scope, *m, m.lastCommandID)
	if len(m.commandMatches) == 0 {
		m.commandCursor = 0
		m.commandScrollOffset = 0
		return
	}
	if m.commandCursor < 0 {
		m.commandCursor = 0
	}
	if m.commandCursor >= len(m.commandMatches) {
		m.commandCursor = len(m.commandMatches) - 1
	}
	m.ensureCommandCursorVisible()
}

func (m model) canOpenCommandUI() bool {
	if m.commandOpen || m.showDetail || m.importDupeModal || m.importPicking || m.catPicker != nil || m.tagPicker != nil {
		return false
	}
	if m.filterApplyPicker != nil || m.filterEditOpen {
		return false
	}
	if m.managerActionPicker != nil || m.managerModalOpen || m.filterInputMode || m.jumpModeActive || m.ruleEditorOpen || m.dryRunOpen {
		return false
	}
	if m.settMode != settModeNone || m.confirmAction != confirmActionNone {
		return false
	}
	if m.dashTimeframeFocus || m.dashCustomEditing {
		return false
	}
	return true
}

func (m model) updateCommandUI(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	scope := scopeCommandMode
	if m.commandUIKind == commandUIKindPalette {
		scope = scopeCommandPalette
	}
	switch {
	case m.isAction(scope, actionClose, msg):
		m.closeCommandUI()
		return m, nil
	case m.isAction(scope, actionSelect, msg):
		if m.commandUIKind == commandUIKindColon && strings.TrimSpace(m.commandQuery) != "" {
			return m.executeTypedColonCommand()
		}
		return m.executeSelectedCommand()
	case isBackspaceKey(msg):
		deleteLastASCIIByte(&m.commandQuery)
		m.rebuildCommandMatches()
		return m, nil
	case isPrintableASCIIKey(msg.String()):
		appendPrintableASCII(&m.commandQuery, msg.String())
		m.rebuildCommandMatches()
		return m, nil
	case m.verticalDelta(scope, msg) != 0:
		delta := m.verticalDelta(scope, msg)
		if delta < 0 {
			m.commandCursor = moveBoundedCursor(m.commandCursor, len(m.commandMatches), -1)
		} else if delta > 0 {
			m.commandCursor = moveBoundedCursor(m.commandCursor, len(m.commandMatches), 1)
		}
		m.ensureCommandCursorVisible()
		return m, nil
	}
	return m, nil
}

func (m model) executeTypedColonCommand() (tea.Model, tea.Cmd) {
	raw := strings.TrimSpace(m.commandQuery)
	if raw == "" {
		return m.executeSelectedCommand()
	}
	lower := strings.ToLower(raw)
	if strings.HasPrefix(lower, "apply:") {
		id := strings.TrimSpace(raw[len("apply:"):])
		normID, err := normalizeSavedFilterID(id)
		if err != nil {
			m.setError(fmt.Sprintf("Command failed: %v", err))
			return m, nil
		}
		targetID := "filter:apply:" + normID
		next, cmd, execErr := m.commands.ExecuteByID(targetID, m.commandSourceScope, m)
		if execErr != nil {
			m.setError(fmt.Sprintf("Command failed: %v", execErr))
			return m, nil
		}
		next.lastCommandID = targetID
		next.closeCommandUI()
		return next, cmd
	}
	return m.executeSelectedCommand()
}

func (m *model) ensureCommandCursorVisible() {
	limit := m.commandPageSize
	if limit <= 0 {
		if m.commandUIKind == commandUIKindPalette {
			limit = 10
		} else {
			limit = 5
		}
	}
	if len(m.commandMatches) <= limit {
		m.commandScrollOffset = 0
		return
	}
	if m.commandCursor < m.commandScrollOffset {
		m.commandScrollOffset = m.commandCursor
	}
	maxVisible := m.commandScrollOffset + limit - 1
	if m.commandCursor > maxVisible {
		m.commandScrollOffset = m.commandCursor - limit + 1
	}
	maxOffset := len(m.commandMatches) - limit
	if maxOffset < 0 {
		maxOffset = 0
	}
	if m.commandScrollOffset > maxOffset {
		m.commandScrollOffset = maxOffset
	}
	if m.commandScrollOffset < 0 {
		m.commandScrollOffset = 0
	}
}

func (m model) executeSelectedCommand() (tea.Model, tea.Cmd) {
	if len(m.commandMatches) == 0 {
		m.setError("No matching command.")
		return m, nil
	}
	idx := m.commandCursor
	if idx < 0 || idx >= len(m.commandMatches) {
		idx = 0
	}
	match := m.commandMatches[idx]
	if !match.Enabled {
		reason := strings.TrimSpace(match.DisabledReason)
		if reason == "" {
			reason = "Selected command is currently unavailable."
		}
		m.setError(reason)
		return m, nil
	}
	if m.commands == nil {
		m.setError("Command registry unavailable.")
		return m, nil
	}
	next, cmd, err := m.commands.ExecuteByID(match.Command.ID, m.commandSourceScope, m)
	if err != nil {
		m.setError(fmt.Sprintf("Command failed: %v", err))
		return m, nil
	}
	next.lastCommandID = match.Command.ID
	next.closeCommandUI()
	return next, cmd
}

func (m model) executeBoundCommand(scope string, msg tea.KeyMsg) (model, tea.Cmd, bool) {
	return m.executeBoundCommandInternal(scope, msg, false)
}

func (m model) executeBoundCommandLocal(scope string, msg tea.KeyMsg) (model, tea.Cmd, bool) {
	return m.executeBoundCommandInternal(scope, msg, true)
}

func (m model) executeBoundCommandInternal(scope string, msg tea.KeyMsg, localOnly bool) (model, tea.Cmd, bool) {
	if m.keys == nil || m.commands == nil {
		return m, nil, false
	}
	var binding *Binding
	if localOnly {
		binding = m.keys.lookupInScope(normalizeKeyName(msg.String()), scope)
	} else {
		binding = m.keys.Lookup(msg.String(), scope)
	}
	if binding == nil || strings.TrimSpace(binding.CommandID) == "" {
		return m, nil, false
	}
	cmdDef, ok := m.commands.byID[binding.CommandID]
	if !ok {
		m.setError(fmt.Sprintf("Command failed: unknown command %q", binding.CommandID))
		return m, nil, true
	}
	if !commandInScope(cmdDef, scope) {
		return m, nil, true
	}
	if cmdDef.Enabled != nil {
		enabled, reason := cmdDef.Enabled(m)
		if !enabled {
			if (binding.CommandID == "filter:save" || binding.CommandID == "filter:apply") && strings.TrimSpace(reason) != "" {
				m.setError(reason)
			}
			return m, nil, true
		}
	}
	next, cmd, err := m.commands.ExecuteByID(binding.CommandID, scope, m)
	if err != nil {
		next.setError(fmt.Sprintf("Command failed: %v", err))
		return next, nil, true
	}
	return next, cmd, true
}

func (m model) commandContextScope() string {
	// Primary tier: overlay/modal scope via shared precedence table.
	if scope := m.activeOverlayScope(false); scope != "" {
		return scope
	}
	// Secondary tier: tab-level scope resolution.
	scope := m.tabScope()
	// tabScope defaults to scopeDashboard for unknown tabs; commandContextScope
	// should fall back to scopeGlobal when no specific tab scope applies.
	if scope == "" {
		return scopeGlobal
	}
	return scope
}

func commandDefaultLabel(value string) string {
	if strings.EqualFold(strings.TrimSpace(value), commandUIKindColon) {
		return "Colon"
	}
	return "Palette"
}

func nextTransactionSortColumn(current int) int {
	if len(transactionSortCycle) == 0 {
		return sortByDate
	}
	for i, col := range transactionSortCycle {
		if col != current {
			continue
		}
		return transactionSortCycle[(i+1)%len(transactionSortCycle)]
	}
	return transactionSortCycle[0]
}
