import { expect, test } from "bun:test"
import { spendingCalendar } from "../../domain/spending"
import { calendarLayout, monthLabels } from "./CalendarView"

/** What a calendar shows is decided by how big its cells come out, never
 * by the range (2026-10-30). */

test("a month in a roomy pane: day numbers with each day's spending under them, cells apart", () => {
  const l = calendarLayout(5, 95, 20)
  expect(l).toMatchObject({ weeks: 5, gap: 1, dayNumbers: true, amounts: "below" })
  expect(l.widths.reduce((a, b) => a + b, 0)).toBe(91)
})

test("the same month squeezed loses amounts, then numbers: a carpet", () => {
  expect(calendarLayout(5, 60, 9)).toMatchObject({ band: 1, dayNumbers: true, amounts: "beside" })
  expect(calendarLayout(5, 40, 9)).toMatchObject({ dayNumbers: true, amounts: null })
  expect(calendarLayout(5, 20, 9)).toMatchObject({ gap: 0, dayNumbers: false, amounts: null })
})

test("a year is a carpet that still fills the pane: weeks share the spare columns", () => {
  const l = calendarLayout(53, 95, 20)
  expect(l.dayNumbers).toBe(false)
  expect(l.widths.reduce((a, b) => a + b, 0)).toBe(91)
  expect(new Set(l.widths)).toEqual(new Set([1, 2]))
  // And a quarter in a big pane gets numbers, not because it's a quarter.
  expect(calendarLayout(14, 200, 30).dayNumbers).toBe(true)
  expect(calendarLayout(14, 60, 30).dayNumbers).toBe(false)
  // Six months in a usual pane: bare colour, no stripes.
  expect(calendarLayout(27, 93, 19)).toMatchObject({ gap: 0, dayNumbers: false })
})

test("more weeks than columns: the latest that fit", () => {
  expect(calendarLayout(120, 60, 20)).toMatchObject({ weeks: 56, cell: 1 })
})

test("month names sit over the week holding the 1st, with spending when every month has room, else names alone", () => {
  // 30 Jul (a Thursday) to 30 Sep: the first week holds 1 Aug, so it's August's.
  const weeks = spendingCalendar([], "2026-07-30", "2026-09-30")
  const roomy = monthLabels(weeks, weeks.map(() => 8), "2026-09-30")
  expect(roomy.trim().split(/\s+/)).toEqual(["Aug", "Sep"])
  expect(roomy.indexOf("Aug")).toBe(0)
  const tight = monthLabels(weeks, weeks.map(() => 1), "2026-09-30")
  expect(tight).not.toContain("$")
})
