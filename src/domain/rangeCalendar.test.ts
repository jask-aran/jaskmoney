import { describe, expect, test } from "bun:test"
import { markedRange, monthWeeks, moveCursor, pageCursor, pageLabel, unitGrid, unitOf, weekdayNames, yearsFrom } from "./rangeCalendar"

describe("the Custom range calendar", () => {
  test("a cell stands for a day, a month or a year; two marks join whichever starts first to whichever ends last", () => {
    expect(unitOf("2026-02-14", "days")).toEqual({ start: "2026-02-14", end: "2026-02-14" })
    expect(unitOf("2026-02-14", "months")).toEqual({ start: "2026-02-01", end: "2026-02-28" })
    expect(unitOf("2024-02-14", "years")).toEqual({ start: "2024-01-01", end: "2024-12-31" })
    // Twice on one month: that month. Backwards: still in order.
    expect(markedRange(unitOf("2026-10-09", "months"), "2026-10-20", "months")).toEqual({ start: "2026-10-01", end: "2026-10-31" })
    expect(markedRange(unitOf("2026-10-09", "days"), "2026-09-28", "days")).toEqual({ start: "2026-09-28", end: "2026-10-09" })
    // A month marked, then a day in the days view.
    expect(markedRange(unitOf("2026-08-15", "months"), "2026-10-03", "days")).toEqual({ start: "2026-08-01", end: "2026-10-03" })
  })

  test("the days view: six weeks from the week start, the month's days only", () => {
    const weeks = monthWeeks("2026-11-17", "monday")
    expect(weeks).toHaveLength(6)
    expect(weeks[0]).toEqual([null, null, null, null, null, null, "2026-11-01"])
    // 1 Nov is a Sunday: the 30th starts the sixth row.
    expect(weeks[5]![0]).toBe("2026-11-30")
    expect(weeks[5]!.slice(1).every((d) => d === null)).toBe(true)
    expect(monthWeeks("2026-02-10", "monday")[5]!.every((d) => d === null)).toBe(true)
    expect(monthWeeks("2026-11-17", "sunday")[0]![0]).toBe("2026-11-01")
    expect(weekdayNames("sunday")[0]).toBe("Su")
  })

  test("arrows move a cell or a row, pages a month, a year or twelve years; the selector says where", () => {
    expect(moveCursor("2026-11-30", "days", "right")).toBe("2026-12-01")
    expect(moveCursor("2026-11-30", "days", "up")).toBe("2026-11-23")
    expect(moveCursor("2026-01-31", "months", "right")).toBe("2026-02-28")
    expect(moveCursor("2026-03-01", "months", "down")).toBe("2026-07-01")
    expect(moveCursor("2026-03-01", "years", "up")).toBe("2022-03-01")
    expect(pageCursor("2026-03-31", "days", -1)).toBe("2026-02-28")
    expect(pageCursor("2026-03-01", "years", 1)).toBe("2038-03-01")
    expect(pageLabel("2026-03-01", "days")).toBe("March 2026")
    expect(pageLabel("2026-03-01", "years")).toBe("2016 – 2027")
    expect(yearsFrom("2028-01-01")).toBe(2028)
    expect(unitGrid("2026-03-01", "months").map((r) => r.length)).toEqual([4, 4, 4])
    expect(unitGrid("2026-03-01", "years")[2]![3]).toBe("2027-01-01")
  })
})
