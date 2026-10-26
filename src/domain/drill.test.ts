import { describe, expect, test } from "bun:test"
import { drillFilter } from "./drill"
import { evalFilter, parseFilterStrict } from "./filter"
import type { Category } from "./types"

const category = (id: number, name: string, parentId: number | null = null) => ({ id, name, parentId }) as Category
const categories = [category(1, "Good Life"), category(2, "Pubs & Bars", 1), category(3, "Takeaway", 1), category(4, "Groceries")]

describe("drillFilter", () => {
  test("a category line: range, spending, accounts and the category", () => {
    expect(drillFilter({ start: "2026-10-15", end: "2026-11-14", accounts: ["Spending"], category: { id: 4, name: "Groceries" }, categories }))
      .toBe('date:2026-10-15..2026-11-14 AND type:spending AND acc:"Spending" AND cat:"Groceries"')
  })
  test("a group covers its subcategories; the result parses", () => {
    const q = drillFilter({ start: "2026-10-15", end: "2026-11-14", accounts: ["Spending", "2Up"], category: { id: 1, name: "Good Life" }, categories })
    expect(q).toBe('date:2026-10-15..2026-11-14 AND type:spending AND (acc:"Spending" OR acc:"2Up") AND (cat:"Good Life" OR cat:"Pubs & Bars" OR cat:"Takeaway")')
    const { node, error } = parseFilterStrict(q)
    expect(error).toBeFalsy()
    const row = { description: "Pub", notes: "", categoryName: "Pubs & Bars", accountName: "Spending", tagNames: [], amount: -12, dateISO: "2026-10-20" }
    expect(evalFilter(node!, row)).toBe(true)
    expect(evalFilter(node!, { ...row, categoryName: "Groceries" })).toBe(false)
    expect(evalFilter(node!, { ...row, amount: 12 })).toBe(false)
    expect(evalFilter(node!, { ...row, excluded: true })).toBe(false)
    expect(evalFilter(node!, { ...row, tagNames: ["iGnOrE"] })).toBe(false)
  })
  test("a chart: all spending in the range", () => {
    expect(drillFilter({ start: "2026-10-01", end: "2026-10-31", accounts: ["Spending"] })).toBe('date:2026-10-01..2026-10-31 AND type:spending AND acc:"Spending"')
  })
})
