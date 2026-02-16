package widgets

import (
	"strings"
	"testing"
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
