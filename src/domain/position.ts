import { addDays, daysBetween, dayTime } from "./days"
import { isHeld, isIncome, isOrdinaryFlow, isSpending } from "./moneyRules"
import { accountRole, type Account, type Transaction } from "./types"

function reconstructHistory(
  balance: number,
  amounts: Iterable<readonly [dateISO: string, amount: number]>,
  endISO: string,
  days: number,
): Array<{ dateISO: string; value: number }> {
  let value = balance
  const amountsByDate = new Map<string, number>()
  for (const [dateISO, amount] of amounts) {
    if (dateISO > endISO) value -= amount
    else amountsByDate.set(dateISO, (amountsByDate.get(dateISO) ?? 0) + amount)
  }
  const history: Array<{ dateISO: string; value: number }> = []
  for (let i = 0; i < days; i++) {
    const dateISO = addDays(endISO, -i)
    history.push({ dateISO, value })
    value -= amountsByDate.get(dateISO) ?? 0
  }
  return history.reverse()
}

interface SaverBalance {
  accountId: number
  name: string
  balance: number
}

interface Position {
  netPosition: number | null
  spendingBalance: number | null
  pendingCount: number
  pendingAmount: number
  savers: SaverBalance[]
  saversTotal: number
  dailySpend: number | null
  runwayDays: number | null
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
  spent: number
  income: number
  net: number
  savedToSavers: number
  savingsRate: number | null
  txnCount: number
  saverChanges: Array<{ accountId: number; change: number }>
}

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

function flowScope(accounts: Account[], spendingAccountIds?: ReadonlySet<number>) {
  const spending = accounts.filter((a) => accountRole(a) === "spending")
  const spendingIds = new Set(spending.filter((a) => spendingAccountIds === undefined || spendingAccountIds.has(a.id)).map((a) => a.id))
  const saverIds = new Set(accounts.filter((a) => accountRole(a) === "saver").map((a) => a.id))
  return { spendingIds, saverIds, saverIncome: spendingIds.size === spending.length }
}

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

export function historyStart(rows: readonly Transaction[]): string | null {
  return rows.reduce<string | null>((first, t) => (first == null || t.dateISO < first ? t.dateISO : first), null)
}

export function historyCovers(rows: readonly Transaction[], earlier: { start: string; end: string }, later: { start: string; end: string }): boolean {
  const days = (w: { start: string; end: string }) => new Set(rows.filter((t) => t.dateISO >= w.start && t.dateISO <= w.end).map((t) => t.dateISO)).size
  const length = (w: { start: string; end: string }) => Math.max(1, daysBetween(w.start, w.end) + 1)
  const now = days(later) / length(later)
  return now === 0 || days(earlier) / length(earlier) >= now / 2
}

export function biggestRow(rows: Transaction[], start: string, end: string): Transaction | undefined {
  let best: Transaction | undefined
  for (const row of rows) if (row.dateISO >= start && row.dateISO <= end && (!best || Math.abs(row.amount) > Math.abs(best.amount))) best = row
  return best
}

export function biggestPayee(rows: Transaction[], start: string, end: string): { name: string; amount: number } | undefined {
  const by = new Map<string, number>()
  for (const row of rows) if (row.dateISO >= start && row.dateISO <= end) by.set(row.description, (by.get(row.description) ?? 0) + Math.abs(row.amount))
  let best: { name: string; amount: number } | undefined
  for (const [name, amount] of by) if (!best || amount > best.amount) best = { name, amount }
  return best
}

interface BalancePoint {
  dateISO: string
  net: number
  spending: number
  savers: number
}

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

interface SaverHistory {
  accountId: number
  name: string
  balance: number
  values: number[]
}

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

export function projectAvailable(
  available: number,
  todayISO: string,
  untilISO: string,
  usualDay: number,
  charges: ReadonlyArray<{ dateISO: string; amount: number }>,
): Array<{ dateISO: string; value: number }> {
  const out: Array<{ dateISO: string; value: number }> = []
  let value = available - charges.filter((c) => c.dateISO <= todayISO).reduce((sum, c) => sum + c.amount, 0)
  for (let d = addDays(todayISO, 1); d <= untilISO; d = addDays(d, 1)) {
    value -= usualDay + charges.filter((c) => c.dateISO === d).reduce((sum, c) => sum + c.amount, 0)
    out.push({ dateISO: d, value })
  }
  return out
}
