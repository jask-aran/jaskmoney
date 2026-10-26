import { accountRole, type Account, type Transaction } from "./types"

/**
 * Dashboard analytics for synced accounts.
 *
 * Position is point-in-time ("now") and ignores the dashboard timeframe.
 * Period flows describe the selected timeframe. Both share these rules:
 * - Only tracked accounts are passed in (sync-disabled accounts never are).
 * - `excluded` transactions (internal transfers between tracked accounts, or a
 *   category marked not-spending) are never spending or income.
 * - `internal` transactions move money between tracked accounts and are never
 *   spending or income. A transfer to an untracked account (e.g. a desynced
 *   joint account that pays rent) is ordinary spending.
 * - Rows tagged IGNORE (case-insensitive) are excluded from spending and
 *   income, matching computeCategorySpend.
 * - Spending and income come from spending-role accounts only
 *   (`accountRole(account) === "spending"`).
 */

export interface SaverBalance {
  accountId: number
  name: string
  balance: number
}

export interface Position {
  /** Sum of balances of tracked accounts that report one (spending + savers);
   * null when none does. CSV accounts report no balance. */
  netPosition: number | null
  /** Sum of spending-role balances; null when none reports one. Up reports
   * available balances, so pending holds are already deducted. */
  spendingBalance: number | null
  /** HELD (pending) transactions on spending-role accounts. */
  pendingCount: number
  /** Their summed amount (negative when money is on hold). */
  pendingAmount: number
  /** Saver-role accounts with a balance, in the given account order. */
  savers: SaverBalance[]
  saversTotal: number
  /** Average daily spending over the trailing `burnDays` ending today; when
   * the data starts later, over the days since the first transaction.
   * null when there is no spending. */
  dailySpend: number | null
  /** netPosition / dailySpend; null when either is null or dailySpend is 0. */
  runwayDays: number | null
  /** End-of-day net position for each of the last `historyDays` days, oldest
   * first, ending with today. Reconstructed backwards from current balances:
   * value(D) = Σ balance − Σ amounts dated after D, per balance-reporting
   * account (HELD rows count; Up balances include holds). */
  history: Array<{ dateISO: string; value: number }>
}

export function computePosition(
  accounts: Account[],
  transactions: Transaction[],
  todayISO: string,
  opts: { burnDays?: number; historyDays?: number } = {},
): Position {
  const burnDays = opts.burnDays ?? 90
  const historyDays = opts.historyDays ?? 90
  const today = Date.parse(todayISO + "T12:00:00Z")
  const burnStartISO = dayISO(today, 1 - burnDays)
  const spendingIds = new Set(accounts.filter((a) => accountRole(a) === "spending").map((a) => a.id))
  const balancedAccounts = accounts.filter((a) => a.balance !== null)
  const balancedIds = new Set(balancedAccounts.map((a) => a.id))
  let netPosition: number | null = null
  let spendingBalance: number | null = null
  const savers: SaverBalance[] = []
  for (const account of balancedAccounts) {
    if (account.balance === null) continue
    netPosition = (netPosition ?? 0) + account.balance
    if (spendingIds.has(account.id)) {
      spendingBalance = (spendingBalance ?? 0) + account.balance
    } else {
      savers.push({ accountId: account.id, name: account.name, balance: account.balance })
    }
  }

  let pendingCount = 0
  let pendingAmount = 0
  let spent = 0
  let firstISO = todayISO
  let historyValue = netPosition ?? 0
  const amountsByDate = new Map<string, number>()
  for (const row of transactions) {
    if (row.dateISO < firstISO) firstISO = row.dateISO
    if (row.accountId !== null && balancedIds.has(row.accountId)) {
      amountsByDate.set(row.dateISO, (amountsByDate.get(row.dateISO) ?? 0) + row.amount)
      if (row.dateISO > todayISO) historyValue -= row.amount
    }
    if (row.accountId === null || !spendingIds.has(row.accountId)) continue
    if (row.status === "HELD") {
      pendingCount++
      pendingAmount += row.amount
    }
    if (isOrdinaryFlow(row) && row.amount < 0 && row.dateISO >= burnStartISO && row.dateISO <= todayISO) {
      spent -= row.amount
    }
  }
  const coveredDays = (today - Date.parse(firstISO + "T12:00:00Z")) / 86400000 + 1
  const dailySpend = spent > 0 ? spent / Math.min(burnDays, coveredDays) : null
  const history: Position["history"] = []
  for (let i = 0; i < historyDays; i++) {
    const dateISO = dayISO(today, -i)
    history.push({ dateISO, value: historyValue })
    historyValue -= amountsByDate.get(dateISO) ?? 0
  }
  history.reverse()
  return {
    netPosition,
    spendingBalance,
    pendingCount,
    pendingAmount,
    savers,
    saversTotal: savers.reduce((sum, saver) => sum + saver.balance, 0),
    dailySpend,
    runwayDays: netPosition === null || dailySpend === null || dailySpend === 0 ? null : netPosition / dailySpend,
    history,
  }
}

export interface PeriodFlows {
  /** Positive total of outflows from spending accounts in scope. */
  spent: number
  /** Total inflows to spending accounts in scope. */
  income: number
  /** income − spent. */
  net: number
  /** Net money moved from spending accounts into savers (positive = saved,
   * negative = withdrawn), from the spending side of internal transfers whose
   * counterpart is a saver. */
  savedToSavers: number
  /** (income − spent) / income × 100; null when income is 0. */
  savingsRate: number | null
  /** Non-internal, non-IGNORE transactions on spending accounts in scope. */
  txnCount: number
  /** Per saver: net amount that arrived in the period (from that saver's own
   * rows, internal or not, e.g. interest). In account order. */
  saverChanges: Array<{ accountId: number; change: number }>
}

/**
 * `transactions` are already limited to the timeframe and include every
 * tracked account. `spendingAccountIds` narrows spending/income to the
 * accounts in the dashboard's account scope; default = all spending-role
 * accounts.
 */
export function computePeriodFlows(
  accounts: Account[],
  transactions: Transaction[],
  spendingAccountIds?: ReadonlySet<number>,
): PeriodFlows {
  const spendingIds = new Set(accounts.filter((a) => accountRole(a) === "spending" && (spendingAccountIds === undefined || spendingAccountIds.has(a.id))).map((a) => a.id))
  const saverAmounts = new Map(accounts.filter((a) => accountRole(a) === "saver").map((a) => [a.id, 0]))
  let spent = 0
  let income = 0
  let savedToSavers = 0
  let txnCount = 0
  for (const row of transactions) {
    if (row.accountId === null) continue
    if (saverAmounts.has(row.accountId)) {
      saverAmounts.set(row.accountId, (saverAmounts.get(row.accountId) ?? 0) + row.amount)
    }
    if (!spendingIds.has(row.accountId)) continue
    if (row.internal && row.transferAccountId !== null && saverAmounts.has(row.transferAccountId)) {
      savedToSavers -= row.amount
    }
    if (!isOrdinaryFlow(row)) continue
    txnCount++
    if (row.amount < 0) spent -= row.amount
    if (row.amount > 0) income += row.amount
  }
  return {
    spent,
    income,
    net: income - spent,
    savedToSavers,
    savingsRate: income === 0 ? null : (income - spent) / income * 100,
    txnCount,
    saverChanges: [...saverAmounts].map(([accountId, change]) => ({ accountId, change })),
  }
}

function isOrdinaryFlow(row: Transaction): boolean {
  return !row.excluded && !row.tagNames.some((tag) => tag.toUpperCase() === "IGNORE")
}

function dayISO(today: number, offset: number): string {
  return new Date(today + offset * 86400000).toISOString().slice(0, 10)
}

export interface BalancePoint {
  dateISO: string
  /** All balance-reporting accounts. */
  net: number
  /** Spending-role accounts. */
  spending: number
  /** Saver-role accounts. */
  savers: number
}

/**
 * End-of-day balances for each day from `startISO` to `endISO` inclusive,
 * reconstructed backwards from current balances like `Position.history`:
 * value(D) = balance − Σ amounts dated after D, per balance-reporting account.
 */
export function balanceHistory(accounts: Account[], transactions: Transaction[], startISO: string, endISO: string): BalancePoint[] {
  const start = Date.parse(startISO + "T12:00:00Z")
  const end = Date.parse(endISO + "T12:00:00Z")
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return []
  const role = new Map(accounts.filter((a) => a.balance !== null).map((a) => [a.id, accountRole(a)]))
  let spending = 0
  let savers = 0
  for (const a of accounts) {
    if (a.balance === null) continue
    if (role.get(a.id) === "spending") spending += a.balance
    else savers += a.balance
  }
  const after = new Map<string, { spending: number; savers: number }>()
  for (const row of transactions) {
    if (row.accountId === null || !role.has(row.accountId)) continue
    if (row.dateISO <= endISO) {
      const day = after.get(row.dateISO) ?? { spending: 0, savers: 0 }
      if (role.get(row.accountId) === "spending") day.spending += row.amount
      else day.savers += row.amount
      after.set(row.dateISO, day)
    } else if (role.get(row.accountId) === "spending") spending -= row.amount
    else savers -= row.amount
  }
  const points: BalancePoint[] = []
  for (let t = end; t >= start; t -= 86400000) {
    const dateISO = new Date(t).toISOString().slice(0, 10)
    points.push({ dateISO, net: spending + savers, spending, savers })
    const day = after.get(dateISO)
    if (day) { spending -= day.spending; savers -= day.savers }
  }
  return points.reverse()
}
