import { describe, expect, test } from "bun:test"
import { categoryIcon } from "./categoryIcons"
import type { Category } from "./types"

const cat = (id: number, name: string, extId: string | null, parentId: number | null = null) =>
  ({ id, name, extId, parentId, color: "#fff", sortOrder: id, isDefault: false, notSpending: false }) as Category

describe("categoryIcon", () => {
  const home = cat(1, "Home", "home")
  const categories = [home, cat(2, "Groceries", "groceries", 1), cat(3, "Spa days", null, 1), cat(4, "Income", null), cat(5, "Misc", null)]

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
