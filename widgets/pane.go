package widgets

import (
	"strings"

	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/x/ansi"
)

type Pane struct {
	Title    string
	Height   int
	Content  string
	Selected bool
	Focused  bool
}

func (p Pane) Render(width, height int) string {
	if width <= 0 {
		return ""
	}
	h := p.Height
	if h < 3 {
		h = 3
	}
	if height > 0 && h > height {
		h = height
	}
	if width < 4 {
		width = 4
	}
	if h < 3 {
		h = 3
	}

	border := lipgloss.Color("#6c7086")
	if p.Selected {
		border = lipgloss.Color("#89b4fa")
	}
	if p.Focused {
		border = lipgloss.Color("#a6e3a1")
	}
	borderStyle := lipgloss.NewStyle().Foreground(border)
	titleStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#cdd6f4")).Bold(true)
	contentStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#cdd6f4"))

	titlePrefix := "  "
	if p.Selected {
		titlePrefix = "▶ "
	}
	if p.Focused {
		titlePrefix = "● "
	}

	innerWidth := width - 2
	contentWidth := innerWidth - 2
	if contentWidth < 1 {
		contentWidth = 1
		innerWidth = contentWidth + 2
		width = innerWidth + 2
	}

	title := strings.TrimSpace(titlePrefix + p.Title)
	titleText := " " + title + " "
	if ansi.StringWidth(titleText) > innerWidth {
		titleText = " " + ansi.Truncate(title, max(1, innerWidth-2), "") + " "
	}
	titleW := ansi.StringWidth(titleText)
	dashes := innerWidth - titleW
	if dashes < 0 {
		dashes = 0
	}
	leftDash := 1
	if dashes == 0 {
		leftDash = 0
	} else if leftDash > dashes {
		leftDash = dashes
	}
	rightDash := dashes - leftDash

	v := borderStyle.Render("│")
	tl := borderStyle.Render("╭")
	tr := borderStyle.Render("╮")
	bl := borderStyle.Render("╰")
	br := borderStyle.Render("╯")

	top := tl +
		borderStyle.Render(strings.Repeat("─", leftDash)) +
		titleStyle.Render(titleText) +
		borderStyle.Render(strings.Repeat("─", rightDash)) +
		tr

	innerHeight := h - 2
	contentLines := splitLines(p.Content)
	if len(contentLines) == 0 {
		contentLines = []string{""}
	}
	rows := make([]string, 0, innerHeight+2)
	rows = append(rows, top)
	for i := 0; i < innerHeight; i++ {
		line := ""
		if i < len(contentLines) {
			line = contentLines[i]
		}
		line = ansi.Truncate(line, contentWidth, "")
		line = contentStyle.Render(line)
		row := v + " " + padRight(line, contentWidth) + " " + v
		rows = append(rows, row)
	}
	bottom := bl + borderStyle.Render(strings.Repeat("─", innerWidth)) + br
	rows = append(rows, bottom)

	return strings.Join(rows, "\n")
}

func splitLines(s string) []string {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return strings.Split(s, "\n")
}
