import type { JevAnswer, JevClient } from "../ai/jev"
import type { ClairicAnswer, ClairicField, WorkersAiClient } from "../ai/workersAi"
import { cycleFor, type CycleConfig } from "./budget"
import { addDays, addMonths } from "./days"
import { categoryTerm } from "./drill"
import { anyOf, filterTerm, textContains } from "./filter"
import { FLOWS, PERIODS, searchNumbers, searchPhrases, searchQuestions, searchTermQuestions, type Flow, type Period, coverQuestions, coveredCategoryIds } from "./questions"
import type { Category } from "./types"

/**
 * Smart search: a plain-English query ("coffee over $5 last month") becomes an
 * ordinary filter expression the user can read and edit. Jev, in one request,
 * decides what it asks about (the period, spending or income, a payee or a
 * kind of thing) and what each number in it means; Clairic, when it is set up
 * and answering, extracts the words and explicit dates. Without Clairic, Jev
 * picks the words from the query's own phrases and explicit dates are lost.
 * Periods are worked out here, not by the model, so "last month" and "this
 * cycle" are exact. The words become `cat:` when they name one of the user's
 * categories, `desc:` when they name a payee, else `ask:` (Jev judges rows).
 */

/** What Clairic reads from the query. No example values in the
 * instructions: Clairic can echo them back as answers. */
export const SEARCH_FIELDS: Record<string, ClairicField> = {
  words: { type: "text", instructions: "Merchant or description words to search for. Not amounts, dates, periods or category names." },
  from: { type: "date", instructions: "An explicit first date the user wrote, such as '3 March' or '2026-01-05'. Empty for relative periods like 'last month'." },
  to: { type: "date", instructions: "An explicit last date the user wrote. Empty for relative periods." },
}

export interface ParsedSearch {
  /** Categories a broad search covers ("stuff for the car" → Fuel, Parking,
   * …): any of them matches, as does `ask` for the rows outside them. */
  categories?: number[]
  /** Description words (a payee). */
  words: string | null
  /** Words for Jev to judge rows by (a kind of thing). */
  ask: string | null
  atLeast: number | null
  atMost: number | null
  from: string | null
  to: string | null
  period: Period
  flow: Flow
  categoryId: number | null
}

/** Categories whose name has every one of `words` as a whole word
 * ("travel" names Holidays & Travel; "eating out" names nothing). */
export function categoriesNamed(words: string, categories: Category[]): Category[] {
  const split = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  const wanted = split(words)
  if (!wanted.length) return []
  return categories.filter((c) => !c.isDefault && wanted.every((w) => split(c.name).includes(w)))
}

/** The models' answers as a search. The words (Clairic's, or with `values`
 * null, Jev's pick of the query's phrases) are a category when they name one
 * of `categories` (Jev's pick breaks ties), a payee to find in the
 * description when Jev says so, else something for Jev to judge rows by.
 * Amounts are the query's numbers in the roles Jev gives them. */
export function parsedSearch(values: Record<string, ClairicAnswer> | null, answers: Record<string, JevAnswer>, categories: Category[], query: string): ParsedSearch {
  const choice = (id: string) => { const a = answers[id]; return a?.type === "choice" ? a.choice : null }
  const value = (id: string) => values?.[id]?.value ?? null
  const text = (id: string) => { const v = value(id); return typeof v === "string" && v.trim() ? v.trim() : null }
  const payee = answers.names_payee?.type === "noul" && answers.names_payee.noul > 0.5
  const phrase = choice("phrase")
  const words = values ? text("words") : phrase && /^p\d+$/.test(phrase) ? searchPhrases(query)[Number(phrase.slice(1))] ?? null : null
  const picked = choice("category")
  const named = words ? categoriesNamed(words, categories) : []
  const category = named.find((c) => `c${c.id}` === picked) ?? named.find((c) => c.name.toLowerCase() === words?.toLowerCase()) ?? (named.length === 1 ? named[0] : undefined)
  const categoryId = !payee && category ? category.id : null
  const period = choice("period")
  const flow = choice("flow")
  let atLeast: number | null = null, atMost: number | null = null
  searchNumbers(query).forEach((n, i) => {
    const role = choice(`amount${i}`)
    const amount = Number(n.replace(/[$+]/g, ""))
    if (!Number.isFinite(amount) || amount <= 0) return
    if (role === "at_least") atLeast = amount
    if (role === "at_most") atMost = amount
  })
  // A search for a shop or person, or one naming a category, isn't routed further.
  const covered = categoryId == null && !payee ? coveredCategoryIds(answers, categories) : []
  return {
    ...(covered.length ? { categories: covered } : {}),
    words: categoryId == null && payee ? words : null,
    // Without Clairic the words are Jev's guess at a phrase (often a fragment:
    // "stuff" from "stuff for the car"); ask: has Jev read every row anyway,
    // so it gets the whole question.
    ask: categoryId == null && !payee && words ? (values ? words : query.trim()) : null,
    atLeast,
    atMost,
    from: text("from"),
    to: text("to"),
    period: period && period in PERIODS ? (period as Period) : "any",
    flow: flow && flow in FLOWS ? (flow as Flow) : "any",
    categoryId,
  }
}

/**
 * Payee words no description contains (as `desc:` matches, so "Mcdonalds"
 * finds "McDonald's") go to Jev as `ask:` instead, which knows "Maccas" is
 * McDonald's.
 */
export function snapPayee(p: ParsedSearch, descriptions: string[]): ParsedSearch {
  if (!p.words || descriptions.some((d) => textContains(d, p.words!))) return p
  return { ...p, words: null, ask: p.words }
}

/** A period's first and last day; null for no period. Ranges that are still
 * running end today. */
export function periodBounds(p: Pick<ParsedSearch, "period" | "from" | "to">, today: string, cycle: CycleConfig): { start: string; end: string } | null {
  const month = today.slice(0, 8) + "01"
  const year = today.slice(0, 4)
  switch (p.period) {
    case "any": return null
    case "this_cycle": return { start: cycleFor(cycle, today).start, end: today }
    case "last_cycle": {
      const previous = cycleFor(cycle, addDays(cycleFor(cycle, today).start, -1))
      return { start: previous.start, end: previous.end }
    }
    case "this_month": return { start: month, end: today }
    case "last_month": return { start: addMonths(month, -1), end: addDays(month, -1) }
    case "last_30": return { start: addDays(today, -29), end: today }
    case "last_90": return { start: addDays(today, -89), end: today }
    case "this_year": return { start: `${year}-01-01`, end: today }
    case "last_year": return { start: `${Number(year) - 1}-01-01`, end: `${Number(year) - 1}-12-31` }
    case "explicit":
      if (!p.from && !p.to) return null
      return { start: p.from ?? "1900-01-01", end: p.to ?? today }
  }
}

/** The filter expression for a parsed search. Amounts are signed in the
 * data (spending is negative), so "over $5" is money out of at least $5,
 * money in of at least $5, or either. */
export function searchFilter(p: ParsedSearch, ctx: { today: string; cycle: CycleConfig; categories: Category[] }): string {
  const terms: string[] = []
  if (p.words) terms.push(filterTerm("desc", p.words))
  const covered = (p.categories ?? []).flatMap((id) => {
    const category = ctx.categories.find((c) => c.id === id)
    return category ? [categoryTerm(category, ctx.categories)] : []
  })
  // Covered categories match outright; Jev reads only the rows outside them.
  if (covered.length) terms.push(anyOf([...covered, ...(p.ask ? [filterTerm("ask", p.ask)] : [])]))
  else if (p.ask) terms.push(filterTerm("ask", p.ask))
  if (p.categoryId != null) {
    const category = ctx.categories.find((c) => c.id === p.categoryId)
    if (category) terms.push(categoryTerm(category, ctx.categories))
  }
  // Money in from anyone is every credit; income is the income categories.
  if (p.flow !== "any") terms.push(`type:${p.flow === "money_in" ? "credit" : p.flow}`)
  if (p.atLeast != null || p.atMost != null) {
    const lo = p.atLeast, hi = p.atMost
    const out = lo != null && hi != null ? `amt:${-hi}..${-lo}` : lo != null ? `amt:<=${-lo}` : `amt:>=${-hi!}`
    const into = lo != null && hi != null ? `amt:${lo}..${hi}` : lo != null ? `amt:>=${lo}` : `amt:<=${hi!}`
    // Either way: at most $hi of money out or in is one range around zero.
    const either = lo == null ? `amt:${-hi!}..${hi!}` : anyOf([out, into])
    terms.push(p.flow === "spending" ? out : p.flow === "any" ? either : into)
  }
  const bounds = periodBounds(p, ctx.today, ctx.cycle)
  if (bounds) terms.push(`date:${bounds.start}..${bounds.end}`)
  return terms.join(" AND ")
}

/**
 * Ask Jev (and Clairic, when there is one) about `query`, in parallel, and
 * build its filter. Clairic failing (no key, or Cloudflare's free daily
 * allowance used up) doesn't stop the search: `clairic` says why it was left
 * out. When nothing usable comes back, the query itself is the filter.
 */
export async function smartSearch(
  ai: { clairic?: WorkersAiClient["clairic"]; jev: Pick<JevClient, "judge"> },
  query: string,
  ctx: { today: string; cycle: CycleConfig; categories: Category[]; descriptions?: string[] },
): Promise<{ expr: string; parsed: ParsedSearch; clairic: string | null }> {
  const [values, answers] = await Promise.all([
    ai.clairic
      ? ai.clairic(SEARCH_FIELDS, query, ctx.today).catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))))
      : Promise.resolve(new Error("no Workers AI key")),
    ai.jev.judge({ ...searchQuestions(ctx.categories), ...searchTermQuestions(query), ...coverQuestions(ctx.categories) }, { search: query }),
  ])
  const clairic = values instanceof Error ? values.message : null
  const raw = parsedSearch(values instanceof Error ? null : values, answers, ctx.categories, query)
  const parsed = ctx.descriptions ? snapPayee(raw, ctx.descriptions) : raw
  const expr = searchFilter(parsed, ctx)
  return { expr: expr || filterTerm("desc", query), parsed, clairic }
}
