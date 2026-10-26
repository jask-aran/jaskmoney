import { normaliseSelection } from "../domain/accountTree"
import type { CycleConfig } from "../domain/budget"
import { activeChipIndex, applyChip, customRange, defaultTimeframe } from "../domain/timeframe"
import type { Account } from "../domain/types"
import { CHART_VIEWS } from "./uiStore"
import type { UiPrefs } from "./settingsConfig"

/** Periods reopen on today's instance; the last custom range survives every family. */
export function restoreUiPrefs(prefs: UiPrefs, accounts: Account[], now: Date, cycle: CycleConfig) {
  let timeframe = defaultTimeframe(now, cycle)
  if (prefs.timeframe) {
    const saved = prefs.timeframe
    const range = saved.custom ? customRange(saved.custom.start, saved.custom.end) : null
    const custom = typeof range === "string" ? null : range
    timeframe = { ...timeframe, ...saved, custom }
    if (saved.family === "custom" && !custom) timeframe = { ...timeframe, family: "period" }
    timeframe = applyChip(timeframe, activeChipIndex(timeframe), now, cycle)
  }
  const accountSelection = normaliseSelection(accounts, prefs.accountSelection ?? "all")
  const chartViews = prefs.chartViews?.every((i) => Number.isInteger(i) && i >= 0 && i < CHART_VIEWS.length) && prefs.chartViews.length === 2 ? prefs.chartViews : undefined
  return { timeframe, accountSelection, chartViews }
}
