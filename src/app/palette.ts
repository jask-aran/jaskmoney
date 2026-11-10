import type { KeyEvent } from "@opentui/core"
import { SETTINGS_SECTION_LABELS, SETTINGS_SECTIONS, type ScopeId } from "../state/uiStore"
import { keyEvent } from "./keyEvent"

export interface Hint { key: string; desc: string; command?: string; label?: string; description?: string; tab?: boolean; paletteOnly?: boolean }

interface FooterPart { text: string; kind: "pane" | "key" | "desc" | "gap" | "rule" }

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
export const ALL: Hint = { key: "ctrl+k", desc: "all" }
const ALL_WIDTH = ALL.key.length + 1 + ALL.desc.length + 2

const NAMED: Record<string, string> = { enter: "return", esc: "escape", del: "delete", "del del": "delete", space: "space", tab: "tab" }

export function hintEvent(hint: string): KeyEvent | null {
  if (NAMED[hint]) return keyEvent(NAMED[hint]!)
  const ctrl = /^ctrl\+([a-z])$/.exec(hint)
  if (ctrl) return keyEvent(ctrl[1]!, { ctrl: true, sequence: "" })
  const shifted = /^S-([a-z])$/.exec(hint)?.[1] ?? (/^[A-Z]$/.test(hint) ? hint.toLowerCase() : null)
  if (shifted) return keyEvent(shifted, { shift: true, sequence: shifted.toUpperCase() })
  if (/^[a-z0-9]$/.test(hint)) return keyEvent(hint)
  if (/^[./?[\]]$/.test(hint)) return keyEvent(hint, { sequence: hint })
  return null
}

export function footerShown(hints: Hint[], palette: boolean, width = Infinity, pane: string | null = null): Hint[] {
  const room = width - (palette ? ALL_WIDTH : 0)
  const shown: Hint[] = []
  for (const h of hints.filter((x) => !x.paletteOnly)) {
    if (partsWidth(footerParts(pane, [...shown, h])) > room) break
    shown.push(h)
  }
  return shown
}

const SCOPE_LABELS: Partial<Record<ScopeId, string>> = {
  "overview": "Overview",
  "manager.txns": "Transactions",
  "manager.accounts": "Accounts",
  "manager.merchants": "Merchants",
  "settings": "Settings",
  ...Object.fromEntries(SETTINGS_SECTIONS.map((section) => [`settings.${section}`, `Settings › ${SETTINGS_SECTION_LABELS[section]}`])),
}

export function scopeLabel(scope: ScopeId): string {
  return SCOPE_LABELS[scope] ?? scope
}
