package app

import (
	tea "github.com/charmbracelet/bubbletea"

	"jaskmoney-v2/core"
	"jaskmoney-v2/core/screens"
)

func Tabs() []core.Tab {
	return []core.Tab{
		NewDashboardTab(),
		NewManagerTab(),
		NewBudgetTab(),
		NewSettingsTab(),
	}
}

func ConfigureModel(m *core.Model) {
	if m == nil {
		return
	}
	bindRuntimeDB(m.DB)

	m.OpenPickerModal = func(model *core.Model) core.Screen {
		items := []screens.PickerItem{}
		return screens.NewPickerModal("Category Picker", "screen:picker", items, func(it screens.PickerItem) tea.Msg {
			return core.StatusMsg{Text: "Picked category: " + it.Label}
		})
	}

	m.OpenCommandModal = func(model *core.Model, scope string) core.Screen {
		return screens.NewCommandModal(scope,
			func(query string) []screens.CommandOption {
				results := model.CommandRegistry().Search(query, scope, model)
				out := make([]screens.CommandOption, 0, len(results))
				for _, r := range results {
					out = append(out, screens.CommandOption{ID: r.CommandID, Name: r.Name, Desc: r.Desc, Disabled: r.Disabled, Reason: r.Reason})
				}
				return out
			},
			func(id string) tea.Msg { return core.CommandExecuteMsg{CommandID: id} },
		)
	}

	m.OpenJumpPickerModal = func(model *core.Model, targets []core.JumpTarget) core.Screen {
		return screens.NewJumpPickerModal(targets)
	}

	RegisterCommands(m.CommandRegistry())
}

func RegisterCommands(reg *core.CommandRegistry) {
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
}
