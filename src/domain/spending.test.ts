import { describe, expect, test } from "bun:test"
import { spendingCalendar, type CalendarDay } from "./spending"
import type { Transaction } from "./types"
import { transaction } from "../testing/fixtures"

const row = (amount: number, overrides: Partial<Transaction> = {}) => transaction({ amount, ...overrides })

const excluded = [row(100), row(0), row(-100, { internal: true, excluded: true }), row(-100, { tagNames: ["other", "iGnOrE"] })]

describe("spendingCalendar", () => {
  test("pads both ends with Monday at row zero", () => {
    expect(spendingCalendar([], "2026-10-04", "2026-10-06")).toEqual([
      [null, null, null, null, null, null, { dateISO: "2026-10-04", spent: 0, level: 0 }],
      [{ dateISO: "2026-10-05", spent: 0, level: 0 }, { dateISO: "2026-10-06", spent: 0, level: 0 }, null, null, null, null, null],
    ])
  })

  test("single partial week and whole week have exactly seven cells", () => {
    const partial = spendingCalendar([], "2026-10-07", "2026-10-07")
    expect(partial).toEqual([[null, null, { dateISO: "2026-10-07", spent: 0, level: 0 }, null, null, null, null]])
    const full = spendingCalendar([], "2026-10-05", "2026-10-11")
    expect(full).toHaveLength(1)
    expect(full[0]).toHaveLength(7)
    expect(full[0].every((day) => day !== null)).toBe(true)
  })

  test("October dates remain consecutive across Melbourne DST", () => {
    const weeks = spendingCalendar([], "2026-10-01", "2026-10-31")
    expect(weeks).toHaveLength(5)
    expect(weeks.flat().filter((d) => d !== null).map((d) => d.dateISO)).toEqual(
      Array.from({ length: 31 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`),
    )
    expect(weeks[0].slice(0, 3)).toEqual([null, null, null])
    expect(weeks[4][6]).toBeNull()
    expect(weeks[1][0]?.dateISO).toBe("2026-10-05")
  })

  test("sums daily spending, excludes ineligible and outside rows, and assigns quartiles", () => {
    const rows = [row(-1), row(-1), ...[4, 6, 8].map((n, i) => row(-n, { dateISO: `2026-10-0${i + 6}` })),
      ...excluded, row(-900, { dateISO: "2026-10-04" }), row(-900, { dateISO: "2026-10-12" })]
    expect(spendingCalendar(rows, "2026-10-05", "2026-10-11")[0]).toEqual([
      { dateISO: "2026-10-05", spent: 2, level: 1 },
      { dateISO: "2026-10-06", spent: 4, level: 2 },
      { dateISO: "2026-10-07", spent: 6, level: 3 },
      { dateISO: "2026-10-08", spent: 8, level: 4 },
      { dateISO: "2026-10-09", spent: 0, level: 0 },
      { dateISO: "2026-10-10", spent: 0, level: 0 },
      { dateISO: "2026-10-11", spent: 0, level: 0 },
    ])
  })

  for (const { values, levels } of [
    { values: [1, 1, 2, 3, 4], levels: [1, 1, 3, 4, 4] },
    { values: [7, 7, 7, 7, 7], levels: [1, 1, 1, 1, 1] },
    { values: [7], levels: [4] },
    { values: [1, 2, 2], levels: [2, 3, 3] },
  ] satisfies Array<{ values: number[]; levels: CalendarDay["level"][] }>) {
    test(`first rank determines tied levels for ${values}`, () => {
      const rows = values.map((value, i) => row(-value, { dateISO: `2026-10-${String(i + 5).padStart(2, "0")}` }))
      expect(spendingCalendar(rows, "2026-10-05", "2026-10-11")[0].slice(0, values.length).map((d) => d?.level)).toEqual(levels)
    })
  }
})

test("Sunday-start calendar pads Saturday then begins a new week on Sunday", () => {
  const weeks = spendingCalendar([], "2026-10-03", "2026-10-05", "sunday")
  expect(weeks).toEqual([
    [null, null, null, null, null, null, { dateISO: "2026-10-03", spent: 0, level: 0 }],
    [{ dateISO: "2026-10-04", spent: 0, level: 0 }, { dateISO: "2026-10-05", spent: 0, level: 0 }, null, null, null, null, null],
  ])
})
