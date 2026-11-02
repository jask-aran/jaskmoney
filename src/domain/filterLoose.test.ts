import { describe, expect, test } from "bun:test"
import { canonicalFilter, evalFilter, filterExprString, parseFilter, parseFilterStrict, reparseFilterInput, type FilterNames } from "./filter"

/**
 * The loose-to-strict ladder (approved 2026-10-29): the search bar forgives
 * what has one clear reading; saving rewrites to the full form, refusing
 * only what's ambiguous. Each change is a deviation from legacy Go
 * filter.go, approved by the user.
 */

const read = (s: string, names?: FilterNames) => { const r = parseFilter(s, names); return r.error ? `error: ${r.error}` : filterExprString(r.node) }
const hints = (s: string, names?: FilterNames) => parseFilter(s, names).hints.join(" | ")

const NAMES: FilterNames = {
  cat: ["Restaurants & Cafes", "Takeaway", "Home", "Homeware & Appliances", "Groceries", "Car Insurance, Rego & Maintenance", "Taxis & Share Cars", "Rent & Mortgage", "Rates & Insurance", "Uncategorised"],
  tag: ["TRAVEL", "DINNERS"],
  acc: ["Spending", "2Up Spending"],
}

describe("1. an unknown word: is text, not a broken search", () => {
  test("only that term is text; the rest keeps its structure", () => {
    expect(read("coffee 12:30")).toBe('coffee AND "12:30"')
    expect(read("ref:ABC amt:<-5")).toBe('"ref:ABC" AND amt:<-5')
    expect(parseFilter("coffee 12:30").error).toBeUndefined()
  })
  test("a near-miss field name gets a hint", () => {
    expect(read("catt:x")).toBe('"catt:x"')
    expect(hints("catt:x")).toContain("did you mean cat:")
    expect(hints("12:30")).not.toContain("did you mean")
  })
  test("saving: a near miss is refused, other text is quoted", () => {
    expect(canonicalFilter("catt:x").error).toContain("did you mean cat:")
    expect(canonicalFilter("12:30")).toMatchObject({ text: '"12:30"', error: undefined })
    expect(parseFilterStrict('"12:30"').error).toBeUndefined()
  })
})

describe("2, 5, 8. spaces inside a value, -word and lowercase or read as their tight forms", () => {
  test.each([
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
  ])("%s reads as %s", (loose, tight) => expect(read(loose)).toBe(read(tight)))
  test("the next term after the value is still its own", () => expect(read("amt:< -50 coffee")).toBe("amt:<-50 AND coffee"))
})

describe("4. saving rewrites to the full form", () => {
  test.each([
    ["a b OR c", "(a AND b) OR c"],
    ["x OR y z", "x OR (y AND z)"],
    ["kfc or mcdonalds amt:<-10", "kfc OR (mcdonalds AND amt:<-10)"],
    ["uber -eats", "uber AND NOT eats"],
    ["amt:< -50", "amt:<-50"],
    ["(kfc OR mcdonalds", "kfc OR mcdonalds"],
    ["amt:-10..-50", "amt:-50..-10"],
    ['cat:restaurants date:2026-10', 'cat:"Restaurants & Cafes" AND date:2026-10'],
  ])("%s saves as %s", (loose, full) => expect(canonicalFilter(loose, NAMES)).toMatchObject({ text: full, error: undefined }))
  test("what's saved parses strictly and means what was typed", () => {
    for (const loose of ["a b OR c", "uber -eats date:26-10", "kfc or mcdonalds amt:<-10", "cat:restaurants OR tag:trav", "12:30 x", "(a OR b) c OR d", "NOT NOT a"]) {
      const saved = canonicalFilter(loose, NAMES)
      const strict = parseFilterStrict(saved.text)
      expect({ loose, error: saved.error, strictError: strict.error }).toEqual({ loose, error: undefined, strictError: undefined })
      expect(filterExprString(strict.node)).toBe(filterExprString(parseFilter(loose, NAMES).node))
    }
  })
  test("strict parsing of stored text is unchanged: brackets still required, lowercase or a word", () => {
    expect(parseFilterStrict("a b OR c").error).toBeDefined()
    expect(parseFilterStrict("kfc OR").error).toBeDefined()
    expect(parseFilterStrict("kfc or mcdonalds").node).toMatchObject({ kind: "and", children: [{ value: "kfc" }, { value: "or" }, { value: "mcdonalds" }] })
  })
})

describe("5. -word is NOT", () => {
  test("a number, a lone dash and a hyphen inside a word stay text", () => {
    expect(parseFilter("-50").node).toMatchObject({ kind: "text", value: "-50" })
    expect(parseFilter("amt:-50").node).toMatchObject({ kind: "field", field: "amt", op: "=", value: "-50" })
    expect(parseFilter("Coca-Cola").node).toMatchObject({ kind: "text", value: "Coca-Cola" })
    expect(parseFilter("a - b").node).toMatchObject({ kind: "and", children: [{ value: "a" }, { value: "-" }, { value: "b" }] })
  })
  test("text starting with a dash is quoted when written out, so it reads back as text", () => {
    const text = filterExprString({ kind: "text", op: "contains", value: "-eats" })
    expect(text).toBe('"-eats"')
    expect(parseFilter(text).node).toMatchObject({ kind: "text", value: "-eats" })
  })
})

describe("6. shortened names", () => {
  test("exact first, then a unique start, then a unique part", () => {
    expect(parseFilter("cat:restaurants", NAMES).node).toMatchObject({ field: "cat", value: "Restaurants & Cafes" })
    expect(parseFilter("cat:home", NAMES).node).toMatchObject({ field: "cat", value: "Home" })
    expect(parseFilter("cat:car", NAMES).node).toMatchObject({ field: "cat", value: "Car Insurance, Rego & Maintenance" })
    expect(parseFilter("cat:cafes", NAMES).node).toMatchObject({ field: "cat", value: "Restaurants & Cafes" })
    expect(parseFilter("tag:trav", NAMES).node).toMatchObject({ field: "tag", value: "TRAVEL" })
    expect(parseFilter("acc:spend", NAMES).node).toMatchObject({ field: "acc", value: "Spending" })
    expect(parseFilter("acc:2up", NAMES).node).toMatchObject({ field: "acc", value: "2Up Spending" })
  })
  test("several fit: the bar finds any of them and says so; saving refuses", () => {
    expect(read("cat:insurance", NAMES)).toBe('cat:"Car Insurance, Rego & Maintenance" OR cat:"Rates & Insurance"')
    expect(hints("cat:insurance", NAMES)).toContain("Car Insurance, Rego & Maintenance")
    expect(hints("cat:insurance", NAMES)).toContain("Rates & Insurance")
    expect(canonicalFilter("cat:insurance", NAMES).error).toContain("Rates & Insurance")
  })
  test("none fits: the bar keeps the value and says so; saving refuses", () => {
    expect(parseFilter("cat:nothing", NAMES).node).toMatchObject({ field: "cat", value: "nothing" })
    expect(hints("cat:nothing", NAMES)).toContain("no category matches")
    expect(canonicalFilter("cat:nothing", NAMES).error).toContain("no category matches")
    expect(hints("tag:zzz", NAMES)).toContain("no tag matches")
    expect(hints("acc:zzz", NAMES)).toContain("no account matches")
  })
  test("without names, values are as written; the live search reports the hints too", () => {
    expect(parseFilter("cat:restaurants").node).toMatchObject({ field: "cat", value: "restaurants" })
    expect(reparseFilterInput("cat:insurance", NAMES).hints.join(" ")).toContain("Rates & Insurance")
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

describe("8. lowercase or between two terms", () => {
  test("quoted, or at either end, it's a word", () => {
    expect(parseFilter('fish "or" chips').node).toMatchObject({ kind: "and", children: [{ value: "fish" }, { value: "or" }, { value: "chips" }] })
    expect(parseFilter("or kfc").node).toMatchObject({ kind: "and", children: [{ value: "or" }, { value: "kfc" }] })
  })
  test("written out, the word or is quoted, so it reads back as a word", () => {
    expect(filterExprString(parseFilterStrict("fish or chips").node)).toBe('fish AND "or" AND chips')
  })
})

describe("as you type: an unfinished search still searches", () => {
  test("a trailing operator is ignored, a missing ) closed", () => {
    expect(read("kfc OR")).toBe("kfc")
    expect(hints("kfc OR")).toContain("ignoring")
    expect(read("kfc AND")).toBe("kfc")
    expect(read("kfc NOT")).toBe("kfc")
    expect(read("(kfc OR mcdonalds")).toBe("kfc OR mcdonalds")
    expect(hints("(kfc OR mcdonalds")).toContain("closing")
    expect(read("((a OR b) c")).toBe(read("((a OR b) c)"))
  })
})
