import { describe, expect, test } from "bun:test"
import {
  computeCategorySpend,
  dailySpendSeries,
  groupCategorySpend,
  weeklyTotals,
} from "./dashboard"
import { category, transaction } from "../testing/fixtures"

const cats = [
  category({ id: 1, name: "Groceries", color: "#94e2d5" }),
  category({ id: 2, name: "Transport", color: "#89b4fa" }),
]

describe("dashboard aggregates", () => {
  test("category spend nets refunds and ignores income, uncategorised money in, IGNORE and internal transfers, but keeps untracked transfers", () => {
    const list = computeCategorySpend(
      [
        transaction({ amount: -30, dateISO: "2026-02-01", categoryName: "Groceries", categoryId: 1 }),
        transaction({ amount: 5, dateISO: "2026-02-01", categoryName: "Groceries", categoryId: 1 }),
        transaction({ amount: -20, dateISO: "2026-02-01", categoryName: "Transport", categoryId: 2 }),
        transaction({ amount: -50, dateISO: "2026-02-01", categoryName: "Groceries", categoryId: 1, tagNames: ["IGNORE"] }),
        transaction({ amount: 100, dateISO: "2026-02-01", categoryName: "Salary", categoryId: 9, income: true }),
        transaction({ amount: 40, dateISO: "2026-02-01" }),
      ],
      cats,
    )
    expect(list.map((c) => [c.name, c.amount])).toEqual([["Groceries", 25], ["Transport", 20]])
    const debit = transaction({ amount: -30, dateISO: "2026-02-01", categoryName: "Groceries", categoryId: 1 })
    expect(computeCategorySpend([
      debit,
      { ...debit, amount: -100, internal: true, excluded: true, transferAccountId: 2 },
      { ...debit, amount: -20, transferAccountId: 99 },
    ], cats)).toEqual([{ categoryId: 1, name: "Groceries", color: "#94e2d5", amount: 50, pct: 100 }])
  })

  test("daily spending excludes internal transfers and keeps existing filters", () => {
    const debit = transaction({ amount: -30, dateISO: "2026-02-01", categoryName: "Groceries" })
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
  test("subcategories roll up into their group; ungrouped categories stand alone", () => {
    const tree = [
      category({ id: 1, name: "Uncategorised", color: "#7f849c", sortOrder: 1, isDefault: true }),
      category({ id: 10, name: "Good Life", color: "#fab387", sortOrder: 2, extId: "good-life" }),
      category({ id: 11, name: "Takeaway", color: "#fab387", sortOrder: 3, parentId: 10, extId: "takeaway" }),
      category({ id: 12, name: "Pubs & Bars", color: "#fab387", sortOrder: 4, parentId: 10, extId: "pubs-and-bars" }),
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
  })
})

describe("tracker series", () => {
  test("weekly totals start on the week start (Monday or Sunday); edge weeks are partial", () => {
    // 2026-10-01 is a Thursday; 2026-10-05 a Monday.
    const dates = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06"]
    expect(weeklyTotals(dates, [1, 2, 3, 4, 5, 6])).toEqual([
      { startISO: "2026-10-01", total: 10, days: 4 },
      { startISO: "2026-10-05", total: 11, days: 2 },
    ])
    expect(weeklyTotals(dates.slice(2), [3, 4, 5, 6], "sunday")).toEqual([
      { startISO: "2026-10-03", total: 3, days: 1 },
      { startISO: "2026-10-04", total: 15, days: 3 },
    ])
  })
})
