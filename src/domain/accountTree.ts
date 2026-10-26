import { accountRole, type Account } from "./types"

/** What the Transactions tab shows: all spending accounts, all savers, or one account. */
export type AccountSelection = "all" | "savers" | number

export type SidebarEntry =
  | { kind: "heading"; label: string }
  | { kind: "select"; selection: AccountSelection; label: string; depth: number; balance: number | null }

const SOURCE_LABEL: Record<Account["source"], string> = { up: "Up", csv: "Imported" }

/** Sidebar rows: "All spending", then each source with its spending accounts
 * and, nested under them, its savers (selectable as a group and singly). */
export function sidebarEntries(accounts: Account[]): SidebarEntry[] {
  const spending = accounts.filter((a) => accountRole(a) === "spending")
  const entries: SidebarEntry[] = [
    { kind: "select", selection: "all", label: "All spending", depth: 0, balance: sumBalances(spending) },
  ]
  const sources = [...new Set(accounts.map((a) => a.source))]
  for (const source of sources) {
    const own = accounts.filter((a) => a.source === source)
    entries.push({ kind: "heading", label: SOURCE_LABEL[source] })
    for (const a of own.filter((a) => accountRole(a) === "spending")) {
      entries.push({ kind: "select", selection: a.id, label: a.name, depth: 1, balance: a.balance })
    }
    const savers = own.filter((a) => accountRole(a) === "saver")
    if (savers.length) {
      entries.push({ kind: "select", selection: "savers", label: "Savers", depth: 1, balance: sumBalances(savers) })
      for (const a of savers) entries.push({ kind: "select", selection: a.id, label: a.name, depth: 2, balance: a.balance })
    }
  }
  return entries
}

export function selectableEntries(accounts: Account[]) {
  return sidebarEntries(accounts).filter((e): e is Extract<SidebarEntry, { kind: "select" }> => e.kind === "select")
}

export function selectedAccounts(accounts: Account[], selection: AccountSelection): Account[] {
  if (selection === "all") return accounts.filter((a) => accountRole(a) === "spending")
  if (selection === "savers") return accounts.filter((a) => accountRole(a) === "saver")
  return accounts.filter((a) => a.id === selection)
}

export function selectionLabel(accounts: Account[], selection: AccountSelection): string {
  if (selection === "all") return "All spending"
  if (selection === "savers") return "Savers"
  return accounts.find((a) => a.id === selection)?.name ?? "All spending"
}

function sumBalances(accounts: Account[]): number | null {
  const known = accounts.filter((a) => a.balance != null)
  return known.length ? known.reduce((sum, a) => sum + a.balance!, 0) : null
}

/** The spending accounts a period analysis covers: the selected account when
 * it is a spending account, otherwise every spending account (savers have
 * no spending of their own; their story is their balance). */
export function spendingScope(accounts: Account[], selection: AccountSelection): { accounts: Account[]; label: string } {
  const one = typeof selection === "number" ? accounts.find((a) => a.id === selection && accountRole(a) === "spending") : undefined
  if (one) return { accounts: [one], label: one.name }
  return { accounts: accounts.filter((a) => accountRole(a) === "spending"), label: "All spending" }
}
