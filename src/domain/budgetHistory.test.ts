import { expect, test } from "bun:test"
import { budgetIn, budgetsIn } from "./budget"

const overall = { kind: "overall" } as const

test("a cycle's budget is the one in force when it started; before the first, the first", () => {
  const history = [
    { scope: overall, amount: 2000, from: null },
    { scope: overall, amount: 2500, from: "2026-10-14" },
    { scope: overall, amount: null, from: "2026-12-14" },
  ]
  expect(budgetIn(history, overall, "2026-09-14")).toBe(2000)
  expect(budgetIn(history, overall, "2026-10-14")).toBe(2500)
  expect(budgetIn(history, overall, "2026-11-14")).toBe(2500)
  expect(budgetIn(history, overall, "2027-01-14")).toBeNull()
  const later = [{ scope: { kind: "category", categoryId: 3 } as const, amount: 300, from: "2026-10-14" }]
  expect(budgetIn(later, { kind: "category", categoryId: 3 }, "2026-05-14")).toBeNull()
  expect(budgetIn(later, { kind: "category", categoryId: 3 }, "2026-10-14")).toBe(300)
  expect(budgetIn(later, overall, "2026-10-14")).toBeNull()
})

test("the budgets in force in a cycle: today's, and ones since removed, as they were then", () => {
  const rent = { kind: "category", categoryId: 2 } as const
  const history = [
    { scope: overall, amount: 2000, from: null },
    { scope: rent, amount: 1200, from: null },
    { scope: rent, amount: null, from: "2026-08-14" },
  ]
  const today = [{ id: 5, scope: overall, amount: 2000 }]
  expect(budgetsIn(history, today, "2026-07-14")).toEqual([{ id: 5, scope: overall, amount: 2000 }, { id: -2, scope: rent, amount: 1200 }])
  expect(budgetsIn(history, today, "2026-09-14")).toEqual([{ id: 5, scope: overall, amount: 2000 }])
})
