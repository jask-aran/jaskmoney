import { expect, test } from "bun:test"
import type { Category } from "../domain/types"
import { categoryRows, originCounts } from "./taxonomyRows"

let next = 1
const cat = (name: string, over: Partial<Category> = {}): Category => ({
  id: next++, name, color: "#89b4fa", sortOrder: next, isDefault: false, parentId: null, extId: null,
  notSpending: false, income: false, budgetIgnored: false, ...over,
})

// Up's groups and Jaskmoney's own, as a synced database holds them: Income's
// subcategories sorted last, after Up's.
const home = cat("Home", { extId: "home" })
const groceries = cat("Groceries", { extId: "groceries", parentId: home.id })
const rent = cat("Rent", { extId: "rent", parentId: home.id })
const income = cat("Income", { income: true })
const transfers = cat("Transfers", { notSpending: true })
const uncategorised = cat("Uncategorised", { isDefault: true })
const mine = cat("Side gigs", { parentId: home.id })
const salary = cat("Salary", { income: true, parentId: income.id })
const interest = cat("Interest", { income: true, parentId: income.id })
const all = [home, groceries, rent, income, transfers, uncategorised, mine, salary, interest]
const names = (open: number[]) => categoryRows(all, open).map((row) => `${"  ".repeat(row.depth)}${row.category.name}`)

test("Jaskmoney's categories come first, then Up's; groups closed, with their size", () => {
  expect(names([])).toEqual(["Income", "Transfers", "Uncategorised", "Home"])
  const rows = categoryRows(all, [])
  expect(rows.map((row) => [row.origin, row.children, row.open])).toEqual([
    ["jaskmoney", 2, false], ["jaskmoney", 0, false], ["jaskmoney", 0, false], ["up", 3, false],
  ])
})

test("an open group's subcategories follow it, whatever their sort order", () => {
  expect(names([income.id])).toEqual(["Income", "  Salary", "  Interest", "Transfers", "Uncategorised", "Home"])
  expect(names([income.id, home.id])).toEqual(["Income", "  Salary", "  Interest", "Transfers", "Uncategorised", "Home", "  Groceries", "  Rent", "  Side gigs"])
  // A leaf can't be open.
  expect(names([transfers.id])).toEqual(names([]))
})

test("a subcategory whose group is gone is drawn at the top level", () => {
  const orphan = cat("Orphan", { parentId: 9999 })
  expect(categoryRows([...all, orphan], []).map((row) => row.category.name)).toContain("Orphan")
})

test("each block counts its subcategories, by its group's origin", () => {
  expect(originCounts(all)).toEqual({ jaskmoney: 5, up: 4 })
})
