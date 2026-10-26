import { afterEach, expect, test } from "bun:test"
import { overviewRange } from "../state/overviewRange"
import { defaultAnchorDraft } from "../state/settingsForm"
import { addDays, addMonths, addMonthsClamped, appNow, appToday, daysBetween, parseDay, setAppClock, toISODay, weekdayIndex } from "./days"
import { defaultTimeframe, timeframeBounds } from "./timeframe"
import { transaction } from "../testing/fixtures"

afterEach(() => setAppClock(null))

test("real calendar dates reject overflow and accept leap days", () => {
  for (const iso of ["2026-02-31", "2025-02-29", "2026-00-01", "2026-13-01", "2026-01-00", "2026-1-01", "bad"]) {
    expect(parseDay(iso)).toBeNull()
  }
  for (const iso of ["2024-02-29", "2000-02-29", "2026-12-31"]) expect(parseDay(iso)).toBe(iso)
})

test("calendar arithmetic crosses leap days, years and both Sydney DST boundaries", () => {
  expect(addDays("2024-02-28", 1)).toBe("2024-02-29")
  expect(addDays("2026-12-31", 1)).toBe("2027-01-01")
  expect(addDays("2027-04-03", 3)).toBe("2027-04-06")
  expect(addDays("2026-10-03", 3)).toBe("2026-10-06")
  expect(daysBetween("2027-04-03", "2027-04-06")).toBe(3)
  expect(daysBetween("2026-10-06", "2026-10-03")).toBe(-3)
  expect(weekdayIndex("2026-10-04")).toBe(0)
  expect(weekdayIndex("2026-10-05")).toBe(1)
})

test("month overflow for lookbacks stays distinct from clamped budget anchors", () => {
  expect(addMonths("2026-03-31", -1)).toBe("2026-03-03")
  expect(addMonthsClamped("2026-03-31", -1)).toBe("2026-02-28")
  expect(addMonthsClamped("2024-01-31", 1)).toBe("2024-02-29")
  expect(addMonthsClamped("2026-12-31", 2)).toBe("2027-02-28")
  const now = new Date(2026, 2, 31)
  expect(timeframeBounds({ ...defaultTimeframe(now), family: "lookback" }, now).start).toBe("2026-03-03")
})

test("clock copies isolate callers and null restores the real clock", () => {
  const fixed = new Date(2026, 9, 27, 8)
  setAppClock(fixed)
  fixed.setFullYear(2000)
  expect(appToday()).toBe("2026-10-27")
  const copy = appNow()
  copy.setFullYear(2001)
  expect(appToday()).toBe("2026-10-27")
  expect(defaultTimeframe().periodAnchor).toBe("2026-10-01")
  setAppClock(null)
  const before = Date.now()
  const now = appNow().getTime()
  expect(now).toBeGreaterThanOrEqual(before)
  expect(now).toBeLessThanOrEqual(Date.now())
})

// Approved change: the anchor uses the local day, even before 11am in Sydney.
test("Sydney morning anchors use the app's local day rather than the UTC day", () => {
  const previousTZ = process.env.TZ
  try {
    process.env.TZ = "Australia/Sydney"
    const morning = new Date("2026-10-26T21:00:00Z")
    setAppClock(morning)
    expect(morning.toISOString().slice(0, 10)).toBe("2026-10-26")
    expect(toISODay(morning)).toBe("2026-10-27")
    expect(appToday()).toBe("2026-10-27")
    expect(defaultAnchorDraft("fortnight")).toBe("2026-10-27")
  } finally {
    if (previousTZ === undefined) delete process.env.TZ
    else process.env.TZ = previousTZ
  }
})

// Approved change: Overview lookbacks end on real today, not the latest row.
test("Overview uses the app clock when transactions end on a different date", () => {
  setAppClock(new Date(2026, 9, 27, 8))
  const row = transaction({ dateISO: "2020-01-01", accountId: null, accountName: "", source: "csv", status: null })
  const range = overviewRange({
    transactions: () => [row],
    state: { accounts: [], accountSelection: "all", budgetCycle: { unit: "month", anchor: "calendar", anchorDate: null }, categories: [] },
  }, { timeframe: { ...defaultTimeframe(), family: "lookback" } })
  expect(toISODay(range.clock)).toBe("2026-10-27")
  expect(range.bounds).toMatchObject({ start: "2026-09-27", end: "2026-10-27" })
  expect(range.inPeriod).toEqual([])
})
