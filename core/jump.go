package core

import (
	"strings"
	"unicode"

	tea "github.com/charmbracelet/bubbletea"
)

type JumpMode struct {
	Active bool
}

func (m *Model) toggleJumpMode() {
	m.jump.Active = !m.jump.Active
	if m.jump.Active {
		m.SetStatus("Jump mode: press tab letter")
	} else {
		m.SetStatus("Ready")
	}
}

func (m *Model) jumpHandleKey(msg tea.KeyMsg) (handled bool) {
	if !m.jump.Active {
		return false
	}
	r := []rune(strings.ToLower(msg.String()))
	if len(r) != 1 || !unicode.IsLetter(r[0]) {
		m.jump.Active = false
		m.SetStatus("Jump mode cancelled")
		return true
	}
	idx := m.tabIndexByJumpKey(byte(r[0]))
	m.jump.Active = false
	if idx < 0 {
		m.SetStatus("No tab mapped to that key")
		return true
	}
	m.SwitchTab(idx)
	m.SetStatus("Jumped to " + m.tabs[idx].Title())
	return true
}

func (m *Model) tabIndexByJumpKey(k byte) int {
	for i, t := range m.tabs {
		if jt, ok := t.(JumpTarget); ok && jt.JumpKey() == k {
			return i
		}
	}
	return -1
}
