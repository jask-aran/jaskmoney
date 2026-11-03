import { normaliseSelection } from "../domain/accountTree"
import type { CycleConfig } from "../domain/budget"
import { DEFAULT_OPEN_RANGE, LOOKBACKS, PERIODS, activeChipIndex, applyChip, customRange, defaultTimeframe } from "../domain/timeframe"
import type { Account } from "../domain/types"
import { CHART_VIEWS, chartViewsFrom } from "./uiStore"
import type { UiPrefs } from "./settingsConfig"

/** Approved deviation: open on the chosen range; "last" keeps the legacy restore. */
export function restoreUiPrefs(prefs: UiPrefs, accounts: Account[], now: Date, cycle: CycleConfig) {
  let timeframe = defaultTimeframe(now, cycle)
  const openRange = prefs.openRange ?? DEFAULT_OPEN_RANGE
  if (openRange === "last" && prefs.timeframe) {
    const saved = prefs.timeframe
    const range = saved.custom ? customRange(saved.custom.start, saved.custom.end) : null
    const custom = typeof range === "string" ? null : range
    timeframe = { ...timeframe, ...saved, custom }
    if (saved.family === "custom" && !custom) timeframe = { ...timeframe, family: "period" }
    timeframe = applyChip(timeframe, activeChipIndex(timeframe), now, cycle)
  }
  if (openRange !== "last") {
    // The custom chip keeps its last range, whichever range opens.
    const saved = prefs.timeframe?.custom ? customRange(prefs.timeframe.custom.start, prefs.timeframe.custom.end) : null
    if (saved && typeof saved !== "string") timeframe = { ...timeframe, custom: saved }
    const index = openRange === "cycle" || openRange === "month"
      ? LOOKBACKS.length + PERIODS.indexOf(openRange)
      : LOOKBACKS.indexOf(openRange)
    timeframe = applyChip(timeframe, index, now, cycle)
  }
  const accountSelection = normaliseSelection(accounts, prefs.accountSelection ?? "all")
  const chartViews = chartViewsFrom(prefs.chartViews, CHART_VIEWS.length)
  return { timeframe, accountSelection, chartViews }
}
