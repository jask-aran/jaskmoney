import { expect, test } from "bun:test"
import { ensureSchema, loadBudgetHistory, recordBudget } from "./client"
import { testDb } from "../testing/scoped"

test("a budget is remembered from the date given: again from the same date replaces it; deleting is no budget from then", () => {
  const db = testDb()
  const now = "2026-11-14"
  recordBudget(db, { kind: "overall" }, 2000, "2026-09-14", now)
  recordBudget(db, { kind: "overall" }, 2500, "2026-10-14", now)
  recordBudget(db, { kind: "overall" }, 2700, "2026-10-14", now)
  recordBudget(db, { kind: "category", categoryId: 7 }, 300, "2026-10-14", now)
  recordBudget(db, { kind: "category", categoryId: 7 }, null, "2026-11-14", now)
  expect(loadBudgetHistory(db)).toEqual([
    { scope: { kind: "overall" }, amount: 2000, from: "2026-09-14" },
    { scope: { kind: "overall" }, amount: 2700, from: "2026-10-14" },
    { scope: { kind: "category", categoryId: 7 }, amount: 300, from: "2026-10-14" },
    { scope: { kind: "category", categoryId: 7 }, amount: null, from: "2026-11-14" },
  ])
})

test("without a date a budget has always been so; upgrading keeps each budget as it is, always", () => {
  const db = testDb()
  recordBudget(db, { kind: "account", accountId: 2 }, 900, null, "2026-11-14")
  expect(loadBudgetHistory(db)).toEqual([{ scope: { kind: "account", accountId: 2 }, amount: 900, from: null }])
  db.exec("DROP TABLE budget_history; UPDATE schema_meta SET version = 33")
  ensureSchema(db)
  expect(loadBudgetHistory(db)).toEqual([{ scope: { kind: "account", accountId: 2 }, amount: 900, from: null }])
})
