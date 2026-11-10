import { fuzzyFilter } from "../domain/fuzzy"
import type { TagGroup } from "../domain/tagGroups"
import { groupForTag } from "../domain/tagSuggest"
import { scopeText } from "../domain/tagScope"
import type { Category, Tag, Transaction } from "../domain/types"
import { tone } from "../theme"
import type { PickerItem } from "./settingsForm"

export type TagChoice =
  | { kind: "tag"; tag: Tag; group?: TagGroup }
  | { kind: "group"; group: TagGroup }
  | { kind: "new"; name: string }

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

export function tagChooserItems(choices: TagChoice[], transactions: Transaction[], categories: Category[]): PickerItem[] {
  const rows: PickerItem[] = []
  let section = ""
  choices.forEach((c, index) => {
    const label = c.kind === "tag" ? "Your tags" : c.kind === "group" ? "Found in your history" : "New tag"
    if (label !== section) { rows.push({ kind: "heading", label }); section = label }
    if (c.kind === "tag") {
      const tagged = transactions.filter((t) => t.tagIds.includes(c.tag.id)).length
      const found = c.group ? (c.group.kind === "trip" ? `trip found: ${c.group.detail.split(" · ").at(-1)}` : `${c.group.rows.length} regular payments`) : ""
      rows.push({ kind: "item", label: c.tag.name, value: index, color: c.tag.color, detail: [`${tagged} tagged`, scopeText(c.tag, categories), found].filter(Boolean).join(" · ") })
    } else if (c.kind === "group") {
      rows.push({ kind: "item", label: c.group.name, value: index, color: tone.ai, detail: c.group.detail })
    } else {
      rows.push({ kind: "item", label: `"${c.name}"`, value: index, color: tone.ai, detail: "Jev looks for it" })
    }
  })
  return rows
}
