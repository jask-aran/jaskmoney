import { describe, expect, test } from "bun:test"
import { merchantSummaries, spendingCalendar, type CalendarDay } from "./spending"
import type { Transaction } from "./types"

function row(amount: number, overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 1, dateRaw: "2026-10-05", dateISO: "2026-10-05", amount,
    description: "Shop", categoryId: null, categoryName: "Food",
    categoryColor: "", notes: "", importId: null, accountId: 1, accountName: "A",
    tagNames: [], tagColors: [], tagIds: [], source: "up", status: "SETTLED",
    transferAccountId: null, internal: false, ...overrides,
  }
}

const excluded = [row(100), row(0), row(-100, { internal: true }), row(-100, { tagNames: ["other", "iGnOrE"] })]

describe("merchantSummaries", () => {
  test("groups exact descriptions, computes totals and average, and finds latest unsorted date", () => {
    // Unlike the legacy dashboard, the spending-tab spec preserves stored names.
    expect(merchantSummaries([
      row(-12, { dateISO: "2026-10-07" }), row(-6),
      row(-3, { description: " Shop" }), row(-2, { description: "" }),
      ...excluded,
    ], "2026-10-05", "2026-10-07")).toEqual([
      { merchant: "Shop", count: 2, total: 18, average: 9, lastISO: "2026-10-07", previousTotal: 0, categoryName: "Food" },
      { merchant: " Shop", count: 1, total: 3, average: 3, lastISO: "2026-10-05", previousTotal: 0, categoryName: "Food" },
      { merchant: "", count: 1, total: 2, average: 2, lastISO: "2026-10-05", previousTotal: 0, categoryName: "Food" },
    ])
  })

  test("previous window has equal inclusive length across DST and excludes both outer dates", () => {
    const result = merchantSummaries([
      row(-900, { dateISO: "2026-09-27" }),
      row(-10, { dateISO: "2026-09-28" }), row(-20, { dateISO: "2026-10-01" }),
      row(-4, { dateISO: "2026-10-02" }), row(-6),
      row(-900, { dateISO: "2026-10-06" }),
      row(-99, { dateISO: "2026-09-30", description: "Previous only" }),
      ...excluded.map((r) => ({ ...r, dateISO: "2026-10-01" })),
    ], "2026-10-02", "2026-10-05")
    expect(result).toEqual([
      { merchant: "Shop", count: 2, total: 10, average: 5, lastISO: "2026-10-05", previousTotal: 30, categoryName: "Food" },
    ])
    expect(merchantSummaries([row(-2, { dateISO: "2025-12-31" }), row(-3, { dateISO: "2026-01-01" })], "2026-01-01", "2026-01-01")[0]?.previousTotal).toBe(2)
  })

  test("category precedence is count, total, then alphabetical, independent of input order", () => {
    const rows = [
      row(-1, { categoryName: "Frequent" }), row(-1, { categoryName: "Frequent" }), row(-100, { categoryName: "Rare" }),
      row(-10, { description: "Totals", categoryName: "A" }), row(-20, { description: "Totals", categoryName: "Z" }),
      row(-5, { description: "Alphabet", categoryName: "Z" }), row(-5, { description: "Alphabet", categoryName: "A" }),
    ]
    for (const input of [rows, [...rows].reverse()]) {
      expect(merchantSummaries(input, "2026-10-05", "2026-10-05").map((r) => r.categoryName)).toEqual(["Frequent", "Z", "A"])
    }
  })

  test("orders equal totals by count then merchant name", () => {
    const rows = [row(-20, { description: "Z" }), row(-20, { description: "A" }), row(-10, { description: "Many" }), row(-10, { description: "Many" })]
    expect(merchantSummaries(rows, "2026-10-05", "2026-10-05").map((r) => r.merchant)).toEqual(["Many", "A", "Z"])
  })

  test("empty or excluded input yields no merchants", () => {
    expect(merchantSummaries([], "2026-10-05", "2026-10-05")).toEqual([])
    expect(merchantSummaries(excluded, "2026-10-05", "2026-10-05")).toEqual([])
  })
})

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
