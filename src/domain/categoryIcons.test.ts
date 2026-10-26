import { describe, expect, test } from "bun:test"
import { categoryIcon } from "./categoryIcons"
import { category } from "../testing/fixtures"

describe("categoryIcon", () => {
  const home = category({ id: 1, name: "Home", extId: "home" })
  const categories = [
    home, category({ id: 2, name: "Groceries", extId: "groceries", parentId: 1 }), category({ id: 3, name: "Spa days", parentId: 1 }),
    category({ id: 4, name: "Income" }), category({ id: 5, name: "Misc" }),
  ]

  test("Up ids, then local names, then the group's icon", () => {
    expect(categoryIcon(categories[1], categories)).toBe("")
    expect(categoryIcon(categories[3], categories)).toBe("")
    expect(categoryIcon(categories[2], categories)).toBe("")
  })

  test("unknown categories have none; every icon is one cell", () => {
    expect(categoryIcon(categories[4], categories)).toBeNull()
    expect(Bun.stringWidth(categoryIcon(categories[1], categories)!)).toBe(1)
  })
})
