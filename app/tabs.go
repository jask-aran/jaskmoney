package app

import (
	"jaskmoney-v2/core"
	"jaskmoney-v2/core/widgets"
)

func NewDashboardTab() core.Tab {
	specs := []core.PaneSpec{
		{ID: "date-picker", Title: "Date Picker", Scope: "pane:dashboard:date-picker", JumpKey: 'd', Focusable: true},
		{ID: "overview", Title: "Overview", Scope: "pane:dashboard:overview", JumpKey: 'o', Focusable: true},
		{ID: "spending-tracker", Title: "Spending Tracker", Scope: "pane:dashboard:spending-tracker", JumpKey: 't', Focusable: true},
		{ID: "spending-by-category", Title: "Spending by Category", Scope: "pane:dashboard:spending-by-category", JumpKey: 'c', Focusable: true},
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
		{ID: "accounts", Title: "Accounts", Scope: "pane:manager:accounts", JumpKey: 'a', Focusable: true},
		{ID: "transactions", Title: "Transactions", Scope: "pane:manager:transactions", JumpKey: 't', Focusable: true},
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
		{ID: "category-budgets", Title: "Category Budgets", Scope: "pane:budget:category-budgets", JumpKey: 'c', Focusable: true},
		{ID: "spending-targets", Title: "Spending Targets", Scope: "pane:budget:spending-targets", JumpKey: 't', Focusable: true},
		{ID: "analytics", Title: "Analytics", Scope: "pane:budget:analytics", JumpKey: 'a', Focusable: true},
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
		{ID: "categories-tags", Title: "Categories & Tags", Scope: "pane:settings:categories-tags", JumpKey: 'c', Focusable: true},
		{ID: "rules", Title: "Rules", Scope: "pane:settings:rules", JumpKey: 'r', Focusable: true},
		{ID: "filters", Title: "Filters", Scope: "pane:settings:filters", JumpKey: 'f', Focusable: true},
		{ID: "chart", Title: "Chart", Scope: "pane:settings:chart", JumpKey: 'h', Focusable: true},
		{ID: "database", Title: "Database", Scope: "pane:settings:database", JumpKey: 'd', Focusable: true},
		{ID: "import-history", Title: "Import History", Scope: "pane:settings:import-history", JumpKey: 'i', Focusable: true},
	}
	layout := func(host *core.PaneHost, m *core.Model) widgets.Widget {
		left := widgets.VStack{
			Widgets: []widgets.Widget{
				host.BuildPane("categories-tags", m),
				host.BuildPane("rules", m),
				host.BuildPane("filters", m),
			},
			Ratios: []float64{0.46, 0.31, 0.23},
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
			Ratios:  []float64{0.60, 0.40},
			Gap:     1,
		}
	}
	return core.NewGeneratedTab("settings", "Settings", specs, layout)
}
