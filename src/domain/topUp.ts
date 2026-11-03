import { addDays } from "./days"
import { isIncome } from "./moneyRules"
import { balanceHistory } from "./position"
import { accountRole, type Account, type Transaction } from "./types"

/**
 * Top-up budgeting (the Budgets tab's "topup" style): each payday the
 * spending accounts are topped up to the target (the budgets' total) from
 * the pay, and the rest of the pay goes to savers. Spending less leaves
 * more in Spending at the next payday, so less pay is kept and more is
 * sent: the sweep is the scorecard.
 */

/** How budgets work (Settings: UiPrefs.budgetStyle): "tracking", spending
 * against budgets, or "topup". */
export type BudgetStyle = "tracking" | "topup"

/** Days after pay arrives that count as its sweep to savers. */
export const SWEEP_DAYS = 3

export interface PaydayResult {
  dateISO: string
  /** Pay in (the Salary category) to the spending accounts that day. */
  pay: number
  /** Spending accounts' balance at the end of the day before. */
  before: number
  /** What the top-up keeps of the pay: target less before, within the pay. */
  keep: number
  /** What should go to savers: the pay less what's kept. */
  due: number
  /** Sent to savers from the spending accounts, net, from payday to
   * SWEEP_DAYS after (and before the next payday), by saver. */
  sent: number
  bySaver: Array<{ accountId: number; amount: number }>
}

const spendingIds = (accounts: Account[]) => new Set(accounts.filter((a) => accountRole(a) === "spending").map((a) => a.id))
const saverIds = (accounts: Account[]) => new Set(accounts.filter((a) => accountRole(a) === "saver").map((a) => a.id))

/** Each payday in `paydays` (ascending) against `target`. */
export function paydayResults(accounts: Account[], transactions: Transaction[], paydays: readonly string[], target: number): PaydayResult[] {
  if (!paydays.length) return []
  const spending = spendingIds(accounts), savers = saverIds(accounts)
  const history = balanceHistory(accounts, transactions, addDays(paydays[0]!, -1), paydays.at(-1)!)
  const balanceOn = new Map(history.map((p) => [p.dateISO, p.spending]))
  return paydays.map((day, i) => {
    const until = [addDays(day, SWEEP_DAYS), ...(paydays[i + 1] ? [addDays(paydays[i + 1]!, -1)] : [])].sort()[0]!
    const pay = transactions.filter((t) => t.dateISO === day && t.accountId != null && spending.has(t.accountId) && isIncome(t) && t.amount > 0 && t.categoryName === "Salary")
      .reduce((n, t) => n + t.amount, 0)
    const before = balanceOn.get(addDays(day, -1)) ?? 0
    const keep = Math.max(0, Math.min(pay, target - before))
    const bySaver = new Map<number, number>()
    for (const t of transactions) {
      if (t.dateISO < day || t.dateISO > until || t.accountId == null || !spending.has(t.accountId) || t.transferAccountId == null || !savers.has(t.transferAccountId)) continue
      bySaver.set(t.transferAccountId, (bySaver.get(t.transferAccountId) ?? 0) - t.amount)
    }
    const sent = [...bySaver.values()].reduce((n, a) => n + a, 0)
    return { dateISO: day, pay, before, keep, due: pay - keep, sent, bySaver: [...bySaver].filter(([, a]) => Math.abs(a) >= 0.5).map(([accountId, amount]) => ({ accountId, amount })) }
  })
}

export interface TopUpForecast {
  /** Spending's balance the day before the next payday, at this pace. */
  end: number
  /** What the next top-up would keep of a pay like the last one, and send. */
  keep: number
  send: number
}

/** The next payday at this pace: Spending's projected end (projectAvailable's
 * last day, or the balance now), topped up to `target` from a pay like
 * `pay` (the last one). */
export function topUpForecast(projectedEnd: number, target: number, pay: number): TopUpForecast {
  const keep = Math.max(0, Math.min(pay, target - projectedEnd))
  return { end: projectedEnd, keep, send: pay - keep }
}
