import { fuzzyFilter } from "../domain/fuzzy"
import { inTagScope } from "../domain/tagScope"
import type { Tag, Transaction } from "../domain/types"
import { theme } from "../theme"
import type { PickerItem } from "./settingsForm"

/**
 * The tag picker's rows, shared by its rendering and its keys: tags whose
 * scope takes a target transaction, then tags without a scope, then tags
 * scoped elsewhere (dimmed), each section fuzzy-filtered by `query`; then a
 * create row when the query names no existing tag.
 */
export function tagPickerItems(tags: Tag[], transactions: Transaction[], targets: number[], query: string): PickerItem[] {
  const targetRows = transactions.filter((t) => targets.includes(t.id))
  const section = (t: Tag) => !t.scope?.trim() ? "Global" : targetRows.some((row) => inTagScope(t, row)) ? "Scoped" : "Out of scope"
  const rows: PickerItem[] = []
  for (const label of ["Scoped", "Global", "Out of scope"]) {
    const matches = fuzzyFilter(tags.filter((t) => section(t) === label), query.trim(), (t) => t.name)
    if (!matches.length) continue
    rows.push({ kind: "heading", label })
    rows.push(...matches.map((t): PickerItem => ({
      kind: "item", label: t.name, value: t.id,
      color: label === "Out of scope" ? theme.overlay1 : t.color,
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
