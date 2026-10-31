import { expect, test } from "bun:test"
import { budgetIn } from "./budget"

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
  // A budget first set this cycle: earlier cycles are measured against it.
  const later = [{ scope: { kind: "category", categoryId: 3 } as const, amount: 300, from: "2026-10-14" }]
  expect(budgetIn(later, { kind: "category", categoryId: 3 }, "2026-05-14")).toBe(300)
  expect(budgetIn(later, overall, "2026-10-14")).toBeNull()
})
