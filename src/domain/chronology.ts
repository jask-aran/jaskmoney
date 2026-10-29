import type { Transaction } from "./types"

/**
 * Oldest first: by day, then by the provider's exact time (Up gives one), then
 * by the order rows were saved. Saved order alone isn't time: a sync saves
 * Up's newest first, so it would put a day's last purchase at the bottom.
 * Rows without a time (CSV) keep their saved order among themselves.
 */
export function chronological(a: Pick<Transaction, "dateISO" | "createdMs" | "id">, b: Pick<Transaction, "dateISO" | "createdMs" | "id">): number {
  if (a.dateISO !== b.dateISO) return a.dateISO < b.dateISO ? -1 : 1
  if (a.createdMs != null && b.createdMs != null && a.createdMs !== b.createdMs) return a.createdMs - b.createdMs
  return a.id - b.id
}

/** Newest first. */
export const newestFirst = (a: Pick<Transaction, "dateISO" | "createdMs" | "id">, b: Pick<Transaction, "dateISO" | "createdMs" | "id">) => chronological(b, a)
