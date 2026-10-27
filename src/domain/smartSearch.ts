import type { JevAnswer, JevClient } from "../ai/jev"
import type { ClairicAnswer, ClairicField, WorkersAiClient } from "../ai/workersAi"
import { cycleFor, type CycleConfig } from "./budget"
import { addDays, addMonths } from "./days"
import { categoryTerm } from "./drill"
import { anyOf, filterTerm } from "./filter"
import { FLOWS, PERIODS, searchQuestions, type Flow, type Period } from "./questions"
import type { Category } from "./types"

/**
 * Smart search: a plain-English query ("coffee over $5 last month") becomes an
 * ordinary filter expression the user can read and edit. Clairic extracts the
 * values written in it (words, amounts, explicit dates); Jev decides what it
 * asks about (the period, spending or income, a payee or a kind of thing).
 * Periods are worked out here, not by the model, so "last month" and "this
 * cycle" are exact. The words become `cat:` when they name one of the user's
 * categories, `desc:` when they name a payee, else `ask:` (Jev judges rows).
 */

/** What Clairic reads from the query. No example values in the
 * instructions: Clairic can echo them back as answers. */
export const SEARCH_FIELDS: Record<string, ClairicField> = {
  words: { type: "text", instructions: "Merchant or description words to search for. Not amounts, dates, periods or category names." },
  at_least: { type: "number", decimals: 2, instructions: "A lower bound on the amount in dollars, only if the search gives one: words like over, more than, at least, or a number followed by +. Empty when no amount is written." },
  at_most: { type: "number", decimals: 2, instructions: "An upper bound on the amount in dollars, only if the search gives one: words like under, less than, up to, at most. Empty when no amount is written." },
  from: { type: "date", instructions: "An explicit first date the user wrote, such as '3 March' or '2026-01-05'. Empty for relative periods like 'last month'." },
  to: { type: "date", instructions: "An explicit last date the user wrote. Empty for relative periods." },
}

export interface ParsedSearch {
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

/** The models' answers as a search. The words are a category when they name
 * one of `categories` (Jev's pick breaks ties), a payee to find in the
 * description when Jev says so, else something for Jev to judge rows by.
 * Equal bounds come from one phrase ("over $20" read both ways): the lower
 * bound is kept. */
export function parsedSearch(values: Record<string, ClairicAnswer>, answers: Record<string, JevAnswer>, categories: Category[]): ParsedSearch {
  const choice = (id: string) => { const a = answers[id]; return a?.type === "choice" ? a.choice : null }
  const value = (id: string) => values[id]?.value ?? null
  const text = (id: string) => { const v = value(id); return typeof v === "string" && v.trim() ? v.trim() : null }
  const number = (id: string) => { const v = value(id); return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null }
  const payee = answers.names_payee?.type === "noul" && answers.names_payee.noul > 0.5
  const words = text("words")
  const picked = choice("category")
  const named = words ? categoriesNamed(words, categories) : []
  const category = named.find((c) => `c${c.id}` === picked) ?? named.find((c) => c.name.toLowerCase() === words?.toLowerCase()) ?? (named.length === 1 ? named[0] : undefined)
  const categoryId = !payee && category ? category.id : null
  const period = choice("period")
  const flow = choice("flow")
  const atLeast = number("at_least"), atMost = number("at_most")
  return {
    words: categoryId == null && payee ? words : null,
    ask: categoryId == null && !payee ? words : null,
    atLeast,
    atMost: atMost === atLeast ? null : atMost,
    from: text("from"),
    to: text("to"),
    period: period && period in PERIODS ? (period as Period) : "any",
    flow: flow && flow in FLOWS ? (flow as Flow) : "any",
    categoryId,
  }
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
  if (p.ask) terms.push(filterTerm("ask", p.ask))
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

/** Ask both models about `query` (in parallel) and build its filter. When
 * nothing usable comes back, the query itself is the filter (plain text). */
export async function smartSearch(ai: { clairic: WorkersAiClient["clairic"]; jev: Pick<JevClient, "judge"> }, query: string, ctx: { today: string; cycle: CycleConfig; categories: Category[] }): Promise<{ expr: string; parsed: ParsedSearch }> {
  const [values, answers] = await Promise.all([
    ai.clairic(SEARCH_FIELDS, query, ctx.today),
    ai.jev.judge(searchQuestions(ctx.categories), query),
  ])
  const parsed = parsedSearch(values, answers, ctx.categories)
  const expr = searchFilter(parsed, ctx)
  return { expr: expr || filterTerm("desc", query), parsed }
}
