import { describe, expect, test } from "bun:test"
import { annotate, lineAnchors } from "./annotate"
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

test("a line's label crowded out at its end names the line further back along it", () => {
  // Two lines; the end (right) is boxed in by the other line's dots above
  // and below, so the label can't go at the point.
  const row = (s: string) => [{ text: s, ink: s.trim() ? "x" : null }]
  const pad = " ".repeat(15)
  const rows = [
    row(`${pad}⣿⣿⣿⣿⣿`),
    row(`${pad}⣿⣿⣿⣿⣿`),
    row(`${"⠒".repeat(15)}⣿⣿⣿⣿⣿`),
    row(`${pad}⣿⣿⣿⣿⣿`),
    row(`${pad}⣿⣿⣿⣿⣿`),
  ]
  const along = lineAnchors(Array(20).fill(1), 18, (i) => ({ row: 2, col: i }))
  const text = (labels: Parameters<typeof annotate>[1]) => annotate(rows, labels).map((r) => r.map((run) => run.text).join(""))
  // Value text at the end: nowhere free.
  expect(text([{ row: 2, col: 19, text: "Holiday $3k", ink: "s" }]).join("\n")).not.toContain("Holiday")
  // With a name and the line's other cells: the name goes back along it.
  const named = text([{ row: 2, col: 19, text: "Holiday $3k", name: "🏖️ Holiday", along, ink: "s" }])
  expect(named.join("\n")).toContain("🏖️ Holiday")
  // An emoji takes two cells: every row keeps its width.
  expect(named.every((line) => Bun.stringWidth(line) === 20)).toBe(true)
})
