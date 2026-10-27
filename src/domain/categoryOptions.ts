import { fuzzyScore } from "./fuzzy"
import type { Category } from "./types"

export type PickerRow =
  | { kind: "heading"; label: string }
  | { kind: "category"; category: Category; index: number }

/**
 * Category picker rows: each group (a category with children, e.g. Up's
 * "Good Life") as a heading followed by its children, then the local
 * top-level categories under "Other", with the default (Uncategorised) last.
 * Groups themselves are not assignable: Up only accepts subcategories.
 * `index` numbers the assignable rows in display order (the picker cursor).
 * A query matches a category's name or its group's name, case-insensitively.
 * `suggested` categories (ids), when there is no query, come first under
 * "Suggested" (they also stay in their groups).
 */
export function categoryPickerRows(categories: Category[], query: string, sortMatches = true, suggested: number[] = []): PickerRow[] {
  const q = query.trim().toLowerCase()
  const groupIds = new Set(categories.map((c) => c.parentId).filter((id): id is number => id != null))
  const groups = categories.filter((c) => groupIds.has(c.id))
  const score = (c: Category, group?: Category) =>
    Math.max(fuzzyScore(q, c.name) ?? -Infinity, group ? fuzzyScore(q, group.name) ?? -Infinity : -Infinity)
  const matches = (c: Category, group?: Category) => score(c, group) > -Infinity
  const rows: PickerRow[] = []
  let index = 0
  const picks = q ? [] : suggested.flatMap((id) => categories.filter((c) => c.id === id && !groupIds.has(c.id)))
  if (picks.length) {
    rows.push({ kind: "heading", label: "Suggested" })
    for (const category of picks) rows.push({ kind: "category", category, index: index++ })
  }
  for (const group of groups) {
    const children = categories.filter((c) => c.parentId === group.id && matches(c, group))
    if (q && sortMatches) children.sort((a, b) => score(b, group) - score(a, group))
    if (!children.length) continue
    rows.push({ kind: "heading", label: group.name })
    for (const category of children) rows.push({ kind: "category", category, index: index++ })
  }
  const others = categories
    .filter((c) => c.parentId == null && !groupIds.has(c.id) && matches(c))
    .sort((a, b) => Number(a.isDefault) - Number(b.isDefault))
  if (q && sortMatches) others.sort((a, b) => score(b) - score(a))
  if (others.length) {
    if (groups.length) rows.push({ kind: "heading", label: "Other" })
    for (const category of others) rows.push({ kind: "category", category, index: index++ })
  }
  return rows
}

export function assignableCategories(categories: Category[], query: string, suggested: number[] = []): Category[] {
  return categoryPickerRows(categories, query, true, suggested).flatMap((r) => (r.kind === "category" ? [r.category] : []))
}

/** The categories suggested for `ids`, most often suggested first. */
export function suggestedCategoryIds(ids: number[], suggestions: Record<number, { categoryId: number }>): number[] {
  const counts = new Map<number, number>()
  for (const id of ids) {
    const s = suggestions[id]
    if (s) counts.set(s.categoryId, (counts.get(s.categoryId) ?? 0) + 1)
  }
  return [...counts].sort((a, b) => b[1] - a[1]).map(([id]) => id)
}
