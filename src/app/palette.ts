import type { KeyEvent } from "@opentui/core"
import { fuzzyFilter } from "../domain/fuzzy"
import { TABS, type ScopeId } from "../state/uiStore"
import { keyEvent } from "./keyEvent"

/**
 * The command palette (ctrl+k, K4) and the trimmed footer (K5) read one
 * source: a scope's hints. The footer shows the first FOOTER_LIMIT, then
 * "ctrl+k all"; the palette lists every hint that is one key press, plus
 * the global commands, and runs one by pressing its key in the scope the
 * palette was opened from. Hints that name several keys ("j/k", "S-j/k",
 * "1-3") are movement, kept for the footer only.
 */
export interface Hint { key: string; desc: string }

export interface PaletteEntry { label: string; key: string; event: KeyEvent }

export const FOOTER_LIMIT = 8

/** Commands that work from every pane (handleKey's own keys). */
export const GLOBAL_COMMANDS: Hint[] = [
  { key: "ctrl+r", desc: "sync now" },
  ...TABS.map((tab) => ({ key: tab.hotkey, desc: `${tab.label} tab` })),
  { key: "v", desc: "jump to a pane" },
]

const NAMED: Record<string, string> = { enter: "return", esc: "escape", del: "delete", "del del": "delete", space: "space", tab: "tab" }

/** The key press a hint names, or null when it names several (or none). */
export function hintEvent(hint: string): KeyEvent | null {
  if (NAMED[hint]) return keyEvent(NAMED[hint]!)
  const ctrl = /^ctrl\+([a-z])$/.exec(hint)
  if (ctrl) return keyEvent(ctrl[1]!, { ctrl: true, sequence: "" })
  const shifted = /^S-([a-z])$/.exec(hint)?.[1] ?? (/^[A-Z]$/.test(hint) ? hint.toLowerCase() : null)
  if (shifted) return keyEvent(shifted, { shift: true, sequence: shifted.toUpperCase() })
  if (/^[a-z0-9]$/.test(hint)) return keyEvent(hint)
  // Punctuation: the handlers read the character from name or sequence.
  if (/^[./?[\]]$/.test(hint)) return keyEvent(hint, { sequence: hint })
  return null
}

/** The palette's rows for a scope's hints and the query, one per key (the
 * scope's own hint wins over a global one), fuzzy-matched on the
 * description and key. `globals` is false where tabs and jump don't apply. */
export function paletteEntries(hints: Hint[], query: string, globals = true): PaletteEntry[] {
  const seen = new Set<string>()
  const entries: PaletteEntry[] = []
  for (const hint of [...hints, ...(globals ? GLOBAL_COMMANDS : [])]) {
    const event = hintEvent(hint.key)
    if (!event || seen.has(hint.key) || hint.key === "esc") continue
    seen.add(hint.key)
    entries.push({ label: hint.desc, key: hint.key, event })
  }
  return fuzzyFilter(entries, query.trim(), (entry) => `${entry.label} ${entry.key}`)
}

/** The footer: the first FOOTER_LIMIT hints, then "ctrl+k all" when the
 * palette has more (`palette`: it can open here). */
export function footerShown(hints: Hint[], palette: boolean): Hint[] {
  if (!palette || hints.length <= FOOTER_LIMIT + 1) return hints
  return [...hints.slice(0, FOOTER_LIMIT), { key: "ctrl+k", desc: "all" }]
}

const SCOPE_LABELS: Partial<Record<ScopeId, string>> = {
  "overview": "Overview",
  "manager.txns": "Transactions",
  "manager.accounts": "Accounts",
  "manager.merchants": "Merchants",
  "settings": "Settings",
  "settings.taxonomy": "Settings › Taxonomy",
  "settings.budgets": "Settings › Budgets",
  "settings.ai": "Settings › AI models",
  "settings.rules": "Settings › Rules",
  "settings.filters": "Settings › Saved filters",
  "settings.up": "Settings › Up Bank",
  "settings.database": "Settings › Database",
}

/** Where the palette opened, as its subtitle names it. */
export function scopeLabel(scope: ScopeId): string {
  return SCOPE_LABELS[scope] ?? scope
}
