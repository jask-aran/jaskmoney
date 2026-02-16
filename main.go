package main

import (
	"database/sql"
	"log"

	tea "github.com/charmbracelet/bubbletea"
	_ "modernc.org/sqlite"

	"jaskmoney-v2/core"
	"jaskmoney-v2/db"
	"jaskmoney-v2/screens"
	"jaskmoney-v2/tabs"
)

func main() {
	database, err := sql.Open("sqlite", "file:phase0.db?cache=shared")
	if err != nil {
		log.Fatal(err)
	}
	defer database.Close()

	if err := db.InitSchema(database); err != nil {
		log.Fatal(err)
	}

	keyReg := core.NewKeyRegistry(defaultBindings())
	cmdReg := core.NewCommandRegistry(nil)

	app := core.NewModel([]core.Tab{
		tabs.NewDashboardTab(),
		tabs.NewManagerTab(),
		tabs.NewBudgetTab(),
		tabs.NewSettingsTab(),
	}, keyReg, cmdReg, database, core.AppData{})

	app.OpenPicker = func(m *core.Model) core.Screen {
		items := []screens.PickerItem{}
		return screens.NewPickerScreen("Category Picker", "screen:picker", items, func(it screens.PickerItem) tea.Msg {
			return core.StatusMsg{Text: "Picked category: " + it.Label}
		})
	}

	app.OpenCmd = func(m *core.Model, scope string) core.Screen {
		return screens.NewCommandScreen(scope,
			func(query string) []screens.CommandOption {
				results := m.CommandRegistry().Search(query, scope, m)
				out := make([]screens.CommandOption, 0, len(results))
				for _, r := range results {
					out = append(out, screens.CommandOption{ID: r.CommandID, Name: r.Name, Desc: r.Desc, Disabled: r.Disabled, Reason: r.Reason})
				}
				return out
			},
			func(id string) tea.Msg { return core.CommandExecuteMsg{CommandID: id} },
		)
	}

	registerCommands(app.CommandRegistry())

	p := tea.NewProgram(app, tea.WithAltScreen())
	if _, err := p.Run(); err != nil {
		log.Fatal(err)
	}
}

func defaultBindings() []core.KeyBinding {
	return []core.KeyBinding{
		{Keys: []string{"q"}, Action: "quit", Description: "quit", Scopes: []string{"*"}},
		{Keys: []string{"j"}, Action: "jump", Description: "jump mode", Scopes: []string{"*"}},
		{Keys: []string{"left"}, Action: "pane-nav", Description: "pane prev", Scopes: []string{"*"}},
		{Keys: []string{"right"}, Action: "pane-nav", Description: "pane next", Scopes: []string{"*"}},
		{Keys: []string{"up"}, Action: "pane-nav", Description: "pane prev", Scopes: []string{"*"}},
		{Keys: []string{"down"}, Action: "pane-nav", Description: "pane next", Scopes: []string{"*"}},
		{Keys: []string{"enter"}, Action: "pane-focus", Description: "focus pane", Scopes: []string{"*"}},
		{Keys: []string{"ctrl+k"}, Action: "open-command-palette", Description: "commands", Scopes: []string{"*"}},
		{Keys: []string{"p"}, Action: "open-category-picker", Description: "categories", Scopes: []string{"*"}},
		{Keys: []string{"1"}, Action: "switch-tab-1", Description: "dashboard", Scopes: []string{"*"}},
		{Keys: []string{"2"}, Action: "switch-tab-2", Description: "manager", Scopes: []string{"*"}},
		{Keys: []string{"3"}, Action: "switch-tab-3", Description: "budget", Scopes: []string{"*"}},
		{Keys: []string{"4"}, Action: "switch-tab-4", Description: "settings", Scopes: []string{"*"}},
		{Keys: []string{"esc"}, Action: "close", Description: "close", Scopes: []string{"screen:picker", "screen:command", "screen:editor"}},
		{Keys: []string{"enter"}, Action: "select", Description: "select", Scopes: []string{"screen:picker", "screen:command"}},
	}
}

func registerCommands(reg *core.CommandRegistry) {
	reg.Register(core.Command{
		ID:          "open-category-picker",
		Name:        "Open category picker",
		Description: "Push category picker screen",
		Scopes:      []string{"*"},
		Execute: func(m *core.Model) tea.Cmd {
			if m.OpenPicker != nil {
				m.PushScreen(m.OpenPicker(m))
			}
			return core.StatusCmd("Category picker opened")
		},
	})
	reg.Register(core.Command{
		ID:          "switch-dashboard",
		Name:        "Switch to dashboard",
		Description: "Activate dashboard tab",
		Scopes:      []string{"*"},
		Execute: func(m *core.Model) tea.Cmd {
			m.SwitchTab(0)
			return core.StatusCmd("Dashboard")
		},
	})
	reg.Register(core.Command{
		ID:          "switch-manager",
		Name:        "Switch to manager",
		Description: "Activate manager tab",
		Scopes:      []string{"*"},
		Execute: func(m *core.Model) tea.Cmd {
			m.SwitchTab(1)
			return core.StatusCmd("Manager")
		},
	})
	reg.Register(core.Command{
		ID:          "switch-budget",
		Name:        "Switch to budget",
		Description: "Activate budget tab",
		Scopes:      []string{"*"},
		Execute: func(m *core.Model) tea.Cmd {
			m.SwitchTab(2)
			return core.StatusCmd("Budget")
		},
	})
	reg.Register(core.Command{
		ID:          "switch-settings",
		Name:        "Switch to settings",
		Description: "Activate settings tab",
		Scopes:      []string{"*"},
		Execute: func(m *core.Model) tea.Cmd {
			m.SwitchTab(3)
			return core.StatusCmd("Settings")
		},
	})
	reg.Register(core.Command{
		ID:          "save-data",
		Name:        "Save data",
		Description: "Placeholder save command",
		Scopes:      []string{"*"},
		Disabled: func(m *core.Model) (bool, string) {
			if m.Data.Transactions == 0 {
				return true, "no transactions loaded"
			}
			return false, ""
		},
		Execute: func(m *core.Model) tea.Cmd {
			return core.StatusCmd("Saved")
		},
	})
}
