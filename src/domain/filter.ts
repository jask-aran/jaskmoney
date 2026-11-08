/**
 * Port of Go filter.go — lexer + recursive-descent parser + eval.
 * Permissive parse for live `/` input; strict for committed/save surfaces.
 */

import { canonicalFilter, parseFilter, type FilterNode } from "./filterParse"

export type { FilterNode } from "./filterParse"

export { canonicalFilter, parseFilter, parseFilterStrict } from "./filterParse"
export { evalFilter, undecided, askTerms, hasDateTerm, topCount, applyTop, eitherInstead, notForRules } from "./filterEval"
export type { AskVerdict } from "./filterEval"
export { textContains, filterTerm, anyOf, filterExprString } from "./filterText"

export interface FilterTxn {
  description: string
  categoryId: number | null
  categoryName: string
  categoryGroup?: string
  accountName: string
  notes: string
  bought?: readonly { name: string }[]
  message?: string | null
  rawText?: string | null
  amount: number
  dateISO: string
  excluded?: boolean
  income?: boolean
  tagNames: string[]
}

export interface FilterNames {
  cat: readonly string[]
  tag: readonly string[]
  acc: readonly string[]
}

function fallbackPlainTextFilter(input: string): FilterNode | null {
  const text = input.trim()
  if (!text) return null
  return { kind: "text", op: "contains_meta", value: text }
}

function markTextNodesAsMetadata(node: FilterNode | null): FilterNode | null {
  if (!node) return null
  if (node.kind === "text" && node.op === "contains") {
    return { ...node, op: "contains_meta" }
  }
  if (node.children) {
    return {
      ...node,
      children: node.children.map((c) => markTextNodesAsMetadata(c)!).filter(Boolean),
    }
  }
  return node
}

function filterContainsFieldPredicate(node: FilterNode | null): boolean {
  if (!node) return false
  if (node.kind === "field") return true
  return (node.children ?? []).some(filterContainsFieldPredicate)
}

export interface FilterNote { text: string; tone: "error" | "warn" | "muted" }

/**
 * What the search bar says beside its dot: why the input doesn't parse
 * (searched as one phrase), else what saving it would refuse (with the
 * live reading of an ambiguous name: "finding either"), else, when
 * something was forgiven or guessed, the full form it reads as.
 */
export function filterNote(input: string, err: string, hints: string[], names?: FilterNames): FilterNote | null {
  if (!input.trim()) return null
  if (err) return { text: `${err}: searching it as one phrase`, tone: "error" }
  const full = canonicalFilter(input, names)
  if (full.error) {
    const live = hints.find((hint) => full.error!.startsWith(hint.replace(/: finding either$/, "")))
    return { text: live ?? full.error, tone: "warn" }
  }
  return hints.length && full.text ? { text: `→ ${full.text}`, tone: "muted" } : null
}

/** A filter as it's typed: what it means, what's wrong with it and the
 * note the bar shows. The store's (setFilterLive) and the setup tour's. */
export function liveFilter(input: string, names: FilterNames): { expr: FilterNode | null; err: string; note: FilterNote | null } {
  const { expr, err, hints } = reparseFilterInput(input, names)
  return { expr, err, note: filterNote(input, err, hints, names) }
}

/** Live reparse: permissive + metadata bare words + fallback. */
export function reparseFilterInput(input: string, names?: FilterNames): {
  expr: FilterNode | null
  err: string
  hints: string[]
} {
  const { node, error, hints } = parseFilter(input, names)
  if (error) {
    return { expr: fallbackPlainTextFilter(input), err: error, hints }
  }
  if (!filterContainsFieldPredicate(node)) {
    return { expr: markTextNodesAsMetadata(node), err: "", hints }
  }
  return { expr: node, err: "", hints }
}
