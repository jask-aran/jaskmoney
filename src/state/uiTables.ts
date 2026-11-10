import type { UiState, TabId, SectionId, SettingsSection, ChartViews } from "./uiStore"

type SettingsList = UiState["taxonomyList"]

interface JumpTarget {
  key: string
  section: SectionId
  label: string
}

export const SETTINGS_SECTIONS: SettingsSection[] = ["taxonomy", "rules", "up", "ai", "appearance", "database"]
export const SETTINGS_RIGHT: SettingsSection[] = ["up", "ai", "appearance", "database"]

export const SETTINGS_SECTION_LABELS: Record<SettingsSection, string> = {
  taxonomy: "Taxonomy", ai: "AI models", rules: "Rules",
  filters: "Saved Filters", up: "Up Bank", appearance: "Appearance", database: "Database & Import",
}

export function settingsSectionFocus(section: SettingsSection, list: SettingsList = "categories"): SectionId {
  if (section === "taxonomy") return list === "categories" ? "set.categories" : "set.tags"
  return section === "rules" ? "set.rules" : section === "filters" ? "set.filters" : section === "up" ? "set.up" : section === "ai" ? "set.ai" : section === "appearance" ? "set.appearance" : "set.database"
}
export const TAB_DEFAULT_FOCUS: Record<TabId, SectionId> = {
  overview: "none",
  manager: "mgr.transactions",
  budgets: "bud.categories",
  settings: "none",
}

export const CHART_SECTIONS = ["ov.chart", "ov.chart2", "ov.chart3", "ov.chart4"] as const
export const chartPaneOf = (section: SectionId) => (CHART_SECTIONS as readonly SectionId[]).indexOf(section)
export const DEFAULT_CHART_VIEWS: ChartViews = [0, 4, 7, 8]
export function chartViewsFrom(raw: unknown, views: number): ChartViews | undefined {
  if (!Array.isArray(raw) || (raw.length !== 2 && raw.length !== 4)) return undefined
  if (!raw.every((i) => Number.isSafeInteger(i) && i >= 0 && i < views)) return undefined
  return [raw[0], raw[1], raw[2] ?? DEFAULT_CHART_VIEWS[2], raw[3] ?? DEFAULT_CHART_VIEWS[3]]
}

export const CHART_VIEWS = [
  { view: "Cumulative", title: "Cumulative spending", group: "Spending", ranged: true },
  { view: "Daily", title: "Daily spending", group: "Spending", ranged: true },
  { view: "Weekly", title: "Weekly spending", group: "Spending", ranged: true },
  { view: "Cash flow", title: "Cash flow", group: "Cash flow", ranged: true },
  { view: "Net position", title: "Net position", group: "Balances", ranged: true },
  { view: "Available", title: "Available", group: "Balances", ranged: true },
  { view: "Savers", title: "Saver balances", group: "Balances", ranged: true },
  { view: "Calendar", title: "Spending calendar", group: "Calendar", ranged: true },
  { view: "Merchants", title: "Merchants", group: "Merchants", ranged: true },
  { view: "Trends", title: "Spending trends", group: "Trends", ranged: true },
] as const

export const BUDGET_VIEWS = [
  ...CHART_VIEWS.filter((v) => v.group === "Spending"),
  { view: "Subscriptions", title: "Subscriptions", group: "Subscriptions", ranged: false },
  { view: "Each cycle", title: "Each cycle", group: "Each cycle", ranged: false },
] as const

export const CYCLE_VIEWS: readonly number[] = CHART_VIEWS.flatMap((v, i) => (v.group === "Spending" || v.view === "Calendar" ? [] : [i]))

export const BUDGET_PANES: readonly SectionId[] = ["bud.chart", "bud.cycle", "bud.cycle2"]

export const CATEGORIES = -1
export function cycleViewsFor(pane: number): readonly number[] {
  return pane === 0 ? [CATEGORIES, ...CYCLE_VIEWS] : CYCLE_VIEWS
}
export function cycleView(index: number): { view: string; title: string; group: string } {
  return index === CATEGORIES ? { view: "Categories", title: "Categories", group: "Categories" } : CHART_VIEWS[index] ?? CHART_VIEWS[0]
}
export function budgetListInPane(state: Pick<UiState, "budgetCyclePanes" | "budgetCycleViews">): boolean {
  return state.budgetCyclePanes > 0 && state.budgetCycleViews[0] === CATEGORIES
}
export function budgetsHome(state: Pick<UiState, "budgetCyclePanes">): SectionId {
  return state.budgetCyclePanes === 0 ? "bud.categories" : "bud.plan"
}

export function jumpTargets(state: Pick<UiState, "activeTab" | "overviewCharts"> & Partial<Pick<UiState, "budgetCyclePanes" | "budgetCycleViews" | "chartViews">>): JumpTarget[] {
  const targets = JUMP_TARGETS[state.activeTab]
  if (state.activeTab === "overview") {
    const n = state.overviewCharts
    const places = n === 1 ? ["Chart"] : n === 2 ? ["Top chart", "Bottom chart"] : ["Top left chart", "Bottom left chart", "Top right chart", "Bottom right chart"]
    return targets.filter((t) => chartPaneOf(t.section) < n).map((t) => {
      const pane = chartPaneOf(t.section)
      if (pane < 0) return t
      const view = state.chartViews ? CHART_VIEWS[state.chartViews[pane] ?? 0]?.title : undefined
      return { ...t, label: view ? `${places[pane]} · ${view}` : places[pane]! }
    })
  }
  if (state.activeTab === "budgets") {
    const panes = state.budgetCyclePanes ?? 1
    const list = panes > 0 && (state.budgetCycleViews ?? [CATEGORIES])[0] === CATEGORIES
    return targets.filter((t) => {
      if (t.section === "bud.plan") return panes > 0
      if (t.section === "bud.categories") return panes === 0 || list
      if (t.section === "bud.cycle") return panes > 0 && !list
      if (t.section === "bud.cycle2") return panes > 1
      return true
    })
  }
  return targets
}

const JUMP_TARGETS: Record<TabId, JumpTarget[]> = {
  overview: [
    { key: "d", section: "ov.range", label: "Date Range" },
    { key: "t", section: "ov.chart", label: "Top chart" },
    { key: "b", section: "ov.chart2", label: "Bottom chart" },
    { key: "y", section: "ov.chart3", label: "Top right chart" },
    { key: "n", section: "ov.chart4", label: "Bottom right chart" },
    { key: "a", section: "ov.accounts", label: "Accounts" },
    { key: "r", section: "ov.categories", label: "Range" },
  ],
  manager: [
    { key: "a", section: "mgr.accounts", label: "Accounts" },
    { key: "t", section: "mgr.transactions", label: "Transactions" },
  ],
  budgets: [
    { key: "c", section: "bud.categories", label: "Categories" },
    { key: "b", section: "bud.plan", label: "Budgets" },
    { key: "t", section: "bud.chart", label: "Budget chart" },
    { key: "y", section: "bud.cycle", label: "Cycle chart" },
    { key: "n", section: "bud.cycle2", label: "Second cycle chart" },
  ],
  settings: [
    { key: "c", section: "set.categories", label: "Categories" },
    { key: "t", section: "set.tags", label: "Tags" },
    { key: "r", section: "set.rules", label: "Rules" },
    { key: "f", section: "set.filters", label: "Filters" },
    { key: "u", section: "set.up", label: "Up Bank" },
    { key: "a", section: "set.ai", label: "AI models" },
    { key: "p", section: "set.appearance", label: "Appearance" },
    { key: "d", section: "set.database", label: "Database & Import" },
  ],
}

export const TABS: { id: TabId; label: string; hotkey: string }[] = [
  { id: "overview", label: "Overview", hotkey: "1" },
  { id: "manager", label: "Transactions", hotkey: "2" },
  { id: "budgets", label: "Budgets", hotkey: "3" },
  { id: "settings", label: "Settings", hotkey: "4" },
]
