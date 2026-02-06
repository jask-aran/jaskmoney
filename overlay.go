package main

import (
	"strings"

	"github.com/charmbracelet/x/ansi"
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
		left := ansi.Truncate(target, x, "")
		leftWidth := ansi.StringWidth(left)
		if leftWidth < x {
			left += strings.Repeat(" ", x-leftWidth)
		}

		overlayLine := padRight(line, overlayWidth)
		pos := x + ansi.StringWidth(overlayLine)
		right := ""
		if width > 0 {
			right = ansi.TruncateLeft(target, pos, "")
			rightWidth := ansi.StringWidth(right)
			gap := width - pos - rightWidth
			if gap > 0 {
				right = strings.Repeat(" ", gap) + right
			}
		}

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
		if w := ansi.StringWidth(line); w > m {
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
	w := ansi.StringWidth(s)
	if w >= width {
		return s
	}
	return s + strings.Repeat(" ", width-w)
}

// truncate shortens s to width runes, appending "..." if truncated.
func truncate(s string, width int) string {
	if width <= 0 {
		return ""
	}
	return ansi.Truncate(s, width, "…")
}
