import { expect, test } from "bun:test"
import { allocation, budgetCounts, budgetIgnoredIds, budgetProgress, measuredBudgetIn, measuredBudgets, type Budget, type CycleConfig } from "./budget"
import { account, category, transaction } from "../testing/fixtures"

const months: CycleConfig = { unit: "month", anchor: "calendar", anchorDate: null }

test("the overall budget is everything else: not categories with their own budget, nor those left out; the total is the two together", () => {
  const home = category({ id: 1, name: "Home" })
  const rent = category({ id: 2, name: "Rent", parentId: 1, budgetIgnored: true })
  const groceries = category({ id: 3, name: "Groceries", parentId: 1 })
  const car = category({ id: 4, name: "Car", budgetIgnored: true })
  const insurance = category({ id: 5, name: "Insurance", parentId: 4 })
  const fun = category({ id: 6, name: "Fun" })
  const categories = [home, rent, groceries, car, insurance, fun]
  expect([...budgetIgnoredIds(categories)].sort()).toEqual([2, 4, 5])
  const spend = (id: number, categoryId: number | null, amount: number) => transaction({ id, dateISO: "2026-10-05", amount: -amount, categoryId, accountId: 1 })
  const rows = [spend(1, 2, 1200), spend(2, 3, 300), spend(3, 5, 500), spend(4, null, 40), spend(5, 6, 60)]
  const budgets: Budget[] = [
    { id: 1, scope: { kind: "overall" }, amount: 1000 },
    { id: 2, scope: { kind: "account", accountId: 1 }, amount: 1000 },
    { id: 3, scope: { kind: "category", categoryId: 2 }, amount: 1300 },
    { id: 4, scope: { kind: "category", categoryId: 3 }, amount: 400 },
  ]
  const [overall, onAccount, onRent, onGroceries] = budgetProgress(budgets, months, "2026-10-10", [account({ id: 1 })], categories, rows)
  // Everything else: Fun and uncategorised (Rent and Groceries have their own; Car is left out).
  expect(overall!.spent).toBe(100)
  // An account's: everything on it but what's left out.
  expect(onAccount!.spent).toBe(400)
  // Left out, Rent still counts toward its own budget.
  expect(onRent!.spent).toBe(1200)
  expect(onGroceries!.spent).toBe(300)
  // The total: all but Car (left out, no budget of its own).
  const total = rows.filter(budgetCounts({ kind: "total" }, categories, budgets)).reduce((sum, t) => sum - t.amount, 0)
  expect(total).toBe(1600)
  // The overall budget is the cap: the categories ask $700 more than it.
  expect(allocation(budgets, categories)).toEqual({ overall: 1000, allocated: 1700, total: 1000, rest: -700 })
})

test("category budgets come out of the overall budget: the cap stays the total, everything else gets the rest", () => {
  const groceries = category({ id: 3, name: "Groceries" })
  const cap: Budget = { id: 1, scope: { kind: "overall" }, amount: 2000 }
  const food: Budget = { id: 2, scope: { kind: "category", categoryId: 3 }, amount: 300 }
  // $300 to Groceries leaves everything else $1,700; the total (the top-up target) stays $2,000.
  expect(allocation([cap, food], [groceries])).toEqual({ overall: 2000, allocated: 300, total: 2000, rest: 1700 })
  expect(measuredBudgets([cap, food], [groceries]).map((b) => b.amount)).toEqual([1700, 300])
  // Categories asking more than the cap leave everything else nothing.
  expect(measuredBudgets([cap, { ...food, amount: 2500 }], [groceries])[0]!.amount).toBe(0)
  // In a past cycle, as the budgets were then.
  const history = [{ scope: cap.scope, amount: 2000, from: null }, { scope: food.scope, amount: 300, from: "2026-09-01" }]
  expect(measuredBudgetIn(history, [cap, food], [groceries], { kind: "overall" }, "2026-08-01")).toBe(2000)
  expect(measuredBudgetIn(history, [cap, food], [groceries], { kind: "overall" }, "2026-09-01")).toBe(1700)
})
