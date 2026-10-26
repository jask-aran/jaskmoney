import { expect, test } from "bun:test"
import { stripWindow } from "./AccountStrip"

test("stripWindow shows every tile when they fit", () => {
  // 10 + 3 + 10 + 3 + 10 = 36 cells.
  expect(stripWindow([10, 10, 10], 2, 36)).toEqual({ start: 0, end: 3 })
})

test("stripWindow keeps the selected tile in view, then fills after it", () => {
  // Cut off on the right: 10 + 3 + 10 + 2 = 25.
  expect(stripWindow([10, 10, 10], 0, 25)).toEqual({ start: 0, end: 2 })
  // The last tile selected: drop tiles from the left until it fits.
  expect(stripWindow([10, 10, 10], 2, 25)).toEqual({ start: 1, end: 3 })
  // Cut off on both sides: 2 + 10 + 2 = 14.
  expect(stripWindow([10, 10, 10], 1, 14)).toEqual({ start: 1, end: 2 })
})
