import { categoryIcon } from "../domain/categoryIcons"
import { data } from "../state/dataStore"

/** The marker shown before a category name: its Nerd Font icon when icons
 * are on and one is known, otherwise a dot (hollow for uncategorised). */
export function categoryMark(categoryId: number | null | undefined, muted = false): string {
  if (data.state.icons) {
    const icon = categoryIcon(data.state.categories.find((c) => c.id === categoryId), data.state.categories)
    if (icon) return icon
  }
  return muted ? "○" : "●"
}

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
