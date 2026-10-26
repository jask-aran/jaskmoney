import { describe, expect, test } from "bun:test"
import { MONTHLY_CYCLE, defaultTimeframe } from "../domain/timeframe"
import { CHART_VIEWS } from "./uiStore"
import { restoreUiPrefs } from "./uiPrefs"

const now = new Date(2026, 9, 26)
const custom = { start: "2025-01-01", end: "2025-01-10" }
const saved = { family: "period", lookback: "3M", period: "month", custom } as const

describe("restore UI preferences", () => {
  test("reanchors saved periods on today and retains the last custom range", () => {
    const restored = restoreUiPrefs({ timeframe: saved }, [], now, MONTHLY_CYCLE)
    expect(restored.timeframe).toEqual({ ...saved, periodAnchor: "2026-10-01" })
    const cycle = { unit: "month", anchor: "date", anchorDate: "2026-01-15" } as const
    expect(restoreUiPrefs({ timeframe: { ...saved, period: "cycle" } }, [], now, cycle).timeframe.periodAnchor).toBe("2026-10-15")
  })

  test("restores lookbacks and custom without changing the custom dates", () => {
    for (const family of ["lookback", "custom"] as const) {
      expect(restoreUiPrefs({ timeframe: { ...saved, family } }, [], now, MONTHLY_CYCLE).timeframe).toEqual({
        ...saved, family, periodAnchor: "2026-10-01",
      })
    }
    expect(restoreUiPrefs({}, [], now, MONTHLY_CYCLE).timeframe).toEqual(defaultTimeframe(now))
    expect(restoreUiPrefs({ timeframe: { ...saved, custom: { start: "bad", end: "bad" } } }, [], now, MONTHLY_CYCLE).timeframe.custom).toBeNull()
  })

  test("unknown accounts fall back to all and invalid chart pairs are ignored", () => {
    expect(restoreUiPrefs({ accountSelection: 999, chartViews: [0, CHART_VIEWS.length] }, [], now, MONTHLY_CYCLE)).toMatchObject({ accountSelection: "all", chartViews: undefined })
    expect(restoreUiPrefs({ accountSelection: "savers", chartViews: [0, 1] }, [], now, MONTHLY_CYCLE)).toMatchObject({ accountSelection: "savers", chartViews: [0, 1] })
    expect(restoreUiPrefs({ chartViews: [-1, 0] }, [], now, MONTHLY_CYCLE).chartViews).toBeUndefined()
    expect(restoreUiPrefs({ chartViews: [0.5, 0] }, [], now, MONTHLY_CYCLE).chartViews).toBeUndefined()
  })
})
