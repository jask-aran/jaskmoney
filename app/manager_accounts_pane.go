package app

import (
	"database/sql"
	"fmt"
	"os"
	"sort"
	"strings"

	"github.com/BurntSushi/toml"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/x/ansi"
	_ "modernc.org/sqlite"

	"jaskmoney-v2/core/widgets"
)

type ManagerAccountsPane struct {
	id    string
	title string
	scope string
	jump  byte
	focus bool
}

type rawAccountsTOML struct {
	Version int                          `toml:"version"`
	Account map[string]rawAccountSection `toml:"account"`
}

type rawAccountSection struct {
	Name         string `toml:"name"`
	Type         string `toml:"type"`
	ImportPrefix string `toml:"import_prefix"`
	SortOrder    int    `toml:"sort_order"`
	Active       *bool  `toml:"active"`
	IsActive     *bool  `toml:"is_active"`
}

type paneAccount struct {
	key         string
	name        string
	accountType string
	prefix      string
	active      bool
	sortOrder   int
}

type dbAccountInfo struct {
	name     string
	prefix   string
	accounts int
	active   bool
}

func NewManagerAccountsPane(id, title, scope string, jumpKey byte, focusable bool) *ManagerAccountsPane {
	return &ManagerAccountsPane{id: id, title: title, scope: scope, jump: jumpKey, focus: focusable}
}

func (p *ManagerAccountsPane) ID() string      { return p.id }
func (p *ManagerAccountsPane) Title() string   { return p.title }
func (p *ManagerAccountsPane) Scope() string   { return p.scope }
func (p *ManagerAccountsPane) JumpKey() byte   { return p.jump }
func (p *ManagerAccountsPane) Focusable() bool { return p.focus }
func (p *ManagerAccountsPane) Init() tea.Cmd   { return nil }
func (p *ManagerAccountsPane) Update(msg tea.Msg) tea.Cmd {
	_ = msg
	return nil
}
func (p *ManagerAccountsPane) OnSelect() tea.Cmd   { return nil }
func (p *ManagerAccountsPane) OnDeselect() tea.Cmd { return nil }
func (p *ManagerAccountsPane) OnFocus() tea.Cmd    { return nil }
func (p *ManagerAccountsPane) OnBlur() tea.Cmd     { return nil }

func (p *ManagerAccountsPane) View(width, height int, selected, focused bool) string {
	contentWidth := width - 4
	if contentWidth < 1 {
		contentWidth = 1
	}
	content := p.renderAccountsLine(contentWidth)
	return widgets.Pane{
		Title:    p.title,
		Height:   height,
		Content:  content,
		Selected: selected,
		Focused:  focused,
	}.Render(width, height)
}

func (p *ManagerAccountsPane) renderAccountsLine(width int) string {
	accounts, err := loadPaneAccountsConfig("config/accounts.toml")
	if err != nil {
		return ansi.Truncate("Failed to load accounts.toml: "+err.Error(), width, "")
	}
	if len(accounts) == 0 {
		return ansi.Truncate("No accounts yet. Press 'a' to create one.", width, "")
	}
	counts := loadTransactionCountsByAccount("transactions.db")
	parts := make([]string, 0, len(accounts))
	for _, acc := range accounts {
		info := findDBAccountInfo(acc, counts)
		countText := fmt.Sprintf("%d", info.accounts)
		countColor := lipgloss.Color("#bac2de")
		if info.accounts == 0 {
			countText = "Empty"
			countColor = lipgloss.Color("#7f849c")
		}
		scopeOn := acc.active
		scopeText := "Off"
		scopeColor := lipgloss.Color("#7f849c")
		if scopeOn {
			scopeText = "On"
			scopeColor = lipgloss.Color("#a6e3a1")
		}
		typeColor := lipgloss.Color("#bac2de")
		if acc.accountType == "credit" {
			typeColor = lipgloss.Color("#fab387")
		}

		chip := "  " +
			lipgloss.NewStyle().Foreground(lipgloss.Color("#cdd6f4")).Render(truncateAccountName(acc.name, 18)) + " " +
			lipgloss.NewStyle().Foreground(typeColor).Render(strings.ToUpper(acc.accountType)) + " " +
			lipgloss.NewStyle().Foreground(countColor).Render(countText) + " " +
			lipgloss.NewStyle().Foreground(scopeColor).Render(scopeText)
		parts = append(parts, chip)
	}
	return ansi.Truncate(strings.Join(parts, "   "), width, "")
}

func loadPaneAccountsConfig(path string) ([]paneAccount, error) {
	var raw rawAccountsTOML
	if _, err := toml.DecodeFile(path, &raw); err != nil {
		return nil, err
	}
	out := make([]paneAccount, 0, len(raw.Account))
	for key, section := range raw.Account {
		name := strings.TrimSpace(section.Name)
		if name == "" {
			name = strings.TrimSpace(key)
		}
		accountType := strings.ToLower(strings.TrimSpace(section.Type))
		if accountType == "" {
			accountType = "debit"
		}
		active := true
		if section.Active != nil {
			active = *section.Active
		}
		if section.IsActive != nil {
			active = *section.IsActive
		}
		out = append(out, paneAccount{
			key:         strings.TrimSpace(key),
			name:        name,
			accountType: accountType,
			prefix:      strings.ToLower(strings.TrimSpace(section.ImportPrefix)),
			active:      active,
			sortOrder:   section.SortOrder,
		})
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].sortOrder != out[j].sortOrder {
			return out[i].sortOrder < out[j].sortOrder
		}
		return strings.ToLower(out[i].name) < strings.ToLower(out[j].name)
	})
	return out, nil
}

func loadTransactionCountsByAccount(path string) []dbAccountInfo {
	if _, err := os.Stat(path); err != nil {
		return nil
	}
	db, err := sql.Open("sqlite", "file:"+path+"?cache=shared")
	if err != nil {
		return nil
	}
	defer db.Close()

	rows, err := db.Query(`
		SELECT
			lower(name),
			lower(COALESCE(prefix, '')),
			COALESCE(active, 1),
			COUNT(t.id)
		FROM accounts a
		LEFT JOIN transactions t ON t.account_id = a.id
		GROUP BY a.id
		ORDER BY a.id
	`)
	if err != nil {
		return nil
	}
	defer rows.Close()

	out := make([]dbAccountInfo, 0, 8)
	for rows.Next() {
		var info dbAccountInfo
		var active int
		if err := rows.Scan(&info.name, &info.prefix, &active, &info.accounts); err != nil {
			continue
		}
		info.active = active == 1
		out = append(out, info)
	}
	return out
}

func findDBAccountInfo(acc paneAccount, infos []dbAccountInfo) dbAccountInfo {
	name := strings.ToLower(strings.TrimSpace(acc.name))
	prefix := strings.ToLower(strings.TrimSpace(acc.prefix))
	for _, info := range infos {
		if info.name == name {
			return info
		}
	}
	if prefix == "" {
		return dbAccountInfo{}
	}
	for _, info := range infos {
		if info.prefix == prefix {
			return info
		}
	}
	return dbAccountInfo{}
}

func truncateAccountName(name string, width int) string {
	return ansi.Truncate(name, width, "")
}
