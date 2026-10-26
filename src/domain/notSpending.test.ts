import { expect, test } from "bun:test"
import { computeCategorySpend } from "./dashboard"
import { computePeriodFlows } from "./position"
import { loadTransactions } from "../db/client"
import { account, transaction } from "../testing/fixtures"
import { testDb } from "../testing/scoped"

const row = (id: number, description: string, amount: number, excluded: boolean) => transaction({
  id, amount, description, excluded, categoryId: excluded ? 9 : 1, categoryName: excluded ? "Transfers" : "Food",
})

test("a not-spending category is left out of spending, income and categories", () => {
  const rows = [row(1, "Cafe", -10, false), row(2, "Wise Account", -1000, true), row(3, "Refund to me", 40, true)]
  const flows = computePeriodFlows([account({ name: "Spending", balance: 0 })], rows)
  expect([flows.spent, flows.income, flows.txnCount, flows.savedToSavers]).toEqual([10, 0, 1, 0])
  expect(computeCategorySpend(rows, []).map((c) => c.name)).toEqual(["Food"])
})

test("the loader marks rows in a not-spending category as excluded; Transfers starts as not-spending", () => {
  const db = testDb()
  const transfers = db.query("SELECT id, not_spending AS ns FROM categories WHERE name = 'Transfers'").get() as { id: number; ns: number }
  expect(transfers.ns).toBe(1)
  db.query(`INSERT INTO transactions (date_raw, date_iso, amount, description, category_id) VALUES ('x', '2026-10-05', -5, 'w', ?)`).run(transfers.id)
  expect(loadTransactions(db).map((t) => [t.internal, t.excluded])).toEqual([[false, true]])
})
