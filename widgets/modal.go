package widgets

import "github.com/charmbracelet/lipgloss"

func RenderModal(base, modal string, width, height int) string {
	if width <= 0 || height <= 0 {
		return modal
	}
	overlay := lipgloss.NewStyle().Border(lipgloss.RoundedBorder()).Padding(1, 2).Render(modal)
	return lipgloss.Place(width, height, lipgloss.Center, lipgloss.Center, overlay)
}
