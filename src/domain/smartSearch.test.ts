import { describe, expect, test } from "bun:test"
import type { ClairicAnswer, ClefAnswer } from "../ai/workersAi"
import { parseFilterStrict } from "./filter"
import { parsedSearch, periodBounds, searchFilter, searchQuestions, smartSearch, type ParsedSearch } from "./smartSearch"
import { category } from "../testing/fixtures"

const categories = [
  category({ id: 1, name: "Good Life" }),
  category({ id: 2, name: "Restaurants & Cafes", parentId: 1 }),
  category({ id: 3, name: "Takeaway", parentId: 1 }),
  category({ id: 4, name: "Groceries" }),
  category({ id: 10, name: "Uncategorised", isDefault: true }),
]
const cycle = { unit: "month" as const, anchor: "date" as const, anchorDate: "2000-01-14" }
const ctx = { today: "2026-10-27", cycle, categories }
const none: ParsedSearch = { words: null, atLeast: null, atMost: null, from: null, to: null, period: "any", flow: "any", categoryId: null }

const values = (v: Record<string, string | number | null>): Record<string, ClairicAnswer> =>
  Object.fromEntries(["words", "at_least", "at_most", "from", "to"].map((id) => [id, { value: v[id] ?? null, confidence: 0.9 }]))
const choice = (c: string): ClefAnswer => ({ type: "choice", choice: c, probabilities: { [c]: 0.9 }, confidence: 0.8 })
const answers = (a: { period?: string; flow?: string; named?: number; category?: string }): Record<string, ClefAnswer> => ({
  period: choice(a.period ?? "any"), flow: choice(a.flow ?? "any"),
  names_category: { type: "noul", noul: a.named ?? 0 }, category: choice(a.category ?? "none"),
})

describe("smart search", () => {
  test("Clef is asked to pick categories by c<id>, with group paths and no Uncategorised", () => {
    const q = searchQuestions(categories).category
    expect(q.type === "choice" && q.criteria).toEqual({ none: "No category is named", c1: "Good Life", c2: "Good Life › Restaurants & Cafes", c3: "Good Life › Takeaway", c4: "Groceries" })
  })

  test("a named category replaces the words naming it; words win when the query names a merchant", () => {
    expect(parsedSearch(values({ words: "groceries" }), answers({ named: 0.9, category: "c4" }))).toMatchObject({ words: null, categoryId: 4 })
    expect(parsedSearch(values({ words: "amazon" }), answers({ named: 0.1, category: "c4" }))).toMatchObject({ words: "amazon", categoryId: null })
    // No words at all: the category is the search.
    expect(parsedSearch(values({}), answers({ named: 0.2, category: "c2" }))).toMatchObject({ words: null, categoryId: 2 })
    expect(parsedSearch(values({}), answers({ named: 0.9, category: "none" }))).toMatchObject({ categoryId: null })
  })

  test("equal bounds are one phrase read both ways: the lower bound stays", () => {
    expect(parsedSearch(values({ at_least: 20, at_most: 20 }), answers({}))).toMatchObject({ atLeast: 20, atMost: null })
    expect(parsedSearch(values({ at_least: 5, at_most: 30 }), answers({}))).toMatchObject({ atLeast: 5, atMost: 30 })
  })

  test("periods are worked out here, cycles from the budget cycle", () => {
    const bounds = (period: ParsedSearch["period"], from: string | null = null, to: string | null = null) => periodBounds({ period, from, to }, "2026-10-27", cycle)
    expect(bounds("any")).toBeNull()
    expect(bounds("this_cycle")).toEqual({ start: "2026-10-14", end: "2026-10-27" })
    expect(bounds("last_cycle")).toEqual({ start: "2026-09-14", end: "2026-10-13" })
    expect(bounds("this_month")).toEqual({ start: "2026-10-01", end: "2026-10-27" })
    expect(bounds("last_month")).toEqual({ start: "2026-09-01", end: "2026-09-30" })
    expect(bounds("last_30")).toEqual({ start: "2026-09-28", end: "2026-10-27" })
    expect(bounds("last_year")).toEqual({ start: "2025-01-01", end: "2025-12-31" })
    expect(bounds("explicit", "2026-03-01", "2026-04-20")).toEqual({ start: "2026-03-01", end: "2026-04-20" })
    expect(bounds("explicit", "2026-03-01")).toEqual({ start: "2026-03-01", end: "2026-10-27" })
    expect(bounds("explicit")).toBeNull()
  })

  test("amounts follow the sign of the money asked about", () => {
    const amounts = (flow: ParsedSearch["flow"], atLeast: number | null, atMost: number | null) => searchFilter({ ...none, flow, atLeast, atMost }, ctx)
    expect(amounts("spending", 5, null)).toBe("type:spending AND amt:<=-5")
    expect(amounts("spending", null, 30)).toBe("type:spending AND amt:>=-30")
    expect(amounts("spending", 5, 30)).toBe("type:spending AND amt:-30..-5")
    expect(amounts("income", 5, null)).toBe("type:income AND amt:>=5")
    expect(amounts("money_in", null, 30)).toBe("type:credit AND amt:<=30")
    expect(amounts("any", 5, null)).toBe("(amt:<=-5 OR amt:>=5)")
    expect(amounts("any", null, 30)).toBe("amt:-30..30")
  })

  test("every part together makes a filter the parser accepts; a group covers its subcategories", () => {
    const expr = searchFilter({ ...none, words: "uber eats", categoryId: 1, flow: "spending", atMost: 30, period: "this_cycle" }, ctx)
    expect(expr).toBe('desc:"uber eats" AND (cat:"Good Life" OR cat:"Restaurants & Cafes" OR cat:"Takeaway") AND type:spending AND amt:>=-30 AND date:2026-10-14..2026-10-27')
    expect(parseFilterStrict(expr).error).toBeUndefined()
  })

  test("asks both models once each, and falls back to the query as words when nothing comes back", async () => {
    const calls: string[] = []
    const ai = {
      clairic: async () => { calls.push("clairic"); return values({ words: "coffee", at_least: 5 }) },
      clef: async (_: unknown, __: string, model?: string) => { calls.push(`clef:${model}`); return answers({ flow: "spending", period: "last_month" }) },
    }
    expect((await smartSearch(ai, "coffee over $5 last month", ctx)).expr).toBe('desc:"coffee" AND type:spending AND amt:<=-5 AND date:2026-09-01..2026-09-30')
    expect(calls.sort()).toEqual(["clairic", "clef:clef"])
    const empty = { clairic: async () => values({}), clef: async () => answers({}) }
    expect((await smartSearch(empty, "hmm", ctx)).expr).toBe('desc:"hmm"')
  })
})
