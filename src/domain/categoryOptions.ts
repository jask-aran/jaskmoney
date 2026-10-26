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
 */
export function categoryPickerRows(categories: Category[], query: string): PickerRow[] {
  const q = query.trim().toLowerCase()
  const groupIds = new Set(categories.map((c) => c.parentId).filter((id): id is number => id != null))
  const groups = categories.filter((c) => groupIds.has(c.id))
  const matches = (c: Category, group?: Category) =>
    !q || c.name.toLowerCase().includes(q) || (group?.name.toLowerCase().includes(q) ?? false)
  const rows: PickerRow[] = []
  let index = 0
  for (const group of groups) {
    const children = categories.filter((c) => c.parentId === group.id && matches(c, group))
    if (!children.length) continue
    rows.push({ kind: "heading", label: group.name })
    for (const category of children) rows.push({ kind: "category", category, index: index++ })
  }
  const others = categories
    .filter((c) => c.parentId == null && !groupIds.has(c.id) && matches(c))
    .sort((a, b) => Number(a.isDefault) - Number(b.isDefault))
  if (others.length) {
    if (groups.length) rows.push({ kind: "heading", label: "Other" })
    for (const category of others) rows.push({ kind: "category", category, index: index++ })
  }
  return rows
}

export function assignableCategories(categories: Category[], query: string): Category[] {
  return categoryPickerRows(categories, query).flatMap((r) => (r.kind === "category" ? [r.category] : []))
}
