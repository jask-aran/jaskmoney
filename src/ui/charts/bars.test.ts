import { describe, expect, test } from "bun:test"
import { barSlots, columnBars } from "./bars"

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

test("bars share the whole width out: a year of weeks fills the pane", () => {
  const slots = barSlots(53, 88)
  expect(slots).toHaveLength(53)
  const last = slots.at(-1)!
  expect(last.col + last.width).toBe(88)
  // One width for every bar: the spare columns open gaps instead.
  expect(new Set(slots.map((s) => s.width))).toEqual(new Set([1]))
  // Wider slots keep a gap, the last too; their bars fill the rest.
  const wide = barSlots(3, 88)
  expect(wide.map((s) => s.width)).toEqual([28, 28, 28])
  expect(wide.at(-1)!.col + wide.at(-1)!.width).toBe(87)
  // Weeks of a half year in 78 columns: one cell each, never one and two.
  expect(new Set(barSlots(27, 78).map((s) => s.width))).toEqual(new Set([1]))
})

test("grouped bars stand together, with a gap after each group", () => {
  expect(barSlots(4, 10, 2)).toEqual([{ col: 0, width: 2 }, { col: 2, width: 2 }, { col: 5, width: 2 }, { col: 7, width: 2 }])
})
