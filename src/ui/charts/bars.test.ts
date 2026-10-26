import { describe, expect, test } from "bun:test"
import { areaChart, columnBars } from "./bars"

describe("columnBars", () => {
  test("bars fill slots less a gap, scaled to max, tagged with their ink", () => {
    const { rows, slots } = columnBars([{ value: 10, ink: "a" }, { value: 5, ink: "b" }, { value: 0, ink: "a" }], 9, 1, 10)
    expect(slots).toEqual([{ col: 0, width: 2 }, { col: 3, width: 2 }, { col: 6, width: 2 }])
    expect(rows).toEqual([[{ text: "██", ink: "a" }, { text: " ", ink: null }, { text: "▄▄", ink: "b" }, { text: "    ", ink: null }]])
  })
})

test("a reference rule runs through blank cells of its row", () => {
  const { rows } = columnBars([{ value: 10, ink: "a" }, { value: 0, ink: "a" }], 4, 2, 10, { value: 6, ink: "ref" })
  expect(rows[0]).toEqual([{ text: "█", ink: "a" }, { text: "┈┈┈", ink: "ref" }])
  expect(rows[1]).toEqual([{ text: "█", ink: "a" }, { text: "   ", ink: null }])
})

describe("areaChart", () => {
  test("fills each column to its value between min and max", () => {
    const rows = areaChart([0, 10, 20], 3, 2, 0, 20)
    // Column levels 1, 8 and 16 eighths of a 16-eighth chart.
    expect(rows[0]).toEqual([{ text: "  ", ink: null }, { text: "█", ink: "area" }])
    expect(rows[1]).toEqual([{ text: "▁██", ink: "area" }])
  })

  test("grid rules fill empty cells of marker columns", () => {
    expect(areaChart([0, 0, 0], 3, 1, 0, 10, [1])[0]).toEqual([{ text: "▁▁▁", ink: "area" }])
    expect(areaChart([0, 0, 0], 3, 2, 0, 10, [1])[0]).toEqual([{ text: " ", ink: null }, { text: "│", ink: "grid" }, { text: " ", ink: null }])
  })
})
