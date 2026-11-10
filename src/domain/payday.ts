import { isIncome } from "./moneyRules"
import { accountRole, type Account, type Transaction } from "./types"

const spendingIds = (accounts: Account[]) => new Set(accounts.filter((a) => accountRole(a) === "spending").map((a) => a.id))
const saverIds = (accounts: Account[]) => new Set(accounts.filter((a) => accountRole(a) === "saver").map((a) => a.id))
const isPay = (spending: Set<number>) => (t: Transaction) =>
  t.accountId != null && spending.has(t.accountId) && isIncome(t) && t.amount > 0 && t.categoryName === "Salary"

interface CyclePay {
  dateISO: string | null
  pay: number
  sent: number
  sends: Array<{ dateISO: string; amount: number }>
  paydays: string[]
}

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

export function usualPay(accounts: Account[], transactions: Transaction[], count = 6): number | null {
  const pay = isPay(spendingIds(accounts))
  const byDay = new Map<string, number>()
  for (const t of transactions) if (pay(t)) byDay.set(t.dateISO, (byDay.get(t.dateISO) ?? 0) + t.amount)
  const recent = [...byDay].sort(([a], [b]) => a.localeCompare(b)).slice(-count).map(([, a]) => a).sort((a, b) => a - b)
  if (!recent.length) return null
  const mid = Math.floor(recent.length / 2)
  return recent.length % 2 ? recent[mid]! : (recent[mid - 1]! + recent[mid]!) / 2
}
