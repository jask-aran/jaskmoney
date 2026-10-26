import { describe, expect, test } from "bun:test"
import { assignableCategories, categoryPickerRows } from "./categoryOptions"
import type { Category } from "./types"

const cat = (id: number, name: string, parentId: number | null, extId: string | null, isDefault = false): Category =>
  ({ id, name, color: "#fff", sortOrder: id, isDefault, parentId, extId, notSpending: false })

const tree: Category[] = [
  cat(1, "Uncategorised", null, null, true),
  cat(2, "Income", null, null),
  cat(10, "Good Life", null, "good-life"),
  cat(11, "Restaurants & Cafes", 10, "restaurants-and-cafes"),
  cat(12, "Takeaway", 10, "takeaway"),
  cat(20, "Home", null, "home"),
  cat(21, "Groceries", 20, "groceries"),
]

describe("category picker rows", () => {
  test("groups head their children; groups are not assignable; local categories last with the default at the end", () => {
    const rows = categoryPickerRows(tree, "")
    expect(rows.map((r) => (r.kind === "heading" ? `# ${r.label}` : r.category.name))).toEqual([
      "# Good Life", "Restaurants & Cafes", "Takeaway", "# Home", "Groceries", "# Other", "Income", "Uncategorised",
    ])
    expect(assignableCategories(tree, "").map((c) => c.id)).toEqual([11, 12, 21, 2, 1])
    expect(rows.flatMap((r) => (r.kind === "category" ? [r.index] : []))).toEqual([0, 1, 2, 3, 4])
  })

  test("a query matches a category or its group", () => {
    expect(assignableCategories(tree, "take").map((c) => c.name)).toEqual(["Takeaway"])
    expect(assignableCategories(tree, "HOME").map((c) => c.name)).toEqual(["Groceries"])
    expect(categoryPickerRows(tree, "zzz")).toEqual([])
  })

  test("without groups there is no Other heading", () => {
    expect(categoryPickerRows([cat(1, "Uncategorised", null, null, true), cat(2, "Food", null, null)], "").map((r) => r.kind)).toEqual(["category", "category"])
  })
})
