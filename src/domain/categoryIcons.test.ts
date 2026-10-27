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

test("a category without an Up id, named as Up names it, gets that Up category's icon (the demo, a CSV import)", () => {
  const named = (name: string, parentId: number | null = null) => category({ id: 900, name, parentId, extId: null })
  expect(categoryIcon(named("Rent & Mortgage"), [])).toBe(categoryIcon(category({ id: 1, name: "x", extId: "rent-and-mortgage" }), []))
  expect(categoryIcon(named("TV, Music & Streaming"), [])).toBe(categoryIcon(category({ id: 1, name: "x", extId: "tv-and-music" }), []))
  expect(categoryIcon(named("Apps, Games & Software"), [])).toBe(categoryIcon(category({ id: 1, name: "x", extId: "games-and-software" }), []))
  expect(categoryIcon(named("Good Life"), [])).not.toBeNull()
})
