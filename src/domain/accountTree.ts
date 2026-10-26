import { accountRole, type Account } from "./types"

/** What the Transactions tab shows: all spending accounts, all savers, or
 * one spending account. */
export type AccountSelection = "all" | "savers" | number

/** One tile in the Transactions tab's accounts strip. */
export interface AccountTile {
  selection: AccountSelection
  label: string
  balance: number | null
}

/** The strip's tiles in groups: "All spending" alone, each source's
 * spending accounts, then one "Savers" tile for every saver. Savers are not
 * listed one by one: their only rows are transfers and interest. */
export function accountStrip(accounts: Account[]): AccountTile[][] {
  const spending = accounts.filter((a) => accountRole(a) === "spending")
  const savers = accounts.filter((a) => accountRole(a) === "saver")
  const groups: AccountTile[][] = [[{ selection: "all", label: "All spending", balance: sumBalances(spending) }]]
  for (const source of new Set(spending.map((a) => a.source))) {
    groups.push(spending.filter((a) => a.source === source).map((a) => ({ selection: a.id, label: a.name, balance: a.balance })))
  }
  if (savers.length) groups.push([{ selection: "savers", label: "Savers", balance: sumBalances(savers) }])
  return groups
}

/** The strip's tiles in order. */
export function accountTiles(accounts: Account[]): AccountTile[] {
  return accountStrip(accounts).flat()
}

/** A selection the strip can show: a saver stands for all savers, and an
 * account that no longer exists for all spending. */
export function normaliseSelection(accounts: Account[], selection: AccountSelection): AccountSelection {
  if (typeof selection !== "number") return selection
  const account = accounts.find((a) => a.id === selection)
  if (!account) return "all"
  return accountRole(account) === "saver" ? "savers" : selection
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
