package main

import (
	"strings"

	"github.com/charmbracelet/lipgloss"
)

// overlayAt composites an overlay string on top of a base string at the given
// character position (x, y). Both are treated as line-based grids.
func overlayAt(base, overlay string, x, y, width, height int) string {
	baseLines := splitLines(base)
	overlayLines := splitLines(overlay)
	overlayWidth := maxLineWidth(overlayLines)
	for i, line := range overlayLines {
		row := y + i
		if row < 0 || row >= len(baseLines) || row >= height {
			continue
		}
		target := padRight(baseLines[row], width)
		left := cutPlain(target, 0, x)
		right := ""
		if width > 0 {
			right = cutPlain(target, x+overlayWidth, width)
		}
		overlayLine := padRight(line, overlayWidth)
		baseLines[row] = left + overlayLine + right
	}
	return strings.Join(baseLines, "\n")
}

// ---------------------------------------------------------------------------
// String utilities
// ---------------------------------------------------------------------------

// splitLines splits a string on newlines, returning at least one element.
func splitLines(s string) []string {
	if s == "" {
		return []string{""}
	}
	return strings.Split(s, "\n")
}

// maxLineWidth returns the visual width of the widest line.
func maxLineWidth(lines []string) int {
	m := 0
	for _, line := range lines {
		if w := lipgloss.Width(line); w > m {
			m = w
		}
	}
	return m
}

// padRight pads s with spaces so its visual width equals width.
func padRight(s string, width int) string {
	if width <= 0 {
		return s
	}
	w := lipgloss.Width(s)
	if w >= width {
		return s
	}
	return s + strings.Repeat(" ", width-w)
}

// cutPlain returns the rune-slice s[left:right], clamped to bounds.
func cutPlain(s string, left, right int) string {
	if right <= left {
		return ""
	}
	runes := []rune(s)
	if left < 0 {
		left = 0
	}
	if right > len(runes) {
		right = len(runes)
	}
	if left > len(runes) {
		return ""
	}
	return string(runes[left:right])
}

// truncate shortens s to width runes, appending "..." if truncated.
func truncate(s string, width int) string {
	if width <= 0 {
		return ""
	}
	runes := []rune(s)
	if len(runes) <= width {
		return s
	}
	if width <= 1 {
		return string(runes[:width])
	}
	return string(runes[:width-1]) + "…"
}

// boldKey wraps text in ANSI bold escape sequences.
func boldKey(text string) string {
	if text == "" {
		return ""
	}
	return "\x1b[1m" + text + "\x1b[22m"
}
