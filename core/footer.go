package core

import (
	"strings"

	"github.com/charmbracelet/bubbles/key"
	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/x/ansi"
)

func RenderFooter(m Model) string {
	bindings := m.keys.BindingsForScope(m.ActiveScope())
	bg := colorMantle
	keyStyle := lipgloss.NewStyle().Foreground(colorAccent).Bold(true).Background(bg)
	descStyle := lipgloss.NewStyle().Foreground(colorMuted).Background(bg)
	space := lipgloss.NewStyle().Background(bg).Render(" ")
	sep := lipgloss.NewStyle().Background(bg).Render("  ")

	parts := make([]string, 0, len(bindings))
	for _, b := range bindings {
		if len(b.Keys) == 0 {
			continue
		}
		kb := key.NewBinding(key.WithKeys(b.Keys...), key.WithHelp(b.Keys[0], b.Description))
		h := kb.Help()
		if h.Key == "" && h.Desc == "" {
			continue
		}
		parts = append(parts, keyStyle.Render(h.Key)+space+descStyle.Render(h.Desc))
	}
	line := strings.Join(parts, sep)
	if line == "" {
		line = lipgloss.NewStyle().Foreground(colorMuted).Background(bg).Render("No shortcuts")
	}
	return renderBar(footerStyle, max(1, m.width), line, bg)
}

func RenderStatusBar(m Model) string {
	msg := strings.TrimSpace(m.status)
	if msg == "" {
		msg = "Ready"
	}
	if strings.TrimSpace(m.statusCode) != "" {
		msg = "[" + m.statusCode + "] " + msg
	}
	if m.statusErr {
		return renderBar(statusErrBarStyle, max(1, m.width), msg, colorSurface0)
	}
	return renderBar(statusBarStyle, max(1, m.width), msg, colorSurface0)
}

func renderBar(style lipgloss.Style, width int, text string, bg lipgloss.TerminalColor) string {
	line := strings.ReplaceAll(text, "\n", " ")
	line = ansi.Truncate(line, width, "")
	lineW := ansi.StringWidth(line)
	if lineW < width {
		line += strings.Repeat(" ", width-lineW)
	}
	return style.
		Background(bg).
		Width(width).
		MaxWidth(width).
		Render(line)
}

func ClipHeight(s string, height int) string {
	if height <= 0 {
		return ""
	}
	lines := strings.Split(s, "\n")
	if len(lines) > height {
		lines = lines[:height]
	}
	return strings.Join(lines, "\n")
}

func TrimToWidth(s string, width int) string {
	if width <= 0 {
		return ""
	}
	return ansi.Truncate(s, width, "")
}

func MaxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
