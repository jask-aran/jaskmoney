import { describe, expect, test } from "bun:test"
import { canonicalFilter, evalFilter, filterExprString, parseFilter, parseFilterStrict, type FilterNames } from "./filter"

const read = (s: string, names?: FilterNames) => { const r = parseFilter(s, names); return r.error ? `error: ${r.error}` : filterExprString(r.node) }
const hints = (s: string, names?: FilterNames) => parseFilter(s, names).hints.join(" | ")

const NAMES: FilterNames = {
  cat: ["Restaurants & Cafes", "Takeaway", "Home", "Homeware & Appliances", "Groceries", "Car Insurance, Rego & Maintenance", "Taxis & Share Cars", "Rent & Mortgage", "Rates & Insurance", "Uncategorised"],
  tag: ["TRAVEL", "DINNERS"],
  acc: ["Spending", "2Up Spending"],
}

describe("2, 5, 8. spaces inside a value, -word and lowercase or read as their tight forms", () => {
  test("loose syntax reads as its strict form", () => {
    for (const [loose, tight] of [
      ["uber -eats", "uber NOT eats"],
      ["-cat:Groceries", "NOT cat:Groceries"],
      ['-"uber eats"', 'NOT "uber eats"'],
      ["-(a OR b)", "NOT (a OR b)"],
      ["desc:coffee -decaf", "desc:coffee NOT decaf"],
      ["kfc or mcdonalds", "kfc OR mcdonalds"],
      ["desc:kfc or mcdonalds", "desc:kfc OR mcdonalds"],
      ["(a or b) c", "(a OR b) c"],
      ["amt:-10..-50", "amt:-50..-10"],
      ["date:2026-10..2026-09", "date:2026-09..2026-10"],
      ["amt:< -50", "amt:<-50"],
      ["amt: >= 20", "amt:>=20"],
      ["amt:-50 .. -10", "amt:-50..-10"],
      ["date:2026-10-01 .. 2026-10-14", "date:2026-10-01..2026-10-14"],
      ["date:2026-10-01 ..2026-10-14", "date:2026-10-01..2026-10-14"],
      ["date:2026-10-01.. 2026-10-14", "date:2026-10-01..2026-10-14"],
    ]) expect(read(loose)).toBe(read(tight))
  })
})

describe("4. saving rewrites to the full form", () => {
  test("what's saved parses strictly and means what was typed", () => {
    for (const loose of ["a b OR c", "uber -eats date:26-10", "kfc or mcdonalds amt:<-10", "cat:restaurants OR tag:trav", "12:30 x", "(a OR b) c OR d", "NOT NOT a"]) {
      const saved = canonicalFilter(loose, NAMES)
      const strict = parseFilterStrict(saved.text)
      expect({ loose, error: saved.error, strictError: strict.error }).toEqual({ loose, error: undefined, strictError: undefined })
      expect(filterExprString(strict.node)).toBe(filterExprString(parseFilter(loose, NAMES).node))
    }
  })
})

describe("6. shortened names", () => {
  test("several fit: the bar finds any of them and says so; saving refuses", () => {
    expect(read("cat:insurance", NAMES)).toBe('cat:"Car Insurance, Rego & Maintenance" OR cat:"Rates & Insurance"')
    expect(hints("cat:insurance", NAMES)).toContain("Car Insurance, Rego & Maintenance")
    expect(hints("cat:insurance", NAMES)).toContain("Rates & Insurance")
    expect(canonicalFilter("cat:insurance", NAMES).error).toContain("Rates & Insurance")
  })
})

describe("7. a group's name takes in its subcategories", () => {
  const row = (categoryName: string, categoryGroup: string) => ({ description: "x", categoryId: 1, categoryName, categoryGroup, accountName: "Spending", notes: "", amount: -5, dateISO: "2026-10-01", tagNames: [] })
  test("cat:Home finds the group's own rows and its subcategories'", () => {
    const home = parseFilter("cat:Home").node
    expect(evalFilter(home, row("Groceries", "Home"))).toBe(true)
    expect(evalFilter(home, row("Home", ""))).toBe(true)
    expect(evalFilter(home, row("Takeaway", "Good Life"))).toBe(false)
    expect(evalFilter(parseFilter("cat:Groceries").node, row("Groceries", "Home"))).toBe(true)
  })
})
