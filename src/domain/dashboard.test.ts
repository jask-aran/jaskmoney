import { describe, expect, test } from "bun:test"
import {
  computeCategorySpend,
  cumulative,
  dailySpendSeries,
  formatWholeMoney,
  groupCategorySpend,
  weeklyTotals,
} from "./dashboard"
import type { Category, Transaction } from "./types"

const cats: Category[] = [
  { id: 1, name: "Groceries", color: "#94e2d5", sortOrder: 1, isDefault: false, parentId: null, extId: null , notSpending: false},
  { id: 2, name: "Transport", color: "#89b4fa", sortOrder: 2, isDefault: false, parentId: null, extId: null , notSpending: false},
]

function t(
  partial: Partial<Transaction> & Pick<Transaction, "amount" | "dateISO" | "categoryName">,
): Transaction {
  return {
    id: 1,
    dateRaw: partial.dateISO,
    dateISO: partial.dateISO,
    amount: partial.amount,
    description: "x",
    categoryId: partial.categoryId ?? null,
    categoryName: partial.categoryName,
    categoryColor: partial.categoryColor ?? "#7f849c",
    notes: "",
    importId: null,
    accountId: 1,
    accountName: "A",
    tagNames: partial.tagNames ?? [],
    tagColors: partial.tagColors ?? [],
    tagIds: partial.tagIds ?? [], source: "csv" as const, status: null, transferAccountId: null, internal: false, excluded: false,
  }
}

describe("dashboard aggregates", () => {
  test("category spend ignores credits and IGNORE", () => {
    const list = computeCategorySpend(
      [
        t({ amount: -30, dateISO: "2026-02-01", categoryName: "Groceries", categoryId: 1 }),
        t({ amount: -20, dateISO: "2026-02-01", categoryName: "Transport", categoryId: 2 }),
        t({ amount: -50, dateISO: "2026-02-01", categoryName: "Groceries", categoryId: 1, tagNames: ["IGNORE"] }),
        t({ amount: 100, dateISO: "2026-02-01", categoryName: "Income", categoryId: 9 }),
      ],
      cats,
    )
    expect(list[0]!.name).toBe("Groceries")
    expect(list[0]!.amount).toBe(30)
    expect(list).toHaveLength(2)
  })

  test("category spend excludes internal transfers but retains untracked transfers", () => {
    const debit = t({ amount: -30, dateISO: "2026-02-01", categoryName: "Groceries", categoryId: 1 })
    expect(computeCategorySpend([
      debit,
      { ...debit, amount: -100, internal: true, excluded: true, transferAccountId: 2 },
      { ...debit, amount: -20, transferAccountId: 99 },
    ], cats)).toEqual([{ categoryId: 1, name: "Groceries", color: "#94e2d5", amount: 50, pct: 100 }])
  })

  test("daily spending excludes internal transfers and keeps existing filters", () => {
    const debit = t({ amount: -30, dateISO: "2026-02-01", categoryName: "Groceries" })
    expect(dailySpendSeries([
      debit,
      { ...debit, amount: -100, internal: true, excluded: true, transferAccountId: 2 },
      { ...debit, amount: -20, transferAccountId: 99 },
      { ...debit, amount: -100, tagNames: ["iGnOrE"] },
      { ...debit, amount: 100 },
      { ...debit, dateISO: "2026-01-31" },
      { ...debit, dateISO: "2026-02-03" },
    ], "2026-02-01", "2026-02-02")).toEqual({ dates: ["2026-02-01", "2026-02-02"], values: [50, 0] })
  })
})

describe("category groups", () => {
  test("subcategories roll up into their group; ungrouped categories stand alone; whole-dollar format", () => {
    const tree = [
      { id: 1, name: "Uncategorised", color: "#7f849c", sortOrder: 1, isDefault: true, parentId: null, extId: null , notSpending: false},
      { id: 10, name: "Good Life", color: "#fab387", sortOrder: 2, isDefault: false, parentId: null, extId: "good-life" , notSpending: false},
      { id: 11, name: "Takeaway", color: "#fab387", sortOrder: 3, isDefault: false, parentId: 10, extId: "takeaway" , notSpending: false},
      { id: 12, name: "Pubs & Bars", color: "#fab387", sortOrder: 4, isDefault: false, parentId: 10, extId: "pubs-and-bars" , notSpending: false},
    ]
    const groups = groupCategorySpend([
      { categoryId: 1, name: "Uncategorised", color: "#7f849c", amount: 50, pct: 0 },
      { categoryId: 11, name: "Takeaway", color: "#fab387", amount: 30, pct: 0 },
      { categoryId: 12, name: "Pubs & Bars", color: "#fab387", amount: 40, pct: 0 },
    ], tree)
    expect(groups.map((g) => [g.name, g.amount, Math.round(g.pct), g.children.map((c) => c.name)])).toEqual([
      ["Good Life", 70, 58, ["Pubs & Bars", "Takeaway"]],
      ["Uncategorised", 50, 42, []],
    ])
    expect(formatWholeMoney(1477.6)).toBe("$1,478")
    expect(formatWholeMoney(-20.2)).toBe("-$20")
  })
})

describe("tracker series", () => {
  test("cumulative running totals", () => {
    expect(cumulative([1, 0, 2.5])).toEqual([1, 1, 3.5])
  })

  test("weekly totals start on Mondays; edge weeks are partial", () => {
    // 2026-10-01 is a Thursday; 2026-10-05 a Monday.
    const dates = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06"]
    expect(weeklyTotals(dates, [1, 2, 3, 4, 5, 6])).toEqual([
      { startISO: "2026-10-01", total: 10, days: 4 },
      { startISO: "2026-10-05", total: 11, days: 2 },
    ])
  })

  test("daily series steps calendar days across DST", () => {
    // Sydney DST ends 2027-04-04 (a 25-hour day) in local time.
    const { dates } = dailySpendSeries([], "2027-04-03", "2027-04-06")
    expect(dates).toEqual(["2027-04-03", "2027-04-04", "2027-04-05", "2027-04-06"])
  })
})
