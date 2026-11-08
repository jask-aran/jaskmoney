import { fuzzyScore } from "../domain/fuzzy"
import type { PickerItem } from "./settingsForm"

/**
 * The model picker (a use's "Change the model…", or a provider's dialog):
 * the provider's chat models as pi-ai's catalog has them, the recommended
 * one (the app's default) first, then the rest by maker. Typing filters by
 * id and name, best match first. No request goes to the provider: the
 * catalog is the list.
 */
export interface ModelEntry {
  id: string
  name: string
  /** Dollars per million tokens in and out. */
  input: number
  output: number
  /** Tokens of context. */
  context: number
}

/** "$0.10 / $0.20 per M · 1049k" (or "free"): what a model costs and holds. */
function modelDetail(entry: ModelEntry): string {
  const money = (n: number) => `$${n < 1 ? n.toFixed(2) : n % 1 ? n.toFixed(2) : n.toFixed(0)}`
  const price = entry.input === 0 && entry.output === 0 ? "free" : `${money(entry.input)} / ${money(entry.output)} per M`
  const context = entry.context >= 1000 ? `${Math.round(entry.context / 1000)}k` : String(entry.context)
  return `${price} · ${context}`
}

/** Who makes it: OpenRouter's ids lead with the maker ("anthropic/…"). */
const makerOf = (id: string, fallback: string) => (id.includes("/") ? id.slice(0, id.indexOf("/")) : fallback)

export function modelPickerItems(entries: readonly ModelEntry[], options: { current: string; recommended: string; query: string; maker: string }): PickerItem[] {
  const item = (entry: ModelEntry): PickerItem => ({
    kind: "item", value: entry.id, label: entry.id,
    detail: [entry.id === options.recommended ? "recommended" : "", entry.id === options.current ? "in use" : "", modelDetail(entry)].filter(Boolean).join(" · "),
  })
  const q = options.query.trim()
  if (q) {
    const scored = entries.flatMap((entry) => {
      const score = Math.max(fuzzyScore(q, entry.id) ?? -Infinity, fuzzyScore(q, entry.name) ?? -Infinity)
      return score > -Infinity ? [{ entry, score }] : []
    }).sort((a, b) => b.score - a.score)
    return scored.length ? [{ kind: "heading", label: "Matches" }, ...scored.map(({ entry }) => item(entry))] : []
  }
  const top = entries.filter((e) => e.id === options.recommended || e.id === options.current)
    .sort((a, b) => Number(b.id === options.recommended) - Number(a.id === options.recommended))
  const rest = entries.filter((e) => !top.includes(e))
  const makers = [...new Set(rest.map((e) => makerOf(e.id, options.maker)))].sort()
  return [
    ...(top.length ? [{ kind: "heading" as const, label: "Recommended" }, ...top.map(item)] : []),
    ...makers.flatMap((maker): PickerItem[] => [{ kind: "heading", label: maker }, ...rest.filter((e) => makerOf(e.id, options.maker) === maker).map(item)]),
  ]
}
