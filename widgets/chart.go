package widgets

import (
	"fmt"
	"strings"
)

type ChartPoint struct {
	Label string
	Value float64
}

type Chart struct {
	Title string
	Data  []ChartPoint
}

func (c Chart) Render(width, height int) string {
	if width <= 0 || height <= 0 {
		return ""
	}
	if len(c.Data) == 0 {
		return c.Title + "\n(no data)"
	}
	maxV := 0.0
	for _, p := range c.Data {
		if p.Value > maxV {
			maxV = p.Value
		}
	}
	if maxV <= 0 {
		maxV = 1
	}
	lines := []string{c.Title}
	for _, p := range c.Data {
		w := int((p.Value / maxV) * float64(max(1, width-12)))
		if w < 1 {
			w = 1
		}
		lines = append(lines, fmt.Sprintf("%-8s %s", p.Label, strings.Repeat("#", w)))
		if len(lines) >= height {
			break
		}
	}
	return strings.Join(lines, "\n")
}
