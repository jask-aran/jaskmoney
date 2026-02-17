package widgets

import (
	"strings"

	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/x/ansi"
)

func RenderModal(base, modal string, width, height int) string {
	return RenderPopup(base, modal, width, height)
}

func RenderPopup(base, popup string, width, height int) string {
	if width <= 0 || height <= 0 {
		return ""
	}
	baseCanvas := fitCanvas(base, width, height)
	card := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		Padding(1, 2).
		Render(popup)
	cardLines := splitToLines(card, 0)
	cardWidth := maxLineWidth(cardLines)
	cardHeight := len(cardLines)
	if cardWidth <= 0 || cardHeight <= 0 {
		return baseCanvas
	}
	x := (width - cardWidth) / 2
	if x < 0 {
		x = 0
	}
	y := (height - cardHeight) / 2
	if y < 0 {
		y = 0
	}
	return overlayAt(baseCanvas, card, x, y, width, height)
}

func overlayAt(base, overlay string, x, y, width, height int) string {
	baseLines := splitToLines(base, height)
	overlayLines := splitToLines(overlay, 0)
	overlayWidth := maxLineWidth(overlayLines)
	for i, line := range overlayLines {
		row := y + i
		if row < 0 || row >= len(baseLines) || row >= height {
			continue
		}
		target := padRightANSI(baseLines[row], width)
		left := ansi.Truncate(target, x, "")
		leftWidth := ansi.StringWidth(left)
		if leftWidth < x {
			left += strings.Repeat(" ", x-leftWidth)
		}

		overlayLine := padRightANSI(line, overlayWidth)
		pos := x + ansi.StringWidth(overlayLine)
		right := ""
		if width > 0 {
			right = dropColumns(target, pos)
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

func fitCanvas(s string, width, height int) string {
	lines := splitToLines(s, height)
	for i := range lines {
		lines[i] = padRightANSI(lines[i], width)
	}
	return strings.Join(lines, "\n")
}

func splitToLines(s string, height int) []string {
	lines := strings.Split(s, "\n")
	if height > 0 && len(lines) > height {
		lines = lines[:height]
	}
	for height > 0 && len(lines) < height {
		lines = append(lines, "")
	}
	return lines
}

func maxLineWidth(lines []string) int {
	maxWidth := 0
	for _, line := range lines {
		if w := ansi.StringWidth(line); w > maxWidth {
			maxWidth = w
		}
	}
	return maxWidth
}

func dropColumns(s string, cols int) string {
	if cols <= 0 {
		return s
	}
	truncated := ansi.Truncate(s, cols, "")
	return strings.TrimPrefix(s, truncated)
}

func padRightANSI(s string, width int) string {
	s = ansi.Truncate(s, width, "")
	w := ansi.StringWidth(s)
	if w >= width {
		return s
	}
	return s + strings.Repeat(" ", width-w)
}
