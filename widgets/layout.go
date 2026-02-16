package widgets

import (
	"math"
	"strings"

	"github.com/charmbracelet/x/ansi"
)

type VStack struct {
	Widgets []Widget
	Spacing int
	Ratios  []float64
}

func (v VStack) Render(width, height int) string {
	if len(v.Widgets) == 0 || width <= 0 || height <= 0 {
		return ""
	}
	spacingTotal := max(0, v.Spacing*(len(v.Widgets)-1))
	usable := max(1, height-spacingTotal)
	heights := splitWidths(usable, len(v.Widgets), v.Ratios)
	lines := make([]string, 0, len(v.Widgets)*2)
	for i, w := range v.Widgets {
		lines = append(lines, w.Render(width, max(1, heights[i])))
		if i < len(v.Widgets)-1 {
			for s := 0; s < v.Spacing; s++ {
				lines = append(lines, "")
			}
		}
	}
	return strings.Join(lines, "\n")
}

type HStack struct {
	Widgets []Widget
	Ratios  []float64
	Gap     int
}

func (h HStack) Render(width, height int) string {
	if len(h.Widgets) == 0 || width <= 0 || height <= 0 {
		return ""
	}
	gapTotal := max(0, h.Gap*(len(h.Widgets)-1))
	usable := max(1, width-gapTotal)
	widths := splitWidths(usable, len(h.Widgets), h.Ratios)
	rendered := make([][]string, len(h.Widgets))
	maxLines := 0
	for i, w := range h.Widgets {
		part := strings.Split(w.Render(max(1, widths[i]), height), "\n")
		rendered[i] = part
		if len(part) > maxLines {
			maxLines = len(part)
		}
	}
	out := make([]string, 0, maxLines)
	for line := 0; line < maxLines; line++ {
		cols := make([]string, len(rendered))
		for i := range rendered {
			if line < len(rendered[i]) {
				cols[i] = padRight(rendered[i][line], widths[i])
			} else {
				cols[i] = strings.Repeat(" ", widths[i])
			}
		}
		out = append(out, strings.Join(cols, strings.Repeat(" ", h.Gap)))
	}
	return strings.Join(out, "\n")
}

func splitWidths(total, n int, ratios []float64) []int {
	if n <= 0 {
		return nil
	}
	if len(ratios) != n {
		width := total / n
		out := make([]int, n)
		for i := range out {
			out[i] = width
		}
		for i := 0; i < total%n; i++ {
			out[i]++
		}
		return out
	}
	sum := 0.0
	for _, r := range ratios {
		if r <= 0 {
			r = 1
		}
		sum += r
	}
	out := make([]int, n)
	used := 0
	for i := range out {
		w := int(math.Floor((ratios[i] / sum) * float64(total)))
		out[i] = w
		used += w
	}
	for i := 0; used < total; i = (i + 1) % n {
		out[i]++
		used++
	}
	return out
}

func padRight(s string, width int) string {
	if width <= 0 {
		return ""
	}
	s = ansi.Truncate(s, width, "")
	w := ansi.StringWidth(s)
	if w >= width {
		return s
	}
	return s + strings.Repeat(" ", width-w)
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
