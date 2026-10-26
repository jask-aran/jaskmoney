import { describe, expect, test } from "bun:test"
import { dateAxis, lineChart, niceRange, niceScale, valueRow } from "./lineChart"

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
    const axis = dateAxis(dates, 40, "2026-10-20")
    expect(axis.labels.startsWith("15 Sep")).toBe(true)
    expect(axis.labels.endsWith("24 Oct")).toBe(true)
    expect(axis.labels).toContain("Oct")
    expect(axis.markers).toContainEqual({ index: dates.indexOf("2026-10-01"), ink: "month" })
    expect(axis.markers).toContainEqual({ index: dates.indexOf("2026-10-20"), ink: "today" })
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
