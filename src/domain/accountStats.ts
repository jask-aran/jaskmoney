import { addDays } from "./days"
import { reconstructHistory } from "./balanceHistory"
import { isHeld } from "./moneyRules"
import type { Account, Transaction } from "./types"

/**
 * Detail statistics for the Transactions accounts strip's selection: a
 * single account (e.g. Spending) or a group ("All spending", "Savers").
 *
 * Unlike the dashboard's spending figures, every row of the given accounts
 * counts here, internal transfers included: for a saver the transfers ARE
 * its activity. Rows of other accounts are ignored.
 */

export interface MonthFlow {
  /** "YYYY-MM". */
  month: string
  /** Positive total of inflows. */
  moneyIn: number
  /** Positive total of outflows. */
  moneyOut: number
}

export interface AccountStats {
  /** Sum of the accounts' reported balances; null when none reports one. Up
   * balances are available balances (holds already deducted). */
  balance: number | null
  /** HELD rows: count and summed amount (negative while money is on hold). */
  held: { count: number; amount: number }
  /** balance − held.amount: what the balance will be once holds settle at
   * their held amounts. null when balance is null. */
  settledBalance: number | null
  /** Latest dateISO among the accounts' rows; null when there are none. */
  lastActivityISO: string | null
  /** Earliest dateISO among the accounts' rows; null when there are none. */
  firstActivityISO: string | null
  /** Trailing windows ending today (inclusive), e.g. 30 = today and the 29
   * days before. Always [30, 90, 365] in that order. */
  windows: Array<{ days: number; moneyIn: number; moneyOut: number; net: number }>
  /** The last `months` calendar months, oldest first, ending with today's
   * month (included even when partial or empty). */
  monthly: MonthFlow[]
  /** End-of-day balance for each of the last `historyDays` days, oldest first,
   * ending today; reconstructed backwards from the current balance as in
   * computePosition (value(D) = balance − Σ amounts dated after D). Empty
   * when balance is null. */
  history: Array<{ dateISO: string; value: number }>
  /** Interest: positive rows whose description is exactly "Interest"
   * (case-insensitive, trimmed), as Up's savers report it. */
  interest: {
    /** Calendar year of today. */
    thisYear: number
    /** Trailing 365 days. */
    last365: number
    /** The most recent interest row, or null. */
    latest: { dateISO: string; amount: number } | null
    /** Effective annual rate implied by the latest interest row:
     * latest.amount / (average end-of-day balance over the 30 days before
     * latest.dateISO, from `history`-style reconstruction, skipping leading
     * days whose balance is ≤ 0, i.e. before the account was funded) × 12 × 100.
     * null when there is no latest row or that average is ≤ 0. */
    impliedAnnualRatePct: number | null
  }
  /** Outflows to outside the tracked accounts in the last 90 days: rows with
   * amount < 0 and excluded = false, grouped by exact description, largest
   * total first, at most 5. */
  topOutflows: Array<{ description: string; amount: number; count: number }>
}

export function computeAccountStats(
  accounts: Account[],
  transactions: Transaction[],
  todayISO: string,
  opts: { months?: number; historyDays?: number } = {},
): AccountStats {
  const months = opts.months ?? 12
  const historyDays = opts.historyDays ?? 365
  const accountIds = new Set(accounts.map((account) => account.id))
  const balancedIds = new Set(accounts.filter((account) => account.balance !== null).map((account) => account.id))
  let balance: number | null = null
  for (const account of accounts) {
    if (account.balance !== null) balance = (balance ?? 0) + account.balance
  }

  const held = { count: 0, amount: 0 }
  let firstActivityISO: string | null = null
  let lastActivityISO: string | null = null
  const windows = [30, 90, 365].map((days) => ({ days, moneyIn: 0, moneyOut: 0, net: 0 }))
  const windowStarts = windows.map((window) => ({ window, startISO: addDays(todayISO, 1 - window.days) }))
  const monthly: MonthFlow[] = []
  const monthNumber = Number(todayISO.slice(0, 4)) * 12 + Number(todayISO.slice(5, 7)) - 1
  for (let i = months - 1; i >= 0; i--) {
    const month = monthNumber - i
    monthly.push({
      month: `${Math.floor(month / 12).toString().padStart(4, "0")}-${(month % 12 + 1).toString().padStart(2, "0")}`,
      moneyIn: 0, moneyOut: 0,
    })
  }
  const flowsByMonth = new Map(monthly.map((flow) => [flow.month, flow]))
  const amountsByDate = new Map<string, number>()
  const outflows = new Map<string, AccountStats["topOutflows"][number]>()
  const outflowStartISO = addDays(todayISO, 1 - 90)
  const interest: AccountStats["interest"] = { thisYear: 0, last365: 0, latest: null, impliedAnnualRatePct: null }
  const year = todayISO.slice(0, 4)
  const interestStartISO = addDays(todayISO, 1 - 365)

  for (const row of transactions) {
    if (row.accountId === null || !accountIds.has(row.accountId)) continue
    if (firstActivityISO === null || row.dateISO < firstActivityISO) firstActivityISO = row.dateISO
    if (lastActivityISO === null || row.dateISO > lastActivityISO) lastActivityISO = row.dateISO
    if (isHeld(row)) {
      held.count++
      held.amount += row.amount
    }
    if (balancedIds.has(row.accountId)) {
      amountsByDate.set(row.dateISO, (amountsByDate.get(row.dateISO) ?? 0) + row.amount)
    }
    if (row.amount > 0 && row.description.trim().toLowerCase() === "interest") {
      if (row.dateISO.slice(0, 4) === year) interest.thisYear += row.amount
      if (row.dateISO >= interestStartISO && row.dateISO <= todayISO) interest.last365 += row.amount
      if (interest.latest === null || row.dateISO > interest.latest.dateISO) {
        interest.latest = { dateISO: row.dateISO, amount: row.amount }
      }
    }
    if (row.dateISO > todayISO) continue
    const moneyIn = Math.max(0, row.amount)
    const moneyOut = Math.max(0, -row.amount)
    for (const { window, startISO } of windowStarts) {
      if (row.dateISO < startISO) continue
      window.moneyIn += moneyIn
      window.moneyOut += moneyOut
      window.net += row.amount
    }
    const month = flowsByMonth.get(row.dateISO.slice(0, 7))
    if (month) {
      month.moneyIn += moneyIn
      month.moneyOut += moneyOut
    }
    if (row.amount < 0 && !row.excluded && row.dateISO >= outflowStartISO) {
      const outflow = outflows.get(row.description) ?? { description: row.description, amount: 0, count: 0 }
      outflow.amount -= row.amount
      outflow.count++
      outflows.set(row.description, outflow)
    }
  }
  const history = balance === null ? [] : reconstructHistory(balance, amountsByDate, todayISO, historyDays)
  if (balance !== null && interest.latest !== null) {
    const endISO = addDays(interest.latest.dateISO, -1)
    // Leading days with nothing in the account (before an opening deposit)
    // earn nothing; averaging them in would overstate a new account's rate.
    // Only leading days: incomplete history still reconstructs a positive
    // balance there, so it is not mistaken for an empty account.
    const prior = reconstructHistory(balance, amountsByDate, endISO, 30)
    const opened = prior.findIndex((day) => day.value > 0)
    const earning = opened < 0 ? [] : prior.slice(opened)
    const average = earning.length ? earning.reduce((sum, day) => sum + day.value, 0) / earning.length : 0
    if (average > 0) interest.impliedAnnualRatePct = interest.latest.amount / average * 12 * 100
  }
  return {
    balance, held, settledBalance: balance === null ? null : balance - held.amount,
    firstActivityISO, lastActivityISO, windows, monthly, history, interest,
    topOutflows: [...outflows.values()].sort((a, b) => b.amount - a.amount).slice(0, 5),
  }
}
