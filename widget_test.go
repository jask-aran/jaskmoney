package main

import "testing"

func TestNewDashboardWidgetsIncludesCanonicalPanes(t *testing.T) {
	widgets := newDashboardWidgets(nil)
	if len(widgets) != 2 {
		t.Fatalf("widget count = %d, want 2", len(widgets))
	}

	if widgets[0].kind != widgetNetCashflow || widgets[0].jumpKey != "n" {
		t.Fatalf("widget[0] = %+v, want net cashflow / n", widgets[0])
	}
	if widgets[1].kind != widgetComposition || widgets[1].jumpKey != "c" {
		t.Fatalf("widget[1] = %+v, want composition / c", widgets[1])
	}
	for i, pane := range widgets {
		if len(pane.modes) == 0 {
			t.Fatalf("widget[%d] has no modes", i)
		}
		if pane.activeMode != 0 {
			t.Fatalf("widget[%d] activeMode = %d, want 0", i, pane.activeMode)
		}
		for _, mode := range pane.modes {
			if !isKnownDashboardViewType(mode.viewType) {
				t.Fatalf("widget[%d] mode %q has invalid canonical view type %q", i, mode.id, mode.viewType)
			}
		}
	}
	if idx := findWidgetModeIndexByID(widgets[0], "burn_runway"); idx >= 0 {
		t.Fatalf("burn_runway mode should be removed, got index %d", idx)
	}
	if idx := findWidgetModeIndexByID(widgets[0], "savings_rate"); idx >= 0 {
		t.Fatalf("savings_rate mode should be removed, got index %d", idx)
	}
	if idx := findWidgetModeIndexByID(widgets[1], "recurring_share"); idx >= 0 {
		t.Fatalf("recurring_share mode should be removed, got index %d", idx)
	}
}

func TestNewDashboardWidgetsCustomSlotActivationNetOnly(t *testing.T) {
	custom := []customPaneMode{
		{Pane: "net_cashflow", Name: "Renovation", Expr: "cat:Home AND amt:<0", ViewType: "line"},
		{Pane: "composition", Name: "Dining", Expr: "cat:Dining", ViewType: "pie"},
	}
	widgets := newDashboardWidgets(custom)
	if len(widgets) != 2 {
		t.Fatalf("widget count = %d, want 2", len(widgets))
	}

	net := widgets[0]
	if len(net.modes) != 3 {
		t.Fatalf("net mode count = %d, want 3 (2 curated + 1 custom)", len(net.modes))
	}
	last := net.modes[len(net.modes)-1]
	if !last.custom {
		t.Fatalf("last net mode should be custom, got %+v", last)
	}
	if last.filterExpr == "" {
		t.Fatalf("custom net mode filterExpr should be set")
	}

	for i := 1; i < len(widgets); i++ {
		for _, mode := range widgets[i].modes {
			if mode.custom {
				t.Fatalf("widget[%d] should not activate custom mode in phase 6, got %+v", i, mode)
			}
		}
	}
}

func TestNewDashboardWidgetsCustomModeInheritsPrimaryViewType(t *testing.T) {
	widgets := newDashboardWidgets([]customPaneMode{
		{Pane: "net_cashflow", Name: "Custom Burn", Expr: "cat:Utilities AND amt:<0", ViewType: ""},
	})
	if len(widgets) == 0 || len(widgets[0].modes) == 0 {
		t.Fatal("expected net widget with modes")
	}
	custom := widgets[0].modes[len(widgets[0].modes)-1]
	if !custom.custom {
		t.Fatalf("expected final net mode to be custom, got %+v", custom)
	}
	if custom.viewType != "line" {
		t.Fatalf("custom viewType = %q, want inherited primary line", custom.viewType)
	}
}
