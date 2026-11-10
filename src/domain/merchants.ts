import type { Transaction } from "./types"
import { filterTerm } from "./filter"

export interface MerchantGroup {
  merchant: string
  count: number
  total: number
  average: number
  lastISO: string
  categoryId: number | null
  categoryName: string
  categoryColor: string
  ids: number[]
}

export type MerchantSort = "total" | "count" | "merchant" | "last"
export const MERCHANT_SORTS: MerchantSort[] = ["total", "count", "merchant", "last"]

export function groupByMerchant(rows: Transaction[]): MerchantGroup[] {
  const groups = new Map<string, { group: MerchantGroup; categories: Map<string, { id: number | null; color: string; count: number; total: number }> }>()
  for (const row of rows) {
    let entry = groups.get(row.description)
    if (!entry) {
      entry = {
        group: { merchant: row.description, count: 0, total: 0, average: 0, lastISO: row.dateISO, categoryId: null, categoryName: "", categoryColor: "", ids: [] },
        categories: new Map(),
      }
      groups.set(row.description, entry)
    }
    const g = entry.group
    g.count++
    g.total += row.amount
    g.ids.push(row.id)
    if (row.dateISO > g.lastISO) g.lastISO = row.dateISO
    const c = entry.categories.get(row.categoryName) ?? { id: row.categoryId, color: row.categoryColor, count: 0, total: 0 }
    c.count++
    c.total += Math.abs(row.amount)
    entry.categories.set(row.categoryName, c)
  }
  return [...groups.values()].map(({ group, categories }) => {
    group.total = Math.round(group.total * 100) / 100
    group.average = group.total / group.count
    const [name, top] = [...categories].sort(([a, x], [b, y]) => y.count - x.count || y.total - x.total || a.localeCompare(b))[0]!
    group.categoryName = name
    group.categoryId = top.id
    group.categoryColor = top.color
    return group
  })
}

export function sortMerchantGroups(groups: MerchantGroup[], sort: MerchantSort, reverse = false): MerchantGroup[] {
  const by: Record<MerchantSort, (a: MerchantGroup, b: MerchantGroup) => number> = {
    total: (a, b) => a.total - b.total,
    count: (a, b) => b.count - a.count,
    merchant: (a, b) => a.merchant.localeCompare(b.merchant),
    last: (a, b) => b.lastISO.localeCompare(a.lastISO),
  }
  const sorted = [...groups].sort((a, b) => by[sort](a, b) || a.merchant.localeCompare(b.merchant))
  return reverse ? sorted.reverse() : sorted
}

export function merchantFilter(current: string, merchant: string): string {
  const term = filterTerm("desc", merchant)
  return current.trim() ? `(${current.trim()}) AND ${term}` : term
}
