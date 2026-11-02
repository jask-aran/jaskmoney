import { describe, expect, test } from "bun:test"
import type { JevAnswer } from "../ai/jev"
import type { ClairicAnswer } from "../ai/workersAi"
import { parseFilterStrict } from "./filter"
import { categoriesNamed, parsedSearch, periodBounds, searchDates, searchFilter, smartSearch, snapPayee, type ParsedSearch } from "./smartSearch"
import { coveredCategoryIds, coverQuestions, searchNumbers, searchPhrases, searchQuestions } from "./questions"

const TODAY = "2026-11-01"
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
    const criteria = q.type === "choice" ? q.criteria : {}
    expect(Object.keys(criteria)).toEqual(["none", "c1", "c2", "c3", "c4"])
    expect(criteria).toMatchObject({ c1: "Good Life", c2: "Good Life › Restaurants & Cafes", c4: "Groceries" })
  })

  test("words name a category, a payee, or something for Jev to judge rows by", () => {
    const parse = (words: string, a: Parameters<typeof answers>[0] = {}) => parsedSearch(values({ words }), answers(a), categories, words, TODAY)
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
    expect(parsedSearch(values({}), answers({ category: "c2" }), categories, "", TODAY)).toMatchObject({ words: null, ask: null, categoryId: null })
  })

  test("several categories named: Jev's pick, else an exact name, else none", () => {
    const tree = [...categories, category({ id: 5, name: "Life Admin" })]
    expect(categoriesNamed("life", tree).map((c) => c.id)).toEqual([1, 5])
    expect(parsedSearch(values({ words: "life" }), answers({ category: "c5" }), tree, "life", TODAY)).toMatchObject({ categoryId: 5 })
    expect(parsedSearch(values({ words: "life" }), answers({}), tree, "life", TODAY)).toMatchObject({ categoryId: null, ask: "life" })
    expect(parsedSearch(values({ words: "good life" }), answers({}), tree, "good life", TODAY)).toMatchObject({ categoryId: 1 })
  })

  test("amounts are the query's numbers in the roles Jev gives them; numbers in dates are not amounts", () => {
    expect(searchNumbers("bunnings between $50 and $200+ on 3 March")).toEqual(["$50", "$200+", "3"])
    const parse = (query: string, amounts: string[]) => parsedSearch(values({}), answers({ amounts }), categories, query, TODAY)
    expect(parse("bunnings between $50 and $200", ["at_least", "at_most"])).toMatchObject({ atLeast: 50, atMost: 200 })
    expect(parse("amazon $20+", ["at_least"])).toMatchObject({ atLeast: 20, atMost: null })
    expect(parse("flights between 1 March and 20 April", ["not_amount", "not_amount"])).toMatchObject({ atLeast: null, atMost: null })
  })

  test("without Clairic, the words are Jev's pick of the query's phrases (or none)", () => {
    const all = searchPhrases("uber eats under 30, this cycle")
    expect(all).toEqual(expect.arrayContaining(["uber eats", "this cycle", "uber eats under this"]))
    expect(all.some((p) => /\d|,/.test(p) || p.split(" ").length > 4)).toBe(false)
    const phrases = searchPhrases("uber eats under 30 this cycle")
    expect(parsedSearch(null, answers({ phrase: `p${phrases.indexOf("uber eats")}`, payee: 0.8 }), categories, "uber eats under 30 this cycle", TODAY)).toMatchObject({ words: "uber eats" })
    expect(parsedSearch(null, answers({ phrase: "none" }), categories, "anything over $500", TODAY)).toMatchObject({ words: null, ask: null })
    // A fragment that would go to ask: ("stuff") becomes the whole question; payees and categories keep the phrase.
    const car = searchPhrases("stuff for the car")
    expect(parsedSearch(null, answers({ phrase: `p${car.indexOf("stuff")}` }), categories, "stuff for the car", TODAY)).toMatchObject({ words: null, ask: "stuff for the car" })
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

  test("asks Clairic once and Jev twice, at once: the category questions alone get the examples; falls back to the query as words when nothing comes back", async () => {
    const calls: string[] = []
    const states: Array<{ ids: string[]; state: unknown }> = []
    const ai = {
      clairic: async () => { calls.push("clairic"); return values({ words: "coffee" }) },
      jev: { judge: async (qs: Record<string, unknown>, state: unknown) => { calls.push("jev"); states.push({ ids: Object.keys(qs), state }); return answers({ flow: "spending", period: "last_month", amounts: ["at_least"] }) } },
    }
    const uses = { Groceries: ["Coles"] }
    expect((await smartSearch(ai, "coffee over $5 last month", { ...ctx, uses })).expr).toBe('ask:"coffee" AND type:spending AND amt:<=-5 AND date:2026-09-01..2026-09-30')
    expect(calls.sort()).toEqual(["clairic", "jev", "jev"])
    const terms = states.find((s) => s.ids.includes("phrase"))!, covers = states.find((s) => s.ids.some((id) => id.startsWith("kind")))!
    expect(terms.state).toEqual({ search: "coffee over $5 last month" })
    expect(terms.ids.some((id) => id.startsWith("kind"))).toBe(false)
    expect(covers.state).toEqual({ search: "coffee over $5 last month", categories_used_for: uses })
    const empty = { clairic: async () => values({}), jev: { judge: async () => answers({}) } }
    expect((await smartSearch(empty, "hmm", ctx)).expr).toBe('desc:"hmm"')
  })

  test("Clairic failing or missing doesn't stop the search: Jev's phrase stands in, and the reason is reported", async () => {
    const jev = { judge: async () => answers({ phrase: "p0", amounts: ["at_least"], flow: "spending" }) }
    const down = await smartSearch({ clairic: async () => { throw new Error("daily allowance used up") }, jev }, "coffee over $5", ctx)
    // The amount is its own term, so ask: gets Jev's phrase, not "coffee over $5".
    expect(down).toMatchObject({ expr: 'ask:"coffee" AND type:spending AND amt:<=-5', clairic: "daily allowance used up" })
    // With nothing else said, ask: gets the whole question (a phrase can be a fragment).
    const plain = { judge: async () => answers({ phrase: "p0" }) }
    expect((await smartSearch({ jev: plain }, "stuff for the car", ctx)).expr).toBe('ask:"stuff for the car"')
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

describe("broad searches go to the categories they cover", () => {
  const noul = (p: number): JevAnswer => ({ type: "noul", noul: p })
  /** Jev's coverage answers: category id → [kind, every]. */
  const covers = (scores: Record<number, [number, number]>) =>
    Object.fromEntries(Object.entries(scores).flatMap(([id, [kind, every]]) => [[`kind${id}`, noul(kind)], [`every${id}`, noul(every)]]))

  test("two questions per routable category (leaves, not groups or Uncategorised), with its path", () => {
    const qs = coverQuestions(categories)
    expect(Object.keys(qs).sort()).toEqual(["every2", "every3", "every4", "kind2", "kind3", "kind4"])
    expect(qs.kind2).toMatchObject({ type: "noul", instructions: { category: "Good Life › Restaurants & Cafes" } })
  })

  test("a category needs both: a kind of spending asked about, and its every row plausibly so", () => {
    // Restaurants: both. Takeaway: kind only (a narrow search sits inside it). Groceries: neither.
    expect(coveredCategoryIds(covers({ 2: [0.85, 0.36], 3: [0.9, 0.2], 4: [0.3, 0.5] }), categories)).toEqual([2])
  })

  test("the covered categories match outright, OR ask: for the rest; payees and named categories aren't routed", () => {
    const broad = parsedSearch(values({ words: "going out" }), { ...answers({ flow: "spending" }), ...covers({ 2: [0.8, 0.4], 3: [0.7, 0.35] }) }, categories, "going out", TODAY)
    expect(broad).toMatchObject({ categories: [2, 3], ask: "going out" })
    const expr = searchFilter(broad, ctx)
    expect(expr).toBe('(cat:"Restaurants & Cafes" OR cat:"Takeaway" OR (cat:"Uncategorised" AND ask:"going out")) AND type:spending')
    expect(parseFilterStrict(expr).error).toBeUndefined()
    // A shop: desc:, never categories.
    expect(parsedSearch(values({ words: "uber" }), { ...answers({ payee: 0.9 }), ...covers({ 2: [0.8, 0.4] }) }, categories, "uber", TODAY).categories).toBeUndefined()
    // Words naming a category take that category alone.
    expect(parsedSearch(values({ words: "groceries" }), { ...answers({}), ...covers({ 2: [0.8, 0.4] }) }, categories, "groceries", TODAY)).toMatchObject({ categoryId: 4 })
    expect(parsedSearch(values({ words: "groceries" }), { ...answers({}), ...covers({ 2: [0.8, 0.4] }) }, categories, "groceries", TODAY).categories).toBeUndefined()
  })
})

describe("several payees and the biggest few", () => {
  test("payees joined by and, or, & or commas match any of them, each a description term; one not found sends them all to Jev", () => {
    const descriptions = ["McDonald's", "KFC", "Hungry Jack's"]
    const words = (w: string): ParsedSearch => ({ ...none, words: w })
    expect(searchFilter(snapPayee(words("mcdonalds and kfc"), descriptions), ctx)).toBe('(desc:"mcdonalds" OR desc:"kfc")')
    expect(searchFilter(snapPayee(words("kfc, hungry jacks or mcdonalds"), descriptions), ctx)).toBe('(desc:"kfc" OR desc:"hungry jacks" OR desc:"mcdonalds")')
    expect(snapPayee(words("kfc and maccas"), descriptions)).toMatchObject({ words: null, ask: "kfc and maccas" })
  })
  test("a count Jev reads as how many of the biggest becomes top:, after the rest", () => {
    const p = parsedSearch(values({ words: null }), answers({ amounts: ["top_count"], flow: "spending" }), categories, "top 10 purchases", TODAY)
    expect(p.top).toBe(10)
    expect(searchFilter(p, ctx)).toBe("type:spending AND top:10")
    expect(parsedSearch(values({ words: null }), answers({ amounts: ["top_count"] }), categories, "top 2.5", TODAY).top).toBeUndefined()
    // "The 5 cheapest" is never the 5 biggest; the count isn't judged per row either.
    const cheapest = parsedSearch(null, answers({ amounts: ["smallest_count"], phrase: "p2" }), categories, "5 cheapest coffees", TODAY)
    expect(cheapest).toMatchObject({ ask: "coffees" })
    expect(searchFilter(cheapest, ctx)).not.toContain("top:")
  })
})

describe("Jev reads only where a search could be", () => {
  test("ask: is bounded to the related categories and uncategorised rows; with nothing related or covered, every row", () => {
    const p: ParsedSearch = { ...none, ask: "coffee", related: [2, 4] }
    expect(searchFilter(p, ctx)).toBe('(cat:"Restaurants & Cafes" OR cat:"Groceries" OR cat:"Uncategorised") AND ask:"coffee"')
    expect(searchFilter({ ...p, categories: [3] }, ctx)).toBe('(cat:"Takeaway" OR ((cat:"Restaurants & Cafes" OR cat:"Groceries" OR cat:"Uncategorised") AND ask:"coffee"))')
    expect(searchFilter({ ...none, ask: "coffee" }, ctx)).toBe('ask:"coffee"')
    expect(parseFilterStrict(searchFilter({ ...p, categories: [3] }, ctx)).error).toBeUndefined()
  })
  test("related: Jev's kind at RELATED_KIND_AT or more, not covered", () => {
    const noul = (n: number): JevAnswer => ({ type: "noul", noul: n })
    const a = { ...answers({}), kind2: noul(0.78), every2: noul(0.1), kind3: noul(0.9), every3: noul(0.9), kind4: noul(0.39), every4: noul(0) }
    expect(parsedSearch(values({ words: "coffee" }), a, categories, "coffee", TODAY)).toMatchObject({ categories: [3], related: [2], ask: "coffee" })
  })
})

describe("searchDates: dates the models leave out or get wrong", () => {
  test("a date after today means the last one; dates make the period explicit", () => {
    expect(searchDates("2026-12-25", null, "spotify since christmas", "2026-11-01", "any")).toEqual({ from: "2025-12-25", to: null, period: "explicit" })
    expect(searchDates("2026-10-14", null, "spending on 14 October", "2026-11-01", "any")).toEqual({ from: "2026-10-14", to: "2026-10-14", period: "explicit" })
    expect(searchDates("2026-03-03", null, "since 3 March", "2026-11-01", "explicit")).toEqual({ from: "2026-03-03", to: null, period: "explicit" })
  })
  test("a named month is that month, its last time; with a year, that year's; since one, to today", () => {
    expect(searchDates(null, null, "fuel in September", "2026-11-01", "explicit")).toEqual({ from: "2026-09-01", to: "2026-09-30", period: "explicit" })
    expect(searchDates(null, null, "groceries in december", "2026-11-01", "any")).toEqual({ from: "2025-12-01", to: "2025-12-31", period: "explicit" })
    expect(searchDates(null, null, "rent march 2025", "2026-11-01", "any")).toEqual({ from: "2025-03-01", to: "2025-03-31", period: "explicit" })
    expect(searchDates(null, null, "uber since august", "2026-11-01", "any")).toEqual({ from: "2026-08-01", to: "2026-11-01", period: "explicit" })
  })
  test("'may' is a month only after a word like 'in'; a relative period wins over a month", () => {
    expect(searchDates(null, null, "what may be coffee", "2026-11-01", "any")).toEqual({ from: null, to: null, period: "any" })
    expect(searchDates(null, null, "coffee in may", "2026-11-01", "any")).toMatchObject({ from: "2026-05-01", to: "2026-05-31" })
    expect(searchDates(null, null, "september coffee last month", "2026-11-01", "last_month")).toEqual({ from: null, to: null, period: "last_month" })
  })
})

test("Jev's phrase stands when Clairic finds no words or when it holds Clairic's words and more; Clairic's when it holds Jev's", () => {
  const phrases = searchPhrases("money from Sam Parker")
  const p = parsedSearch({ words: { value: null }, from: { value: null }, to: { value: null } } as never, { phrase: { type: "choice", choice: `p${phrases.indexOf("Sam Parker")}`, probabilities: {} }, names_payee: { type: "noul", noul: 0.9 } } as never, [], "money from Sam Parker", TODAY)
  expect(p.words).toBe("Sam Parker")
  const pick = (query: string, phrase: string, clairic: string) => parsedSearch({ words: { value: clairic }, from: { value: null }, to: { value: null } } as never,
    { phrase: { type: "choice", choice: `p${searchPhrases(query).indexOf(phrase)}`, probabilities: {} }, names_payee: { type: "noul", noul: 0.9 } } as never, [], query, TODAY).words
  expect(pick("netflix and stan", "netflix and stan", "netflix")).toBe("netflix and stan")
  expect(pick("uber trips", "trips", "uber trips")).toBe("uber trips")
})
