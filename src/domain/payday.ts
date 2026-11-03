import { addDays } from "./days"
import { isIncome } from "./moneyRules"
import { accountRole, type Account, type Transaction } from "./types"

/**
 * Paydays as they happened: what came in (the Salary category) to the
 * spending accounts, and what went from them to savers until the next
 * payday. The Budgets tab sets these beside the plan you give it (your
 * pay, your spending): pay less spending is what goes to savers.
 */

export interface PaydayResult {
  dateISO: string
  /** Pay in to the spending accounts that day. */
  pay: number
  /** Sent to savers from the spending accounts, net, from payday until
   * the day before the next (or `until`), by saver. */
  sent: number
  bySaver: Array<{ accountId: number; amount: number }>
}

const spendingIds = (accounts: Account[]) => new Set(accounts.filter((a) => accountRole(a) === "spending").map((a) => a.id))
const saverIds = (accounts: Account[]) => new Set(accounts.filter((a) => accountRole(a) === "saver").map((a) => a.id))

/** Each payday in `paydays` (ascending); the last one's sends run to `until`. */
export function paydayResults(accounts: Account[], transactions: Transaction[], paydays: readonly string[], until: string): PaydayResult[] {
  const spending = spendingIds(accounts), savers = saverIds(accounts)
  return paydays.map((day, i) => {
    const end = paydays[i + 1] ? addDays(paydays[i + 1]!, -1) : until
    const pay = transactions.filter((t) => t.dateISO === day && t.accountId != null && spending.has(t.accountId) && isIncome(t) && t.amount > 0 && t.categoryName === "Salary")
      .reduce((n, t) => n + t.amount, 0)
    const bySaver = new Map<number, number>()
    for (const t of transactions) {
      if (t.dateISO < day || t.dateISO > end || t.accountId == null || !spending.has(t.accountId) || t.transferAccountId == null || !savers.has(t.transferAccountId)) continue
      bySaver.set(t.transferAccountId, (bySaver.get(t.transferAccountId) ?? 0) - t.amount)
    }
    const sent = [...bySaver.values()].reduce((n, a) => n + a, 0)
    return { dateISO: day, pay, sent, bySaver: [...bySaver].filter(([, a]) => Math.abs(a) >= 0.5).map(([accountId, amount]) => ({ accountId, amount })) }
  })
}

/** What your last few pays averaged (up to `count` paydays with pay in),
 * the plan's starting point for your pay; null with none. */
export function usualPay(accounts: Account[], transactions: Transaction[], paydays: readonly string[], count = 6): number | null {
  const pays = paydayResults(accounts, transactions, paydays, paydays.at(-1) ?? "").map((p) => p.pay).filter((p) => p > 0).slice(-count)
  return pays.length ? pays.reduce((n, p) => n + p, 0) / pays.length : null
}
