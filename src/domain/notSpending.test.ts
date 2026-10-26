import { expect, test } from "bun:test"
import { computeCategorySpend } from "./dashboard"
import { computePeriodFlows } from "./position"
import { loadTransactions, openDb } from "../db/client"
import type { Account, Transaction } from "./types"

const account: Account = { id: 1, name: "Spending", type: "debit", sortOrder: 1, isActive: true, source: "up", externalKind: "TRANSACTIONAL", balance: 0, syncEnabled: true }
const row = (id: number, description: string, amount: number, excluded: boolean): Transaction => ({
  id, dateRaw: "x", dateISO: "2026-10-05", amount, description, categoryId: excluded ? 9 : 1, categoryName: excluded ? "Transfers" : "Food",
  categoryColor: "#fff", notes: "", importId: null, accountId: 1, accountName: "Spending", tagNames: [], tagColors: [], tagIds: [],
  source: "up", status: null, transferAccountId: null, internal: false, excluded,
})

test("a not-spending category is left out of spending, income and categories", () => {
  const rows = [row(1, "Cafe", -10, false), row(2, "Wise Account", -1000, true), row(3, "Refund to me", 40, true)]
  const flows = computePeriodFlows([account], rows)
  expect([flows.spent, flows.income, flows.txnCount, flows.savedToSavers]).toEqual([10, 0, 1, 0])
  expect(computeCategorySpend(rows, []).map((c) => c.name)).toEqual(["Food"])
})

test("the loader marks rows in a not-spending category as excluded; Transfers starts as not-spending", () => {
  const db = openDb(":memory:")
  const transfers = db.query("SELECT id, not_spending AS ns FROM categories WHERE name = 'Transfers'").get() as { id: number; ns: number }
  expect(transfers.ns).toBe(1)
  db.query(`INSERT INTO transactions (date_raw, date_iso, amount, description, category_id) VALUES ('x', '2026-10-05', -5, 'w', ?)`).run(transfers.id)
  expect(loadTransactions(db).map((t) => [t.internal, t.excluded])).toEqual([[false, true]])
  db.close()
})
