package core

import tea "github.com/charmbracelet/bubbletea"

type JumpTarget struct {
	Key   string
	Label string
}

type JumpTargetProvider interface {
	JumpTargets() []JumpTarget
	JumpToTarget(m *Model, key string) (bool, tea.Cmd)
}

func (m *Model) jumpTargetsForActiveTab() []JumpTarget {
	if len(m.tabs) == 0 {
		return nil
	}
	provider, ok := m.tabs[m.activeTab].(JumpTargetProvider)
	if !ok {
		return nil
	}
	return provider.JumpTargets()
}

func (m *Model) activateJumpPicker() tea.Cmd {
	targets := m.jumpTargetsForActiveTab()
	if len(targets) == 0 {
		m.SetStatus("No jump targets for active tab")
		return nil
	}
	if m.OpenJumpPicker == nil {
		m.SetStatus("Jump picker unavailable")
		return nil
	}
	if top := m.screens.Top(); top != nil && top.Scope() == "screen:jump-picker" {
		m.screens.Pop()
		m.SetStatus("Jump picker closed")
		return nil
	}
	m.screens.Push(m.OpenJumpPicker(m, targets))
	m.SetStatus("Jump mode: press pane key")
	return nil
}
