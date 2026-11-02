import { describe, expect, test } from "bun:test"
import { LOOKBACKS, PERIODS, MONTHLY_CYCLE, activeChipIndex, applyChip, defaultTimeframe } from "../domain/timeframe"
import { CHART_VIEWS } from "./uiStore"
import { restoreUiPrefs } from "./uiPrefs"

const now = new Date(2026, 9, 26)
const custom = { start: "2025-01-01", end: "2025-01-10" }
const saved = { family: "period", lookback: "3M", period: "month", custom } as const

describe("restore UI preferences", () => {
  test("reanchors saved periods on today and retains the last custom range", () => {
    const restored = restoreUiPrefs({ openRange: "last", timeframe: saved }, [], now, MONTHLY_CYCLE)
    expect(restored.timeframe).toEqual({ ...saved, periodAnchor: "2026-10-01" })
    const cycle = { unit: "month", anchor: "date", anchorDate: "2026-01-15" } as const
    expect(restoreUiPrefs({ openRange: "last", timeframe: { ...saved, period: "cycle" } }, [], now, cycle).timeframe.periodAnchor).toBe("2026-10-15")
  })

  test("restores lookbacks and custom without changing the custom dates", () => {
    for (const family of ["lookback", "custom"] as const) {
      expect(restoreUiPrefs({ openRange: "last", timeframe: { ...saved, family } }, [], now, MONTHLY_CYCLE).timeframe).toEqual({
        // A lookback opens on now (its offset isn't saved).
        ...saved, family, periodAnchor: "2026-10-01", ...(family === "lookback" ? { lookbackOffset: 0 } : {}),
      })
    }
    expect(restoreUiPrefs({ openRange: "last" }, [], now, MONTHLY_CYCLE).timeframe).toEqual(defaultTimeframe(now))
    expect(restoreUiPrefs({ openRange: "last", timeframe: { ...saved, custom: { start: "bad", end: "bad" } } }, [], now, MONTHLY_CYCLE).timeframe.custom).toBeNull()
  })

  test("opens on the chosen chip and ignores saved state unless last (the custom chip keeps its last range)", () => {
    const cycle = { unit: "month", anchor: "date", anchorDate: "2026-01-15" } as const
    const base = defaultTimeframe(now, cycle)
    const firstRun = restoreUiPrefs({}, [], now, cycle).timeframe
    expect(firstRun).toEqual(applyChip(base, 0, now, cycle))
    expect(firstRun).toMatchObject({ family: "lookback", lookback: "1M", custom: null })
    expect(activeChipIndex(firstRun)).toBe(0)
    expect(LOOKBACKS[activeChipIndex(firstRun)]).toBe("1M")
    for (const family of ["period", "lookback", "custom"] as const) {
      const timeframe = { ...saved, family }
      const kept = { ...base, custom }
      expect(restoreUiPrefs({ timeframe }, [], now, cycle).timeframe).toEqual(applyChip(kept, 0, now, cycle))
      for (const openRange of ["1M", "3M", "6M", "1Y", "cycle", "month"] as const) {
        const index = openRange === "cycle" || openRange === "month"
          ? LOOKBACKS.length + PERIODS.indexOf(openRange) : LOOKBACKS.indexOf(openRange)
        expect(restoreUiPrefs({ openRange, timeframe }, [], now, cycle).timeframe).toEqual(applyChip(kept, index, now, cycle))
      }
    }
    expect(restoreUiPrefs({ openRange: "last", timeframe: { ...saved, family: "custom", custom: null } }, [], now, cycle).timeframe)
      .toEqual({ ...base, ...saved, family: "period", custom: null, periodAnchor: "2026-10-01" })
  })

  test("unknown accounts fall back to all and invalid chart pairs are ignored", () => {
    expect(restoreUiPrefs({ accountSelection: 999, chartViews: [0, CHART_VIEWS.length] }, [], now, MONTHLY_CYCLE)).toMatchObject({ accountSelection: "all", chartViews: undefined })
    expect(restoreUiPrefs({ accountSelection: "savers", chartViews: [0, 1] }, [], now, MONTHLY_CYCLE)).toMatchObject({ accountSelection: "savers", chartViews: [0, 1] })
    expect(restoreUiPrefs({ chartViews: [-1, 0] }, [], now, MONTHLY_CYCLE).chartViews).toBeUndefined()
    expect(restoreUiPrefs({ chartViews: [0.5, 0] }, [], now, MONTHLY_CYCLE).chartViews).toBeUndefined()
  })
})
