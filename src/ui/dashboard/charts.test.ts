import { describe, expect, test } from "bun:test"
import { columnBars, levelChart } from "./charts"

describe("columnBars", () => {
  test("bars fill slots less a gap, scaled to max, tagged with their ink", () => {
    const { rows, slots } = columnBars([{ value: 10, ink: "a" }, { value: 5, ink: "b" }, { value: 0, ink: "a" }], 9, 1, 10)
    expect(slots).toEqual([{ col: 0, width: 2 }, { col: 3, width: 2 }, { col: 6, width: 2 }])
    expect(rows).toEqual([[{ text: "██", ink: "a" }, { text: " ", ink: null }, { text: "▄▄", ink: "b" }, { text: "    ", ink: null }]])
  })
})

describe("levelChart", () => {
  test("fills up to each column's latest value above a margin under the minimum", () => {
    const chart = levelChart([10, 20, 30, 40], 4, 1)
    expect(chart).toEqual({ rows: ["▁▃▆█"], min: 10, max: 40 })
  })
})
