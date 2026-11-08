import { addDays, dayOfWeek, daysBetween, type WeekStart } from "./days"
import { groupByMerchant } from "./merchants"
import { isSpending } from "./moneyRules"
import { computeCategorySpend, groupCategorySpend, type CategoryGroupSpend } from "./dashboard"
import type { Category, Transaction } from "./types"

/**
 * The Overview's table views, both drawn from the Date Range: Trends (the
 * range's spending by category group, a month a row, or a week a row when
 * it's two months or less) and Merchants (where the range's spending went,
 * against the period before).
 */

/** Ranges this many days or fewer go a week a row. */
const WEEKLY_UP_TO = 62
/** Trends names this many groups; the rest are "Other". */
const TREND_GROUPS = 5

export interface TrendGroup {
  /** The group's category; null for Uncategorised, and for Other. */
  categoryId: number | null
  name: string
  color: string
}

export interface TrendRow {
  /** "Oct 2026", or the week's first day in the range ("3 Oct"). */
  label: string
  start: string
  end: string
  /** Spent in each of Trends' groups, in their order (Other last). */
  amounts: number[]
  total: number
  /** Cut short: by the range's ends, or still running today. */
  partial: boolean
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** The range's months (or weeks), oldest first, none after today. */
function buckets(start: string, end: string, today: string, weekStart: WeekStart) {
  const weekly = daysBetween(start, end) + 1 <= WEEKLY_UP_TO
  const last = end < today ? end : today
  const out: Array<{ label: string; start: string; end: string; partial: boolean }> = []
  let at = start
  while (at <= last) {
    const whole = weekly
      ? { start: addDays(at, -dayOfWeek(at, weekStart)), end: addDays(at, 6 - dayOfWeek(at, weekStart)) }
      : { start: `${at.slice(0, 8)}01`, end: addDays(`${nextMonth(at)}-01`, -1) }
    const to = whole.end < end ? whole.end : end
    const [y, m, d] = (weekly ? at : whole.start).split("-").map(Number)
    out.push({
      label: weekly ? `${d} ${MONTHS[m! - 1]}` : `${MONTHS[m! - 1]} ${y}`, start: at, end: to,
      partial: at !== whole.start || to !== whole.end || (today >= at && today < whole.end),
    })
    at = addDays(to, 1)
  }
  return out
}

/** "2026-10-14" → "2026-11". */
function nextMonth(iso: string): string {
  const y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7))
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`
}

/** The range's spending (`rows`: the scope's, in the range) a month or a
 * week at a time, split by category group as the Categories card groups it:
 * the range's TREND_GROUPS biggest groups, then Other. */
export function trendRows(rows: Transaction[], categories: Category[], start: string, end: string, today: string, weekStart: WeekStart): { groups: TrendGroup[]; rows: TrendRow[] } {
  const all = groupCategorySpend(computeCategorySpend(rows, categories), categories)
  const named = all.slice(0, TREND_GROUPS)
  const groups: TrendGroup[] = [
    ...named.map((g) => ({ categoryId: g.categoryId, name: g.name, color: g.color })),
    ...(all.length > TREND_GROUPS ? [{ categoryId: null, name: "Other", color: "" }] : []),
  ]
  const slot = (g: CategoryGroupSpend) => {
    const i = named.findIndex((n) => n.categoryId === g.categoryId && n.name === g.name)
    return i >= 0 ? i : TREND_GROUPS
  }
  return {
    groups,
    rows: buckets(start, end, today, weekStart).map((b) => {
      const amounts = groups.map(() => 0)
      const spend = groupCategorySpend(computeCategorySpend(rows.filter((t) => t.dateISO >= b.start && t.dateISO <= b.end), categories), categories)
      for (const g of spend) amounts[slot(g)] = (amounts[slot(g)] ?? 0) + g.amount
      return { ...b, amounts, total: amounts.reduce((n, a) => n + a, 0) }
    }),
  }
}

export interface MerchantRow {
  merchant: string
  count: number
  /** Spent there in the range (positive; refunds taken off). */
  spent: number
  /** Spent there in the period before; null when the history doesn't
   * cover it (so no comparison). */
  before: number | null
  categoryId: number | null
}

/** The range's spending by merchant (Up's cleaned name), most first. `before`
 * is the comparison period's spending rows, or null when the history
 * doesn't cover it. Only spending counts: transfers and income don't. */
export function merchantRows(rows: Transaction[], before: Transaction[] | null): MerchantRow[] {
  const spent = (list: Transaction[]) => list.filter(isSpending)
  const then = before ? new Map(groupByMerchant(spent(before)).map((g) => [g.merchant, -g.total])) : null
  return groupByMerchant(spent(rows))
    .map((g) => ({ merchant: g.merchant, count: g.count, spent: -g.total, before: then ? then.get(g.merchant) ?? 0 : null, categoryId: g.categoryId }))
    .filter((r) => r.spent > 0)
    .sort((a, b) => b.spent - a.spent || a.merchant.localeCompare(b.merchant))
}
