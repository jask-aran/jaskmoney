import { expect, test } from "bun:test"
import { fuzzyFilter, fuzzyScore } from "./fuzzy"
import { categoryPickerRows } from "./categoryOptions"
import { pickerItems } from "../state/settingsForm"
import { category } from "../testing/fixtures"

test("fuzzy matching uses ordered characters and ranks exact, prefix, runs, boundaries and length", () => {
  expect(fuzzyScore("CF", "Coffee")).not.toBeNull()
  expect(fuzzyScore("fc", "Coffee")).toBeNull()
  for (const [query, better, worse] of [
    ["gas", "Gas", "Gas Bill"],
    ["ga", "Games", "Video Games"],
    ["amm", "Gamma", "Palm Medium"],
    ["bm", "Big Market", "Bigmarket"],
    ["ga", "Gas", "Games"],
  ]) expect(fuzzyScore(query!, better!)!).toBeGreaterThan(fuzzyScore(query!, worse!)!)
  const items = ["Gas Bill", "GAS", "gas", "Palm Medium"]
  expect(fuzzyFilter(items, "gas", (s) => s)).toEqual(["GAS", "gas", "Gas Bill"])
  expect(fuzzyFilter(items, "", (s) => s)).toBe(items)
})

test("category fuzzy matching keeps groups and ranks children; Settings only filters", () => {
  const categories = [
    category({ id: 1, name: "Good Life" }), category({ id: 2, name: "Gas Bill", parentId: 1 }), category({ id: 3, name: "Gas", parentId: 1 }),
    category({ id: 4, name: "Home" }), category({ id: 5, name: "Gas heating", parentId: 4 }),
  ]
  const names = (q: string) => categoryPickerRows(categories, q).map((r) => r.kind === "heading" ? r.label : r.category.name)
  expect(names("gas")).toEqual(["Good Life", "Gas", "Gas Bill", "Home", "Gas heating"])
  expect(names("gl")).toEqual(["Good Life", "Gas Bill", "Gas"])
  const ctx = { categories, tags: [], accounts: [], savedFilters: [] }
  expect(pickerItems("tag", "categoryId", ctx, "gas").map((r) => r.label)).toEqual(["Good Life", "Gas Bill", "Gas", "Home", "Gas heating"])
  expect(pickerItems("rule", "savedFilterId", { ...ctx, savedFilters: [
    { id: "big", name: "Gas Bill", expr: "" }, { id: "gas", name: "Gas", expr: "" },
  ] }, "gs").map((r) => r.label)).toEqual(["Gas Bill", "Gas"])
})
