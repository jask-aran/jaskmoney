import { describe, expect, test } from "bun:test"
import { cellColumn, dateAxis, fitRange, lineChart, niceRange, niceScale, tickRows, valueRow } from "./lineChart"

const text = (rows: ReturnType<typeof lineChart>) => rows.map((runs) => runs.map((r) => r.text).join(""))

describe("lineChart", () => {
  test("plots a rising line bottom-left to top-right", () => {
    const rows = lineChart({ series: [{ values: [0, 1, 2, 3], ink: "a" }], length: 4, width: 2, height: 1, min: 0, max: 3 })
    // Dots (0,3) (1,2) (2,1) (3,0): left cell dots 7+6, right cell dots 2+4.
    expect(text(rows)).toEqual(["⡠⠊"])
    expect(rows[0]!.every((r) => r.ink === "a")).toBe(true)
  })

  test("nulls leave gaps and markers fill empty cells", () => {
    const rows = lineChart({
      series: [{ values: [0, 0, null, null], ink: "a" }], length: 4, width: 4, height: 1, min: 0, max: 1,
      markers: [{ index: 3, ink: "today" }],
    })
    expect(rows[0]!.map((r) => [r.text, r.ink])).toEqual([["⣀⡀", "a"], [" ", null], ["│", "today"]])
  })

  test("a later series owns shared cells", () => {
    const rows = lineChart({
      series: [{ values: [0, 0], ink: "ref" }, { values: [0, 0], ink: "data" }], length: 2, width: 1, height: 1, min: 0, max: 1,
    })
    expect(rows[0]).toEqual([{ text: "⣀", ink: "data" }])
  })
})

describe("lineChart fill", () => {
  test("cells below the line take the fill ink; the line's cells hold only the line", () => {
    const rows = lineChart({ series: [{ values: [1, 1], ink: "line", fill: "area" }], length: 2, width: 1, height: 2, min: 0, max: 1 })
    // Line on the top dot row of the top cell; the cell below is filled.
    expect(rows[0]).toEqual([{ text: "\u2809", ink: "line" }])
    expect(rows[1]).toEqual([{ text: "\u28ff", ink: "area" }])
  })
})

describe("niceScale", () => {
  test("rounds up to a 1/2/2.5/5 step", () => {
    expect(niceScale(1200)).toEqual({ max: 1500, step: 500 })
    expect(niceScale(161)).toEqual({ max: 200, step: 50 })
    expect(niceScale(0)).toEqual({ max: 1, step: 1 })
  })
})

describe("valueRow", () => {
  test("maps the range onto rows top first", () => {
    expect(valueRow(100, 0, 100, 5)).toBe(0)
    expect(valueRow(0, 0, 100, 5)).toBe(4)
  })
})

describe("lineChart shared cells", () => {
  test("a cell two lines share shows one line's dots in its colour", () => {
    // Both lines run through the one cell: the bottom line (2 dots) and the
    // top line (2 dots); the tie goes to the later series, alone.
    const rows = lineChart({ series: [{ values: [0, 0], ink: "a" }, { values: [1, 1], ink: "b" }], length: 2, width: 1, height: 1, min: 0, max: 1 })
    expect(rows).toEqual([[{ text: "⠉", ink: "b" }]])
    // The line with more dots there wins.
    const more = lineChart({ series: [{ values: [0, 1], ink: "a" }, { values: [1, 1], ink: "b" }], length: 2, width: 1, height: 1, min: 0, max: 1 })
    expect(more[0]![0]!.ink).toBe("a")
  })
})

describe("dateAxis", () => {
  test("labels the ends and month starts and marks today", () => {
    const dates = Array.from({ length: 40 }, (_, i) => new Date(Date.UTC(2026, 8, 15 + i)).toISOString().slice(0, 10))
    const axis = dateAxis(dates, 40, "2026-09-25")
    expect(axis.labels.startsWith("15 Sep")).toBe(true)
    expect(axis.labels.endsWith("24 Oct")).toBe(true)
    expect(axis.labels).toContain("Oct")
    expect(axis.markers).toContainEqual({ index: dates.indexOf("2026-10-01"), ink: "month" })
    expect(axis.markers).toContainEqual({ index: dates.indexOf("2026-09-25"), ink: "today" })
  })

  test("today's date is always labelled under its rule, as zoom allows, over whatever it covers", () => {
    const days = (start: string, n: number) => Array.from({ length: n }, (_, i) => new Date(Date.parse(start) + i * 86_400_000).toISOString().slice(0, 10))
    const at = (axis: ReturnType<typeof dateAxis>) => axis.labels.slice(axis.today!.start, axis.today!.start + axis.today!.length)
    // A month: the day; it takes the end label's place when they collide.
    const month = dateAxis(days("2026-10-01", 31), 31, "2026-10-29")
    expect(at(month)).toBe("29")
    expect(month.today!.start).toBe(28)
    expect(month.labels).not.toContain("31 Oct")
    // A year: day and month; beyond two years: month and year.
    expect(at(dateAxis(days("2025-11-01", 365), 100, "2026-10-27"))).toBe("27 Oct")
    expect(at(dateAxis(days("2023-11-01", 1092), 100, "2026-10-27"))).toBe("Oct 26")
    // Even on the first day, and not at all outside the range.
    expect(at(dateAxis(days("2026-10-01", 31), 31, "2026-10-01"))).toBe("1")
    expect(dateAxis(days("2026-09-01", 30), 30, "2026-10-27").today).toBeUndefined()
  })
})

describe("dateAxis gridlines", () => {
  const days = (from: number, count: number) => Array.from({ length: count }, (_, i) => new Date(Date.UTC(2026, 6, from + i)).toISOString().slice(0, 10))
  test("narrow months get unlabelled week rules on days 7, 14 and 21, and the range closes on a month end", () => {
    const dates = days(1, 184) // 1 Jul – 31 Dec
    const axis = dateAxis(dates, 100, "2026-10-26")
    const weeks = axis.markers.filter((m) => m.ink === "week").map((m) => dates[m.index]!)
    expect(weeks.slice(0, 3)).toEqual(["2026-07-07", "2026-07-14", "2026-07-21"])
    expect(axis.markers).toContainEqual({ index: dates.indexOf("2026-08-01"), ink: "month" })
    expect(axis.markers).toContainEqual({ index: dates.length - 1, ink: "year" })
    expect(axis.labels).not.toContain(" 14 ")
  })
  test("today on the last day replaces the closing rule", () => {
    const dates = days(1, 31)
    const axis = dateAxis(dates, 60, "2026-07-31")
    expect(axis.markers.filter((m) => m.index === 30)).toEqual([{ index: 30, ink: "today" }])
  })
})

describe("niceRange", () => {
  test("snaps level bounds to the step", () => {
    expect(niceRange(6500, 14200)).toEqual({ min: 6000, max: 16000, step: 2000 })
    expect(niceRange(100, 100)).toEqual({ min: 100, max: 125, step: 25 })
  })
})

describe("fitRange", () => {
  const rows = 23
  test("fits the series with a free row above and below it", () => {
    const r = fitRange(11063, 13971, rows)
    expect(valueRow(11063, r.min, r.max, rows)).toBe(rows - 2)
    expect(valueRow(13971, r.min, r.max, rows)).toBe(1)
    expect([...tickRows(r.min, r.max, r.step, rows, String).values()]).toEqual(["11000", "12000", "13000", "14000"])
  })
  test("from $0 the floor is $0 and only the top gets headroom", () => {
    const r = fitRange(11063, 13971, rows, true)
    expect(r.min).toBe(0)
    expect(valueRow(13971, r.min, r.max, rows)).toBe(1)
    expect(valueRow(0, r.min, r.max, rows)).toBe(rows - 1)
    // A balance below $0 keeps headroom under it.
    expect(fitRange(-500, 2000, rows, true).min).toBeLessThan(-500)
  })
  test("a flat series gets a band around its value", () => {
    expect(fitRange(100, 100, rows)).toEqual(niceRange(100, 100))
  })
})

test("Sunday-start axis marks and labels Sundays instead of Mondays", () => {
  const dates = Array.from({ length: 21 }, (_, i) => new Date(Date.UTC(2026, 9, 2 + i)).toISOString().slice(0, 10))
  const axis = dateAxis(dates, 100, "", undefined, "sunday")
  expect(axis.markers.filter((m) => m.ink === "week").map((m) => dates[m.index])).toEqual(["2026-10-04", "2026-10-11", "2026-10-18"])
  expect(axis.labels.slice(cellColumn(9, dates.length, 100))).toMatch(/^11/)
})

describe("xAxisLine", () => {
  test("a corner, then a rule ticked where gridlines come down", async () => {
    const { xAxisLine } = await import("./ChartBody")
    expect(xAxisLine([[{ text: "  │ ", ink: null }, { text: "⣀│", ink: "a" }]])).toBe("└──┴──┴")
  })
})
