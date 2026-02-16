package widgets

import "github.com/charmbracelet/lipgloss"

type Box struct {
	Title   string
	Content string
}

func (b Box) Render(width, height int) string {
	if width <= 0 || height <= 0 {
		return ""
	}
	style := lipgloss.NewStyle().Border(lipgloss.RoundedBorder()).Padding(0, 1).Width(width - 2).Height(max(1, height-2))
	return style.Render("[" + b.Title + "]\n" + b.Content)
}
