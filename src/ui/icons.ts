import { categoryIcon } from "../domain/categoryIcons"
import { unwrap } from "solid-js/store"
import { data } from "../state/dataStore"
import { lazyMemo } from "../client/lazyMemo"

/** The marker shown before a category name: its Nerd Font icon when icons
 * are on and one is known, otherwise a dot (hollow for uncategorised). */
export function categoryMark(categoryId: number | null | undefined, muted = false): string {
  if (data.state.icons) {
    const icon = icons().get(categoryId ?? -1)
    if (icon) return icon
  }
  return muted ? "○" : "●"
}

/** Each category's icon, worked out once per change of the categories
 * rather than per row drawn (a search of the store's categories each). */
const icons = lazyMemo(() => {
  const categories = unwrap(data.state.categories)
  void data.state.categories.length
  return new Map(categories.flatMap((c) => { const icon = categoryIcon(c, categories); return icon ? [[c.id, icon] as const] : [] }))
})

/** The Overview chart views' icons (Font Awesome 4 in Nerd Fonts). */
const VIEW_ICONS: Record<string, string> = {
  Cumulative: "\uf201", // line-chart
  Daily: "\uf080", // bar-chart
  Weekly: "\uf0db", // columns
  "Cash flow": "\uf0ec", // exchange
  "Net position": "\uf19c", // university
  Available: "\uf09d", // credit-card
  Savers: "\uf0d6", // money
  Calendar: "\uf073", // calendar
  Merchants: "\uf07a", // shopping-cart
  Trends: "\uf1fe", // area-chart
  // The Budgets tab's regular payments.
  Subscriptions: "\uf021", // refresh
  // The Budgets tab's cycle by cycle (its Cumulative shares the Overview's).
  Cycles: "\uf080", // bar-chart
}

/** A chart view's mark in the pane's view picker: its icon when icons are
 * on, otherwise a dot (filled for the current view). */
export function viewMark(view: string, current: boolean): string {
  if (data.state.icons && VIEW_ICONS[view]) return VIEW_ICONS[view]!
  return current ? "●" : "○"
}

/** Marks for the Transactions accounts pane, shared with the chart views
 * that show the same figures: a bank's net position, a spending account,
 * savers. Empty when icons are off. */
export function accountMark(kind: "net" | "spending" | "savers"): string {
  if (!data.state.icons) return ""
  return VIEW_ICONS[kind === "net" ? "Net position" : kind === "spending" ? "Available" : "Savers"]!
}

/** Settings rows' icons (Font Awesome 4 in Nerd Fonts), by what the row is. */
const SETTING_ICONS = {
  token: "", // key
  sync: "", // refresh
  accounts: "", // university
  setup: "", // magic
  web: "", // globe
  tui: "", // terminal
  theme: "", // paint-brush
  icons: "", // tags
  xAxis: "", // line-chart
  chartMotion: "", // play
  chartSpeed: "", // dashboard
  chartCurve: "", // area-chart
  chartLabels: "", // tag
  openRange: "", // calendar
  backdrop: "", // picture-o
  database: "", // database
  import: "", // upload
  history: "", // history
  profiles: "", // tasks
  weekStart: "", // calendar-o
  demo: "", // flask
  clearData: "", // trash
  reset: "", // warning
  rule: "", // bolt
  filter: "", // filter
} as const
export type SettingIcon = keyof typeof SETTING_ICONS

/** A Settings row's mark: its icon when icons are on, else `fallback` (a
 * status dot, or nothing for a row whose mark is only decoration). */
export function settingMark(icon: SettingIcon, fallback = ""): string {
  return data.state.icons ? SETTING_ICONS[icon] : fallback
}
