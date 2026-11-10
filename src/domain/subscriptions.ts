import { addDays, addMonthsClamped, daysBetween } from "./days"
import { isSpending } from "./moneyRules"
import { median, regularCharges } from "./tagGroups"
import type { Transaction } from "./types"

export interface Subscription {
  name: string
  cadence: string
  amount: number
  monthly: number
  last: string
  next: string
  stopped: boolean
  change: { from: number; to: number; since: string } | null
  categoryId: number | null
  chargeIds: number[]
}

const CHANGE_NEWS_DAYS = 180
const CHANGE_MIN = { dollars: 0.5, share: 0.02 }

export function subscriptions(transactions: readonly Transaction[], today: string, { people = false } = {}): Subscription[] {
  const out: Subscription[] = []
  for (const { name, cadence, charges, payments } of regularCharges(transactions.filter(isSpending), { people })) {
    const latest = payments.at(-1)!
    const every = Math.round(median(payments.slice(1).map((p, i) => daysBetween(payments[i]!.dateISO, p.dateISO))))
    const next = addDays(latest.dateISO, every)
    const late = daysBetween(next, today)
    const stopped = late > Math.max(5, Math.round(every / 4))
    if (stopped && late > 2 * every) continue
    const amount = latest.amount
    out.push({
      name, cadence: cadence.name, amount, monthly: amount * cadence.perMonth, last: latest.dateISO, next, stopped,
      change: priceChange(payments, today), categoryId: charges.at(-1)!.categoryId, chargeIds: charges.map((row) => row.id),
    })
  }
  return out.sort((a, b) => Number(a.stopped) - Number(b.stopped) || b.monthly - a.monthly || a.name.localeCompare(b.name))
}

function priceChange(payments: Array<{ dateISO: string; amount: number }>, today: string): Subscription["change"] {
  const amounts = payments.map((p) => p.amount)
  const to = amounts.at(-1)!
  const moved = (a: number) => Math.abs(a - to) >= Math.max(CHANGE_MIN.dollars, to * CHANGE_MIN.share)
  let at = amounts.length - 1
  while (at > 0 && !moved(amounts[at - 1]!)) at--
  if (at === 0) return null
  const since = payments[at]!.dateISO
  return daysBetween(since, today) <= CHANGE_NEWS_DAYS ? { from: amounts[at - 1]!, to, since } : null
}

export function monthlyTotal(list: readonly Subscription[]): number {
  return list.reduce((sum, s) => sum + (s.stopped ? 0 : s.monthly), 0)
}

const STEP: Record<string, { days?: number; months?: number }> = {
  weekly: { days: 7 }, fortnightly: { days: 14 }, monthly: { months: 1 }, quarterly: { months: 3 }, yearly: { months: 12 },
}

export function upcomingCharges(list: readonly Subscription[], fromISO: string, toISO: string): Array<{ name: string; dateISO: string; amount: number }> {
  const out: Array<{ name: string; dateISO: string; amount: number }> = []
  for (const s of list) {
    if (s.stopped) continue
    const step = STEP[s.cadence]
    if (!step) continue
    for (let k = 0, at = s.next; at <= toISO && k < 60; k++) {
      if (at >= fromISO || k === 0) out.push({ name: s.name, dateISO: at < fromISO ? fromISO : at, amount: s.amount })
      at = step.days ? addDays(s.next, step.days * (k + 1)) : addMonthsClamped(s.next, step.months! * (k + 1))
    }
  }
  return out.sort((a, b) => a.dateISO.localeCompare(b.dateISO))
}
