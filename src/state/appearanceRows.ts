import { DEFAULT_THEME, THEMES } from "../themes"
import { CHART_LABEL_LABELS, CHART_MOTION_LABELS, CHART_SPEEDS, DEFAULT_CHART_LABELS, DEFAULT_CHART_MOTION, DEFAULT_CHART_SPEED } from "../ui/charts/motion"
import { BACKDROPS, DEFAULT_BACKDROP } from "../ui/welcome/backdrop"
import { DEFAULT_OPEN_RANGE, OPEN_RANGE_LABELS } from "../domain/timeframe"
import type { UiPrefs } from "./settingsConfig"

/** Approved port deviation: display settings live in Appearance. */
export type AppearanceRow = "theme" | "icons" | "xAxis" | "chartMotion" | "chartSpeed" | "chartLabels" | "openRange" | "backdrop"
export const APPEARANCE_ROWS: readonly AppearanceRow[] = ["theme", "icons", "xAxis", "chartMotion", "chartSpeed", "chartLabels", "openRange", "backdrop"]
export type AppearanceRowContext = Pick<UiPrefs, "theme" | "xAxis" | "chartMotion" | "chartSpeed" | "chartLabels" | "openRange" | "backdrop"> & { icons: boolean }

/** A row's label and value; for a choice, which of how many it is (a
 * toggle's on or off as `on`). */
export interface AppearanceRowView { label: string; value: string; on?: boolean; choice?: { index: number; count: number } }

export function appearanceRow(row: AppearanceRow, ctx: AppearanceRowContext): AppearanceRowView {
  const view = appearanceLabel(row, ctx)
  const pick = <T,>(all: readonly T[], at: (item: T) => boolean) => ({ index: Math.max(0, all.findIndex(at)), count: all.length })
  switch (row) {
    case "theme": return view
    case "icons": return { ...view, on: ctx.icons }
    case "xAxis": return { ...view, on: !!ctx.xAxis }
    case "chartMotion": return { ...view, choice: pick(Object.keys(CHART_MOTION_LABELS), (id) => id === (ctx.chartMotion ?? DEFAULT_CHART_MOTION)) }
    case "chartSpeed": return { ...view, choice: pick(CHART_SPEEDS, (speed) => speed.id === (ctx.chartSpeed ?? DEFAULT_CHART_SPEED)) }
    case "chartLabels": return { ...view, choice: pick(Object.keys(CHART_LABEL_LABELS), (id) => id === (ctx.chartLabels ?? DEFAULT_CHART_LABELS)) }
    case "openRange": return { ...view, choice: pick(Object.keys(OPEN_RANGE_LABELS), (id) => id === (ctx.openRange ?? DEFAULT_OPEN_RANGE)) }
    case "backdrop": return { ...view, choice: pick(BACKDROPS, (backdrop) => backdrop.id === (ctx.backdrop ?? DEFAULT_BACKDROP)) }
  }
}

function appearanceLabel(row: AppearanceRow, ctx: AppearanceRowContext): { label: string; value: string } {
  switch (row) {
    case "theme": return { label: "Theme", value: themeName(ctx.theme) }
    case "icons": return { label: "Category icons", value: ctx.icons ? "on (Nerd Font)" : "off" }
    case "xAxis": return { label: "Charts' $0 line", value: ctx.xAxis ? "on" : "off" }
    case "chartMotion": return { label: "Chart animation", value: CHART_MOTION_LABELS[ctx.chartMotion ?? DEFAULT_CHART_MOTION] }
    case "chartSpeed": return { label: "Animation speed", value: CHART_SPEEDS.find((speed) => speed.id === (ctx.chartSpeed ?? DEFAULT_CHART_SPEED))!.label }
    case "chartLabels": return { label: "Chart labels", value: CHART_LABEL_LABELS[ctx.chartLabels ?? DEFAULT_CHART_LABELS] }
    case "openRange": return { label: "Range on open", value: OPEN_RANGE_LABELS[ctx.openRange ?? DEFAULT_OPEN_RANGE] }
    case "backdrop": return { label: "Welcome backdrop", value: BACKDROPS.find((backdrop) => backdrop.id === (ctx.backdrop ?? DEFAULT_BACKDROP))!.label }
  }
}

/** A theme's name by id (the default's for none or an unknown one). */
export function themeName(id: string | undefined): string {
  return (THEMES.find((t) => t.id === id) ?? THEMES.find((t) => t.id === DEFAULT_THEME)!).name
}
