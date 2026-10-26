import { describe, expect, test } from "bun:test"
import {
  barFill,
  computeCategorySpend,
  computeOverview,
  dailySpendSeries,
  sparkline,
  formatWholeMoney,
  groupCategorySpend,
} from "./dashboard"
import type { Category, Transaction } from "./types"

const cats: Category[] = [
  { id: 1, name: "Groceries", color: "#94e2d5", sortOrder: 1, isDefault: false, parentId: null, extId: null },
  { id: 2, name: "Transport", color: "#89b4fa", sortOrder: 2, isDefault: false, parentId: null, extId: null },
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
    tagIds: partial.tagIds ?? [], source: "csv" as const, status: null, transferAccountId: null, internal: false,
  }
}

describe("dashboard aggregates", () => {
  test("overview", () => {
    const s = computeOverview([
      t({ amount: 100, dateISO: "2026-02-01", categoryName: "Income", categoryId: 9 }),
      t({ amount: -40, dateISO: "2026-02-02", categoryName: "Groceries", categoryId: 1 }),
      t({ amount: -10, dateISO: "2026-02-03", categoryName: "Uncategorised" }),
    ])
    expect(s.balance).toBe(50)
    expect(s.debits).toBe(50)
    expect(s.credits).toBe(100)
    expect(s.uncatCount).toBe(1)
  })

  test("uncategorised total is a magnitude, matching Go renderSummaryCards", () => {
    const s = computeOverview([
      t({ amount: 25, dateISO: "2026-02-01", categoryName: "Uncategorised" }),
      t({ amount: -10, dateISO: "2026-02-02", categoryName: "Uncategorised" }),
    ])
    expect(s.uncatTotal).toBe(35)
  })

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

  test("sparkline and bar", () => {
    expect(sparkline([0, 1, 2, 3], 4).length).toBe(4)
    expect(barFill(50, 10)).toBe("█████░░░░░")
  })

  test("category spend excludes internal transfers but retains untracked transfers", () => {
    const debit = t({ amount: -30, dateISO: "2026-02-01", categoryName: "Groceries", categoryId: 1 })
    expect(computeCategorySpend([
      debit,
      { ...debit, amount: -100, internal: true, transferAccountId: 2 },
      { ...debit, amount: -20, transferAccountId: 99 },
    ], cats)).toEqual([{ categoryId: 1, name: "Groceries", color: "#94e2d5", amount: 50, pct: 100 }])
  })

  test("daily spending excludes internal transfers and keeps existing filters", () => {
    const debit = t({ amount: -30, dateISO: "2026-02-01", categoryName: "Groceries" })
    expect(dailySpendSeries([
      debit,
      { ...debit, amount: -100, internal: true, transferAccountId: 2 },
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
      { id: 1, name: "Uncategorised", color: "#7f849c", sortOrder: 1, isDefault: true, parentId: null, extId: null },
      { id: 10, name: "Good Life", color: "#fab387", sortOrder: 2, isDefault: false, parentId: null, extId: "good-life" },
      { id: 11, name: "Takeaway", color: "#fab387", sortOrder: 3, isDefault: false, parentId: 10, extId: "takeaway" },
      { id: 12, name: "Pubs & Bars", color: "#fab387", sortOrder: 4, isDefault: false, parentId: 10, extId: "pubs-and-bars" },
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
