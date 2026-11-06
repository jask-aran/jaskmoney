import { isIncome } from "./moneyRules"
import { accountRole, type Account, type Transaction } from "./types"

/**
 * Pay as it happened: what came in (the Salary category) to the spending
 * accounts, and what went from them to savers. The Budgets tab sets these
 * beside the plan you give it (your pay, your spending target): pay less
 * the target is what goes to savers.
 */

const spendingIds = (accounts: Account[]) => new Set(accounts.filter((a) => accountRole(a) === "spending").map((a) => a.id))
const saverIds = (accounts: Account[]) => new Set(accounts.filter((a) => accountRole(a) === "saver").map((a) => a.id))
const isPay = (spending: Set<number>) => (t: Transaction) =>
  t.accountId != null && spending.has(t.accountId) && isIncome(t) && t.amount > 0 && t.categoryName === "Salary"

export interface CyclePay {
  /** The cycle's first pay day; null with no pay in it yet. */
  dateISO: string | null
  /** All pay in the cycle so far (a final pay or a bonus mid-cycle too). */
  pay: number
  /** Sent to savers from the spending accounts, net, in the cycle so far. */
  sent: number
  /** Each day's net sends to savers, in date order. */
  sends: Array<{ dateISO: string; amount: number }>
  /** Each day pay came in, in date order. */
  paydays: string[]
}

/** A cycle's pay and sends from `start` to `through` (inclusive). */
export function cyclePay(accounts: Account[], transactions: Transaction[], start: string, through: string): CyclePay {
  const spending = spendingIds(accounts), savers = saverIds(accounts), pay = isPay(spending)
  let first: string | null = null, total = 0
  const days = new Set<string>()
  const byDay = new Map<string, number>()
  for (const t of transactions) {
    if (t.dateISO < start || t.dateISO > through) continue
    if (pay(t)) { total += t.amount; days.add(t.dateISO); if (!first || t.dateISO < first) first = t.dateISO }
    if (t.accountId != null && spending.has(t.accountId) && t.transferAccountId != null && savers.has(t.transferAccountId)) byDay.set(t.dateISO, (byDay.get(t.dateISO) ?? 0) - t.amount)
  }
  const sends = [...byDay].filter(([, a]) => Math.abs(a) >= 0.5).sort(([a], [b]) => a.localeCompare(b)).map(([dateISO, amount]) => ({ dateISO, amount }))
  return { dateISO: first, pay: total, sent: sends.reduce((n, s) => n + s.amount, 0), sends, paydays: [...days].sort() }
}

/** Your usual pay, the plan's starting point: the median of the last
 * `count` pay days' pay, so one odd pay (a final pay, a long first one)
 * doesn't move it; null with none. */
export function usualPay(accounts: Account[], transactions: Transaction[], count = 6): number | null {
  const pay = isPay(spendingIds(accounts))
  const byDay = new Map<string, number>()
  for (const t of transactions) if (pay(t)) byDay.set(t.dateISO, (byDay.get(t.dateISO) ?? 0) + t.amount)
  const recent = [...byDay].sort(([a], [b]) => a.localeCompare(b)).slice(-count).map(([, a]) => a).sort((a, b) => a - b)
  if (!recent.length) return null
  const mid = Math.floor(recent.length / 2)
  return recent.length % 2 ? recent[mid]! : (recent[mid - 1]! + recent[mid]!) / 2
}
