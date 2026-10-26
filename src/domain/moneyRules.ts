import type { Transaction } from "./types"

type FlowRow = Pick<Transaction, "tagNames"> & Partial<Pick<Transaction, "excluded">>

/** Whether a row has an IGNORE tag, case-insensitive. */
export function hasIgnoreTag(row: Pick<Transaction, "tagNames">): boolean {
  return row.tagNames.some((tag) => tag.toUpperCase() === "IGNORE")
}

/** Ordinary flows exclude excluded rows and IGNORE tags, but include holds. */
export function isOrdinaryFlow(row: FlowRow): boolean {
  return !row.excluded && !hasIgnoreTag(row)
}

/** A negative ordinary flow counts as spending. */
export function isSpending(row: FlowRow & Pick<Transaction, "amount">): boolean {
  return row.amount < 0 && isOrdinaryFlow(row)
}

/** A positive ordinary flow counts as income. */
export function isIncome(row: FlowRow & Pick<Transaction, "amount">): boolean {
  return row.amount > 0 && isOrdinaryFlow(row)
}

/** Whether a synced row is pending. */
export function isHeld(row: Pick<Transaction, "status">): boolean {
  return row.status === "HELD"
}
