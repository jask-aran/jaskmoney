package core

import (
	"fmt"

	tea "github.com/charmbracelet/bubbletea"
)

func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width, m.height = msg.Width, msg.Height
		return m, nil
	case StatusMsg:
		m.status = msg.Text
		m.statusErr = msg.IsErr
		return m, nil
	case DataLoadedMsg:
		if msg.Err != nil {
			m.SetError(msg.Err)
		} else {
			m.SetStatus("Data loaded: " + msg.Key)
		}
		return m, nil
	case PushScreenMsg:
		m.screens.Push(msg.Screen)
		return m, nil
	case PopScreenMsg:
		m.screens.Pop()
		return m, nil
	case CommandExecuteMsg:
		return m, m.commands.Execute(msg.CommandID, &m)
	case TabSwitchMsg:
		m.SwitchTab(msg.Index)
		return m, nil
	case JumpTargetSelectedMsg:
		if len(m.tabs) == 0 {
			return m, nil
		}
		provider, ok := m.tabs[m.activeTab].(JumpTargetProvider)
		if !ok {
			return m, nil
		}
		handled, cmd := provider.JumpToTarget(&m, msg.Key)
		if handled {
			return m, cmd
		}
		return m, nil
	case tea.KeyMsg:
		if msg.String() == "ctrl+c" {
			m.quitting = true
			return m, tea.Quit
		}

		if top := m.screens.Top(); top != nil {
			next, cmd, pop := top.Update(msg)
			if pop {
				m.screens.Pop()
				return m, cmd
			}
			if next != nil {
				m.screens.items[len(m.screens.items)-1] = next
			}
			return m, cmd
		}

		scope := m.ActiveScope()
		if m.keys.IsAction(msg, "quit", scope) {
			m.quitting = true
			return m, tea.Quit
		}
		if m.keys.IsAction(msg, "jump", scope) {
			return m, m.activateJumpPicker()
		}
		if len(m.tabs) > 0 {
			if handler, ok := m.tabs[m.activeTab].(PaneKeyHandler); ok {
				handled, cmd := handler.HandlePaneKey(&m, msg)
				if handled {
					return m, cmd
				}
			}
		}
		if m.keys.IsAction(msg, "open-command-palette", scope) && m.OpenCommandModal != nil {
			m.screens.Push(m.OpenCommandModal(&m, scope))
			return m, nil
		}
		if m.keys.IsAction(msg, "open-category-picker", scope) && m.OpenPickerModal != nil {
			m.screens.Push(m.OpenPickerModal(&m))
			return m, nil
		}
		for i := range m.tabs {
			if m.keys.IsAction(msg, fmt.Sprintf("switch-tab-%d", i+1), scope) {
				m.SwitchTab(i)
				return m, nil
			}
		}
		if len(m.tabs) > 0 {
			return m, m.tabs[m.activeTab].Update(&m, msg)
		}
	}

	if top := m.screens.Top(); top != nil {
		next, cmd, pop := top.Update(msg)
		if pop {
			m.screens.Pop()
			return m, cmd
		}
		if next != nil {
			m.screens.items[len(m.screens.items)-1] = next
		}
		return m, cmd
	}
	if len(m.tabs) > 0 {
		return m, m.tabs[m.activeTab].Update(&m, msg)
	}
	return m, nil
}
