import { describe, expect, test } from "bun:test"
import type { JevAnswer } from "../ai/jev"
import type { ClairicAnswer } from "../ai/workersAi"
import { parseFilterStrict } from "./filter"
import { categoriesNamed, parsedSearch, periodBounds, searchFilter, smartSearch, snapPayee, type ParsedSearch } from "./smartSearch"
import { searchNumbers, searchPhrases, searchQuestions } from "./questions"
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
const none: ParsedSearch = { words: null, ask: null, atLeast: null, atMost: null, from: null, to: null, period: "any", flow: "any", categoryId: null }

const values = (v: Record<string, string | number | null>): Record<string, ClairicAnswer> =>
  Object.fromEntries(["words", "from", "to"].map((id) => [id, { value: v[id] ?? null, confidence: 0.9 }]))
const choice = (c: string): JevAnswer => ({ type: "choice", choice: c, probabilities: { [c]: 0.9 }, confidence: 0.8 })
const answers = (a: { period?: string; flow?: string; payee?: number; category?: string; amounts?: string[]; phrase?: string }): Record<string, JevAnswer> => ({
  period: choice(a.period ?? "any"), flow: choice(a.flow ?? "any"),
  names_payee: { type: "noul", noul: a.payee ?? 0 }, category: choice(a.category ?? "none"),
  ...Object.fromEntries((a.amounts ?? []).map((role, i) => [`amount${i}`, choice(role)])),
  ...(a.phrase ? { phrase: choice(a.phrase) } : {}),
})

describe("smart search", () => {
  test("Jev is asked to pick categories by c<id>, with group paths and no Uncategorised", () => {
    const q = searchQuestions(categories).category
    expect(q.type === "choice" && q.criteria).toEqual({ none: "No category is named", c1: "Good Life", c2: "Good Life › Restaurants & Cafes", c3: "Good Life › Takeaway", c4: "Groceries" })
  })

  test("words name a category, a payee, or something for Jev to judge rows by", () => {
    const parse = (words: string, a: Parameters<typeof answers>[0] = {}) => parsedSearch(values({ words }), answers(a), categories, words)
    // Every word is a whole word of one category's name.
    expect(parse("groceries")).toMatchObject({ words: null, ask: null, categoryId: 4 })
    expect(parse("restaurants")).toMatchObject({ categoryId: 2 })
    // A payee is found in the description, even when it reads like a category.
    expect(parse("amazon", { payee: 0.7 })).toMatchObject({ words: "amazon", ask: null, categoryId: null })
    expect(parse("groceries", { payee: 0.9 })).toMatchObject({ words: "groceries", categoryId: null })
    // A kind of thing no category names: Jev judges rows.
    expect(parse("coffee", { category: "c2" })).toMatchObject({ words: null, ask: "coffee", categoryId: null })
    expect(parse("eating out")).toMatchObject({ ask: "eating out", categoryId: null })
    // No words, no category, whatever Jev picked.
    expect(parsedSearch(values({}), answers({ category: "c2" }), categories, "")).toMatchObject({ words: null, ask: null, categoryId: null })
  })

  test("several categories named: Jev's pick, else an exact name, else none", () => {
    const tree = [...categories, category({ id: 5, name: "Life Admin" })]
    expect(categoriesNamed("life", tree).map((c) => c.id)).toEqual([1, 5])
    expect(parsedSearch(values({ words: "life" }), answers({ category: "c5" }), tree, "life")).toMatchObject({ categoryId: 5 })
    expect(parsedSearch(values({ words: "life" }), answers({}), tree, "life")).toMatchObject({ categoryId: null, ask: "life" })
    expect(parsedSearch(values({ words: "good life" }), answers({}), tree, "good life")).toMatchObject({ categoryId: 1 })
  })

  test("amounts are the query's numbers in the roles Jev gives them; numbers in dates are not amounts", () => {
    expect(searchNumbers("bunnings between $50 and $200+ on 3 March")).toEqual(["$50", "$200+", "3"])
    const parse = (query: string, amounts: string[]) => parsedSearch(values({}), answers({ amounts }), categories, query)
    expect(parse("bunnings between $50 and $200", ["at_least", "at_most"])).toMatchObject({ atLeast: 50, atMost: 200 })
    expect(parse("amazon $20+", ["at_least"])).toMatchObject({ atLeast: 20, atMost: null })
    expect(parse("flights between 1 March and 20 April", ["not_amount", "not_amount"])).toMatchObject({ atLeast: null, atMost: null })
  })

  test("without Clairic, the words are Jev's pick of the query's phrases (or none)", () => {
    expect(searchPhrases("uber eats under 30, this cycle")).toEqual(["uber", "uber eats", "uber eats under", "uber eats under this", "eats", "eats under", "eats under this", "eats under this cycle", "under", "under this", "under this cycle", "this", "this cycle", "cycle"])
    const phrases = searchPhrases("uber eats under 30 this cycle")
    expect(parsedSearch(null, answers({ phrase: `p${phrases.indexOf("uber eats")}`, payee: 0.8 }), categories, "uber eats under 30 this cycle")).toMatchObject({ words: "uber eats" })
    expect(parsedSearch(null, answers({ phrase: "none" }), categories, "anything over $500")).toMatchObject({ words: null, ask: null })
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
    const expr = searchFilter({ ...none, words: "uber eats", ask: "late night food", categoryId: 1, flow: "spending", atMost: 30, period: "this_cycle" }, ctx)
    expect(expr).toBe('desc:"uber eats" AND ask:"late night food" AND (cat:"Good Life" OR cat:"Restaurants & Cafes" OR cat:"Takeaway") AND type:spending AND amt:>=-30 AND date:2026-10-14..2026-10-27')
    expect(parseFilterStrict(expr).error).toBeUndefined()
  })

  test("asks both models once each, and falls back to the query as words when nothing comes back", async () => {
    const calls: string[] = []
    const ai = {
      clairic: async () => { calls.push("clairic"); return values({ words: "coffee" }) },
      jev: { judge: async () => { calls.push("jev"); return answers({ flow: "spending", period: "last_month", amounts: ["at_least"] }) } },
    }
    expect((await smartSearch(ai, "coffee over $5 last month", ctx)).expr).toBe('ask:"coffee" AND type:spending AND amt:<=-5 AND date:2026-09-01..2026-09-30')
    expect(calls.sort()).toEqual(["clairic", "jev"])
    const empty = { clairic: async () => values({}), jev: { judge: async () => answers({}) } }
    expect((await smartSearch(empty, "hmm", ctx)).expr).toBe('desc:"hmm"')
  })

  test("Clairic failing or missing doesn't stop the search: Jev's phrase stands in, and the reason is reported", async () => {
    const jev = { judge: async () => answers({ phrase: "p0", amounts: ["at_least"], flow: "spending" }) }
    const down = await smartSearch({ clairic: async () => { throw new Error("daily allowance used up") }, jev }, "coffee over $5", ctx)
    expect(down).toMatchObject({ expr: 'ask:"coffee" AND type:spending AND amt:<=-5', clairic: "daily allowance used up" })
    expect((await smartSearch({ jev }, "coffee over $5", ctx)).clairic).toBe("no Workers AI key")
  })
})

describe("payee words no description has", () => {
  const parsed = (words: string): ParsedSearch => ({ words, ask: null, atLeast: null, atMost: null, from: null, to: null, period: "any", flow: "any", categoryId: null })
  test("stay as desc: when a description has them (punctuation aside); otherwise go to Jev", () => {
    const descriptions = ["McDonald's", "Uber Eats", "UBER *TRIP"]
    expect(snapPayee(parsed("uber eats"), descriptions)).toEqual(parsed("uber eats"))
    expect(searchFilter(snapPayee(parsed("Mcdonalds"), descriptions), ctx)).toBe('desc:"Mcdonalds"')
    expect(snapPayee(parsed("maccas"), descriptions)).toMatchObject({ words: null, ask: "maccas" })
  })
})
