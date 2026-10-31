import { expect, test } from "bun:test"
import { budgetIgnoredIds, budgetProgress, type CycleConfig } from "./budget"
import { account, category, transaction } from "../testing/fixtures"

const months: CycleConfig = { unit: "month", anchor: "calendar", anchorDate: null }

test("an ignored category, or one under an ignored group, is left out of the overall and account budgets but keeps its own", () => {
  const home = category({ id: 1, name: "Home" })
  const rent = category({ id: 2, name: "Rent", parentId: 1, budgetIgnored: true })
  const groceries = category({ id: 3, name: "Groceries", parentId: 1 })
  const car = category({ id: 4, name: "Car", budgetIgnored: true })
  const insurance = category({ id: 5, name: "Insurance", parentId: 4 })
  const categories = [home, rent, groceries, car, insurance]
  expect([...budgetIgnoredIds(categories)].sort()).toEqual([2, 4, 5])
  const spend = (id: number, categoryId: number, amount: number) => transaction({ id, dateISO: "2026-10-05", amount: -amount, categoryId, accountId: 1 })
  const rows = [spend(1, 2, 1200), spend(2, 3, 300), spend(3, 5, 500), transaction({ id: 4, dateISO: "2026-10-06", amount: -40, categoryId: null, accountId: 1 })]
  const [overall, onAccount, onRent, onHome] = budgetProgress([
    { id: 1, scope: { kind: "overall" }, amount: 1000 },
    { id: 2, scope: { kind: "account", accountId: 1 }, amount: 1000 },
    { id: 3, scope: { kind: "category", categoryId: 2 }, amount: 1300 },
    { id: 4, scope: { kind: "category", categoryId: 1 }, amount: 2000 },
  ], months, "2026-10-10", [account({ id: 1 })], categories, rows)
  expect(overall!.spent).toBe(340)
  expect(onAccount!.spent).toBe(340)
  expect(onRent!.spent).toBe(1200)
  // A group's own budget counts everything in it, ignored or not.
  expect(onHome!.spent).toBe(1500)
})
