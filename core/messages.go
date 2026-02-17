package core

import tea "github.com/charmbracelet/bubbletea"

type StatusMsg struct {
	Text  string
	IsErr bool
	Code  string
}

type DataLoadedMsg struct {
	Key  string
	Data any
	Err  error
}

type PushScreenMsg struct {
	Screen Screen
}

type PopScreenMsg struct{}

type CommandExecuteMsg struct {
	CommandID string
}

type TabSwitchMsg struct {
	Index int
}

type SetScopeStatusMsg struct {
	Text string
}

type JumpTargetSelectedMsg struct {
	Key string
}

func StatusCmd(text string) tea.Cmd {
	return func() tea.Msg { return StatusMsg{Text: text} }
}

func StatusCodeCmd(code, text string) tea.Cmd {
	return func() tea.Msg { return StatusMsg{Text: text, Code: code} }
}

func ErrorCmd(err error) tea.Cmd {
	return func() tea.Msg {
		if err == nil {
			return StatusMsg{Text: "", IsErr: false}
		}
		return StatusMsg{Text: err.Error(), IsErr: true}
	}
}
