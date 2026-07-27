import { describe, expect, test } from "bun:test"
import {
  barFill,
  computeCategorySpend,
  computeOverview,
  sparkline,
} from "./dashboard"
import type { Category, Transaction } from "./types"

const cats: Category[] = [
  { id: 1, name: "Groceries", color: "#94e2d5", sortOrder: 1, isDefault: false },
  { id: 2, name: "Transport", color: "#89b4fa", sortOrder: 2, isDefault: false },
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
    tagIds: partial.tagIds ?? [],
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
})
