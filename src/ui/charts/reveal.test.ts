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

test("bars rise from the bottom row; words in the plot wait for the end", () => {
  const top: Run[] = [{ text: "██ $826", ink: "spend" }]
  const bottom: Run[] = [{ text: "██", ink: "spend" }]
  expect(text(revealRuns(bottom, 3, 4, 0.25))).toBe("██")
  expect(text(revealRuns(top, 0, 4, 0.25))).toBe("       ")
  expect(text(revealRuns(top, 0, 4, 0.8))).toBe("██     ")
  expect(text(revealRuns(top, 0, 4, 0.95))).toBe("██ $826")
})
