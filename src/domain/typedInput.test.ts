import { describe, expect, test } from "bun:test"
import { amountFromText, dayFromText, rangeDayFromText, rangeDayText } from "./typedInput"

describe("amountFromText", () => {
  test("reads plain amounts, ignoring $, commas and spaces", () => {
    expect(amountFromText("120")).toBe(120)
    expect(amountFromText("$1,250.50")).toBe(1250.5)
    expect(amountFromText("  80 ")).toBe(80)
    expect(amountFromText(".5")).toBe(0.5)
  })

  test("does arithmetic with the usual precedence and brackets", () => {
    expect(amountFromText("12+3.5*2")).toBe(19)
    expect(amountFromText("(12+3)*2")).toBe(30)
    expect(amountFromText("600/4")).toBe(150)
    expect(amountFromText("100 - 20 - 5")).toBe(75)
    expect(amountFromText("-5+10")).toBe(5)
    expect(amountFromText("$50 * 4")).toBe(200)
  })

  test("rounds to cents", () => {
    expect(amountFromText("100/3")).toBe(33.33)
    expect(amountFromText("0.1+0.2")).toBe(0.3)
  })

  test("refuses what isn't an amount", () => {
    for (const bad of ["", "   ", "abc", "12+", "*3", "(1+2", "1+2)", "1/0", "12..5", "1e3", "2**3", "Math.PI", "1;2"]) {
      expect(amountFromText(bad)).toBeNull()
    }
  })
})

describe("dayFromText", () => {
  const today = "2026-11-02"

  test("a day number alone is that day of this month", () => {
    expect(dayFromText("18", today)).toBe("2026-11-18")
    expect(dayFromText("1", today)).toBe("2026-11-01")
    expect(dayFromText("07", today)).toBe("2026-11-07")
  })

  test("day/month is this year; day/month/year takes two or four digit years", () => {
    expect(dayFromText("18/11", today)).toBe("2026-11-18")
    expect(dayFromText("3/2", today)).toBe("2026-02-03")
    expect(dayFromText("18/11/25", today)).toBe("2025-11-18")
    expect(dayFromText("18/11/2025", today)).toBe("2025-11-18")
    expect(dayFromText("18-11-2025", today)).toBe("2025-11-18")
    expect(dayFromText("18.11.25", today)).toBe("2025-11-18")
  })

  test("full ISO dates still work", () => {
    expect(dayFromText("2025-06-30", today)).toBe("2025-06-30")
    expect(dayFromText(" 2025-06-30 ", today)).toBe("2025-06-30")
  })

  test("refuses days that don't exist and other text", () => {
    for (const bad of ["", "0", "32", "31/11", "30/2", "29/2/25", "18/13", "2026-02-30", "abc", "18/11/202", "1/2/3/4"]) {
      expect(dayFromText(bad, today)).toBeNull()
    }
    expect(dayFromText("29/2/28", today)).toBe("2028-02-29")
    expect(dayFromText("31", "2026-02-10")).toBeNull()
  })
})

describe("rangeDayFromText", () => {
  const today = "2026-11-02"
  test("reads what dayFromText does, and today, days back, day and month, and a month alone", () => {
    expect(rangeDayFromText("18/11/2025", today, "start")).toBe("2025-11-18")
    expect(rangeDayFromText("today", today, "start")).toBe(today)
    expect(rangeDayFromText(" Today ", today, "end")).toBe(today)
    expect(rangeDayFromText("-14", today, "start")).toBe("2026-10-19")
    expect(rangeDayFromText("1 oct", today, "start")).toBe("2026-10-01")
    expect(rangeDayFromText("1 October 2025", today, "end")).toBe("2025-10-01")
    expect(rangeDayFromText("2 Sep 2026", today, "start")).toBe("2026-09-02")
    // A month: its first day as a start, its last as an end.
    expect(rangeDayFromText("feb", today, "start")).toBe("2026-02-01")
    expect(rangeDayFromText("feb", today, "end")).toBe("2026-02-28")
    expect(rangeDayFromText("Sept 24", today, "end")).toBe("2024-09-30")
    // A blank end is today; a blank start isn't a date.
    expect(rangeDayFromText("", today, "end")).toBe(today)
    expect(rangeDayFromText("", today, "start")).toBeNull()
    for (const bad of ["ma", "31 feb", "smarch", "1 oct 202", "--3"]) expect(rangeDayFromText(bad, today, "start")).toBeNull()
  })

  test("writes a day the way it reads one back", () => {
    for (const iso of ["2026-09-02", "2025-12-31"]) expect(rangeDayFromText(rangeDayText(iso), today, "start")).toBe(iso)
    expect(rangeDayText("2026-09-02")).toBe("2 Sep 2026")
  })
})
