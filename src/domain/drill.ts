import { anyOf, filterTerm } from "./filter"
import type { Category } from "./types"

export function drillFilter(opts: {
  start: string
  end: string
  accounts: string[]
  category?: { id: number | null; name: string }
  categories?: Category[]
}): string {
  const terms = [`date:${opts.start}..${opts.end}`, "type:spending"]
  if (opts.accounts.length) terms.push(anyOf(opts.accounts.map((name) => filterTerm("acc", name))))
  if (opts.category) terms.push(categoryTerm(opts.category, opts.categories ?? []))
  return terms.join(" AND ")
}

export function categoryTerm(category: { id: number | null; name: string }, categories: Category[]): string {
  const children = category.id == null ? [] : categories.filter((c) => c.parentId === category.id).map((c) => c.name)
  return anyOf([category.name, ...children].map((name) => filterTerm("cat", name)))
}
