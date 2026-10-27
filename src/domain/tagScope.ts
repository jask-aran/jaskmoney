import { askTerms, evalFilter, parseFilterStrict, type FilterNode, type FilterTxn } from "./filter"
import type { Tag } from "./types"

/**
 * A tag's scope: a filter expression for the rows it can go on (a trip's
 * dates, a category), or empty for anywhere. Not ask: (a scope is checked
 * on every row, offline). Returns the parsed node, or an error to show.
 */
export function parseTagScope(expr: string | null): { node: FilterNode | null; error?: string } {
  if (!expr?.trim()) return { node: null }
  const { node, error } = parseFilterStrict(expr)
  if (error || !node) return { node: null, error: error ?? "empty expression" }
  if (askTerms(node).length) return { node: null, error: "ask: can't be used in a tag scope" }
  return { node }
}

/** Whether `t` is in `tag`'s scope (always, for a tag without one; never,
 * for one whose scope no longer parses). */
export function inTagScope(tag: Pick<Tag, "scope">, t: FilterTxn): boolean {
  if (!tag.scope?.trim()) return true
  const { node } = parseTagScope(tag.scope)
  return !!node && evalFilter(node, t)
}
