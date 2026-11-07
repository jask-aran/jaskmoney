import type { KeyEvent } from "@opentui/core"
import { SETTINGS_SECTION_LABELS, SETTINGS_SECTIONS, type ScopeId } from "../state/uiStore"
import { keyEvent } from "./keyEvent"

/**
 * The footer (K5) and the command palette's pane commands (K4, app/commands)
 * read one source: a scope's hints. The footer names the focused pane and
 * shows its keys, then the tab's (`tab`), as many as the line holds, then
 * "ctrl+k all" where some didn't fit; the palette has a command for each
 * hint that is one key press, run by pressing it. Hints that name several keys
 * ("j/k", "S-j/k", "1-4") are movement, kept for the footer only.
 */
/** A footer hint: its key and short text. A one-key hint is also a palette
 * command: the registry command it names (`command`, app/commands), or its
 * own, by `label` and `description` (else its text, capitalised). */
export interface Hint { key: string; desc: string; command?: string; label?: string; description?: string; tab?: boolean }

/** A footer piece, as the footer draws it: the pane's name, a hint's key
 * or words, the gap between hints, or the rule between the pane's keys
 * and the tab's. */
export interface FooterPart { text: string; kind: "pane" | "key" | "desc" | "gap" | "rule" }

/** The footer's pieces for the pane named `pane` (none: the tab's keys
 * alone) and `hints`: the pane's name, its keys, a rule, the tab's. */
export function footerParts(pane: string | null, hints: Hint[]): FooterPart[] {
  const parts: FooterPart[] = pane ? [{ text: pane, kind: "pane" }] : []
  hints.forEach((h, i) => {
    const before = i > 0 ? hints[i - 1] : null
    if (h.tab && (before ? !before.tab : pane)) parts.push({ text: "  │  ", kind: "rule" })
    else if (parts.length) parts.push({ text: "  ", kind: "gap" })
    parts.push({ text: h.key, kind: "key" }, { text: ` ${h.desc}`, kind: "desc" })
  })
  return parts
}

const partsWidth = (parts: FooterPart[]) => parts.reduce((n, p) => n + p.text.length, 0)
const ALL: Hint = { key: "ctrl+k", desc: "all" }

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

/** The footer's hints on a line `width` wide after the pane's name: all
 * of them where they fit; else, in order, those that fit with "ctrl+k
 * all" after them (`palette`: it can open here), the pane's first. */
export function footerShown(hints: Hint[], palette: boolean, width = Infinity, pane: string | null = null): Hint[] {
  if (partsWidth(footerParts(pane, hints)) <= width) return hints
  const shown: Hint[] = []
  for (const h of hints) {
    if (partsWidth(footerParts(pane, [...shown, h, ...(palette ? [ALL] : [])])) > width) break
    shown.push(h)
  }
  return palette ? [...shown, ALL] : shown
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
