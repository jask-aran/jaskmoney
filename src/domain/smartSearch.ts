import type { ClairicAnswer, ClairicField, ClefAnswer, ClefQuestion, WorkersAiClient } from "../ai/workersAi"
import { cycleFor, type CycleConfig } from "./budget"
import { addDays, addMonths } from "./days"
import { categoryTerm } from "./drill"
import { anyOf, filterTerm } from "./filter"
import type { Category } from "./types"

/**
 * Smart search: a plain-English query ("coffee over $5 last month") becomes an
 * ordinary filter expression the user can read and edit. Clairic extracts the
 * values written in it (words, amounts, explicit dates); Clef decides what it
 * asks about (the period, spending or income, a category). Periods are worked
 * out here, not by the model, so "last month" and "this cycle" are exact.
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

export const PERIODS = {
  any: "No period mentioned",
  this_cycle: "This budget cycle, or since payday",
  last_cycle: "The previous budget cycle",
  this_month: "This calendar month",
  last_month: "Last calendar month",
  last_30: "The last 30 days, or the past month",
  last_90: "The last 3 months or 90 days",
  this_year: "This year",
  last_year: "Last year",
  explicit: "Specific dates are given",
} as const
export type Period = keyof typeof PERIODS

const FLOWS = {
  any: "Not specified",
  spending: "Spending, purchases, money out",
  money_in: "Money received from someone, refunds, paybacks",
  income: "Income: pay, salary, interest, earnings",
} as const
export type Flow = keyof typeof FLOWS

/** Clef's questions about the query: the period, the kind of money, and
 * whether (and which) category it names. Categories are keyed `c<id>`. */
export function searchQuestions(categories: Category[]): Record<string, ClefQuestion> {
  const byId = new Map(categories.map((c) => [c.id, c]))
  const criteria: Record<string, string> = { none: "No category is named" }
  for (const c of categories) {
    if (c.isDefault) continue
    const parent = c.parentId != null ? byId.get(c.parentId) : undefined
    criteria[`c${c.id}`] = parent ? `${parent.name} › ${c.name}` : c.name
  }
  return {
    period: { type: "choice", instructions: "Which period does the search ask about?", criteria: { ...PERIODS } },
    flow: { type: "choice", instructions: "What kind of money is asked about?", criteria: { ...FLOWS } },
    names_category: { type: "noul", instructions: "Does the search ask about a kind of spending or a category (groceries, eating out, travel, salary) rather than a particular merchant or payee?" },
    category: { type: "choice", instructions: "Which category does the search ask about?", criteria },
  }
}

export interface ParsedSearch {
  words: string | null
  atLeast: number | null
  atMost: number | null
  from: string | null
  to: string | null
  period: Period
  flow: Flow
  categoryId: number | null
}

/** The models' answers as a search. A category counts when Clef says the
 * query names one (the words naming it are then dropped), or when there are
 * no words to search for. Equal bounds come from one phrase ("over $20"
 * read both ways): the lower bound is kept. */
export function parsedSearch(values: Record<string, ClairicAnswer>, answers: Record<string, ClefAnswer>): ParsedSearch {
  const choice = (id: string) => { const a = answers[id]; return a?.type === "choice" ? a.choice : null }
  const value = (id: string) => values[id]?.value ?? null
  const text = (id: string) => { const v = value(id); return typeof v === "string" && v.trim() ? v.trim() : null }
  const number = (id: string) => { const v = value(id); return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null }
  const named = answers.names_category?.type === "noul" && answers.names_category.noul > 0.5
  const words = text("words")
  const category = named || !words ? choice("category") : null
  const categoryId = category && /^c\d+$/.test(category) ? Number(category.slice(1)) : null
  const period = choice("period")
  const flow = choice("flow")
  const atLeast = number("at_least"), atMost = number("at_most")
  return {
    words: categoryId != null && named ? null : words,
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
export async function smartSearch(ai: Pick<WorkersAiClient, "clef" | "clairic">, query: string, ctx: { today: string; cycle: CycleConfig; categories: Category[] }): Promise<{ expr: string; parsed: ParsedSearch }> {
  const [values, answers] = await Promise.all([
    ai.clairic(SEARCH_FIELDS, query, ctx.today),
    // Full Clef: Clef-flash mistook "this cycle" and "last month" for the last 30 days.
    ai.clef(searchQuestions(ctx.categories), query, "clef"),
  ])
  const parsed = parsedSearch(values, answers)
  const expr = searchFilter(parsed, ctx)
  return { expr: expr || filterTerm("desc", query), parsed }
}
