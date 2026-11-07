import { expect, test } from "bun:test"
import { addDays, daysBetween, weekdayIndex } from "./days"

test("calendar arithmetic crosses leap days, years and both Sydney DST boundaries", () => {
  expect(addDays("2024-02-28", 1)).toBe("2024-02-29")
  expect(addDays("2026-12-31", 1)).toBe("2027-01-01")
  expect(addDays("2027-04-03", 3)).toBe("2027-04-06")
  expect(addDays("2026-10-03", 3)).toBe("2026-10-06")
  expect(daysBetween("2027-04-03", "2027-04-06")).toBe(3)
  expect(daysBetween("2026-10-06", "2026-10-03")).toBe(-3)
  expect(weekdayIndex("2026-10-04")).toBe(0)
  expect(weekdayIndex("2026-10-05")).toBe(1)
})
