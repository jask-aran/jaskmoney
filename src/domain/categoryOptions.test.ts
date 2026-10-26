import { describe, expect, test } from "bun:test"
import { assignableCategories, categoryPickerRows } from "./categoryOptions"
import { category } from "../testing/fixtures"

const tree = [
  category({ id: 1, name: "Uncategorised", isDefault: true }),
  category({ id: 2, name: "Income" }),
  category({ id: 10, name: "Good Life", extId: "good-life" }),
  category({ id: 11, name: "Restaurants & Cafes", parentId: 10, extId: "restaurants-and-cafes" }),
  category({ id: 12, name: "Takeaway", parentId: 10, extId: "takeaway" }),
  category({ id: 20, name: "Home", extId: "home" }),
  category({ id: 21, name: "Groceries", parentId: 20, extId: "groceries" }),
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
    expect(categoryPickerRows([category({ id: 1, name: "Uncategorised", isDefault: true }), category({ id: 2, name: "Food" })], "").map((r) => r.kind)).toEqual(["category", "category"])
  })
})
