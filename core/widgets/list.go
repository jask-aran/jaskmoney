package widgets

import "strings"

type List struct {
	Title string
	Items []string
}

func (l List) Render(width, height int) string {
	if width <= 0 || height <= 0 {
		return ""
	}
	rows := make([]string, 0, len(l.Items)+1)
	rows = append(rows, l.Title)
	for _, item := range l.Items {
		rows = append(rows, "- "+item)
	}
	if len(rows) > height {
		rows = rows[:height]
	}
	return strings.Join(rows, "\n")
}
