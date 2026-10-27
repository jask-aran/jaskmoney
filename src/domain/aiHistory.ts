import type { CategoryLogEntry, TagLogEntry } from "../db/client"
import { askTerms, evalFilter, parseFilterStrict } from "./filter"
import { isUncategorised } from "./moneyRules"
import { dryRunRules, filterRowNames } from "./rules"
import { descKey, groupByDescription } from "./transactionGroups"
import type { Category, Rule, SavedFilter, Tag, Transaction } from "./types"

/**
 * The app's history as plain data for the AI: what's in a category or on a
 * tag, what you did recently and how, which descriptions are reliably one
 * thing, what the rows have in common, what looks alike but isn't, and how a
 * filter expression would do. Read-only and JSON-shaped (no ids the model
 * must look up, names instead); every list is capped.
 */
export interface HistoryData {
  transactions: Transaction[]
  categories: Category[]
  tags: Tag[]
  rules: Rule[]
  savedFilters: SavedFilter[]
  categoryLog: CategoryLogEntry[]
  tagLog: TagLogEntry[]
  /** Who set each row's category ("provider": Up; "type": sync from Up's
   * transaction type; "user", "pending", "rule"); absent rows have none. */
  categorySources?: Map<number, string | null>
}

/** The filter language, for prompts: what a rule can test. */
export const FILTER_GUIDE = `Filter expressions (rules use these):
- desc:WORDS  description contains the words (case, spaces and punctuation ignored); quote multi-word: desc:"Transfer to Holiday"
- note:WORDS  the payment's message or note contains the words
- cat:NAME  category is exactly NAME (quote names with spaces: cat:"Rent & Mortgage"); cat:Uncategorised for none
- acc:NAME  account name is exactly NAME
- tag:NAME  has the tag
- type:debit | type:credit (money out | in), type:spending | type:income
- amt:=-30  amt:<-100  amt:>=50  amt:-50..-20  (money out is negative)
- date:2026-05  date:2026-05-01..2026-05-31
- combine with AND, OR, NOT and parentheses; terms side by side mean AND
Not testable in a filter (context only): up_type, card, foreign, payer.`

/** A transaction as the model reads it: names, not ids; empty facts left out. */
export interface RowFacts {
  date: string
  description: string
  amount: number
  account: string
  category: string
  tags?: string[]
  message?: string
  payer?: string
  up_type?: string
  card?: string
  foreign?: string
}

export function rowFacts(t: Transaction): RowFacts {
  return {
    date: t.dateISO,
    description: t.description.trim(),
    amount: t.amount,
    account: t.accountName,
    category: t.categoryName,
    ...(t.tagNames.length ? { tags: t.tagNames } : {}),
    ...(t.message ? { message: t.message } : {}),
    ...(t.rawText && t.rawText !== t.description ? { payer: t.rawText } : {}),
    ...(t.transactionType ? { up_type: t.transactionType } : {}),
    ...(t.cardMethod ? { card: t.cardMethod } : {}),
    ...(t.foreignAmount ? { foreign: t.foreignAmount } : {}),
  }
}

type Group<T> = { key: T; rows: number; share: number }

/** The most common values of `pick` among `rows` (≥ min rows each), with their share. */
function common<T>(rows: Transaction[], pick: (t: Transaction) => T | null | undefined, limit = 5, min = 1): Group<T>[] {
  const counts = new Map<T, number>()
  for (const t of rows) {
    const v = pick(t)
    if (v != null && v !== "") counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  return [...counts].filter(([, n]) => n >= min).sort((a, b) => b[1] - a[1]).slice(0, limit)
    .map(([key, n]) => ({ key, rows: n, share: round(n / Math.max(1, rows.length)) }))
}

const round = (n: number) => Math.round(n * 100) / 100

/** What a set of rows share: accounts, Up's types, card use, currencies, repeated amounts. */
export function sharedFacts(rows: Transaction[]) {
  const named = <T>(groups: Group<T>[], name: string) => groups.map(({ key, rows, share }) => ({ [name]: key, rows, share }))
  return {
    rows: rows.length,
    accounts: named(common(rows, (t) => t.accountName), "account"),
    up_types: named(common(rows, (t) => t.transactionType), "up_type"),
    card: named(common(rows, (t) => t.cardMethod), "card"),
    currencies: named(common(rows, (t) => t.foreignAmount?.split(" ")[0]), "currency"),
    money: { out: rows.filter((t) => t.amount < 0).length, in: rows.filter((t) => t.amount > 0).length },
    repeated_amounts: named(common(rows, (t) => t.amount, 6, 2), "amount"),
    dates: rows.length ? { first: rows.reduce((a, t) => (t.dateISO < a ? t.dateISO : a), rows[0]!.dateISO), last: rows.reduce((a, t) => (t.dateISO > a ? t.dateISO : a), rows[0]!.dateISO) } : null,
  }
}

/**
 * For each exact description among `inside` (most rows first): how many rows
 * have it in all, how many are inside, which categories hold the rest, and
 * how many wait for one. A description whose rows are all inside is a
 * perfect match.
 */
export function descriptionGroups(inside: Transaction[], all: Transaction[], limit = 30) {
  const insideIds = new Set(inside.map((t) => t.id))
  const byKey = groupByDescription(all)
  const keys = [...new Set(inside.map(descKey))]
  return keys.map((key) => {
    const rows = byKey.get(key) ?? []
    const inCount = rows.filter((t) => insideIds.has(t.id)).length
    const others = rows.filter((t) => !insideIds.has(t.id))
    const elsewhere: Record<string, number> = {}
    for (const t of others) if (!isUncategorised(t)) elsewhere[t.categoryName] = (elsewhere[t.categoryName] ?? 0) + 1
    return {
      description: rows[0]?.description.trim() ?? key,
      rows: rows.length,
      inside: inCount,
      elsewhere,
      waiting: others.filter(isUncategorised).length,
      perfect: inCount === rows.length,
    }
  }).sort((a, b) => b.inside - a.inside || a.description.localeCompare(b.description)).slice(0, limit)
}

/** Words (4+ letters) of the inside rows' descriptions. */
function words(rows: Transaction[]): Set<string> {
  const out = new Set<string>()
  for (const t of rows) for (const w of t.description.toLowerCase().match(/[a-z]{4,}/g) ?? []) out.add(w)
  return out
}

/** Rows outside that share a word with the inside rows' descriptions, by
 * description: what a desc: rule might catch by mistake. */
export function lookalikes(inside: Transaction[], all: Transaction[], limit = 12) {
  const insideIds = new Set(inside.map((t) => t.id))
  const insideKeys = new Set(inside.map(descKey))
  const vocab = words(inside)
  const groups = new Map<string, { description: string; rows: number; categories: Record<string, number>; shares: string[] }>()
  for (const t of all) {
    if (insideIds.has(t.id) || insideKeys.has(descKey(t))) continue
    const shared = (t.description.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => vocab.has(w))
    if (!shared.length) continue
    const g = groups.get(descKey(t)) ?? { description: t.description.trim(), rows: 0, categories: {}, shares: [...new Set(shared)] }
    g.rows++
    g.categories[t.categoryName] = (g.categories[t.categoryName] ?? 0) + 1
    groups.set(descKey(t), g)
  }
  return [...groups.values()].sort((a, b) => b.rows - a.rows).slice(0, limit)
}

function ruleList(data: HistoryData, keep: (rule: Rule) => boolean) {
  return data.rules.filter((r) => r.enabled && keep(r)).map((r) => ({
    name: r.name,
    expr: data.savedFilters.find((f) => f.id === r.savedFilterId)?.expr ?? "(missing filter)",
  }))
}

/**
 * A category's history: its rows' shared facts, your recent choices into it
 * (newest first, with how and what it was before), its descriptions by
 * purity, lookalikes elsewhere, and the rules that already set it.
 */
export function categoryHistory(data: HistoryData, categoryId: number, limits: { recent?: number; descriptions?: number } = {}) {
  const category = data.categories.find((c) => c.id === categoryId)
  if (!category) throw new Error(`no category ${categoryId}`)
  const parent = category.parentId != null ? data.categories.find((c) => c.id === category.parentId)?.name : undefined
  const inside = data.transactions.filter((t) => t.categoryId === categoryId)
  const byId = new Map(data.transactions.map((t) => [t.id, t]))
  const names = new Map(data.categories.map((c) => [c.id, c.name]))
  const seen = new Set<number>()
  const recent = data.categoryLog.filter((e) => e.categoryId === categoryId && byId.has(e.transactionId) && !seen.has(e.transactionId) && seen.add(e.transactionId))
    .slice(0, limits.recent ?? 25)
    .map((e) => ({ ...rowFacts(byId.get(e.transactionId)!), how: e.how, at: e.at, was: e.previousCategoryId != null ? names.get(e.previousCategoryId) ?? "?" : "Uncategorised" }))
  return {
    category: { name: category.name, ...(parent ? { group: parent } : {}), rows: inside.length },
    shared: sharedFacts(inside),
    recent_choices: recent,
    descriptions: descriptionGroups(inside, data.transactions, limits.descriptions ?? 30),
    lookalikes: lookalikes(inside, data.transactions),
    rules: ruleList(data, (r) => r.setCategoryId === categoryId),
  }
}

/** A tag's history, as categoryHistory: rows tagged, recent changes, descriptions, lookalikes, rules adding it. */
export function tagHistory(data: HistoryData, tagId: number, limits: { recent?: number; descriptions?: number } = {}) {
  const tag = data.tags.find((t) => t.id === tagId)
  if (!tag) throw new Error(`no tag ${tagId}`)
  const inside = data.transactions.filter((t) => t.tagIds.includes(tagId))
  const byId = new Map(data.transactions.map((t) => [t.id, t]))
  const recent = data.tagLog.filter((e) => e.tagId === tagId && byId.has(e.transactionId)).slice(0, limits.recent ?? 25)
    .map((e) => ({ ...rowFacts(byId.get(e.transactionId)!), change: e.added ? "added" : "removed", how: e.how, at: e.at }))
  return {
    tag: { name: tag.name, ...(tag.scope ? { scope: tag.scope } : {}), rows: inside.length },
    shared: sharedFacts(inside),
    recent_changes: recent,
    descriptions: descriptionGroups(inside, data.transactions, limits.descriptions ?? 30).map((g) => ({ ...g, waiting: g.rows - g.inside })),
    lookalikes: lookalikes(inside, data.transactions),
    rules: ruleList(data, (r) => r.addTagIds.includes(tagId)),
  }
}

/** Rows waiting for a category, by exact description (most first). */
export function waitingOverview(data: HistoryData, limit = 40) {
  const waiting = data.transactions.filter((t) => isUncategorised(t) && !t.excluded)
  const groups = groupByDescription(waiting)
  return {
    rows: waiting.length,
    descriptions: [...groups.values()].sort((a, b) => b.length - a.length).slice(0, limit).map((rows) => ({
      description: rows[0]!.description.trim(),
      rows: rows.length,
      latest: rowFacts(rows.reduce((a, t) => (t.dateISO > a.dateISO ? t : a))),
      amounts: [...new Set(rows.map((t) => t.amount))].slice(0, 6),
    })),
  }
}

/** The rows a filter expression finds, or why it can't be a rule. */
export function findRows(data: HistoryData, expr: string): { rows: Transaction[] } | { error: string } {
  const { node, error } = parseFilterStrict(expr)
  if (!node || error) return { error: error ?? "empty expression" }
  if (askTerms(node).length) return { error: "ask: can't be used in a rule" }
  const names = filterRowNames(data.categories, data.tags)
  return { rows: data.transactions.filter((t) => evalFilter(node, names.row(t, t.categoryId, t.tagIds))) }
}

export type MatchTarget = { categoryId: number } | { tagId: number }

/**
 * How a filter expression does against the history, for a target category
 * or tag: rows it finds, how many are already in the target and how many
 * elsewhere (its precision), how many wait, how many of your recent choices
 * it covers (its recall), whether rules already do it, and samples, mistakes
 * first.
 */
export function matchReport(data: HistoryData, expr: string, target: MatchTarget, sample = 8) {
  const result = findRows(data, expr)
  if ("error" in result) return { expr, valid: false as const, error: result.error }
  const found = result.rows
  const byCategory = common(found, (t) => t.categoryName, 12).map(({ key, rows }) => ({ category: key, rows }))
  const isIn = "categoryId" in target ? (t: Transaction) => t.categoryId === target.categoryId : (t: Transaction) => t.tagIds.includes(target.tagId)
  const inTarget = found.filter(isIn)
  const elsewhere = found.filter((t) => !isIn(t) && ("tagId" in target || !isUncategorised(t)))
  const waiting = "categoryId" in target ? found.filter((t) => !isIn(t) && isUncategorised(t)) : elsewhere
  const chosen = "categoryId" in target
    ? new Set(data.categoryLog.filter((e) => e.categoryId === target.categoryId && e.how !== "rule").map((e) => e.transactionId))
    : new Set(data.tagLog.filter((e) => e.tagId === target.tagId && e.added && (e.how === "picker" || e.how === "review")).map((e) => e.transactionId))
  const foundIds = new Set(found.map((t) => t.id))
  const decided = inTarget.length + elsewhere.length
  return {
    expr,
    valid: true as const,
    rows: found.length,
    in_target: inTarget.length,
    elsewhere: elsewhere.length,
    waiting: waiting.length,
    precision: decided ? ("tagId" in target ? inTarget.length / decided : round(inTarget.length / decided)) : null,
    covers_your_choices: { of: chosen.size, covered: [...chosen].filter((id) => foundIds.has(id)).length },
    // Rows in the target that Up (or sync, from Up's type) categorised: a rule adds nothing for them.
    set_by_up: "categoryId" in target ? inTarget.filter((t) => ["provider", "type"].includes(data.categorySources?.get(t.id) ?? "")).length : 0,
    already_by_rules: found.length > 0 && ("categoryId" in target ? alreadyByRules(data, found, target.categoryId) : alreadyTaggedByRules(data, found, target.tagId)),
    by_category: byCategory,
    sample: [...elsewhere, ...("categoryId" in target ? waiting : []), ...inTarget].slice(0, sample).map((t) => ({ ...rowFacts(t), verdict: isIn(t) ? "in target" : isUncategorised(t) && "categoryId" in target ? "waiting" : "elsewhere" })),
  }
}

/** Every row found would get the category from existing rules anyway. */
function alreadyByRules(data: HistoryData, found: Transaction[], categoryId: number): boolean {
  const fresh = found.map((t) => ({ ...t, categoryId: null, tagIds: [] }))
  const set = new Map(dryRunRules(fresh, data.rules, data.savedFilters, data.categories, data.tags).changes.filter((c) => c.categorySet).map((c) => [c.id, c.categoryId]))
  return fresh.every((t) => set.get(t.id) === categoryId)
}

/** Remove only the target tag: existing rules must add it to every row. */
function alreadyTaggedByRules(data: HistoryData, found: Transaction[], tagId: number): boolean {
  const fresh = found.map((t) => ({ ...t, tagIds: t.tagIds.filter((id) => id !== tagId) }))
  const tagged = new Set(dryRunRules(fresh, data.rules, data.savedFilters, data.categories, data.tags).changes.filter((c) => c.tagIds.includes(tagId)).map((c) => c.id))
  return fresh.every((t) => tagged.has(t.id))
}
