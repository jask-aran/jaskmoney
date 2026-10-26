import { fuzzyFilter } from "../domain/fuzzy"
import type { SavedFilter } from "../domain/types"
import type { PickerItem } from "./settingsForm"

/**
 * Saved filters in the order the picker offers them: typed text ranks by
 * fuzzy match (over name and expression); otherwise most recently used
 * first (Go app), then the never-used ones by name.
 */
export function savedFilterOptions(filters: SavedFilter[], usage: Record<string, string> = {}, query = ""): SavedFilter[] {
  if (query.trim()) return fuzzyFilter([...filters], query, (filter) => `${filter.name} ${filter.expr}`)
  const used = (filter: SavedFilter) => Date.parse(usage[filter.id] ?? "") || 0
  return [...filters].sort((a, b) => used(b) - used(a) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
}

/** The picker's rows: each filter's name, its expression as the detail. */
export function savedFilterItems(filters: SavedFilter[]): PickerItem[] {
  return filters.map((filter) => ({ kind: "item", label: filter.name, value: filter.id, detail: filter.expr }))
}
