import type { Category } from "../domain/types"

type Origin = "jaskmoney" | "up"

export interface CategoryRow {
  category: Category
  origin: Origin
  depth: 0 | 1
  children: number
  open: boolean
}

export const originOf = (category: Category): Origin => (category.extId != null ? "up" : "jaskmoney")

export function categoryRows(categories: Category[], open: readonly number[]): CategoryRow[] {
  const byParent = new Map<number, Category[]>()
  for (const c of categories) if (c.parentId != null) byParent.set(c.parentId, [...(byParent.get(c.parentId) ?? []), c])
  const ids = new Set(categories.map((c) => c.id))
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

export function originCounts(categories: Category[]): Record<Origin, number> {
  const byId = new Map(categories.map((c) => [c.id, c]))
  const counts: Record<Origin, number> = { jaskmoney: 0, up: 0 }
  for (const c of categories) {
    const top = c.parentId != null ? byId.get(c.parentId) ?? c : c
    counts[originOf(top)]++
  }
  return counts
}
