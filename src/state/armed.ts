type ArmedKind =
  | "category" | "tag" | "rule" | "filter" | "profile" | "budget"
  | "clearData" | "clearAccount" | "deleteAccount" | "desyncAccount"
  | "aiKey"

export interface Armed {
  kind: ArmedKind
  id: number | string
  label: string
  with: "delete" | "enter"
  promptId: number
}

export const ACCOUNT_ACTIONS = ["clearAccount", "deleteAccount"] as const

export function armedText(armed: Omit<Armed, "promptId">): string {
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
    aiKey: `remove what was saved for ${armed.label}`,
  }[armed.kind]
  return `Press ${press} again to ${what}`
}

export function isArmed(armed: Armed | null, kind: ArmedKind, id: number | string): boolean {
  return !!armed && armed.kind === kind && String(armed.id) === String(id)
}

export function armedFor(armed: Armed | null, kind: ArmedKind, id: number | string): string | undefined {
  return armed && isArmed(armed, kind, id) ? armedText(armed) : undefined
}

export function isSecondPress(armed: Armed, name: string): boolean {
  return armed.with === "delete" ? name === "delete" || name === "backspace" : name === "return" || name === "enter"
}
