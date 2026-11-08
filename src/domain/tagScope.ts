import type { Category, Tag } from "./types"

/**
 * A tag's scope: the categories it fits, a group covering those under it.
 * A tag without categories fits anywhere.
 */
function scopeCategoryIds(tag: Pick<Tag, "categoryIds">, categories: Category[]): Set<number> {
  const ids = new Set(tag.categoryIds)
  for (const c of categories) if (c.parentId != null && ids.has(c.parentId)) ids.add(c.id)
  return ids
}

/** Whether `t` is in `tag`'s scope (always, for a tag without categories). */
export function tagCovers(tag: Pick<Tag, "categoryIds">, categories: Category[]): (t: { categoryId: number | null }) => boolean {
  if (!tag.categoryIds.length) return () => true
  const ids = scopeCategoryIds(tag, categories)
  return (t) => t.categoryId != null && ids.has(t.categoryId)
}

/** The scope in words: "Holidays & Travel", "Restaurants & Cafes, Takeaway",
 * "" for anywhere. */
export function scopeText(tag: Pick<Tag, "categoryIds">, categories: Category[]): string {
  return tag.categoryIds.map((id) => categories.find((c) => c.id === id)?.name).filter(Boolean).join(", ")
}
