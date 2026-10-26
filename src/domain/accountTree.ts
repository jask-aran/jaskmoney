import { accountRole, type Account } from "./types"

/** What the Transactions tab shows: all spending accounts, all savers, or
 * one spending account. */
export type AccountSelection = "all" | "savers" | number

/** A selectable row in the Transactions tab's accounts pane. `accountId`
 * is the one account behind the row, if there is one. */
export interface AccountRow {
  selection: AccountSelection
  label: string
  kind: "spending" | "savers"
  balance: number | null
  accountId: number | null
}

/** One stack in the accounts pane: a source (or every source) with its net
 * position over the accounts it lists. */
export interface AccountStack {
  label: string
  net: number | null
  rows: AccountRow[]
}

const SOURCE_LABEL: Record<Account["source"], string> = { up: "Up (API)", csv: "CSV import" }

/** The accounts pane: a stack per source with its spending accounts and one
 * Savers row for its savers (their rows are only transfers and interest).
 * With more than one spending account an "All accounts" stack comes first
 * for all spending together; with one, that account is all spending. */
export function accountStacks(accounts: Account[]): AccountStack[] {
  const spending = accounts.filter((a) => accountRole(a) === "spending")
  const stacks: AccountStack[] = []
  if (spending.length > 1) {
    stacks.push({
      label: "All accounts",
      net: sumBalances(accounts),
      rows: [{ selection: "all", label: "All spending", kind: "spending", balance: sumBalances(spending), accountId: null }],
    })
  }
  for (const source of new Set(accounts.map((a) => a.source))) {
    const own = accounts.filter((a) => a.source === source)
    const savers = own.filter((a) => accountRole(a) === "saver")
    const rows: AccountRow[] = own.filter((a) => accountRole(a) === "spending").map((a) => ({
      selection: spending.length === 1 ? "all" : a.id, label: a.name, kind: "spending", balance: a.balance, accountId: a.id,
    }))
    if (savers.length) rows.push({ selection: "savers", label: "Savers", kind: "savers", balance: sumBalances(savers), accountId: null })
    stacks.push({ label: SOURCE_LABEL[source], net: sumBalances(own), rows })
  }
  return stacks
}

/** The pane's rows in order, stack by stack. */
export function accountRows(accounts: Account[]): AccountRow[] {
  return accountStacks(accounts).flatMap((stack) => stack.rows)
}

/** A selection the pane can show: a saver stands for all savers, the only
 * spending account for all spending, and an account that no longer exists
 * for all spending. */
export function normaliseSelection(accounts: Account[], selection: AccountSelection): AccountSelection {
  if (typeof selection !== "number") return selection
  const account = accounts.find((a) => a.id === selection)
  if (!account) return "all"
  if (accountRole(account) === "saver") return "savers"
  return accounts.filter((a) => accountRole(a) === "spending").length === 1 ? "all" : selection
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
