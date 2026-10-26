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

describe("niceRange", () => {
  test("snaps level bounds to the step", () => {
    expect(niceRange(6500, 14200)).toEqual({ min: 6000, max: 16000, step: 2000 })
    expect(niceRange(100, 100)).toEqual({ min: 100, max: 125, step: 25 })
  })
})
