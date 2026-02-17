package main

import "strings"

type widgetKind int

const (
	widgetNetCashflow widgetKind = iota
	widgetComposition
)

type widgetMode struct {
	id         string
	label      string
	viewType   string // line | area | bar | pie | table
	filterExpr string // custom mode expression; empty for curated defaults
	custom     bool
}

type widget struct {
	kind       widgetKind
	title      string
	jumpKey    string
	modes      []widgetMode
	activeMode int
}

const dashboardPaneCount = 2

func newDashboardWidgets(customModes []customPaneMode) []widget {
	widgets := []widget{
		{
			kind:    widgetNetCashflow,
			title:   "Net/Cashflow",
			jumpKey: "n",
			modes: []widgetMode{
				{id: "net_worth", label: "Net Worth", viewType: "line"},
				{id: "spending", label: "Spending", viewType: "line"},
			},
		},
		{
			kind:    widgetComposition,
			title:   "Composition",
			jumpKey: "c",
			modes: []widgetMode{
				{id: "category_share", label: "Category Share", viewType: "pie"},
				{id: "needs_wants_savings", label: "Needs/Wants/Savings", viewType: "pie"},
				{id: "top_merchants", label: "Top Merchants", viewType: "bar"},
			},
		},
	}

	for i := range widgets {
		paneID := dashboardPaneID(widgets[i].kind)
		custom, ok := dashboardCustomModeForPane(customModes, paneID)
		if !ok {
			continue
		}
		if !dashboardPaneCustomSlotActive(paneID) {
			continue
		}
		viewType := strings.ToLower(strings.TrimSpace(custom.ViewType))
		if viewType == "" {
			viewType = dashboardPanePrimaryViewType(widgets[i].kind)
		}
		widgets[i].modes = append(widgets[i].modes, widgetMode{
			id:         dashboardCustomModeID(custom.Name),
			label:      strings.TrimSpace(custom.Name),
			viewType:   viewType,
			filterExpr: strings.TrimSpace(custom.Expr),
			custom:     true,
		})
	}

	return widgets
}

func dashboardPaneID(kind widgetKind) string {
	switch kind {
	case widgetNetCashflow:
		return "net_cashflow"
	case widgetComposition:
		return "composition"
	default:
		return ""
	}
}

func dashboardPanePrimaryViewType(kind widgetKind) string {
	switch kind {
	case widgetNetCashflow:
		return "line"
	case widgetComposition:
		return "pie"
	default:
		return "line"
	}
}

func dashboardPaneCustomSlotActive(paneID string) bool {
	switch strings.ToLower(strings.TrimSpace(paneID)) {
	case "net_cashflow":
		return true
	default:
		return false
	}
}

func dashboardCustomModeForPane(customModes []customPaneMode, paneID string) (customPaneMode, bool) {
	target := strings.ToLower(strings.TrimSpace(paneID))
	for _, mode := range customModes {
		if strings.EqualFold(strings.TrimSpace(mode.Pane), target) {
			return mode, true
		}
	}
	return customPaneMode{}, false
}

func dashboardCustomModeID(name string) string {
	norm := strings.ToLower(strings.TrimSpace(name))
	if norm == "" {
		return "custom"
	}
	buf := strings.Builder{}
	for i := 0; i < len(norm); i++ {
		ch := norm[i]
		if (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') {
			buf.WriteByte(ch)
			continue
		}
		buf.WriteByte('_')
	}
	out := strings.Trim(buf.String(), "_")
	for strings.Contains(out, "__") {
		out = strings.ReplaceAll(out, "__", "_")
	}
	if out == "" {
		return "custom"
	}
	return "custom_" + out
}

func findWidgetModeIndexByID(w widget, id string) int {
	target := strings.TrimSpace(id)
	if target == "" {
		return -1
	}
	for i, mode := range w.modes {
		if strings.EqualFold(strings.TrimSpace(mode.id), target) {
			return i
		}
	}
	return -1
}

func dashboardWidgetIndexFromSection(section int) int {
	if section < sectionDashboardNetCashflow || section > sectionDashboardComposition {
		return -1
	}
	return section
}

func isDashboardAnalyticsSection(section int) bool {
	return dashboardWidgetIndexFromSection(section) >= 0
}
