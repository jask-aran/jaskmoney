/**
 * Confirming by pressing the same key again (K2): the first press arms a row
 * (it turns red and says what the second press does), the same key on the
 * same row does it, and any other key disarms. One rule for every
 * destructive action: del on a list row, enter on a dialog action. Typing
 * RESET stays only for wiping the whole database.
 */
export type ArmedKind =
  | "category" | "tag" | "rule" | "filter" | "profile" | "budget"
  | "clearData" | "clearAccount" | "deleteAccount" | "desyncAccount"

export interface Armed {
  kind: ArmedKind
  id: number | string
  /** The thing, as the row and status line name it. */
  label: string
  /** The key that armed it, which does it on a second press. */
  with: "delete" | "enter"
}

/** The account data dialog's actions (Transactions › accounts, d), each enter twice. */
export const ACCOUNT_ACTIONS = ["clearAccount", "deleteAccount"] as const

/** What the second press does, as the armed row and the status line say it. */
export function armedText(armed: Armed): string {
  const press = armed.with === "delete" ? "del" : "enter"
  const what = {
    category: `delete ${armed.label}`,
    tag: `delete ${armed.label}`,
    rule: `delete ${armed.label}`,
    filter: `delete ${armed.label}`,
    profile: `delete profile ${armed.label}`,
    budget: `delete ${armed.label}`,
    clearData: "clear all transactions and imports",
    clearAccount: `clear ${armed.label}'s transactions`,
    deleteAccount: `remove ${armed.label} and its transactions`,
    desyncAccount: `stop syncing ${armed.label} (its transactions are removed)`,
  }[armed.kind]
  return `Press ${press} again to ${what}`
}

/** Whether `armed` is this row. */
export function isArmed(armed: Armed | null, kind: ArmedKind, id: number | string): boolean {
  return !!armed && armed.kind === kind && String(armed.id) === String(id)
}

/** The armed row's text (armedText) when `armed` is this row, for ListRow's `armed`. */
export function armedFor(armed: Armed | null, kind: ArmedKind, id: number | string): string | undefined {
  return armed && isArmed(armed, kind, id) ? armedText(armed) : undefined
}

/** Whether a key press is the armed one's second press (backspace counts as del). */
export function isSecondPress(armed: Armed, name: string): boolean {
  return armed.with === "delete" ? name === "delete" || name === "backspace" : name === "return" || name === "enter"
}
