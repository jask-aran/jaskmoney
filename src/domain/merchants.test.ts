import { describe, expect, test } from "bun:test"
import { groupByMerchant, merchantFilter, sortMerchantGroups } from "./merchants"
import { parseFilterStrict } from "./filter"
import type { Transaction } from "./types"

const row = (id: number, description: string, amount: number, dateISO: string, categoryName = "Groceries", categoryId: number | null = 1): Transaction => ({
  id, dateRaw: dateISO, dateISO, amount, description, categoryId, categoryName, categoryColor: "#fff", notes: "",
  importId: null, accountId: 1, accountName: "Spending", tagNames: [], tagColors: [], tagIds: [], source: "up",
  status: "SETTLED", transferAccountId: null, internal: false, excluded: false,
})

describe("groupByMerchant", () => {
  const rows = [
    row(1, "Coles", -40, "2026-10-01"),
    row(2, "Coles", -60, "2026-10-09"),
    row(3, "Coles", 10, "2026-10-10", "Refunds", 2),
    row(4, "Amazon", -150, "2026-10-05", "Technology", 3),
    row(5, "Alba Coffee", -6.2, "2026-10-20", "Cafes", 4),
  ]

  test("signed totals, counts, latest date, the usual category and the ids", () => {
    const coles = groupByMerchant(rows).find((g) => g.merchant === "Coles")!
    expect(coles).toMatchObject({ count: 3, total: -90, average: -30, lastISO: "2026-10-10", categoryName: "Groceries", categoryId: 1 })
    expect(coles.ids).toEqual([1, 2, 3])
  })

  test("sorts by biggest spend, count, name or latest; reversible", () => {
    const groups = groupByMerchant(rows)
    expect(sortMerchantGroups(groups, "total").map((g) => g.merchant)).toEqual(["Amazon", "Coles", "Alba Coffee"])
    expect(sortMerchantGroups(groups, "count").map((g) => g.merchant)[0]).toBe("Coles")
    expect(sortMerchantGroups(groups, "merchant").map((g) => g.merchant)).toEqual(["Alba Coffee", "Amazon", "Coles"])
    expect(sortMerchantGroups(groups, "last").map((g) => g.merchant)[0]).toBe("Alba Coffee")
    expect(sortMerchantGroups(groups, "total", true).map((g) => g.merchant)[0]).toBe("Alba Coffee")
  })
})

describe("merchantFilter", () => {
  test("narrows the current filter, escaping quotes, and stays parseable", () => {
    expect(merchantFilter("", 'Cafe "Ripple"')).toBe('desc:"Cafe \\"Ripple\\""')
    const narrowed = merchantFilter("cat:Groceries OR cat:Cafes", "Coles")
    expect(narrowed).toBe('(cat:Groceries OR cat:Cafes) AND desc:"Coles"')
    expect(parseFilterStrict(narrowed).error).toBeUndefined()
  })
})
