package core

import (
	"slices"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
)

type KeyBinding struct {
	Keys        []string
	Action      string
	Description string
	Scopes      []string
}

type KeyRegistry struct {
	bindings []KeyBinding
}

func NewKeyRegistry(bindings []KeyBinding) *KeyRegistry {
	return &KeyRegistry{bindings: slices.Clone(bindings)}
}

func (r *KeyRegistry) Register(binding KeyBinding) {
	r.bindings = append(r.bindings, binding)
}

func (r *KeyRegistry) BindingsForScope(scope string) []KeyBinding {
	out := make([]KeyBinding, 0, len(r.bindings))
	for _, b := range r.bindings {
		if scopeMatch(scope, b.Scopes) {
			out = append(out, b)
		}
	}
	return out
}

func (r *KeyRegistry) IsAction(msg tea.KeyMsg, action, scope string) bool {
	pressed := normalizeKey(msg.String())
	for _, b := range r.bindings {
		if b.Action != action || !scopeMatch(scope, b.Scopes) {
			continue
		}
		for _, k := range b.Keys {
			if normalizeKey(k) == pressed {
				return true
			}
		}
	}
	return false
}

func normalizeKey(k string) string {
	return strings.ToLower(strings.TrimSpace(k))
}

func scopeMatch(scope string, scopes []string) bool {
	if len(scopes) == 0 {
		return true
	}
	for _, s := range scopes {
		if s == "*" || s == scope {
			return true
		}
	}
	return false
}
