import { describe, expect, test } from "bun:test"
import { columnBars } from "./charts"

describe("columnBars", () => {
  test("bars fill slots less a gap, scaled to max, tagged with their ink", () => {
    const { rows, slots } = columnBars([{ value: 10, ink: "a" }, { value: 5, ink: "b" }, { value: 0, ink: "a" }], 9, 1, 10)
    expect(slots).toEqual([{ col: 0, width: 2 }, { col: 3, width: 2 }, { col: 6, width: 2 }])
    expect(rows).toEqual([[{ text: "██", ink: "a" }, { text: " ", ink: null }, { text: "▄▄", ink: "b" }, { text: "    ", ink: null }]])
  })
})
