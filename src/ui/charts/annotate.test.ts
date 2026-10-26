import { describe, expect, test } from "bun:test"
import { annotate } from "./annotate"
import type { Run } from "./lineChart"

const grid = (...lines: string[]): Run[][] => lines.map((text) => [{ text, ink: null }])
const text = (rows: Run[][]) => rows.map((runs) => runs.map((r) => r.text).join(""))

describe("annotate", () => {
  test("puts a label right of its point, over gridlines but not over dots", () => {
    expect(text(annotate(grid("   ⣀  │      "), [{ row: 0, col: 3, text: "low", ink: "x" }]))).toEqual(["   ⣀ low     "])
  })
  test("falls back to the left, then the rows above and below", () => {
    expect(text(annotate(grid("      ⣀⣿⣿"), [{ row: 0, col: 6, text: "hi", ink: "x" }]))).toEqual(["   hi ⣀⣿⣿"])
    expect(text(annotate(grid("        ", "⣿⣿⣿⣿⣿⣿⣿⣿"), [{ row: 1, col: 3, text: "top", ink: "x" }]))).toEqual(["  top   ", "⣿⣿⣿⣿⣿⣿⣿⣿"])
  })
  test("drops a label that fits nowhere", () => {
    expect(text(annotate(grid("⣿⣿⣿⣿"), [{ row: 0, col: 1, text: "label", ink: "x" }]))).toEqual(["⣿⣿⣿⣿"])
  })
})
