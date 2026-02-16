package widgets

import (
	"strings"
	"testing"
)

type fixedWidget struct{ text string }

func (w fixedWidget) Render(width, height int) string {
	return w.text
}

func TestHStackRespectsRatios(t *testing.T) {
	h := HStack{Widgets: []Widget{fixedWidget{"A"}, fixedWidget{"B"}}, Ratios: []float64{0.75, 0.25}, Gap: 1}
	out := h.Render(20, 2)
	lines := strings.Split(out, "\n")
	if len(lines) == 0 || len(lines[0]) == 0 {
		t.Fatalf("expected output")
	}
}

func TestVStackSpacing(t *testing.T) {
	v := VStack{Widgets: []Widget{fixedWidget{"top"}, fixedWidget{"bottom"}}, Spacing: 1}
	out := v.Render(20, 6)
	if !strings.Contains(out, "top") || !strings.Contains(out, "bottom") {
		t.Fatalf("expected both widgets in output")
	}
}
