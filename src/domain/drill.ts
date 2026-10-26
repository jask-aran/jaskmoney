import { anyOf, filterTerm } from "./filter"
import type { Category } from "./types"

/**
 * The Transactions filter for a drill-down from the Overview: spending in
 * the date range, on the spending accounts in scope, and, for a category
 * line, in that category (a group covers itself and its subcategories).
 * Approved deviation from Go (which drilled to every debit): `type:spending`
 * leaves out excluded and IGNORE rows, so the drill lists exactly the rows
 * its total counted.
 */
export function drillFilter(opts: {
  start: string
  end: string
  accounts: string[]
  category?: { id: number | null; name: string }
  categories?: Category[]
}): string {
  const terms = [`date:${opts.start}..${opts.end}`, "type:spending"]
  if (opts.accounts.length) terms.push(anyOf(opts.accounts.map((name) => filterTerm("acc", name))))
  if (opts.category) {
    const children = opts.category.id == null ? [] : (opts.categories ?? []).filter((c) => c.parentId === opts.category!.id).map((c) => c.name)
    terms.push(anyOf([opts.category.name, ...children].map((name) => filterTerm("cat", name))))
  }
  return terms.join(" AND ")
}
