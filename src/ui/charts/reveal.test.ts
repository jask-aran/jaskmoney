import { expect, test } from "bun:test"
import { gridColumns, revealRuns } from "./reveal"
import type { Run } from "./lineChart"

const text = (runs: Run[]) => runs.map((r) => r.text).join("")

test("a line traces left to right; gridlines and spaces stand from the start", () => {
  const row: Run[] = [{ text: "⣀⣀│⣀⣀⣀⣀⣀⣀⣀", ink: "spend" }]
  const frame = gridColumns([[{ text: "  │       ", ink: "week" }]])
  expect(text(revealRuns(row, 0, 1, 0, frame))).toBe("  │       ")
  expect(text(revealRuns(row, 0, 1, 0.5, frame))).toBe("⣀⣀│⣀⣀     ")
  expect(revealRuns(row, 0, 1, 1, frame)).toBe(row)
  // Where the line covers a gridline's column it draws the gridline, in its own ink.
  const covered: Run[] = [{ text: "⣀⣀⣀⣀", ink: "spend" }]
  expect(revealRuns(covered, 0, 1, 0.25, new Map([[2, { text: "│", ink: "week" }]]))).toEqual([{ text: "⣀ ", ink: "spend" }, { text: "│", ink: "week" }, { text: " ", ink: "spend" }])
})

test("bars rise from the bottom row; a label waits for its bar to reach it", () => {
  const top: Run[] = [{ text: "██ $826", ink: "spend" }]
  const bottom: Run[] = [{ text: "██", ink: "spend" }]
  expect(text(revealRuns(bottom, 3, 4, 0.25, undefined, true))).toBe("██")
  expect(text(revealRuns(top, 0, 4, 0.25, undefined, true))).toBe("       ")
  expect(text(revealRuns(top, 0, 4, 0.8, undefined, true))).toBe("██     ")
  expect(text(revealRuns(top, 0, 4, 1, undefined, true))).toBe("██ $826")
})

test("labels together: all at once as the chart all but finishes", () => {
  const row: Run[] = [{ text: "⣀ Early ⣀⣀⣀⣀⣀⣀ Late ⣀", ink: "spend" }]
  expect(text(revealRuns(row, 0, 1, 0.8))).not.toMatch(/Early|Late/)
  expect(text(revealRuns(row, 0, 1, 0.86))).toMatch(/Early.*Late/)
})

test("a label shows a beat after the line reaches it, whole: labels come in the order of their points", () => {
  // "To General" ends at column 13; "From General" further on, at 38.
  const row: Run[] = [{ text: "⣀⣀⣀ To General ⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀ From General ⣀⣀⣀", ink: "spend" }]
  const width = [...row[0]!.text].length
  const at = (col: number) => text(revealRuns(row, 0, 1, col / width, undefined, false, "sequential"))
  expect(at(13)).not.toContain("To General")
  expect(at(15)).toContain("To General")
  expect(at(15)).not.toContain("From")
  expect(at(39)).not.toContain("From")
  expect(at(41)).toContain("From General")
  // Never a part of one: it shows whole.
  expect(at(10)).not.toMatch(/To|General/)
})
