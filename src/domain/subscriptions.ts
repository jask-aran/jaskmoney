import { addDays, daysBetween } from "./days"
import { isSpending } from "./moneyRules"
import { median, regularCharges } from "./tagGroups"
import type { Transaction } from "./types"

/** A regular payment as the Overview's Subscriptions view shows it. */
export interface Subscription {
  name: string
  cadence: string
  /** The latest charge (positive). */
  amount: number
  /** What it costs a month at the latest charge. */
  monthly: number
  /** Dates (YYYY-MM-DD): the latest charge, and the next one expected. */
  last: string
  next: string
  /** Charges stopped: none for a while after the next was due. */
  stopped: boolean
  /** The price changed lately: from what, to what (the latest), and since when. */
  change: { from: number; to: number; since: string } | null
}

/** A change is news this long after it starts. */
const CHANGE_NEWS_DAYS = 180
/** A price moves when it moves by at least this much (dollars, share). */
const CHANGE_MIN = { dollars: 0.5, share: 0.02 }

/**
 * Regular spending payments (domain/tagGroups regularCharges), active ones
 * by monthly cost, then the ones that stopped lately (within two of their
 * gaps after the charge they missed). A payment is stopped once a quarter
 * of its gap (at least 5 days) has passed after the next charge was due.
 */
export function subscriptions(transactions: readonly Transaction[], today: string): Subscription[] {
  const out: Subscription[] = []
  for (const { name, cadence, charges } of regularCharges(transactions.filter(isSpending))) {
    const latest = charges.at(-1)!
    const every = Math.round(median(charges.slice(1).map((row, i) => daysBetween(charges[i]!.dateISO, row.dateISO))))
    const next = addDays(latest.dateISO, every)
    const late = daysBetween(next, today)
    const stopped = late > Math.max(5, Math.round(every / 4))
    if (stopped && late > 2 * every) continue
    const amount = Math.abs(latest.amount)
    out.push({ name, cadence: cadence.name, amount, monthly: amount * cadence.perMonth, last: latest.dateISO, next, stopped, change: priceChange(charges, today) })
  }
  return out.sort((a, b) => Number(a.stopped) - Number(b.stopped) || b.monthly - a.monthly || a.name.localeCompare(b.name))
}

/** The latest amount against the one before it, when it moved lately. */
function priceChange(charges: Transaction[], today: string): Subscription["change"] {
  const amounts = charges.map((row) => Math.abs(row.amount))
  const to = amounts.at(-1)!
  const moved = (a: number) => Math.abs(a - to) >= Math.max(CHANGE_MIN.dollars, to * CHANGE_MIN.share)
  let at = amounts.length - 1
  while (at > 0 && !moved(amounts[at - 1]!)) at--
  if (at === 0) return null
  const since = charges[at]!.dateISO
  return daysBetween(since, today) <= CHANGE_NEWS_DAYS ? { from: amounts[at - 1]!, to, since } : null
}

/** Active subscriptions' total a month. */
export function monthlyTotal(list: readonly Subscription[]): number {
  return list.reduce((sum, s) => sum + (s.stopped ? 0 : s.monthly), 0)
}
