import { anyOf, filterTerm } from "./filter"
import type { Category } from "./types"

/**
 * The Transactions filter for a drill-down from the Overview: spending
 * (debits) in the date range, on the spending accounts in scope, and, for a
 * category line, in that category (a group covers itself and its
 * subcategories), as in the Go app's drill from a dashboard pane.
 */
export function drillFilter(opts: {
  start: string
  end: string
  accounts: string[]
  category?: { id: number | null; name: string }
  categories?: Category[]
}): string {
  const terms = [`date:${opts.start}..${opts.end}`, "type:debit"]
  if (opts.accounts.length) terms.push(anyOf(opts.accounts.map((name) => filterTerm("acc", name))))
  if (opts.category) {
    const children = opts.category.id == null ? [] : (opts.categories ?? []).filter((c) => c.parentId === opts.category!.id).map((c) => c.name)
    terms.push(anyOf([opts.category.name, ...children].map((name) => filterTerm("cat", name))))
  }
  return terms.join(" AND ")
}
