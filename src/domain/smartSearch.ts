import type { JevClient } from "../ai/jev"
import type { JevAnswer } from "../ai/judge"
import type { ClairicAnswer, ClairicField, WorkersAiClient } from "../ai/workersAi"
import { cycleFor, type CycleConfig } from "./budget"
import { MONTH_NAMES, addDays, addMonths } from "./days"
import { categoryTerm } from "./drill"
import { anyOf, filterTerm, textContains } from "./filter"
import { FLOWS, PERIODS, searchNumbers, searchPhrases, searchQuestions, searchTermQuestions, type Flow, type Period, coverQuestions, coveredCategoryIds, type CategoryUses, relatedCategoryIds } from "./questions"
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
 * categories, `desc:` when they name a payee, else `ask:` (Jev judges rows):
 * only rows in the categories the search relates to, and uncategorised
 * ones, so Jev's work stays bounded however long the history.
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
  /** Categories it relates to without covering (coffee → Restaurants &
   * Cafes, Groceries): `ask` is judged only there and on uncategorised
   * rows. None: on every row. */
  related?: number[]
  /** Description words (a payee). */
  words: string | null
  /** Words for Jev to judge rows by (a kind of thing). */
  ask: string | null
  atLeast: number | null
  atMost: number | null
  /** Only the biggest this many ("top 10"). */
  top?: number | null
  from: string | null
  to: string | null
  period: Period
  flow: Flow
  categoryId: number | null
}

/** Categories whose name has every one of `words` as a whole word
 * ("travel" names Holidays & Travel; "eating out" names nothing). */
function categoriesNamed(words: string, categories: Category[]): Category[] {
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
export function parsedSearch(values: Record<string, ClairicAnswer> | null, answers: Record<string, JevAnswer>, categories: Category[], query: string, today: string): ParsedSearch {
  const choice = (id: string) => { const a = answers[id]; return a?.type === "choice" ? a.choice : null }
  const value = (id: string) => values?.[id]?.value ?? null
  const text = (id: string) => { const v = value(id); return typeof v === "string" && v.trim() ? v.trim() : null }
  const payee = answers.names_payee?.type === "noul" && answers.names_payee.noul > 0.5
  const phrase = choice("phrase")
  // Clairic's words, or Jev's pick of the query's phrases: Jev's when
  // Clairic has none (it gave none for "money from Sam Parker", which left
  // all money in) or when Jev's holds Clairic's and more (Clairic read
  // "netflix and stan" as "netflix"); Clairic's holding Jev's ("uber trips"
  // over "trips") stands.
  const jevWords = phrase && /^p\d+$/.test(phrase) ? searchPhrases(query)[Number(phrase.slice(1))] ?? null : null
  const read = values ? text("words") : null
  const clairicWords = read && jevWords && jevWords.length > read.length && jevWords.toLowerCase().includes(read.toLowerCase()) ? null : read
  const words = clairicWords ?? jevWords
  const picked = choice("category")
  const named = words ? categoriesNamed(words, categories) : []
  const category = named.find((c) => `c${c.id}` === picked) ?? named.find((c) => c.name.toLowerCase() === words?.toLowerCase()) ?? (named.length === 1 ? named[0] : undefined)
  const categoryId = !payee && category ? category.id : null
  const period = choice("period")
  const flow = choice("flow")
  let atLeast: number | null = null, atMost: number | null = null, top: number | null = null, smallest = false
  searchNumbers(query).forEach((n, i) => {
    const role = choice(`amount${i}`)
    const amount = Number(n.replace(/[$+]/g, ""))
    if (!Number.isFinite(amount) || amount <= 0) return
    if (role === "at_least") atLeast = amount
    if (role === "at_most") atMost = amount
    if (role === "top_count" && Number.isInteger(amount)) top = amount
    // "The 5 cheapest": no filter term cuts the smallest yet, but it is a
    // count, not something to judge rows by.
    if (role === "smallest_count") smallest = true
  })
  const constrained = top != null || smallest || atLeast != null || atMost != null || (!!period && period !== "any")
  // A search for a shop or person, or one naming a category, isn't routed further.
  // With no subject at all ("spending on 14 October", "top 10 biggest
  // purchases this year"), no categories either: what the category
  // questions say of a search with nothing in it is noise (Parking; Technology).
  const covered = categoryId == null && !payee && words ? coveredCategoryIds(answers, categories) : []
  const related = categoryId == null && !payee && words ? relatedCategoryIds(answers, categories) : []
  return {
    ...(covered.length ? { categories: covered } : {}),
    ...(related.length ? { related } : {}),
    words: categoryId == null && payee ? words : null,
    // Without Clairic the words are Jev's guess at a phrase (often a fragment:
    // "stuff" from "stuff for the car"), so ask: gets the whole question,
    // unless the question carries what the other terms already say (a
    // count, an amount, a period): no one row is "the top 10 coffees".
    ask: categoryId == null && !payee && words ? (clairicWords || constrained ? words : query.trim()) : null,
    atLeast,
    atMost,
    ...(top ? { top } : {}),
    ...searchDates(text("from"), text("to"), query, today, period && period in PERIODS ? (period as Period) : "any"),
    flow: flow && flow in FLOWS ? (flow as Flow) : "any",
    categoryId,
  }
}


/**
 * The search's dates, worked out in code where the models leave a gap:
 * - A first date alone is that day, or after "since", "from" and the
 *   like, from then to today.
 * - A date after today means the last one (Clairic read "since christmas"
 *   as this coming one, which matched nothing): a year earlier.
 * - A month named with no dates ("fuel in September": no period option
 *   names a month, and Clairic gives only dates written as dates) is that
 *   month, its last time (with a year, that year's); after "since" or
 *   "from", that month to today. "may" counts only after "in", "since" or
 *   the like, being a word too.
 */
function searchDates(from: string | null, to: string | null, query: string, today: string, period: Period): Pick<ParsedSearch, "from" | "to" | "period"> {
  const back = (d: string | null) => (d && d > today ? `${Number(d.slice(0, 4)) - 1}${d.slice(4)}` : d)
  // A first date alone runs to today after "since" and the like; else it's
  // that one day ("spending on 14 October").
  const open = /\b(since|from|after|onwards?|starting)\b/i.test(query)
  if (from || to) return { from: back(from), to: back(to ?? (open ? null : from)), period: period === "any" ? "explicit" : period }
  if (period !== "any" && period !== "explicit") return { from: null, to: null, period }
  const found = new RegExp(`\\b(in|during|for|of|since|from|after|throughout)?\\s*\\b(${MONTH_NAMES.join("|")})\\b(?:\\s+(\\d{4}))?`, "i").exec(query)
  if (!found || (found[2]!.toLowerCase() === "may" && !found[1])) return { from: null, to: null, period }
  const month = MONTH_NAMES.indexOf(found[2]!.toLowerCase()) + 1
  let year = found[3] ? Number(found[3]) : Number(today.slice(0, 4))
  const first = () => `${year}-${String(month).padStart(2, "0")}-01`
  if (!found[3] && first() > today) year--
  const start = first()
  const since = /^(since|from|after)$/i.test(found[1] ?? "")
  return { from: start, to: since ? today : addDays(addMonths(start, 1), -1), period: "explicit" }
}

/** The payees in a search's words: "mcdonalds and kfc", "kfc, hungry
 * jacks or maccas" name several (any of them matches). */
export function payees(words: string): string[] {
  return words.split(/\s*(?:,|&|\band\b|\bor\b)\s*/i).map((w) => w.trim()).filter(Boolean)
}

/**
 * Payee words no description contains (as `desc:` matches, so "Mcdonalds"
 * finds "McDonald's") go to Jev as `ask:` instead, which knows "Maccas" is
 * McDonald's; for several payees, when any of them isn't found.
 */
export function snapPayee(p: ParsedSearch, descriptions: string[]): ParsedSearch {
  if (!p.words || payees(p.words).every((w) => descriptions.some((d) => textContains(d, w)))) return p
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
  if (p.words) terms.push(anyOf(payees(p.words).map((w) => filterTerm("desc", w))))
  const term = (id: number) => {
    const category = ctx.categories.find((c) => c.id === id)
    return category ? [categoryTerm(category, ctx.categories)] : []
  }
  const covered = (p.categories ?? []).flatMap(term)
  // Jev reads only related categories' rows and uncategorised ones; with
  // nothing related, every row.
  const uncategorised = ctx.categories.find((c) => c.isDefault)
  const scope = (p.related ?? []).flatMap(term)
  const ask = !p.ask ? null : scope.length || covered.length
    ? `${anyOf([...scope, ...(uncategorised ? [filterTerm("cat", uncategorised.name)] : [])])} AND ${filterTerm("ask", p.ask)}`
    : filterTerm("ask", p.ask)
  // Covered categories match outright, and Jev isn't asked about them.
  if (covered.length) terms.push(anyOf([...covered, ...(ask ? [ask.includes(" AND ") ? `(${ask})` : ask] : [])]))
  else if (ask) terms.push(ask)
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
  if (p.top) terms.push(`top:${p.top}`)
  return terms.join(" AND ")
}

/**
 * Ask Jev (and Clairic, when there is one) about `query`, in parallel, and
 * build its filter. Clairic failing (no key, or Cloudflare's free daily
 * allowance used up) doesn't stop the search: `clairic` says why it was left
 * out. When nothing usable comes back, the query itself is the filter.
 * `uses`, the account holder's examples per category (suggest
 * categoryUses), go with the category questions in a request of their own,
 * at the same time: in the same state they pulled the phrase question
 * ("stuff for the car" → "car", then read as Car Insurance).
 */
export async function smartSearch(
  ai: { clairic?: WorkersAiClient["clairic"]; jev: Pick<JevClient, "judge"> },
  query: string,
  ctx: { today: string; cycle: CycleConfig; categories: Category[]; descriptions?: string[]; uses?: CategoryUses },
): Promise<{ expr: string; parsed: ParsedSearch; clairic: string | null }> {
  const uses = ctx.uses && Object.keys(ctx.uses).length ? ctx.uses : null
  const [values, terms, covers] = await Promise.all([
    ai.clairic
      ? ai.clairic(SEARCH_FIELDS, query, ctx.today).catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))))
      : Promise.resolve(new Error("no Workers AI key")),
    ai.jev.judge({ ...searchQuestions(ctx.categories), ...searchTermQuestions(query) }, { search: query }),
    ai.jev.judge(coverQuestions(ctx.categories, !!uses), { search: query, ...(uses ? { categories_used_for: uses } : {}) }),
  ])
  const answers = { ...terms, ...covers }
  const clairic = values instanceof Error ? values.message : null
  const raw = parsedSearch(values instanceof Error ? null : values, answers, ctx.categories, query, ctx.today)
  const parsed = ctx.descriptions ? snapPayee(raw, ctx.descriptions) : raw
  const expr = searchFilter(parsed, ctx)
  return { expr: expr || filterTerm("desc", query), parsed, clairic }
}
