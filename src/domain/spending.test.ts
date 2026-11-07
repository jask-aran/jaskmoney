import { describe, expect, test } from "bun:test"
import { spendingCalendar } from "./spending"
import type { Transaction } from "./types"
import { transaction } from "../testing/fixtures"

const row = (amount: number, overrides: Partial<Transaction> = {}) => transaction({ amount, ...overrides })

const excluded = [row(100), row(0), row(-100, { internal: true, excluded: true }), row(-100, { tagNames: ["other", "iGnOrE"] })]

describe("spendingCalendar", () => {
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
})
