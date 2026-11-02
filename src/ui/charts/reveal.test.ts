import { expect, test } from "bun:test"
import { easeOut, gridColumns, revealRuns } from "./reveal"
import { CHART_CURVES, chartCurvePower } from "./motion"
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

test("a label with an emoji keeps its row's width while hidden: the gridlines after it stay in their columns", async () => {
  const { balancesChart } = await import("../overview/periodCharts")
  const { account } = await import("../../testing/fixtures")
  const { addDays } = await import("../../domain/days")
  const dates = Array.from({ length: 90 }, (_, i) => addDays("2026-09-01", i))
  const savers = ["💰 General", "🚨 Emergency", "🏖️ Holiday"].map((name, i) => account({ id: i + 1, name, externalKind: "SAVER", balance: [5000, 1000, 3000][i]! }))
  const model = balancesChart("Savers", dates, 100, 15, "2026-10-10", savers, [])
  const width = (runs: Run[]) => runs.reduce((n, run) => n + Bun.stringWidth(run.text), 0)
  const labelled = model.rows.filter((runs) => runs.some((run) => /\p{Extended_Pictographic}/u.test(run.text)))
  expect(labelled.length).toBeGreaterThan(0)
  const frame = gridColumns(model.rows)
  for (const p of [0.3, 0.6, 0.9, 1]) {
    model.rows.forEach((runs, i) => {
      const shown = revealRuns(runs, i, model.rows.length, p, frame)
      expect(width(shown)).toBe(100)
      // Every gridline column of the full row is still a gridline or the line's dots.
      let col = 0
      const at = new Map<number, string>()
      for (const run of shown) for (const ch of [...new Intl.Segmenter().segment(run.text)].map((s) => s.segment)) { at.set(col, ch); col += Bun.stringWidth(ch) }
      for (const [c, g] of frame) if (p < 0.85 && at.get(c) !== undefined && /[⠀-⣿]/.test(at.get(c)!) === false) expect(at.get(c)).toBe(g.text)
    })
  }
})

test("the curves all ease out, from 0 to 1; a higher power gets further sooner and settles longer", () => {
  for (const { power } of CHART_CURVES) {
    expect(easeOut(0, power)).toBe(0)
    expect(easeOut(1, power)).toBe(1)
    expect(easeOut(0.5, power)).toBeGreaterThan(0.5)
  }
  const at = (t: number) => CHART_CURVES.map(({ power }) => easeOut(t, power))
  expect(at(0.2)).toEqual([...at(0.2)].sort((a, b) => a - b))
  // Unknown or missing: the default, cubic, as before.
  expect(chartCurvePower(undefined)).toBe(3)
  expect(chartCurvePower("bogus")).toBe(3)
  expect(easeOut(0.3)).toBe(easeOut(0.3, 3))
})
