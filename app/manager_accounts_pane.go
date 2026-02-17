package app

import (
	"fmt"
	"sort"
	"strconv"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/x/ansi"

	"jaskmoney-v2/core"
	coredb "jaskmoney-v2/core/db"
	"jaskmoney-v2/core/screens"
	"jaskmoney-v2/core/widgets"
)

type ManagerAccountsPane struct {
	id      string
	title   string
	scope   string
	jump    byte
	focus   bool
	focused bool

	cursor    int
	accounts  []coredb.ManagedAccount
	selection map[int]bool
	errMsg    string
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
func (p *ManagerAccountsPane) OnSelect() tea.Cmd {
	return nil
}
func (p *ManagerAccountsPane) OnDeselect() tea.Cmd {
	return nil
}
func (p *ManagerAccountsPane) OnFocus() tea.Cmd {
	p.focused = true
	p.reload()
	return nil
}
func (p *ManagerAccountsPane) OnBlur() tea.Cmd {
	p.focused = false
	return nil
}

func (p *ManagerAccountsPane) Update(msg tea.Msg) tea.Cmd {
	keyMsg, ok := msg.(tea.KeyMsg)
	if !ok || !p.focused {
		return nil
	}
	p.reload()
	key := strings.ToLower(keyMsg.String())
	switch key {
	case "left", "h", "up", "k":
		p.cursor = boundedStep(p.cursor, len(p.accounts), -1)
		return nil
	case "right", "l", "down", "j":
		p.cursor = boundedStep(p.cursor, len(p.accounts), 1)
		return nil
	case "a":
		return p.openAccountEditor(nil)
	case "e", "enter":
		acc := p.selectedAccount()
		if acc == nil {
			return nil
		}
		return p.openAccountEditor(acc)
	case " ":
		return p.toggleAccountScope()
	case "delete", "del":
		acc := p.selectedAccount()
		if acc == nil {
			return nil
		}
		return p.openAccountActionPicker(*acc)
	case "r":
		p.reload()
		if p.errMsg != "" {
			return core.ErrorCmd(fmt.Errorf("MANAGER_ACCOUNTS_REFRESH_FAILED: %s", p.errMsg))
		}
		return core.StatusCodeCmd("MANAGER_ACCOUNTS_REFRESH", "Accounts refreshed.")
	}
	return nil
}

func (p *ManagerAccountsPane) View(width, height int, selected, focused bool) string {
	p.reload()
	contentWidth := width - 4
	if contentWidth < 1 {
		contentWidth = 1
	}
	lines := make([]string, 0, 8)
	if p.errMsg != "" {
		lines = append(lines, lipgloss.NewStyle().Foreground(lipgloss.Color("#f38ba8")).Render(p.errMsg))
	}
	if len(p.accounts) == 0 {
		lines = append(lines, "No accounts yet. Press 'a' to add one.")
	} else {
		lines = append(lines, p.renderAccountsLine(contentWidth))
		if acc := p.selectedAccount(); acc != nil {
			lines = append(lines, fmt.Sprintf(
				"Selected: %s (%s) txns:%d prefix:%s",
				acc.Name, strings.ToUpper(acc.Type), acc.TxnCount, valueOrDash(acc.Prefix),
			))
		}
	}
	lines = append(lines, "h/l move  a add  e edit  space scope  del actions")
	return widgets.Pane{
		Title:    p.title,
		Height:   4,
		Content:  core.ClipHeight(strings.Join(lines, "\n"), core.MaxInt(2, height)),
		Selected: selected,
		Focused:  focused,
	}.Render(width, height)
}

func (p *ManagerAccountsPane) renderAccountsLine(width int) string {
	parts := make([]string, 0, len(p.accounts))
	for i, acc := range p.accounts {
		countText := fmt.Sprintf("%d", acc.TxnCount)
		countColor := lipgloss.Color("#bac2de")
		if acc.TxnCount == 0 {
			countText = "Empty"
			countColor = lipgloss.Color("#7f849c")
		}
		scopeOn := p.isAccountSelected(acc.ID)
		scopeText := "Off"
		scopeColor := lipgloss.Color("#7f849c")
		if scopeOn {
			scopeText = "On"
			scopeColor = lipgloss.Color("#a6e3a1")
		}
		typeColor := lipgloss.Color("#bac2de")
		if strings.EqualFold(acc.Type, "credit") {
			typeColor = lipgloss.Color("#fab387")
		}
		nameStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#cdd6f4"))
		if i == p.cursor && p.focused {
			nameStyle = nameStyle.Bold(true).Underline(true)
		}
		chip := "  " +
			nameStyle.Render(ansi.Truncate(acc.Name, 18, "")) + " " +
			lipgloss.NewStyle().Foreground(typeColor).Render(strings.ToUpper(acc.Type)) + " " +
			lipgloss.NewStyle().Foreground(countColor).Render(countText) + " " +
			lipgloss.NewStyle().Foreground(scopeColor).Render(scopeText)
		parts = append(parts, chip)
	}
	return ansi.Truncate(strings.Join(parts, "   "), width, "")
}

func (p *ManagerAccountsPane) reload() {
	dbConn := activeDB()
	if dbConn == nil {
		p.accounts = nil
		p.selection = nil
		p.errMsg = "database not ready"
		return
	}
	accounts, err := coredb.LoadManagedAccounts(dbConn)
	if err != nil {
		p.accounts = nil
		p.selection = nil
		p.errMsg = "load accounts failed: " + err.Error()
		return
	}
	selection, err := coredb.LoadSelectedAccounts(dbConn)
	if err != nil {
		p.accounts = nil
		p.selection = nil
		p.errMsg = "load account scope failed: " + err.Error()
		return
	}
	p.accounts = accounts
	p.selection = selection
	p.errMsg = ""
	p.cursor = clampCursor(p.cursor, len(p.accounts))
}

func (p *ManagerAccountsPane) selectedAccount() *coredb.ManagedAccount {
	if p.cursor < 0 || p.cursor >= len(p.accounts) {
		return nil
	}
	return &p.accounts[p.cursor]
}

func (p *ManagerAccountsPane) isAccountSelected(accountID int) bool {
	if len(p.selection) == 0 {
		return true
	}
	return p.selection[accountID]
}

func (p *ManagerAccountsPane) toggleAccountScope() tea.Cmd {
	dbConn := activeDB()
	if dbConn == nil {
		return core.ErrorCmd(fmt.Errorf("MANAGER_SCOPE_DB_NIL: database not ready"))
	}
	acc := p.selectedAccount()
	if acc == nil {
		return nil
	}
	if len(p.selection) == 0 {
		p.selection = make(map[int]bool, len(p.accounts))
		for _, account := range p.accounts {
			p.selection[account.ID] = true
		}
	}
	if p.selection[acc.ID] {
		delete(p.selection, acc.ID)
	} else {
		p.selection[acc.ID] = true
	}
	if len(p.selection) == len(p.accounts) || len(p.selection) == 0 {
		p.selection = nil
	}
	selectedIDs := p.selectedScopeIDs()
	if err := coredb.SaveSelectedAccounts(dbConn, selectedIDs); err != nil {
		return core.ErrorCmd(fmt.Errorf("MANAGER_SCOPE_SAVE_FAILED: %w", err))
	}
	if p.isAccountSelected(acc.ID) {
		return core.StatusCodeCmd("MANAGER_SCOPE", "Scope enabled for "+acc.Name)
	}
	return core.StatusCodeCmd("MANAGER_SCOPE", "Scope disabled for "+acc.Name)
}

func (p *ManagerAccountsPane) selectedScopeIDs() []int {
	if len(p.selection) == 0 {
		return nil
	}
	ids := make([]int, 0, len(p.selection))
	for _, acc := range p.accounts {
		if p.selection[acc.ID] {
			ids = append(ids, acc.ID)
		}
	}
	sort.Ints(ids)
	if len(ids) == len(p.accounts) {
		return nil
	}
	return ids
}

func (p *ManagerAccountsPane) openAccountEditor(existing *coredb.ManagedAccount) tea.Cmd {
	initial := coredb.ManagedAccount{Type: "debit", Active: true}
	title := "Add Account"
	if existing != nil {
		initial = *existing
		title = "Edit Account"
	}
	screen := screens.NewEditorScreen(
		title,
		"screen:manager-account-edit",
		[]screens.EditorField{
			{Key: "name", Label: "Name", Value: initial.Name},
			{Key: "type", Label: "Type (debit|credit)", Value: initial.Type},
			{Key: "prefix", Label: "Import prefix", Value: initial.Prefix},
			{Key: "active", Label: "Active (true|false)", Value: strconv.FormatBool(initial.Active)},
		},
		func(values map[string]string) tea.Msg {
			dbConn := activeDB()
			if dbConn == nil {
				return core.StatusMsg{Text: "MANAGER_ACCOUNT_DB_NIL: database not ready", IsErr: true}
			}
			active := strings.EqualFold(strings.TrimSpace(values["active"]), "true") || strings.TrimSpace(values["active"]) == "1"
			account := coredb.ManagedAccount{
				ID:     initial.ID,
				Name:   strings.TrimSpace(values["name"]),
				Type:   strings.TrimSpace(values["type"]),
				Prefix: strings.TrimSpace(values["prefix"]),
				Active: active,
			}
			id, err := coredb.UpsertManagedAccount(dbConn, account)
			if err != nil {
				return core.StatusMsg{Text: "MANAGER_ACCOUNT_SAVE_FAILED: " + err.Error(), IsErr: true}
			}
			return core.StatusMsg{Text: fmt.Sprintf("Account saved: %s (id=%d)", account.Name, id), Code: "MANAGER_ACCOUNT_SAVE"}
		},
	)
	return func() tea.Msg { return core.PushScreenMsg{Screen: screen} }
}

func (p *ManagerAccountsPane) openAccountActionPicker(account coredb.ManagedAccount) tea.Cmd {
	items := []screens.PickerItem{
		{ID: "clear", Label: "Clear Transactions", Desc: fmt.Sprintf("%d txn(s)", account.TxnCount)},
		{ID: "nuke", Label: "Nuke Account", Desc: "Delete account + all txns"},
		{ID: "delete", Label: "Delete If Empty", Desc: "Delete account only when no txns"},
	}
	screen := screens.NewPickerModal(
		"Account Actions: "+account.Name,
		"screen:manager-account-actions",
		items,
		func(item screens.PickerItem) tea.Msg {
			dbConn := activeDB()
			if dbConn == nil {
				return core.StatusMsg{Text: "MANAGER_ACTION_DB_NIL: database not ready", IsErr: true}
			}
			switch item.ID {
			case "clear":
				n, err := coredb.ClearTransactionsForAccount(dbConn, account.ID)
				if err != nil {
					return core.StatusMsg{Text: "MANAGER_CLEAR_FAILED: " + err.Error(), IsErr: true}
				}
				return core.StatusMsg{Text: fmt.Sprintf("Cleared %d transaction(s) from %s", n, account.Name), Code: "MANAGER_CLEAR"}
			case "nuke":
				n, err := coredb.NukeManagedAccount(dbConn, account.ID)
				if err != nil {
					return core.StatusMsg{Text: "MANAGER_NUKE_FAILED: " + err.Error(), IsErr: true}
				}
				return core.StatusMsg{Text: fmt.Sprintf("Nuked %s (%d txn removed)", account.Name, n), Code: "MANAGER_NUKE"}
			case "delete":
				if err := coredb.DeleteManagedAccountIfEmpty(dbConn, account.ID); err != nil {
					return core.StatusMsg{Text: "MANAGER_DELETE_FAILED: " + err.Error(), IsErr: true}
				}
				return core.StatusMsg{Text: "Deleted account " + account.Name, Code: "MANAGER_DELETE"}
			default:
				return core.StatusMsg{Text: "No account action selected."}
			}
		},
	)
	return func() tea.Msg { return core.PushScreenMsg{Screen: screen} }
}

func valueOrDash(v string) string {
	if strings.TrimSpace(v) == "" {
		return "-"
	}
	return v
}
