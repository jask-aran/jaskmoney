import { describe, expect, test } from "bun:test"
import {
  applyChip,
  readCustomRange,
  stepRange,
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
  stepChip,
  LOOKBACKS,
  PERIODS,
  timeframeNow,
} from "./timeframe"
import { toISODay } from "./days"
import { transaction } from "../testing/fixtures"

describe("timeframe", () => {
  const now = new Date(2026, 1, 18) // 18 Feb 2026

  test("month period and 1M lookback bounds; rows filtered to the period", () => {
    expect(timeframeBounds(defaultTimeframe(now), now)).toMatchObject({ start: "2026-02-01", end: "2026-02-28" })
    expect(timeframeBounds(applyChip(defaultTimeframe(now), 0, now), now)).toMatchObject({ start: "2026-01-18", end: "2026-02-18" })
    const tf = defaultTimeframe(now)
    const rows = [
      transaction({ dateISO: "2026-01-15" }),
      transaction({ dateISO: "2026-02-03" }),
      transaction({ dateISO: "2026-03-01" }),
    ]
    const filtered = filterByTimeframe(rows, tf, now)
    expect(filtered.map((r) => r.dateISO)).toEqual(["2026-02-03"])
  })
})

describe("comparisonWindows", () => {
  test("a running period compares its days so far with the same days before it; a finished one the whole previous window", () => {
    expect(comparisonWindows("2026-10-01", "2026-10-31", "2026-10-26")).toEqual({
      days: 26, partial: true, previous: { start: "2026-08-31", end: "2026-09-25" },
    })
    expect(comparisonWindows("2026-09-01", "2026-09-30", "2026-10-26")).toEqual({
      days: 30, partial: false, previous: { start: "2026-08-02", end: "2026-08-31" },
    })
  })
})

describe("cycle period", () => {
  const payday = { unit: "fortnight" as const, anchor: "date" as const, anchorDate: "2026-10-16" }

  test("defaults to the budget cycle containing today and steps a whole cycle at a time", () => {
    const tf = defaultTimeframe(new Date(2026, 9, 26), payday)
    expect(tf).toMatchObject({ family: "period", period: "cycle", periodAnchor: "2026-10-16" })
    expect(timeframeBounds(tf, new Date(2026, 9, 26), payday)).toMatchObject({ start: "2026-10-16", end: "2026-10-29" })
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
  })
  test("stepChip walks the Lookback and Period chips, never Custom (C, or its chip, asks for dates)", () => {
    const tf = applyChip(defaultTimeframe(now), LOOKBACKS.length + PERIODS.indexOf("year"), now)
    expect(stepChip(tf, 1)).toBe(0)
    expect(stepChip({ ...tf, custom: { start: "2026-10-01", end: "2026-10-05" } }, 1)).toBe(0)
    expect(stepChip({ ...tf, family: "custom", custom: { start: "2026-10-01", end: "2026-10-05" } }, -1)).toBe(CUSTOM_CHIP - 1)
    expect(stepChip(applyChip(tf, 0, now), -1)).toBe(LOOKBACKS.length + PERIODS.length - 1)
  })
})

describe("custom range", () => {
  test("validates typed dates", () => {
    expect(customRange("2026-10-01", "2026-10-15")).toEqual({ start: "2026-10-01", end: "2026-10-15" })
    expect(customRange("2026-02-30", "2026-03-01")).toContain("Start")
    expect(customRange("2026-10-01", "2026-9-1")).toContain("End")
    expect(typeof customRange("2026-10-15", "2026-10-01")).toBe("string")
  })
  test("the Custom chip returns to the last range, and bounds follow it", () => {
    const now = new Date(2026, 9, 26)
    const tf = defaultTimeframe(now)
    expect(applyChip(tf, CUSTOM_CHIP, now)).toBe(tf)
    const custom = applyChip({ ...tf, custom: { start: "2026-09-03", end: "2026-10-09" } }, CUSTOM_CHIP, now)
    expect(custom.family).toBe("custom")
    expect(activeChipIndex(custom)).toBe(CUSTOM_CHIP)
    expect(timeframeBounds(custom, now)).toMatchObject({ start: "2026-09-03", end: "2026-10-09" })
  })
  test("[ and ] move a custom range by its own length", () => {
    const tf = { ...defaultTimeframe(new Date(2026, 9, 26)), family: "custom" as const, custom: { start: "2026-10-01", end: "2026-10-10" } }
    expect(stepCustom(tf, 1).custom).toEqual({ start: "2026-10-11", end: "2026-10-20" })
    expect(stepCustom(tf, -1).custom).toEqual({ start: "2026-09-21", end: "2026-09-30" })
  })
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
    expect(customRange(iso, "2026-10-27")).toContain("Start")
    expect(customRange("2026-10-27", iso)).toContain("End")
  }
  const early = new Date(1000, 0, 1)
  early.setFullYear(999)
  expect(toISODay(early)).toBe("999-01-01")
  expect(customRange("1000-01-01", "1000-01-02")).toEqual({ start: "1000-01-01", end: "1000-01-02" })
})

describe("stepRange", () => {
  const now = new Date(2026, 10, 2, 12)
  const tf = { ...defaultTimeframe(now), family: "lookback" as const, lookback: "1M" as const }
  test("a lookback steps its own length and stays a lookback: 2M back is the two months before; 0 is now", () => {
    expect(timeframeBounds(tf, now)).toMatchObject({ start: "2026-10-02", end: "2026-11-02" })
    const twoM = applyChip(tf, 1, now)
    const back = stepRange(twoM, -1, now)
    expect(back).toMatchObject({ family: "lookback", lookback: "2M", lookbackOffset: -1 })
    expect(timeframeBounds(back, now)).toMatchObject({ start: "2026-07-02", end: "2026-09-02" })
    expect(stepRange(back, -1, now).lookbackOffset).toBe(-2)
    expect(stepRange(twoM, 1, now).lookbackOffset).toBe(1)
    // Forward again, 0, or the chip itself: now.
    expect(stepRange(back, 1, now).lookbackOffset).toBe(0)
    expect(timeframeNow(back, now).lookbackOffset).toBe(0)
    expect(applyChip(back, 1, now).lookbackOffset).toBe(0)
  })
  test("periods step a period", () => {
    expect(timeframeBounds(stepRange(applyChip(tf, 6, now), -1, now), now)).toMatchObject({ start: "2026-10-01", end: "2026-10-31" })
  })
})

describe("labels", () => {
  test("periods by their short names; lookbacks, cycles and custom ranges by their days, the year short", () => {
    const at = (period: string, periodAnchor: string) => timeframeBounds({ ...defaultTimeframe(), family: "period", period, periodAnchor } as Parameters<typeof timeframeBounds>[0], new Date(2026, 10, 7)).label
    expect(at("month", "2026-10-15")).toBe("Oct 26")
    expect(at("qtr", "2026-10-15")).toBe("Q4 26")
    expect(at("qtr", "2026-02-15")).toBe("Q1 26")
    expect(at("half", "2026-03-15")).toBe("1H 26")
    expect(at("half", "2026-10-15")).toBe("2H 26")
    // The financial year by the year it ends in: Jul 2026 – Jun 2027.
    expect(at("fy", "2026-10-15")).toBe("FY27")
    expect(at("fy", "2026-03-15")).toBe("FY26")
    expect(at("year", "2026-10-15")).toBe("2026")
    // 1M on 7 Nov: its days, not its months.
    expect(timeframeBounds({ ...defaultTimeframe(), family: "lookback", lookback: "1M" } as Parameters<typeof timeframeBounds>[0], new Date(2026, 10, 7)).label).toBe("7 Oct – 7 Nov '26")
    expect(readCustomRange("16 dec 2026", "15 jan 2027", "2026-11-02")).toMatchObject({ label: "16 Dec '26 – 15 Jan '27" })
  })
})

describe("readCustomRange", () => {
  test("a range with its label and length, or what's wrong and where", () => {
    expect(readCustomRange("oct", "", "2026-11-02")).toMatchObject({ start: "2026-10-01", end: "2026-11-02", days: 33 })
    expect(readCustomRange("oct", "oct", "2026-11-02")).toMatchObject({ start: "2026-10-01", end: "2026-10-31", days: 31 })
    expect(readCustomRange("nope", "", "2026-11-02")).toMatchObject({ field: "from" })
    expect(readCustomRange("today", "-3", "2026-11-02")).toMatchObject({ field: "to" })
  })
})
