package core

import "github.com/charmbracelet/lipgloss"

var (
	appStyle = lipgloss.NewStyle().Foreground(colorText)

	headerStyle = lipgloss.NewStyle().Foreground(colorAccent).Bold(true)

	activeTabStyle   = lipgloss.NewStyle().Foreground(colorAccent).Bold(true)
	inactiveTabStyle = lipgloss.NewStyle().Foreground(colorTabOff)

	statusBarStyle    = lipgloss.NewStyle().Foreground(colorSuccess).Background(colorSurface1)
	statusErrBarStyle = lipgloss.NewStyle().Foreground(colorError).Background(colorSurface1)
	footerStyle       = lipgloss.NewStyle().Foreground(colorMuted).Background(colorSurface1)

	keyStyle      = lipgloss.NewStyle().Foreground(colorAccent).Bold(true)
	helpDescStyle = lipgloss.NewStyle().Foreground(colorMuted)
)
