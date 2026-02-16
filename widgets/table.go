package widgets

import "strings"

type Table struct {
	Headers []string
	Rows    [][]string
}

func (t Table) Render(width, height int) string {
	if width <= 0 || height <= 0 {
		return ""
	}
	if len(t.Headers) == 0 {
		return "No data"
	}
	lines := []string{strings.Join(t.Headers, " | ")}
	for _, row := range t.Rows {
		lines = append(lines, strings.Join(row, " | "))
		if len(lines) >= height {
			break
		}
	}
	return strings.Join(lines, "\n")
}
