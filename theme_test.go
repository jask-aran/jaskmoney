package main

import (
	"regexp"
	"testing"
)

var hexColorRegex = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

func TestAllPaletteColorsAreValidHex(t *testing.T) {
	colors := AllPaletteColors()
	if len(colors) != 26 {
		t.Errorf("expected 26 palette colors, got %d", len(colors))
	}
	for _, c := range colors {
		hex := string(c)
		if !hexColorRegex.MatchString(hex) {
			t.Errorf("invalid hex color: %q", hex)
		}
	}
}

func TestCategoryAccentColorsAreValidHex(t *testing.T) {
	colors := CategoryAccentColors()
	if len(colors) == 0 {
		t.Fatal("expected at least one category accent color")
	}
	for _, c := range colors {
		hex := string(c)
		if !hexColorRegex.MatchString(hex) {
			t.Errorf("invalid hex color: %q", hex)
		}
	}
}

func TestSemanticAliasesMatchPalette(t *testing.T) {
	tests := []struct {
		name  string
		alias string
		want  string
	}{
		{"accent", string(colorAccent), string(colorLavender)},
		{"brand", string(colorBrand), string(colorMauve)},
		{"success", string(colorSuccess), string(colorGreen)},
		{"error", string(colorError), string(colorRed)},
		{"warning", string(colorWarning), string(colorYellow)},
		{"info", string(colorInfo), string(colorTeal)},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.alias != tt.want {
				t.Errorf("%s = %q, want %q", tt.name, tt.alias, tt.want)
			}
		})
	}
}
