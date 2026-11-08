import type { FilterNode, FilterTxn } from "./filter"
import { dayTime, parseDay } from "./days"
import { dateTokenBounds } from "./filterParse"
import { eqFold, filterExprString, textContains } from "./filterText"
import { isIncome, isSpending } from "./moneyRules"

/** Jev's verdict on whether a row matches an `ask:` term's words; undefined
 * while it hasn't judged the row. */
export type AskVerdict<T> = (words: string, t: T) => boolean | undefined

/**
 * Whether a row passes the filter. `ask:` terms take Jev's verdicts from
 * `ask`; a row whose result hangs on a term not judged yet does not pass
 * (with no `ask` at all, as in rules, that is every such row).
 */
export function evalFilter<T extends FilterTxn>(
  node: FilterNode | null,
  t: T,
  ask?: AskVerdict<T>,
): boolean {
  return verdict3(node, t, ask ?? unjudged) === true
}

const unjudged = () => undefined

/** Whether the row's match waits on an unjudged `ask:` term (neither
 * matched nor ruled out without it). */
export function undecided<T extends FilterTxn>(node: FilterNode | null, t: T, ask: AskVerdict<T>): boolean {
  return verdict3(node, t, ask) === undefined
}

/** Three-valued evaluation: an unjudged `ask:` term is unknown (undefined),
 * and AND / OR / NOT carry the unknown through. */
function verdict3<T extends FilterTxn>(node: FilterNode | null, t: T, ask: AskVerdict<T>): boolean | undefined {
  if (!node) return true
  const children = node.children ?? []
  switch (node.kind) {
    case "text": {
      const needle = node.value ?? ""
      if (!needle.trim()) return true
      if (textContains(t.description, needle)) return true
      if (node.op === "contains_meta") {
        if (textContains(t.categoryName, needle)) return true
        if (t.tagNames.some((tg) => textContains(tg, needle))) return true
        // Approved addition (2026-10-30): what it bought, its message and
        // your notes too. The raw text stays under info: (city names).
        if (t.bought?.some((item) => textContains(item.name, needle))) return true
        if (t.message && textContains(t.message, needle)) return true
        if (t.notes && textContains(t.notes, needle)) return true
      }
      return false
    }
    case "field":
      return node.field === "ask" ? ask(node.value ?? "", t) : evalField(node, t)
    case "and": {
      let unknown = false
      for (const c of children) { const v = verdict3(c, t, ask); if (v === false) return false; if (v === undefined) unknown = true }
      return unknown ? undefined : true
    }
    case "or": {
      let unknown = false
      for (const c of children) { const v = verdict3(c, t, ask); if (v === true) return true; if (v === undefined) unknown = true }
      return unknown ? undefined : false
    }
    case "not": {
      if (!children.length) return true
      const v = verdict3(children[0]!, t, ask)
      return v === undefined ? undefined : !v
    }
    default:
      return true
  }
}

function isAsk(node: FilterNode): boolean {
  return node.kind === "field" && node.field === "ask"
}

/** The distinct words of every `ask:` term, in order. */
export function askTerms(node: FilterNode | null): string[] {
  if (!node) return []
  if (isAsk(node)) return [node.value ?? ""].filter(Boolean)
  return [...new Set((node.children ?? []).flatMap(askTerms))]
}

/** Whether the filter limits dates anywhere. */
export function hasDateTerm(node: FilterNode | null): boolean {
  if (!node) return false
  if (node.kind === "field" && node.field === "date") return true
  return (node.children ?? []).some(hasDateTerm)
}

function evalField(node: FilterNode, t: FilterTxn): boolean {
  const field = (node.field ?? "").toLowerCase()
  switch (field) {
    case "desc":
      return textContains(t.description, node.value ?? "")
    case "note":
      return textContains(t.notes, node.value ?? "")
    // Approved addition to legacy Go filter.go (2026-10-30): info:.
    case "info":
      return (t.bought?.some((item) => textContains(item.name, node.value ?? "")) ?? false)
        || (t.message != null && textContains(t.message, node.value ?? ""))
        || (t.rawText != null && textContains(t.rawText, node.value ?? ""))
    case "cat":
      return eqFold(t.categoryName, node.value ?? "") || (!!t.categoryGroup && eqFold(t.categoryGroup, node.value ?? ""))
    case "acc":
      return eqFold(t.accountName, node.value ?? "")
    case "tag":
      return t.tagNames.some((tg) => eqFold(tg, node.value ?? ""))
    case "type": {
      const want = (node.value ?? "").toLowerCase()
      if (want === "debit") return t.amount < 0
      if (want === "credit") return t.amount > 0
      if (want === "spending") return isSpending(t)
      if (want === "income") return isIncome(t)
      return false
    }
    case "amt":
      return evalAmount(node, t.amount)
    case "date":
      return evalDate(node, t.dateISO)
    // Each row passes; applyTop cuts the result.
    case "top":
      return true
    default:
      return false
  }
}

function evalAmount(node: FilterNode, amt: number): boolean {
  if (node.op === "..") {
    const lo = Number(node.valueLo)
    const hi = Number(node.valueHi)
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return false
    return amt >= lo && amt <= hi
  }
  const v = Number(node.value)
  if (!Number.isFinite(v)) return false
  switch (node.op) {
    case "=":
      return amt === v
    case ">":
      return amt > v
    case "<":
      return amt < v
    case ">=":
      return amt >= v
    case "<=":
      return amt <= v
    default:
      return false
  }
}

function evalDate(node: FilterNode, dateISO: string): boolean {
  if (!parseDay(dateISO)) return false
  const txn = dayTime(dateISO)
  if (node.op === "=") {
    const [lo, hi] = dateTokenBounds(node.value ?? "")
    return txn >= lo && txn <= hi
  }
  if (node.op === "..") {
    const [lo] = dateTokenBounds(node.valueLo ?? "")
    const [, hi] = dateTokenBounds(node.valueHi ?? "")
    return txn >= lo && txn <= hi
  }
  return false
}

/** The filter's `top:` count, if it has one. */
export function topCount(node: FilterNode | null): number | null {
  if (!node) return null
  const level = node.kind === "and" ? (node.children ?? []) : [node]
  const top = level.find((n) => n.kind === "field" && n.field === "top")
  return top ? Number(top.value) : null
}

/** `rows` (already filtered) cut to the filter's `top:` count: the biggest
 * by amount either way (money out or in), ties the newest. Without top:,
 * `rows` as they are. */
export function applyTop<T extends { amount: number; dateISO: string; id: number }>(node: FilterNode | null, rows: T[]): T[] {
  const n = topCount(node)
  if (n == null) return rows
  const keep = new Set([...rows].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount) || b.dateISO.localeCompare(a.dateISO) || b.id - a.id).slice(0, n))
  return rows.filter((t) => keep.has(t))
}

/** For a filter of plain words that finds nothing because no row has them
 * all ("mcdonalds kfc"), though each finds some: the same words joined by
 * OR. Else null. */
export function eitherInstead<T extends FilterTxn>(node: FilterNode | null, rows: T[]): string | null {
  if (node?.kind !== "and") return null
  const words = node.children ?? []
  const plain = (n: FilterNode) => n.kind === "text" || (n.kind === "field" && n.field === "desc")
  if (words.length < 2 || !words.every(plain)) return null
  if (!words.every((w) => rows.some((t) => evalFilter(w, t)))) return null
  return filterExprString({ kind: "or", children: words })
}

/** Why a filter can't drive a rule (which decides each row on its own), or
 * null: ask: needs Jev, top: needs the whole set. */
export function notForRules(node: FilterNode | null): string | null {
  if (askTerms(node).length) return "ask: can't be used in a rule"
  if (topCount(node) != null) return "top: can't be used in a rule"
  return null
}
