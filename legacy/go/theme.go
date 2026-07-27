package main

import "github.com/charmbracelet/lipgloss"

// ---------------------------------------------------------------------------
// Catppuccin Mocha palette — true-color hex values
// https://catppuccin.com/palette
// ---------------------------------------------------------------------------

const (
	colorRosewater lipgloss.Color = "#f5e0dc"
	colorFlamingo  lipgloss.Color = "#f2cdcd"
	colorPink      lipgloss.Color = "#f5c2e7"
	colorMauve     lipgloss.Color = "#cba6f7"
	colorRed       lipgloss.Color = "#f38ba8"
	colorMaroon    lipgloss.Color = "#eba0ac"
	colorPeach     lipgloss.Color = "#fab387"
	colorYellow    lipgloss.Color = "#f9e2af"
	colorGreen     lipgloss.Color = "#a6e3a1"
	colorTeal      lipgloss.Color = "#94e2d5"
	colorSky       lipgloss.Color = "#89dceb"
	colorSapphire  lipgloss.Color = "#74c7ec"
	colorBlue      lipgloss.Color = "#89b4fa"
	colorLavender  lipgloss.Color = "#b4befe"

	colorText     lipgloss.Color = "#cdd6f4"
	colorSubtext1 lipgloss.Color = "#bac2de"
	colorSubtext0 lipgloss.Color = "#a6adc8"
	colorOverlay2 lipgloss.Color = "#9399b2"
	colorOverlay1 lipgloss.Color = "#7f849c"
	colorOverlay0 lipgloss.Color = "#6c7086"
	colorSurface2 lipgloss.Color = "#585b70"
	colorSurface1 lipgloss.Color = "#45475a"
	colorSurface0 lipgloss.Color = "#313244"
	colorBase     lipgloss.Color = "#1e1e2e"
	colorMantle   lipgloss.Color = "#181825"
	colorCrust    lipgloss.Color = "#11111b"
)

// ---------------------------------------------------------------------------
// Semantic color aliases
// ---------------------------------------------------------------------------

const (
	colorAccent  = colorPink
	colorBrand   = colorPink
	colorFocus   = colorLavender
	colorSuccess = colorGreen
	colorError   = colorRed
	colorWarning = colorYellow
	colorInfo    = colorTeal
)

// ---------------------------------------------------------------------------
// All palette colors for validation / iteration
// ---------------------------------------------------------------------------

// AllPaletteColors returns every Catppuccin Mocha color for testing purposes.
func AllPaletteColors() []lipgloss.Color {
	return []lipgloss.Color{
		colorRosewater, colorFlamingo, colorPink, colorMauve,
		colorRed, colorMaroon, colorPeach, colorYellow,
		colorGreen, colorTeal, colorSky, colorSapphire,
		colorBlue, colorLavender,
		colorText, colorSubtext1, colorSubtext0,
		colorOverlay2, colorOverlay1, colorOverlay0,
		colorSurface2, colorSurface1, colorSurface0,
		colorBase, colorMantle, colorCrust,
	}
}

// ---------------------------------------------------------------------------
// Category color palette (for assigning to user categories)
// ---------------------------------------------------------------------------

// CategoryAccentColors returns the set of accent colors available for
// category assignment, in display order.
func CategoryAccentColors() []lipgloss.Color {
	return []lipgloss.Color{
		colorGreen, colorTeal, colorPeach, colorBlue,
		colorMauve, colorPink, colorFlamingo, colorSapphire,
		colorLavender, colorOverlay1, // Overlay1 is "Uncategorised"
		colorYellow, colorRed, colorMaroon, colorRosewater, colorSky,
	}
}

// TagAccentColors returns the set of accent colors available for tag assignment.
// This palette intentionally differs from categories.
func TagAccentColors() []lipgloss.Color {
	return []lipgloss.Color{
		colorRosewater, colorSky, colorLavender, colorFlamingo,
		colorSapphire, colorYellow, colorMaroon, colorMauve,
		colorPink, colorTeal, colorBlue, colorGreen,
	}
}
