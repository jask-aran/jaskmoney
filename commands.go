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
	Action      Action
	Category    string
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
}

func NewCommandRegistry(keys *KeyRegistry) *CommandRegistry {
	r := &CommandRegistry{}
	r.commands = []Command{
		{
			ID:          "go:dashboard",
			Label:       "Go to Dashboard",
			Description: "Switch to Dashboard tab",
			Action:      actionCommandGoDashboard,
			Category:    "Navigation",
			Enabled:     commandAlwaysEnabled,
			Execute: func(m model) (model, tea.Cmd, error) {
				m.activeTab = tabDashboard
				return m, nil, nil
			},
		},
		{
			ID:          "go:transactions",
			Label:       "Go to Transactions",
			Description: "Switch to Manager tab in transactions mode",
			Action:      actionCommandGoTransactions,
			Category:    "Navigation",
			Enabled:     commandAlwaysEnabled,
			Execute: func(m model) (model, tea.Cmd, error) {
				m.activeTab = tabManager
				m.managerMode = managerModeTransactions
				m.ensureCursorInWindow()
				return m, nil, nil
			},
		},
		{
			ID:          "go:settings",
			Label:       "Go to Settings",
			Description: "Switch to Settings tab",
			Action:      actionCommandGoSettings,
			Category:    "Navigation",
			Enabled:     commandAlwaysEnabled,
			Execute: func(m model) (model, tea.Cmd, error) {
				m.activeTab = tabSettings
				return m, nil, nil
			},
		},
		{
			ID:          "focus:accounts",
			Label:       "Focus Accounts",
			Description: "Switch to Manager accounts mode",
			Action:      actionCommandFocusAccounts,
			Category:    "Navigation",
			Enabled:     commandAlwaysEnabled,
			Execute: func(m model) (model, tea.Cmd, error) {
				m.activeTab = tabManager
				m.managerMode = managerModeAccounts
				return m, nil, nil
			},
		},
		{
			ID:          "focus:transactions",
			Label:       "Focus Transactions",
			Description: "Switch to Manager transactions mode",
			Action:      actionCommandFocusTransactions,
			Category:    "Navigation",
			Enabled:     commandAlwaysEnabled,
			Execute: func(m model) (model, tea.Cmd, error) {
				m.activeTab = tabManager
				m.managerMode = managerModeTransactions
				m.ensureCursorInWindow()
				return m, nil, nil
			},
		},
		{
			ID:          "import",
			Label:       "Import CSV",
			Description: "Open import picker from Settings",
			Action:      actionImport,
			Category:    "Actions",
			Enabled: func(m model) (bool, string) {
				if m.db == nil {
					return false, "Database not ready."
				}
				return true, ""
			},
			Execute: func(m model) (model, tea.Cmd, error) {
				if m.db == nil {
					return m, nil, fmt.Errorf("database not ready")
				}
				m.activeTab = tabSettings
				m.settColumn = settColRight
				m.settSection = settSecDBImport
				m.settActive = true
				return m, m.beginImportFlow(), nil
			},
		},
		{
			ID:          "apply:category-rules",
			Label:       "Apply Category Rules",
			Description: "Apply category rules to uncategorized transactions",
			Action:      actionApplyAll,
			Category:    "Actions",
			Enabled: func(m model) (bool, string) {
				if m.db == nil {
					return false, "Database not ready."
				}
				if len(m.rules) == 0 {
					return false, "No category rules available."
				}
				return true, ""
			},
			Execute: func(m model) (model, tea.Cmd, error) {
				if m.db == nil {
					return m, nil, fmt.Errorf("database not ready")
				}
				db := m.db
				return m, func() tea.Msg {
					count, err := applyCategoryRules(db)
					return rulesAppliedMsg{count: count, err: err}
				}, nil
			},
		},
		{
			ID:          "apply:tag-rules",
			Label:       "Apply Tag Rules",
			Description: "Apply tag rules to matching transactions",
			Action:      actionCommandApplyTagRules,
			Category:    "Actions",
			Enabled: func(m model) (bool, string) {
				if m.db == nil {
					return false, "Database not ready."
				}
				if len(m.tagRules) == 0 {
					return false, "No tag rules available."
				}
				return true, ""
			},
			Execute: func(m model) (model, tea.Cmd, error) {
				if m.db == nil {
					return m, nil, fmt.Errorf("database not ready")
				}
				db := m.db
				return m, func() tea.Msg {
					count, err := applyTagRules(db)
					return tagRulesAppliedMsg{count: count, err: err}
				}, nil
			},
		},
		{
			ID:          "clear:search",
			Label:       "Clear Search",
			Description: "Clear active search query",
			Action:      actionClearSearch,
			Category:    "Cleanup",
			Enabled: func(m model) (bool, string) {
				if m.searchQuery == "" && !m.searchMode {
					return false, "No active search."
				}
				return true, ""
			},
			Execute: func(m model) (model, tea.Cmd, error) {
				m.searchMode = false
				m.searchQuery = ""
				m.cursor = 0
				m.topIndex = 0
				m.setStatus("Search cleared.")
				return m, nil, nil
			},
		},
		{
			ID:          "clear:filters",
			Label:       "Clear Filters",
			Description: "Reset category and account filters",
			Action:      actionCommandClearFilters,
			Category:    "Cleanup",
			Enabled: func(m model) (bool, string) {
				hasCat := len(m.filterCategories) > 0
				hasAcct := len(m.filterAccounts) > 0
				if !hasCat && !hasAcct {
					return false, "No active category/account filters."
				}
				return true, ""
			},
			Execute: func(m model) (model, tea.Cmd, error) {
				m.filterCategories = nil
				m.filterAccounts = nil
				m.setStatus("Category/account filters cleared.")
				return m, nil, nil
			},
		},
		{
			ID:          "clear:selection",
			Label:       "Clear Selection",
			Description: "Clear selected/highlighted transactions",
			Action:      actionCommandClearSelection,
			Category:    "Cleanup",
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

func (r *CommandRegistry) Search(query string, m model, lastCommandID string) []CommandMatch {
	if r == nil {
		return nil
	}
	q := strings.TrimSpace(query)
	out := make([]CommandMatch, 0, len(r.commands))
	for _, cmd := range r.commands {
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
	m.rebuildCommandMatches()
}

func (m *model) closeCommandUI() {
	m.commandOpen = false
	m.commandUIKind = ""
	m.commandQuery = ""
	m.commandCursor = 0
	m.commandMatches = nil
}

func (m *model) rebuildCommandMatches() {
	if m.commands == nil {
		m.commandMatches = nil
		m.commandCursor = 0
		return
	}
	m.commandMatches = m.commands.Search(m.commandQuery, *m, m.lastCommandID)
	if len(m.commandMatches) == 0 {
		m.commandCursor = 0
		return
	}
	if m.commandCursor < 0 {
		m.commandCursor = 0
	}
	if m.commandCursor >= len(m.commandMatches) {
		m.commandCursor = len(m.commandMatches) - 1
	}
}

func (m model) canOpenCommandUI() bool {
	if m.commandOpen || m.showDetail || m.importDupeModal || m.importPicking || m.catPicker != nil || m.tagPicker != nil {
		return false
	}
	if m.accountNukePicker != nil || m.managerModalOpen || m.searchMode {
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
	keyName := normalizeKeyName(msg.String())
	scope := scopeCommandMode
	if m.commandUIKind == commandUIKindPalette {
		scope = scopeCommandPalette
	}
	switch {
	case m.isAction(scope, actionClose, msg):
		m.closeCommandUI()
		return m, nil
	case m.isAction(scope, actionSelect, msg):
		return m.executeSelectedCommand()
	case isBackspaceKey(msg):
		deleteLastASCIIByte(&m.commandQuery)
		m.rebuildCommandMatches()
		return m, nil
	case m.isAction(scope, actionNavigate, msg):
		delta := navDeltaFromKeyName(keyName)
		if delta < 0 {
			m.commandCursor = moveBoundedCursor(m.commandCursor, len(m.commandMatches), -1)
		} else if delta > 0 {
			m.commandCursor = moveBoundedCursor(m.commandCursor, len(m.commandMatches), 1)
		}
		return m, nil
	}
	if isPrintableASCIIKey(msg.String()) {
		appendPrintableASCII(&m.commandQuery, msg.String())
		m.rebuildCommandMatches()
	}
	return m, nil
}

func (m model) executeSelectedCommand() (tea.Model, tea.Cmd) {
	match, ok := m.firstExecutableCommand()
	if !ok {
		if len(m.commandMatches) == 0 {
			m.setError("No matching command.")
		} else if len(m.commandMatches) > 0 && strings.TrimSpace(m.commandMatches[0].DisabledReason) != "" {
			m.setError(m.commandMatches[0].DisabledReason)
		} else {
			m.setError("No executable command in results.")
		}
		return m, nil
	}
	next, cmd, err := match.Command.Execute(m)
	if err != nil {
		m.setError(fmt.Sprintf("Command failed: %v", err))
		return m, nil
	}
	next.lastCommandID = match.Command.ID
	next.closeCommandUI()
	return next, cmd
}

func (m model) firstExecutableCommand() (CommandMatch, bool) {
	if len(m.commandMatches) == 0 {
		return CommandMatch{}, false
	}
	if m.commandCursor >= 0 && m.commandCursor < len(m.commandMatches) {
		candidate := m.commandMatches[m.commandCursor]
		if candidate.Enabled {
			return candidate, true
		}
	}
	for _, match := range m.commandMatches {
		if match.Enabled {
			return match, true
		}
	}
	return CommandMatch{}, false
}

func commandDefaultLabel(value string) string {
	if strings.EqualFold(strings.TrimSpace(value), commandUIKindColon) {
		return "Colon"
	}
	return "Palette"
}
