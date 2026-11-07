import { expect, test } from "bun:test"
import { deleteBudget, loadBudgetCycle, loadBudgets, saveBudget, saveBudgetCycle } from "./client"
import { testDb } from "../testing/scoped"

test("one budget per scope (saving again replaces the amount); cycle defaults to calendar months and validates dates", () => {
  const db = testDb()
  expect(loadBudgetCycle(db)).toEqual({ unit: "month", anchor: "calendar", anchorDate: null, payEarly: false })
  const overall = saveBudget(db, { kind: "overall" }, 3000)
  expect(saveBudget(db, { kind: "overall" }, 3200)).toBe(overall)
  saveBudget(db, { kind: "category", categoryId: 7 }, 400)
  saveBudget(db, { kind: "account", accountId: 2 }, 2500)
  expect(loadBudgets(db)).toEqual([
    { id: overall, amount: 3200, scope: { kind: "overall" } },
    { id: expect.any(Number), amount: 400, scope: { kind: "category", categoryId: 7 } },
    { id: expect.any(Number), amount: 2500, scope: { kind: "account", accountId: 2 } },
  ])
  expect(() => saveBudget(db, { kind: "overall" }, -1)).toThrow("positive")
  deleteBudget(db, overall)
  expect(loadBudgets(db)).toHaveLength(2)
  expect(() => saveBudgetCycle(db, { unit: "fortnight", anchor: "date", anchorDate: "15/10" })).toThrow("YYYY-MM-DD")
  saveBudgetCycle(db, { unit: "fortnight", anchor: "date", anchorDate: "2026-10-16", payEarly: true })
  expect(loadBudgetCycle(db)).toEqual({ unit: "fortnight", anchor: "date", anchorDate: "2026-10-16", payEarly: true })
  saveBudgetCycle(db, { unit: "week", anchor: "calendar", anchorDate: "2026-10-16" })
  expect(loadBudgetCycle(db)).toEqual({ unit: "week", anchor: "calendar", anchorDate: null, payEarly: false })
})
