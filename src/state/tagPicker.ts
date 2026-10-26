import { fuzzyFilter } from "../domain/fuzzy"
import type { Tag, Transaction } from "../domain/types"
import { theme } from "../theme"
import type { PickerItem } from "./settingsForm"

/**
 * The tag picker's rows, shared by its rendering and its keys: tags scoped to
 * a category of the target transactions, then global tags, then tags scoped
 * to other categories (dimmed), each section fuzzy-filtered by `query`; then
 * a create row when the query names no existing tag.
 */
export function tagPickerItems(tags: Tag[], transactions: Transaction[], targets: number[], query: string): PickerItem[] {
  const categories = new Set(transactions.filter((t) => targets.includes(t.id)).map((t) => t.categoryId))
  const section = (t: Tag) => t.categoryId == null ? "Global" : categories.has(t.categoryId) ? "Scoped" : "Other categories"
  const rows: PickerItem[] = []
  for (const label of ["Scoped", "Global", "Other categories"]) {
    const matches = fuzzyFilter(tags.filter((t) => section(t) === label), query.trim(), (t) => t.name)
    if (!matches.length) continue
    rows.push({ kind: "heading", label })
    rows.push(...matches.map((t): PickerItem => ({
      kind: "item", label: t.name, value: t.id,
      color: label === "Other categories" ? theme.overlay1 : t.color,
    })))
  }
  const name = query.trim()
  if (name && !tags.some((t) => t.name.toLowerCase() === name.toLowerCase())) {
    rows.push({ kind: "item", label: `Create "${name}"`, value: null, color: theme.teal })
  }
  return rows
}

/** Whether all, some or none of the targets carry the tag. */
export function tagPickerState(transactions: Transaction[], targets: number[], tagId: number): "all" | "some" | "none" {
  const hits = targets.filter((id) => transactions.find((t) => t.id === id)?.tagIds.includes(tagId)).length
  return hits === 0 ? "none" : hits === targets.length ? "all" : "some"
}
