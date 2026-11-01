import { expect, test } from "bun:test"
import { lastCall } from "./lastCall"

test("lastCall returns the last result for the same arguments, and works again for others", () => {
  let runs = 0
  const rows = [1, 2, 3]
  const sum = lastCall((xs: number[], k: number) => { runs++; return xs.reduce((a, b) => a + b, 0) * k })
  expect(sum(rows, 2)).toBe(12)
  expect(sum(rows, 2)).toBe(12)
  expect(runs).toBe(1)
  expect(sum([1, 2, 3], 2)).toBe(12)
  expect(runs).toBe(2)
  expect(sum(rows, 3)).toBe(18)
  expect(runs).toBe(3)
})
