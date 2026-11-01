import { CHART_LABEL_LABELS, CHART_MOTION_LABELS, CHART_SPEEDS, DEFAULT_CHART_LABELS, DEFAULT_CHART_MOTION, DEFAULT_CHART_SPEED } from "../ui/charts/motion"
import { BACKDROPS, DEFAULT_BACKDROP } from "../ui/welcome/backdrop"
import type { UiPrefs } from "./settingsConfig"

/** Approved port deviation: display settings live in Appearance. */
export type AppearanceRow = "icons" | "xAxis" | "chartMotion" | "chartSpeed" | "chartLabels" | "backdrop"
export const APPEARANCE_ROWS: readonly AppearanceRow[] = ["icons", "xAxis", "chartMotion", "chartSpeed", "chartLabels", "backdrop"]
export type AppearanceRowContext = Pick<UiPrefs, "xAxis" | "chartMotion" | "chartSpeed" | "chartLabels" | "backdrop"> & { icons: boolean }

export function appearanceRow(row: AppearanceRow, ctx: AppearanceRowContext): { label: string; value: string } {
  switch (row) {
    case "icons": return { label: "Category icons", value: ctx.icons ? "on (Nerd Font)" : "off" }
    case "xAxis": return { label: "Charts' $0 line", value: ctx.xAxis ? "on" : "off" }
    case "chartMotion": return { label: "Chart animation", value: CHART_MOTION_LABELS[ctx.chartMotion ?? DEFAULT_CHART_MOTION] }
    case "chartSpeed": return { label: "Animation speed", value: CHART_SPEEDS.find((speed) => speed.id === (ctx.chartSpeed ?? DEFAULT_CHART_SPEED))!.label }
    case "chartLabels": return { label: "Chart labels", value: CHART_LABEL_LABELS[ctx.chartLabels ?? DEFAULT_CHART_LABELS] }
    case "backdrop": return { label: "Welcome backdrop", value: BACKDROPS.find((backdrop) => backdrop.id === (ctx.backdrop ?? DEFAULT_BACKDROP))!.label }
  }
}
