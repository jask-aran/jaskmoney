import type { Transaction } from "./types"

/** Exact descriptions match ignoring case and outer spaces. */
export const descKey = (t: Pick<Transaction, "description">) => t.description.trim().toLowerCase()

/** Group rows by exact description, preserving input order. */
export function groupByDescription(transactions: readonly Transaction[]): Map<string, Transaction[]> {
  const groups = new Map<string, Transaction[]>()
  for (const row of transactions) {
    const key = descKey(row)
    const rows = groups.get(key) ?? []
    rows.push(row)
    groups.set(key, rows)
  }
  return groups
}
