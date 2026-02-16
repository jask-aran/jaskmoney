package core

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/lipgloss"
)

func RenderFooter(m Model) string {
	bindings := m.keys.BindingsForScope(m.ActiveScope())
	parts := make([]string, 0, len(bindings))
	for _, b := range bindings {
		if len(b.Keys) == 0 {
			continue
		}
		parts = append(parts, fmt.Sprintf("%s %s", strings.ToUpper(b.Keys[0]), b.Description))
	}
	line := strings.Join(parts, "  ")
	if line == "" {
		line = "No shortcuts"
	}
	return renderBar(footerStyle, max(1, m.width), line)
}

func RenderStatusBar(m Model) string {
	msg := strings.TrimSpace(m.status)
	if msg == "" {
		msg = "Ready"
	}
	if m.statusErr {
		return renderBar(statusErrBarStyle, max(1, m.width), msg)
	}
	return renderBar(statusBarStyle, max(1, m.width), msg)
}

func renderBar(style lipgloss.Style, width int, text string) string {
	line := strings.ReplaceAll(text, "\n", " ")
	line = trimToWidth(strings.TrimSpace(line), width)
	r := []rune(line)
	if len(r) < width {
		line += strings.Repeat(" ", width-len(r))
	}
	return style.Width(width).MaxWidth(width).Render(line)
}
