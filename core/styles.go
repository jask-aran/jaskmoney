package core

import "github.com/charmbracelet/lipgloss"

var (
	colorText     lipgloss.Color = "#cdd6f4"
	colorMuted    lipgloss.Color = "#a6adc8"
	colorBorder   lipgloss.Color = "#585b70"
	colorBg       lipgloss.Color = "#1e1e2e"
	colorMantle   lipgloss.Color = "#181825"
	colorSurface0 lipgloss.Color = "#313244"
	colorAccent   lipgloss.Color = "#89b4fa"
	colorSuccess  lipgloss.Color = "#a6e3a1"
	colorError    lipgloss.Color = "#f38ba8"
	colorTabOff   lipgloss.Color = "#7f849c"
	colorSurface1 lipgloss.Color = "#45475a"

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
