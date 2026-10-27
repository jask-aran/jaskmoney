import { fuzzyFilter } from "../domain/fuzzy"
import type { TagGroup } from "../domain/tagGroups"
import { groupForTag } from "../domain/tagSuggest"
import type { Tag, Transaction } from "../domain/types"
import { theme } from "../theme"
import type { PickerItem } from "./settingsForm"

/** What finding transactions can start from: an existing tag (and the
 * detected group it stands for), a detected group no tag covers yet, or a
 * name just typed. */
export type TagChoice =
  | { kind: "tag"; tag: Tag; group?: TagGroup }
  | { kind: "group"; group: TagGroup }
  | { kind: "new"; name: string }

/** The chooser's choices in order (its cursor indexes these), filtered by
 * `query`: your tags, then groups found in the history, then a new name.
 * IGNORE isn't offered: it says what to leave out, not what things are. */
export function tagChoices(tags: Tag[], groups: TagGroup[], query: string): TagChoice[] {
  const q = query.trim()
  const own = tags.filter((t) => t.name.toUpperCase() !== "IGNORE")
  const matched = new Set<TagGroup>()
  const tagRows = own.map((tag): TagChoice => {
    const group = groupForTag(tag.name, groups)
    if (group) matched.add(group)
    return { kind: "tag", tag, ...(group ? { group } : {}) }
  })
  const found = groups.filter((g) => !matched.has(g) && !tags.some((t) => t.name.toLowerCase() === g.name.toLowerCase()))
    .map((group): TagChoice => ({ kind: "group", group }))
  const name = (c: TagChoice) => (c.kind === "tag" ? c.tag.name : c.kind === "group" ? c.group.name : c.name)
  const fresh = q && !tags.some((t) => t.name.toLowerCase() === q.toLowerCase()) ? [{ kind: "new", name: q } as TagChoice] : []
  return [...fuzzyFilter(tagRows, q, name), ...fuzzyFilter(found, q, name), ...fresh]
}

/** The chooser's rows: a heading per section, each choice with what it
 * holds (how many tagged, its scope, a trip found for it). */
export function tagChooserItems(choices: TagChoice[], transactions: Transaction[]): PickerItem[] {
  const rows: PickerItem[] = []
  let section = ""
  choices.forEach((c, index) => {
    const label = c.kind === "tag" ? "Your tags" : c.kind === "group" ? "Found in your history" : "New tag"
    if (label !== section) { rows.push({ kind: "heading", label }); section = label }
    if (c.kind === "tag") {
      const tagged = transactions.filter((t) => t.tagIds.includes(c.tag.id)).length
      const found = c.group ? (c.group.kind === "trip" ? `trip found: ${c.group.detail.split(" · ").at(-1)}` : `${c.group.rows.length} regular payments`) : ""
      rows.push({ kind: "item", label: c.tag.name, value: index, color: c.tag.color, detail: [`${tagged} tagged`, c.tag.scope ?? "", found].filter(Boolean).join(" · ") })
    } else if (c.kind === "group") {
      rows.push({ kind: "item", label: c.group.name, value: index, color: theme.teal, detail: c.group.detail })
    } else {
      rows.push({ kind: "item", label: `"${c.name}"`, value: index, color: theme.teal, detail: "Jev looks for it" })
    }
  })
  return rows
}
