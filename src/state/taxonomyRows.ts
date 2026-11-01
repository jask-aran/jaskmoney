import type { Category } from "../domain/types"

/**
 * Settings › Taxonomy's category rows, in the order they're drawn and the
 * cursor moves: Jaskmoney's own categories (no provider id: Income,
 * Transfers, Uncategorised, People, any you add), then Up's. A group (a
 * category with others under it) is one row, closed until opened; open,
 * its subcategories follow it. Each subcategory sits under its group
 * whatever its sort order (Salary under Income, not after Transport).
 */
export type Origin = "jaskmoney" | "up"

export interface CategoryRow {
  category: Category
  origin: Origin
  /** 0: top level; 1: under its group. */
  depth: 0 | 1
  /** Subcategories under it (a group); 0 for the rest. */
  children: number
  open: boolean
}

/** A top-level category's block: Up's when Up gave it, else Jaskmoney's. */
export const originOf = (category: Category): Origin => (category.extId != null ? "up" : "jaskmoney")

export function categoryRows(categories: Category[], open: readonly number[]): CategoryRow[] {
  const byParent = new Map<number, Category[]>()
  for (const c of categories) if (c.parentId != null) byParent.set(c.parentId, [...(byParent.get(c.parentId) ?? []), c])
  const ids = new Set(categories.map((c) => c.id))
  // A category whose group is gone is drawn at the top level.
  const tops = categories.filter((c) => c.parentId == null || !ids.has(c.parentId))
  const rows: CategoryRow[] = []
  for (const origin of ["jaskmoney", "up"] as const) {
    for (const top of tops.filter((c) => originOf(c) === origin)) {
      const children = byParent.get(top.id) ?? []
      const isOpen = children.length > 0 && open.includes(top.id)
      rows.push({ category: top, origin, depth: 0, children: children.length, open: isOpen })
      if (isOpen) for (const child of children) rows.push({ category: child, origin, depth: 1, children: 0, open: false })
    }
  }
  return rows
}

/** How many categories each block holds, subcategories included. */
export function originCounts(categories: Category[]): Record<Origin, number> {
  const byId = new Map(categories.map((c) => [c.id, c]))
  const counts: Record<Origin, number> = { jaskmoney: 0, up: 0 }
  for (const c of categories) {
    const top = c.parentId != null ? byId.get(c.parentId) ?? c : c
    counts[originOf(top)]++
  }
  return counts
}
