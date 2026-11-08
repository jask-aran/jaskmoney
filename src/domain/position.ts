import { addDays, daysBetween, dayTime } from "./days"
import { reconstructHistory } from "./balanceHistory"
import { isHeld, isIncome, isOrdinaryFlow, isSpending } from "./moneyRules"
import { accountRole, type Account, type Transaction } from "./types"

/**
 * Overview analytics for synced accounts.
 *
 * Position is point-in-time ("now") and ignores the Date Range. Period
 * flows describe the selected range. Both share these rules:
 * - Only tracked accounts are passed in (sync-disabled accounts never are).
 * - `excluded` transactions (internal transfers between tracked accounts, or a
 *   category marked not-spending) are never spending or income.
 * - `internal` transactions move money between tracked accounts and are never
 *   spending or income. A transfer to an untracked account (e.g. a desynced
 *   joint account that pays rent) is ordinary spending.
 * - Rows tagged IGNORE (case-insensitive) are excluded from spending and
 *   income, matching computeCategorySpend.
 * - Spending and income come from spending-role accounts only
 *   (`accountRole(account) === "spending"`), except that a saver's income
 *   (interest) counts when every spending account is in scope.
 * - Income is the income categories; spending is money out plus refunds
 *   into spending categories; uncategorised money in is neither (see
 *   moneyRules).
 */

interface SaverBalance {
  accountId: number
  name: string
  balance: number
}

interface Position {
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
  const burnStartISO = addDays(todayISO, 1 - burnDays)
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
  const historyAmounts: Array<[string, number]> = []
  for (const row of transactions) {
    if (row.dateISO < firstISO) firstISO = row.dateISO
    if (row.accountId !== null && balancedIds.has(row.accountId)) {
      historyAmounts.push([row.dateISO, row.amount])
    }
    if (row.accountId === null || !spendingIds.has(row.accountId)) continue
    if (isHeld(row)) {
      pendingCount++
      pendingAmount += row.amount
    }
    if (isSpending(row) && row.dateISO >= burnStartISO && row.dateISO <= todayISO) {
      spent -= row.amount
    }
  }
  const coveredDays = daysBetween(firstISO, todayISO) + 1
  const dailySpend = spent > 0 ? spent / Math.min(burnDays, coveredDays) : null
  const history = reconstructHistory(netPosition ?? 0, historyAmounts, todayISO, historyDays)
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

interface PeriodFlows {
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
  const { spendingIds, saverIncome, saverIds } = flowScope(accounts, spendingAccountIds)
  const saverAmounts = new Map([...saverIds].map((id) => [id, 0]))
  let spent = 0
  let income = 0
  let savedToSavers = 0
  let txnCount = 0
  for (const row of transactions) {
    if (row.accountId === null) continue
    if (saverAmounts.has(row.accountId)) {
      saverAmounts.set(row.accountId, (saverAmounts.get(row.accountId) ?? 0) + row.amount)
      if (saverIncome && isIncome(row)) income += row.amount
      continue
    }
    if (!spendingIds.has(row.accountId)) continue
    if (row.internal && row.transferAccountId !== null && saverAmounts.has(row.transferAccountId)) {
      savedToSavers -= row.amount
    }
    if (!isOrdinaryFlow(row)) continue
    txnCount++
    if (isSpending(row)) spent -= row.amount
    if (isIncome(row)) income += row.amount
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

/** Which accounts a period's flows count: the spending accounts in scope,
 * and savers (whose interest is income only when every spending account
 * is in scope: it belongs to them all, not to one). */
function flowScope(accounts: Account[], spendingAccountIds?: ReadonlySet<number>) {
  const spending = accounts.filter((a) => accountRole(a) === "spending")
  const spendingIds = new Set(spending.filter((a) => spendingAccountIds === undefined || spendingAccountIds.has(a.id)).map((a) => a.id))
  const saverIds = new Set(accounts.filter((a) => accountRole(a) === "saver").map((a) => a.id))
  return { spendingIds, saverIds, saverIncome: spendingIds.size === spending.length }
}

/** The rows computePeriodFlows counts as money spent and as money in, by
 * the same rules: the rows behind a chart's bars, to say what made one
 * tall. */
export function flowRows(accounts: Account[], transactions: Transaction[], spendingAccountIds?: ReadonlySet<number>): { spent: Transaction[]; income: Transaction[] } {
  const { spendingIds, saverIds, saverIncome } = flowScope(accounts, spendingAccountIds)
  const spent: Transaction[] = [], income: Transaction[] = []
  for (const row of transactions) {
    if (row.accountId === null) continue
    if (saverIds.has(row.accountId)) {
      if (saverIncome && isIncome(row)) income.push(row)
      continue
    }
    if (!spendingIds.has(row.accountId) || !isOrdinaryFlow(row)) continue
    if (isSpending(row)) spent.push(row)
    if (isIncome(row)) income.push(row)
  }
  return { spent, income }
}

/** The earliest date in `rows`: where their history starts. */
export function historyStart(rows: readonly Transaction[]): string | null {
  return rows.reduce<string | null>((first, t) => (first == null || t.dateISO < first ? t.dateISO : first), null)
}

/** Whether `rows` cover the `earlier` days well enough to compare them
 * with the `later` ones: rows on at least half as many days, day for day.
 * A few stray old rows (an import's leftovers) don't make a period. */
export function historyCovers(rows: readonly Transaction[], earlier: { start: string; end: string }, later: { start: string; end: string }): boolean {
  const days = (w: { start: string; end: string }) => new Set(rows.filter((t) => t.dateISO >= w.start && t.dateISO <= w.end).map((t) => t.dateISO)).size
  const length = (w: { start: string; end: string }) => Math.max(1, daysBetween(w.start, w.end) + 1)
  const now = days(later) / length(later)
  return now === 0 || days(earlier) / length(earlier) >= now / 2
}

/** The largest of `rows` dated `start` to `end` (inclusive) by size: what
 * most explains a day's, week's or month's figure. */
export function biggestRow(rows: Transaction[], start: string, end: string): Transaction | undefined {
  let best: Transaction | undefined
  for (const row of rows) if (row.dateISO >= start && row.dateISO <= end && (!best || Math.abs(row.amount) > Math.abs(best.amount))) best = row
  return best
}

/** Who `rows` dated `start` to `end` came from or went to most, by the
 * size of all their rows together (two pays from one employer are one
 * payee): what most explains a bar. */
export function biggestPayee(rows: Transaction[], start: string, end: string): { name: string; amount: number } | undefined {
  const by = new Map<string, number>()
  for (const row of rows) if (row.dateISO >= start && row.dateISO <= end) by.set(row.description, (by.get(row.description) ?? 0) + Math.abs(row.amount))
  let best: { name: string; amount: number } | undefined
  for (const [name, amount] of by) if (!best || amount > best.amount) best = { name, amount }
  return best
}

interface BalancePoint {
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
  if (!Number.isFinite(dayTime(startISO)) || !Number.isFinite(dayTime(endISO)) || dayTime(endISO) < dayTime(startISO)) return []
  const role = new Map(accounts.filter((a) => a.balance !== null).map((a) => [a.id, accountRole(a)]))
  let spending = 0
  let savers = 0
  for (const a of accounts) {
    if (a.balance === null) continue
    if (role.get(a.id) === "spending") spending += a.balance
    else savers += a.balance
  }
  const spendingAmounts: Array<[string, number]> = []
  const saverAmounts: Array<[string, number]> = []
  for (const row of transactions) {
    if (row.accountId === null || !role.has(row.accountId)) continue
    const amounts = role.get(row.accountId) === "spending" ? spendingAmounts : saverAmounts
    amounts.push([row.dateISO, row.amount])
  }
  const days = daysBetween(startISO, endISO) + 1
  const spendingHistory = reconstructHistory(spending, spendingAmounts, endISO, days)
  const saverHistory = reconstructHistory(savers, saverAmounts, endISO, days)
  return spendingHistory.map((point, index) => {
    const savers = saverHistory[index]!.value
    return { dateISO: point.dateISO, net: point.value + savers, spending: point.value, savers }
  })
}

/** One saver's end-of-day balances, as `balanceHistory` reconstructs them. */
interface SaverHistory {
  accountId: number
  name: string
  /** Today's balance. */
  balance: number
  /** One per day from `startISO` to `endISO`, oldest first. */
  values: number[]
}

/** Each saver-role account with a balance, in account order: its balance
 * on each day from `startISO` to `endISO` inclusive. */
export function saverHistories(accounts: Account[], transactions: Transaction[], startISO: string, endISO: string): SaverHistory[] {
  if (!Number.isFinite(dayTime(startISO)) || !Number.isFinite(dayTime(endISO)) || dayTime(endISO) < dayTime(startISO)) return []
  const savers = accounts.filter((a) => a.balance !== null && accountRole(a) !== "spending")
  const amounts = new Map(savers.map((a) => [a.id, [] as Array<[string, number]>]))
  for (const row of transactions) if (row.accountId !== null) amounts.get(row.accountId)?.push([row.dateISO, row.amount])
  const days = daysBetween(startISO, endISO) + 1
  return savers.map((a) => ({
    accountId: a.id,
    name: a.name,
    balance: a.balance!,
    values: reconstructHistory(a.balance!, amounts.get(a.id)!, endISO, days).map((p) => p.value),
  }))
}

/**
 * What a usual day costs the spending accounts, for looking ahead: the last
 * `days` days' spending without the regular payments (`regularIds`, which
 * come on their own days), the biggest tenth of the days left out so a
 * one-off doesn't count as usual. 0 with no spending.
 */
export function usualDailySpend(accounts: Account[], transactions: Transaction[], todayISO: string, regularIds: ReadonlySet<number>, days = 90): number {
  const spendingIds = new Set(accounts.filter((a) => accountRole(a) === "spending").map((a) => a.id))
  const first = transactions.reduce((min, row) => (row.dateISO < min ? row.dateISO : min), todayISO)
  const start = addDays(todayISO, 1 - Math.min(days, daysBetween(first, todayISO) + 1))
  const spent = new Map<string, number>()
  for (let d = start; d <= todayISO; d = addDays(d, 1)) spent.set(d, 0)
  for (const row of transactions) {
    if (row.accountId === null || !spendingIds.has(row.accountId) || regularIds.has(row.id) || !spent.has(row.dateISO) || !isSpending(row)) continue
    spent.set(row.dateISO, spent.get(row.dateISO)! - row.amount)
  }
  const usual = [...spent.values()].sort((a, b) => a - b).slice(0, spent.size - Math.floor(spent.size / 10))
  return Math.max(0, usual.reduce((sum, v) => sum + v, 0) / usual.length)
}

/**
 * Where Available is headed: from today's balance, each day to `untilISO`
 * (the day before the next payday) less a usual day (usualDailySpend) and
 * the regular payments due that day. One value per day after today, in
 * order.
 */
export function projectAvailable(
  available: number,
  todayISO: string,
  untilISO: string,
  usualDay: number,
  charges: ReadonlyArray<{ dateISO: string; amount: number }>,
): Array<{ dateISO: string; value: number }> {
  const out: Array<{ dateISO: string; value: number }> = []
  // Charges due today and not yet taken come off first.
  let value = available - charges.filter((c) => c.dateISO <= todayISO).reduce((sum, c) => sum + c.amount, 0)
  for (let d = addDays(todayISO, 1); d <= untilISO; d = addDays(d, 1)) {
    value -= usualDay + charges.filter((c) => c.dateISO === d).reduce((sum, c) => sum + c.amount, 0)
    out.push({ dateISO: d, value })
  }
  return out
}
