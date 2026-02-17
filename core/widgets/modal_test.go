package widgets

import (
	"fmt"
	"strings"
	"testing"

	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/x/ansi"
)

func TestRenderPopupOverlaysWithoutDroppingBase(t *testing.T) {
	base := strings.Join([]string{
		"row-0................",
		"row-1................",
		"row-2................",
		"row-3................",
		"row-4................",
		"row-5................",
		"row-6................",
		"row-7................",
		"row-8................",
	}, "\n")
	out := RenderPopup(base, "Popup", 20, 9)
	lines := strings.Split(out, "\n")
	if len(lines) != 9 {
		t.Fatalf("line count = %d, want 9", len(lines))
	}
	if !strings.Contains(out, "Popup") {
		t.Fatalf("expected popup content in output")
	}
	if !strings.Contains(lines[0], "row-0") {
		t.Fatalf("expected top base row preserved, got %q", lines[0])
	}
	if !strings.Contains(lines[8], "row-8") {
		t.Fatalf("expected bottom base row preserved, got %q", lines[8])
	}
}

func TestRenderPopupMasksBaseWithinModalBounds(t *testing.T) {
	baseRows := make([]string, 0, 9)
	for i := 0; i < 9; i++ {
		baseRows = append(baseRows, fmt.Sprintf("r%d-%s", i, strings.Repeat("x", 24)))
	}
	base := strings.Join(baseRows, "\n")

	width := 30
	height := 9
	out := RenderPopup(base, "", width, height)
	outLines := strings.Split(out, "\n")
	if len(outLines) != height {
		t.Fatalf("line count = %d, want %d", len(outLines), height)
	}

	card := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		Padding(1, 2).
		Render("")
	cardLines := splitToLines(card, 0)
	cardWidth := maxLineWidth(cardLines)
	cardHeight := len(cardLines)
	x := (width - cardWidth) / 2
	y := (height - cardHeight) / 2
	if x < 0 {
		x = 0
	}
	if y < 0 {
		y = 0
	}

	for row := y + 1; row < y+cardHeight-1 && row < len(outLines); row++ {
		segment := ansi.Truncate(dropColumns(outLines[row], x), cardWidth, "")
		if strings.Contains(ansi.Strip(segment), "x") {
			t.Fatalf("base content leaked into popup row %d: %q", row, ansi.Strip(segment))
		}
	}
}
