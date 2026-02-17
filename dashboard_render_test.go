package main

import (
	"strings"
	"testing"

	"github.com/charmbracelet/x/ansi"
)

func TestDashboardViewRendersLowerAnalyticsGridPanes(t *testing.T) {
	m := newModel()
	m.ready = true
	m.activeTab = tabDashboard
	m.width = 120
	m.rows = testDashboardRows()
	m.dashWidgets = newDashboardWidgets(nil)

	out := m.dashboardView()
	if !strings.Contains(out, "Net/Cashflow") {
		t.Fatal("missing Net/Cashflow pane")
	}
	if !strings.Contains(out, "Composition") {
		t.Fatal("missing Composition pane")
	}
	if strings.Contains(out, "Compare Bars") {
		t.Fatal("unexpected Compare Bars pane")
	}
}

func TestDashboardAnalyticsLayoutWideUsesSixtyFortySplitWithOneGap(t *testing.T) {
	m := newModel()
	m.ready = true
	m.activeTab = tabDashboard
	m.width = 120
	m.rows = testDashboardRows()
	m.dashWidgets = newDashboardWidgets(nil)

	out := m.dashboardView()
	lines := strings.Split(out, "\n")
	found := false
	for _, line := range lines {
		plain := ansi.Strip(line)
		if strings.Contains(plain, "Net/Cashflow") && strings.Contains(plain, "Composition") {
			netAt := strings.Index(plain, "Net/Cashflow")
			compAt := strings.Index(plain, "Composition")
			if netAt < 0 || compAt < 0 {
				continue
			}
			if compAt-netAt < 60 {
				t.Fatalf("expected wide 60:40 split; title offset too small in %q", plain)
			}
			found = true
			break
		}
	}
	if !found {
		t.Fatal("expected Net/Cashflow and Composition side-by-side in wide layout")
	}
}

func TestDashboardAnalyticsGridNarrowFallbackStacksPanes(t *testing.T) {
	m := newModel()
	m.ready = true
	m.activeTab = tabDashboard
	m.width = 70
	m.rows = testDashboardRows()
	m.dashWidgets = newDashboardWidgets(nil)

	out := m.dashboardView()
	lines := strings.Split(out, "\n")
	for _, line := range lines {
		plain := ansi.Strip(line)
		if strings.Contains(plain, "Net/Cashflow") && strings.Contains(plain, "Composition") {
			t.Fatalf("unexpected side-by-side pane titles in narrow fallback: %q", plain)
		}
	}
}

func TestDashboardFocusedPaneShowsActiveTitleMarker(t *testing.T) {
	m := newModel()
	m.ready = true
	m.activeTab = tabDashboard
	m.width = 120
	m.rows = testDashboardRows()
	m.dashWidgets = newDashboardWidgets(nil)
	m.focusedSection = sectionDashboardNetCashflow

	out := m.dashboardView()
	lines := strings.Split(ansi.Strip(out), "\n")
	found := false
	for _, line := range lines {
		if !strings.Contains(line, "Net/Cashflow [N] ·") {
			continue
		}
		found = true
		if !strings.Contains(line, "*") {
			t.Fatalf("expected focused pane title marker in line %q", line)
		}
		break
	}
	if !found {
		t.Fatalf("expected net pane title line in output")
	}
}

func TestDashboardPaneLayoutUsesFortyPercentViewportHeight(t *testing.T) {
	m := newModel()
	m.height = 60

	spec := dashboardPaneLayoutSpecFor(m, widgetNetCashflow)
	if spec.chartHeight != 24 {
		t.Fatalf("chartHeight = %d, want 24", spec.chartHeight)
	}
	if spec.minLines != 24 {
		t.Fatalf("minLines = %d, want 24", spec.minLines)
	}
}
