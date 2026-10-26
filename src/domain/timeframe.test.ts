import { describe, expect, test } from "bun:test"
import {
  applyChip,
  comparisonWindows,
  stepPeriod,
  defaultTimeframe,
  filterByTimeframe,
  timeframeBounds,
  customRange,
  stepCustom,
  CUSTOM_CHIP,
  activeChipIndex,
  periodOffset,
  offsetLabel,
  stepChip,
  LOOKBACKS,
  PERIODS,
  timeframeNow,
} from "./timeframe"
import { toISODay } from "./days"
import type { Transaction } from "./types"

function txn(dateISO: string, amount = -10): Transaction {
  return {
    id: 1,
    dateRaw: dateISO,
    dateISO,
    amount,
    description: "x",
    categoryId: 1,
    categoryName: "A",
    categoryColor: "#94e2d5",
    notes: "",
    importId: null,
    accountId: 1,
    accountName: "A",
    tagNames: [],
          tagColors: [],
          tagIds: [], source: "csv" as const, status: null, transferAccountId: null, internal: false, excluded: false,
  }
}

describe("timeframe", () => {
  const now = new Date(2026, 1, 18) // 18 Feb 2026

  test("month period bounds", () => {
    const tf = defaultTimeframe(now)
    const b = timeframeBounds(tf, now)
    expect(b.start).toBe("2026-02-01")
    expect(b.end).toBe("2026-02-28")
  })

  test("lookback 1M", () => {
    let tf = defaultTimeframe(now)
    tf = applyChip(tf, 0, now) // 1M
    const b = timeframeBounds(tf, now)
    expect(b.start).toBe("2026-01-18")
    expect(b.end).toBe("2026-02-18")
  })

  test("filter rows", () => {
    const tf = defaultTimeframe(now)
    const rows = [
      txn("2026-01-15"),
      txn("2026-02-03"),
      txn("2026-03-01"),
    ]
    const filtered = filterByTimeframe(rows, tf, now)
    expect(filtered.map((r) => r.dateISO)).toEqual(["2026-02-03"])
  })
})

describe("comparisonWindows", () => {
  test("a running period compares its days so far with the same days before it", () => {
    expect(comparisonWindows("2026-10-01", "2026-10-31", "2026-10-26")).toEqual({
      days: 26, partial: true, previous: { start: "2026-08-31", end: "2026-09-25" },
    })
  })

  test("a finished period compares with the whole previous window", () => {
    expect(comparisonWindows("2026-09-01", "2026-09-30", "2026-10-26")).toEqual({
      days: 30, partial: false, previous: { start: "2026-08-02", end: "2026-08-31" },
    })
  })
})

describe("cycle period", () => {
  const payday = { unit: "fortnight" as const, anchor: "date" as const, anchorDate: "2026-10-16" }

  test("defaults to the budget cycle containing today", () => {
    const tf = defaultTimeframe(new Date(2026, 9, 26), payday)
    expect(tf).toMatchObject({ family: "period", period: "cycle", periodAnchor: "2026-10-16" })
    expect(timeframeBounds(tf, new Date(2026, 9, 26), payday)).toEqual({ start: "2026-10-16", end: "2026-10-29", label: "16 Oct – 29 Oct 2026" })
  })

  test("steps a whole cycle at a time", () => {
    const tf = defaultTimeframe(new Date(2026, 9, 26), payday)
    expect(stepPeriod(tf, -1, payday).periodAnchor).toBe("2026-10-02")
    expect(stepPeriod(tf, 2, payday).periodAnchor).toBe("2026-11-13")
  })
})

describe("stepping", () => {
  const now = new Date(2026, 9, 27)
  test("periodOffset counts steps from the current period", () => {
    const month = applyChip(defaultTimeframe(now), LOOKBACKS.length + PERIODS.indexOf("month"), now)
    expect(periodOffset(month, now)).toBe(0)
    expect(periodOffset(stepPeriod(stepPeriod(month, -1), -1), now)).toBe(-2)
    expect(periodOffset(stepPeriod(month, 1), now)).toBe(1)
    expect(offsetLabel("month", -2)).toBe("2 months back")
    expect(offsetLabel("qtr", 1)).toBe("1 quarter ahead")
    expect(offsetLabel("cycle", 0)).toBe("")
  })
  test("stepChip walks every chip, skipping Custom until there is a range", () => {
    const tf = applyChip(defaultTimeframe(now), LOOKBACKS.length + PERIODS.indexOf("year"), now)
    expect(stepChip(tf, 1)).toBe(0)
    expect(stepChip({ ...tf, custom: { start: "2026-10-01", end: "2026-10-05" } }, 1)).toBe(CUSTOM_CHIP)
    expect(stepChip(applyChip(tf, 0, now), -1)).toBe(LOOKBACKS.length + PERIODS.length - 1)
  })
})

describe("custom range", () => {
  test("validates typed dates", () => {
    expect(customRange("2026-10-01", "2026-10-15")).toEqual({ start: "2026-10-01", end: "2026-10-15" })
    expect(customRange("2026-02-30", "2026-03-01")).toBe("Start must be a date: YYYY-MM-DD")
    expect(customRange("2026-10-01", "2026-9-1")).toBe("End must be a date: YYYY-MM-DD")
    expect(customRange("2026-10-15", "2026-10-01")).toBe("End is before start")
  })
  test("the Custom chip returns to the last range, and bounds follow it", () => {
    const now = new Date(2026, 9, 26)
    const tf = defaultTimeframe(now)
    expect(applyChip(tf, CUSTOM_CHIP, now)).toBe(tf)
    const custom = applyChip({ ...tf, custom: { start: "2026-09-03", end: "2026-10-09" } }, CUSTOM_CHIP, now)
    expect(custom.family).toBe("custom")
    expect(activeChipIndex(custom)).toBe(CUSTOM_CHIP)
    expect(timeframeBounds(custom, now)).toEqual({ start: "2026-09-03", end: "2026-10-09", label: "3 Sep – 9 Oct 2026" })
  })
  test("[ and ] move a custom range by its own length", () => {
    const tf = { ...defaultTimeframe(new Date(2026, 9, 26)), family: "custom" as const, custom: { start: "2026-10-01", end: "2026-10-10" } }
    expect(stepCustom(tf, 1).custom).toEqual({ start: "2026-10-11", end: "2026-10-20" })
    expect(stepCustom(tf, -1).custom).toEqual({ start: "2026-09-21", end: "2026-09-30" })
  })
})

test("a single month's label names it once", () => {
  const now = new Date(2026, 9, 27)
  const month = applyChip(defaultTimeframe(now), LOOKBACKS.length + PERIODS.indexOf("month"), now)
  expect(timeframeBounds(month, now).label).toBe("Oct 2026")
})

test("timeframeNow: the same kind of range, now", () => {
  const now = new Date(2026, 9, 27)
  const month = applyChip(defaultTimeframe(now), LOOKBACKS.length + PERIODS.indexOf("month"), now)
  expect(timeframeNow(stepPeriod(stepPeriod(month, -1), -1), now)).toEqual(month)
  const custom = { ...month, family: "custom" as const, custom: { start: "2026-09-01", end: "2026-09-10" } }
  expect(timeframeNow(custom, now).custom).toEqual({ start: "2026-10-18", end: "2026-10-27" })
})

test("calendar consolidation preserves early-year formatting and custom-range rejection", () => {
  for (const iso of ["0099-01-01", "0100-01-01", "0999-01-01"]) {
    expect(customRange(iso, "2026-10-27")).toBe("Start must be a date: YYYY-MM-DD")
    expect(customRange("2026-10-27", iso)).toBe("End must be a date: YYYY-MM-DD")
  }
  const early = new Date(1000, 0, 1)
  early.setFullYear(999)
  expect(toISODay(early)).toBe("999-01-01")
  expect(customRange("1000-01-01", "1000-01-02")).toEqual({ start: "1000-01-01", end: "1000-01-02" })
})
