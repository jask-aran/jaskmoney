import { describe, expect, test } from "bun:test"
import { drillFilter } from "./drill"
import { evalFilter, parseFilterStrict } from "./filter"
import { category } from "../testing/fixtures"

const categories = [
  category({ id: 1, name: "Good Life" }), category({ id: 2, name: "Pubs & Bars", parentId: 1 }),
  category({ id: 3, name: "Takeaway", parentId: 1 }), category({ id: 4, name: "Groceries" }),
]

describe("drillFilter", () => {
  const row = { description: "Pub", notes: "", categoryId: 5, categoryName: "Pubs & Bars", accountName: "Spending", tagNames: [], amount: -12, dateISO: "2026-10-20" }
  const parsed = (q: string) => { const { node, error } = parseFilterStrict(q); expect(error).toBeFalsy(); return node! }

  test("a category line or a chart: spending in the range, on the accounts, in the category", () => {
    const line = parsed(drillFilter({ start: "2026-10-15", end: "2026-11-14", accounts: ["Spending"], category: { id: 4, name: "Groceries" }, categories }))
    const groceries = { ...row, categoryName: "Groceries" }
    expect(evalFilter(line, groceries)).toBe(true)
    for (const miss of [row, { ...groceries, accountName: "2Up" }, { ...groceries, dateISO: "2026-10-14" }]) expect(evalFilter(line, miss)).toBe(false)
    const chart = parsed(drillFilter({ start: "2026-10-01", end: "2026-10-31", accounts: ["Spending"] }))
    expect(evalFilter(chart, row)).toBe(true)
    expect(evalFilter(chart, { ...row, dateISO: "2026-11-01" })).toBe(false)
  })
  test("a group covers its subcategories", () => {
    const q = drillFilter({ start: "2026-10-15", end: "2026-11-14", accounts: ["Spending", "2Up"], category: { id: 1, name: "Good Life" }, categories })
    const { node, error } = parseFilterStrict(q)
    expect(error).toBeFalsy()
    expect(evalFilter(node!, row)).toBe(true)
    expect(evalFilter(node!, { ...row, accountName: "2Up" })).toBe(true)
    expect(evalFilter(node!, { ...row, categoryName: "Groceries" })).toBe(false)
    // A refund into the group counts against it (it is in the total).
    expect(evalFilter(node!, { ...row, amount: 12 })).toBe(true)
    expect(evalFilter(node!, { ...row, amount: 12, income: true })).toBe(false)
    expect(evalFilter(node!, { ...row, excluded: true })).toBe(false)
    expect(evalFilter(node!, { ...row, tagNames: ["iGnOrE"] })).toBe(false)
  })
})
