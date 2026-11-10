import type { Category, Tag } from "./types"

function scopeCategoryIds(tag: Pick<Tag, "categoryIds">, categories: Category[]): Set<number> {
  const ids = new Set(tag.categoryIds)
  for (const c of categories) if (c.parentId != null && ids.has(c.parentId)) ids.add(c.id)
  return ids
}

export function tagCovers(tag: Pick<Tag, "categoryIds">, categories: Category[]): (t: { categoryId: number | null }) => boolean {
  if (!tag.categoryIds.length) return () => true
  const ids = scopeCategoryIds(tag, categories)
  return (t) => t.categoryId != null && ids.has(t.categoryId)
}

export function scopeText(tag: Pick<Tag, "categoryIds">, categories: Category[]): string {
  return tag.categoryIds.map((id) => categories.find((c) => c.id === id)?.name).filter(Boolean).join(", ")
}
