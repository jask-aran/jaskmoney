import type { KeyEvent } from "@opentui/core"
import { SETTINGS_SECTION_LABELS, SETTINGS_SECTIONS, type ScopeId } from "../state/uiStore"
import { keyEvent } from "./keyEvent"

/**
 * The footer (K5) and the command palette's pane commands (K4, app/commands)
 * read one source: a scope's hints. The footer shows the first
 * FOOTER_LIMIT, then "ctrl+k all"; the palette has a command for each hint
 * that is one key press, run by pressing it. Hints that name several keys
 * ("j/k", "S-j/k", "1-4") are movement, kept for the footer only.
 */
/** A footer hint: its key and short text. A one-key hint is also a palette
 * command: the registry command it names (`command`, app/commands), or its
 * own, by `label` and `description` (else its text, capitalised). */
export interface Hint { key: string; desc: string; command?: string; label?: string; description?: string }

export const FOOTER_LIMIT = 8

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
  ...Object.fromEntries(SETTINGS_SECTIONS.map((section) => [`settings.${section}`, `Settings › ${SETTINGS_SECTION_LABELS[section]}`])),
}

/** Where the palette opened, as its subtitle names it. */
export function scopeLabel(scope: ScopeId): string {
  return SCOPE_LABELS[scope] ?? scope
}
