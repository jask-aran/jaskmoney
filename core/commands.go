package core

import (
	"cmp"
	"slices"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
)

type Command struct {
	ID          string
	Name        string
	Description string
	Scopes      []string
	Execute     func(m *Model) tea.Cmd
	Disabled    func(m *Model) (bool, string)
}

type CommandResult struct {
	CommandID string
	Name      string
	Desc      string
	Disabled  bool
	Reason    string
}

type CommandRegistry struct {
	commands map[string]Command
}

func NewCommandRegistry(cmds []Command) *CommandRegistry {
	reg := &CommandRegistry{commands: map[string]Command{}}
	for _, c := range cmds {
		reg.Register(c)
	}
	return reg
}

func (r *CommandRegistry) Register(c Command) {
	if c.ID == "" {
		return
	}
	r.commands[c.ID] = c
}

func (r *CommandRegistry) Search(query, scope string, m *Model) []CommandResult {
	q := strings.ToLower(strings.TrimSpace(query))
	results := make([]CommandResult, 0, len(r.commands))
	for _, c := range r.commands {
		if !scopeMatch(scope, c.Scopes) {
			continue
		}
		h := strings.ToLower(c.Name + " " + c.Description + " " + c.ID)
		if q != "" && !strings.Contains(h, q) {
			continue
		}
		disabled := false
		reason := ""
		if c.Disabled != nil {
			disabled, reason = c.Disabled(m)
		}
		results = append(results, CommandResult{
			CommandID: c.ID,
			Name:      c.Name,
			Desc:      c.Description,
			Disabled:  disabled,
			Reason:    reason,
		})
	}
	slices.SortFunc(results, func(a, b CommandResult) int {
		if a.Disabled != b.Disabled {
			if !a.Disabled {
				return -1
			}
			return 1
		}
		return cmp.Compare(a.Name, b.Name)
	})
	return results
}

func (r *CommandRegistry) Execute(id string, m *Model) tea.Cmd {
	c, ok := r.commands[id]
	if !ok {
		return StatusCmd("Unknown command: " + id)
	}
	if c.Disabled != nil {
		disabled, reason := c.Disabled(m)
		if disabled {
			if reason == "" {
				reason = "command is disabled"
			}
			return StatusCmd(reason)
		}
	}
	if c.Execute == nil {
		return nil
	}
	return c.Execute(m)
}
