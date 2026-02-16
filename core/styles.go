package core

import "github.com/charmbracelet/lipgloss"

var (
	appStyle = lipgloss.NewStyle().Foreground(colorText)

	headerStyle    = lipgloss.NewStyle().Foreground(colorAccent).Bold(true)
	headerAppStyle = lipgloss.NewStyle().Foreground(colorAccent).Bold(true)
	headerBarStyle = lipgloss.NewStyle().
			Background(colorMantle).
			Foreground(colorText)
	tabSepStyle = lipgloss.NewStyle().
			Foreground(colorBorder).
			Background(colorMantle)

	activeTabStyle = lipgloss.NewStyle().
			Background(colorSurface0).
			Foreground(colorAccent).
			Bold(true).
			Padding(0, 1)
	inactiveTabStyle = lipgloss.NewStyle().
				Background(colorMantle).
				Foreground(colorTabOff).
				Padding(0, 1)

	statusBarStyle = lipgloss.NewStyle().
			Foreground(colorSuccess).
			Background(colorSurface0)
	statusErrBarStyle = lipgloss.NewStyle().
				Foreground(colorError).
				Background(colorSurface0)
	footerStyle = lipgloss.NewStyle().
			Background(colorMantle)

	keyStyle      = lipgloss.NewStyle().Foreground(colorAccent).Bold(true)
	helpDescStyle = lipgloss.NewStyle().Foreground(colorMuted)
)
