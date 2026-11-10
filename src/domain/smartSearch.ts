import type { JevClient } from "../ai/jev"
import type { JevAnswer } from "../ai/judge"
import type { ClairicAnswer, ClairicField, WorkersAiClient } from "../ai/workersAi"
import { cycleFor, type CycleConfig } from "./budget"
import { MONTH_NAMES, addDays, addMonths } from "./days"
import { categoryTerm } from "./drill"
import { anyOf, filterTerm, textContains } from "./filter"
import { FLOWS, PERIODS, searchNumbers, searchPhrases, searchQuestions, searchTermQuestions, type Flow, type Period, coverQuestions, coveredCategoryIds, type CategoryUses, relatedCategoryIds } from "./questions"
import type { Category } from "./types"

export const SEARCH_FIELDS: Record<string, ClairicField> = {
  words: { type: "text", instructions: "Merchant or description words to search for. Not amounts, dates, periods or category names." },
  from: { type: "date", instructions: "An explicit first date the user wrote, such as '3 March' or '2026-01-05'. Empty for relative periods like 'last month'." },
  to: { type: "date", instructions: "An explicit last date the user wrote. Empty for relative periods." },
}

export interface ParsedSearch {
  categories?: number[]
  related?: number[]
  words: string | null
  ask: string | null
  atLeast: number | null
  atMost: number | null
  top?: number | null
  from: string | null
  to: string | null
  period: Period
  flow: Flow
  categoryId: number | null
}

function categoriesNamed(words: string, categories: Category[]): Category[] {
  const split = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  const wanted = split(words)
  if (!wanted.length) return []
  return categories.filter((c) => !c.isDefault && wanted.every((w) => split(c.name).includes(w)))
}

export function parsedSearch(values: Record<string, ClairicAnswer> | null, answers: Record<string, JevAnswer>, categories: Category[], query: string, today: string): ParsedSearch {
  const choice = (id: string) => { const a = answers[id]; return a?.type === "choice" ? a.choice : null }
  const value = (id: string) => values?.[id]?.value ?? null
  const text = (id: string) => { const v = value(id); return typeof v === "string" && v.trim() ? v.trim() : null }
  const payee = answers.names_payee?.type === "noul" && answers.names_payee.noul > 0.5
  const phrase = choice("phrase")
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
    if (role === "smallest_count") smallest = true
  })
  const constrained = top != null || smallest || atLeast != null || atMost != null || (!!period && period !== "any")
  const covered = categoryId == null && !payee && words ? coveredCategoryIds(answers, categories) : []
  const related = categoryId == null && !payee && words ? relatedCategoryIds(answers, categories) : []
  return {
    ...(covered.length ? { categories: covered } : {}),
    ...(related.length ? { related } : {}),
    words: categoryId == null && payee ? words : null,
    ask: categoryId == null && !payee && words ? (clairicWords || constrained ? words : query.trim()) : null,
    atLeast,
    atMost,
    ...(top ? { top } : {}),
    ...searchDates(text("from"), text("to"), query, today, period && period in PERIODS ? (period as Period) : "any"),
    flow: flow && flow in FLOWS ? (flow as Flow) : "any",
    categoryId,
  }
}

function searchDates(from: string | null, to: string | null, query: string, today: string, period: Period): Pick<ParsedSearch, "from" | "to" | "period"> {
  const back = (d: string | null) => (d && d > today ? `${Number(d.slice(0, 4)) - 1}${d.slice(4)}` : d)
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

export function payees(words: string): string[] {
  return words.split(/\s*(?:,|&|\band\b|\bor\b)\s*/i).map((w) => w.trim()).filter(Boolean)
}

export function snapPayee(p: ParsedSearch, descriptions: string[]): ParsedSearch {
  if (!p.words || payees(p.words).every((w) => descriptions.some((d) => textContains(d, w)))) return p
  return { ...p, words: null, ask: p.words }
}

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

export function searchFilter(p: ParsedSearch, ctx: { today: string; cycle: CycleConfig; categories: Category[] }): string {
  const terms: string[] = []
  if (p.words) terms.push(anyOf(payees(p.words).map((w) => filterTerm("desc", w))))
  const term = (id: number) => {
    const category = ctx.categories.find((c) => c.id === id)
    return category ? [categoryTerm(category, ctx.categories)] : []
  }
  const covered = (p.categories ?? []).flatMap(term)
  const uncategorised = ctx.categories.find((c) => c.isDefault)
  const scope = (p.related ?? []).flatMap(term)
  const ask = !p.ask ? null : scope.length || covered.length
    ? `${anyOf([...scope, ...(uncategorised ? [filterTerm("cat", uncategorised.name)] : [])])} AND ${filterTerm("ask", p.ask)}`
    : filterTerm("ask", p.ask)
  if (covered.length) terms.push(anyOf([...covered, ...(ask ? [ask.includes(" AND ") ? `(${ask})` : ask] : [])]))
  else if (ask) terms.push(ask)
  if (p.categoryId != null) {
    const category = ctx.categories.find((c) => c.id === p.categoryId)
    if (category) terms.push(categoryTerm(category, ctx.categories))
  }
  if (p.flow !== "any") terms.push(`type:${p.flow === "money_in" ? "credit" : p.flow}`)
  if (p.atLeast != null || p.atMost != null) {
    const lo = p.atLeast, hi = p.atMost
    const out = lo != null && hi != null ? `amt:${-hi}..${-lo}` : lo != null ? `amt:<=${-lo}` : `amt:>=${-hi!}`
    const into = lo != null && hi != null ? `amt:${lo}..${hi}` : lo != null ? `amt:>=${lo}` : `amt:<=${hi!}`
    const either = lo == null ? `amt:${-hi!}..${hi!}` : anyOf([out, into])
    terms.push(p.flow === "spending" ? out : p.flow === "any" ? either : into)
  }
  const bounds = periodBounds(p, ctx.today, ctx.cycle)
  if (bounds) terms.push(`date:${bounds.start}..${bounds.end}`)
  if (p.top) terms.push(`top:${p.top}`)
  return terms.join(" AND ")
}

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
