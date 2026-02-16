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
	overlayCanvas := fitCanvas(lipgloss.Place(width, height, lipgloss.Center, lipgloss.Center, card), width, height)
	return overlayOntoBase(baseCanvas, overlayCanvas, width, height)
}

func overlayOntoBase(base, overlay string, width, height int) string {
	baseLines := splitToLines(base, height)
	overlayLines := splitToLines(overlay, height)
	out := make([]string, height)
	for i := 0; i < height; i++ {
		baseLine := padRightANSI(baseLines[i], width)
		overlayLine := padRightANSI(overlayLines[i], width)
		start, end, has := overlaySegmentBounds(overlayLine, width)
		if !has {
			out[i] = baseLine
			continue
		}
		left := ansi.Truncate(baseLine, start, "")
		segment := ansi.Truncate(dropColumns(overlayLine, start), end-start, "")
		right := dropColumns(baseLine, end)
		out[i] = padRightANSI(left+segment+right, width)
	}
	return strings.Join(out, "\n")
}

func overlaySegmentBounds(line string, width int) (start, end int, ok bool) {
	plain := ansi.Strip(ansi.Truncate(line, width, ""))
	trimmed := strings.TrimRight(plain, " ")
	if trimmed == "" {
		return 0, 0, false
	}
	start = 0
	for start < len(plain) && plain[start] == ' ' {
		start++
	}
	end = len(trimmed)
	if start >= end {
		return 0, 0, false
	}
	return start, end, true
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
	if len(lines) > height {
		lines = lines[:height]
	}
	for len(lines) < height {
		lines = append(lines, "")
	}
	return lines
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
