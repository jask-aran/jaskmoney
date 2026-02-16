package app

import (
	"jaskmoney-v2/core"
	"jaskmoney-v2/core/widgets"
)

func NewDashboardTab() core.Tab {
	specs := []core.PaneSpec{
		{ID: "date-picker", Title: "Date Picker", Scope: "pane:dashboard:date-picker", JumpKey: 'd', Focusable: false, Text: "", Height: 3},
		{ID: "overview", Title: "Overview", Scope: "pane:dashboard:overview", JumpKey: 'o', Focusable: true, Text: "", Height: 6},
		{ID: "spending-tracker", Title: "Spending Tracker", Scope: "pane:dashboard:spending-tracker", JumpKey: 't', Focusable: true, Text: "", Height: 10},
		{ID: "spending-by-category", Title: "Spending by Category", Scope: "pane:dashboard:spending-by-category", JumpKey: 'c', Focusable: true, Text: "", Height: 10},
	}
	layout := func(host *core.PaneHost, m *core.Model) widgets.Widget {
		charts := widgets.HStack{
			Widgets: []widgets.Widget{
				host.BuildPane("spending-tracker", m),
				host.BuildPane("spending-by-category", m),
			},
			Ratios: []float64{0.6, 0.4},
			Gap:    1,
		}
		return widgets.VStack{
			Widgets: []widgets.Widget{
				host.BuildPane("date-picker", m),
				host.BuildPane("overview", m),
				charts,
			},
			Ratios: []float64{0.12, 0.24, 0.64},
		}
	}
	return core.NewGeneratedTab("dashboard", "Dashboard", specs, layout)
}

func NewManagerTab() core.Tab {
	specs := []core.PaneSpec{
		{ID: "accounts", Title: "Accounts", Scope: "pane:manager:accounts", JumpKey: 'a', Focusable: true, Factory: func(spec core.PaneSpec) core.Pane {
			return NewManagerAccountsPane(spec.ID, spec.Title, spec.Scope, spec.JumpKey, spec.Focusable)
		}},
		{ID: "transactions", Title: "Transactions", Scope: "pane:manager:transactions", JumpKey: 't', Focusable: true, Factory: func(spec core.PaneSpec) core.Pane {
			return widgets.NewTransactionPane(spec.ID, spec.Title, spec.Scope, spec.JumpKey, spec.Focusable)
		}},
	}
	layout := func(host *core.PaneHost, m *core.Model) widgets.Widget {
		return widgets.VStack{
			Widgets: []widgets.Widget{host.BuildPane("accounts", m), host.BuildPane("transactions", m)},
			Ratios:  []float64{0.25, 0.75},
		}
	}
	return core.NewGeneratedTab("manager", "Manager", specs, layout)
}

func NewBudgetTab() core.Tab {
	specs := []core.PaneSpec{
		{ID: "category-budgets", Title: "Category Budgets", Scope: "pane:budget:category-budgets", JumpKey: 'c', Focusable: true, Text: "", Height: 8},
		{ID: "spending-targets", Title: "Spending Targets", Scope: "pane:budget:spending-targets", JumpKey: 't', Focusable: true, Text: "", Height: 8},
		{ID: "analytics", Title: "Analytics", Scope: "pane:budget:analytics", JumpKey: 'a', Focusable: true, Text: "", Height: 5},
	}
	layout := func(host *core.PaneHost, m *core.Model) widgets.Widget {
		return widgets.VStack{
			Widgets: []widgets.Widget{
				host.BuildPane("category-budgets", m),
				host.BuildPane("spending-targets", m),
				host.BuildPane("analytics", m),
			},
			Ratios: []float64{0.38, 0.38, 0.24},
		}
	}
	return core.NewGeneratedTab("budget", "Budget", specs, layout)
}

func NewSettingsTab() core.Tab {
	specs := []core.PaneSpec{
		{ID: "categories", Title: "Categories", Scope: "pane:settings:categories", JumpKey: 'c', Focusable: true, Text: "", Height: 5},
		{ID: "tags", Title: "Tags", Scope: "pane:settings:tags", JumpKey: 't', Focusable: true, Text: "", Height: 5},
		{ID: "rules", Title: "Rules", Scope: "pane:settings:rules", JumpKey: 'r', Focusable: true, Text: "", Height: 6},
		{ID: "filters", Title: "Filters", Scope: "pane:settings:filters", JumpKey: 'f', Focusable: true, Text: "", Height: 5},
		{ID: "chart", Title: "Chart", Scope: "pane:settings:chart", JumpKey: 'h', Focusable: true, Text: "", Height: 5},
		{ID: "database", Title: "Database", Scope: "pane:settings:database", JumpKey: 'd', Focusable: true, Text: "", Height: 5},
		{ID: "import-history", Title: "Import History", Scope: "pane:settings:import-history", JumpKey: 'i', Focusable: true, Text: "", Height: 5},
	}
	layout := func(host *core.PaneHost, m *core.Model) widgets.Widget {
		left := widgets.VStack{
			Widgets: []widgets.Widget{
				host.BuildPane("categories", m),
				host.BuildPane("tags", m),
				host.BuildPane("rules", m),
				host.BuildPane("filters", m),
			},
			Ratios: []float64{0.23, 0.23, 0.31, 0.23},
		}
		right := widgets.VStack{
			Widgets: []widgets.Widget{
				host.BuildPane("chart", m),
				host.BuildPane("database", m),
				host.BuildPane("import-history", m),
			},
			Ratios: []float64{0.34, 0.33, 0.33},
		}
		return widgets.HStack{
			Widgets: []widgets.Widget{left, right},
			Ratios:  []float64{0.55, 0.45},
			Gap:     1,
		}
	}
	return core.NewGeneratedTab("settings", "Settings", specs, layout)
}
