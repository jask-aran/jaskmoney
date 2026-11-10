import type { Transaction } from "./types"

export function chronological(a: Pick<Transaction, "dateISO" | "createdMs" | "id">, b: Pick<Transaction, "dateISO" | "createdMs" | "id">): number {
  if (a.dateISO !== b.dateISO) return a.dateISO < b.dateISO ? -1 : 1
  if (a.createdMs != null && b.createdMs != null && a.createdMs !== b.createdMs) return a.createdMs - b.createdMs
  return a.id - b.id
}

export const newestFirst = (a: Pick<Transaction, "dateISO" | "createdMs" | "id">, b: Pick<Transaction, "dateISO" | "createdMs" | "id">) => chronological(b, a)
