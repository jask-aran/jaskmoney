import type { Transaction } from "./types"

/**
 * Spending-tab aggregates. Callers pass the transactions to consider (already
 * limited to spending accounts); these functions apply the shared spending
 * rules: only outflows (amount < 0), never `internal` rows, never rows tagged
 * IGNORE (case-insensitive). Amounts in results are positive dollars.
 */

export interface MerchantSummary {
  /** Grouping key: the description as stored (Up's cleaned merchant name). */
  merchant: string
  count: number
  total: number
  average: number
  /** Latest dateISO in the period. */
  lastISO: string
  /** Total over the previous period of the same length (the days immediately
   * before startISO); 0 when there was none. */
  previousTotal: number
  /** Most common categoryName among its rows in the period (ties: the one with
   * the larger total, then alphabetical). */
  categoryName: string
}

/**
 * Merchants with spending in [startISO, endISO] (inclusive), largest total
 * first (ties: more transactions, then merchant name). `previousTotal` uses
 * the same rules over the preceding window of equal length, so `transactions`
 * should cover both windows.
 */
export function merchantSummaries(transactions: Transaction[], startISO: string, endISO: string): MerchantSummary[] {
  const start = Date.parse(startISO + "T12:00:00Z")
  const days = (Date.parse(endISO + "T12:00:00Z") - start) / 86400000 + 1
  const previousStartISO = dayISO(start, -days)
  const previous = new Map<string, number>()
  const merchants = new Map<string, { summary: MerchantSummary; categories: Map<string, { count: number; total: number }> }>()
  for (const row of transactions) {
    if (!isSpending(row) || row.dateISO < previousStartISO || row.dateISO > endISO) continue
    if (row.dateISO < startISO) {
      previous.set(row.description, (previous.get(row.description) ?? 0) - row.amount)
      continue
    }
    let entry = merchants.get(row.description)
    if (!entry) {
      entry = {
        summary: { merchant: row.description, count: 0, total: 0, average: 0, lastISO: row.dateISO, previousTotal: 0, categoryName: "" },
        categories: new Map(),
      }
      merchants.set(row.description, entry)
    }
    entry.summary.count++
    entry.summary.total -= row.amount
    if (row.dateISO > entry.summary.lastISO) entry.summary.lastISO = row.dateISO
    const category = entry.categories.get(row.categoryName) ?? { count: 0, total: 0 }
    category.count++
    category.total -= row.amount
    entry.categories.set(row.categoryName, category)
  }
  return [...merchants.values()].map(({ summary, categories }) => {
    summary.average = summary.total / summary.count
    summary.previousTotal = previous.get(summary.merchant) ?? 0
    summary.categoryName = [...categories].sort(([a, x], [b, y]) =>
      y.count - x.count || y.total - x.total || a.localeCompare(b))[0][0]
    return summary
  }).sort((a, b) => b.total - a.total || b.count - a.count || a.merchant.localeCompare(b.merchant))
}

export interface CalendarDay {
  dateISO: string
  spent: number
  /** 0 = no spending; 1–4 = quartile of the period's non-zero days (1 lowest). */
  level: 0 | 1 | 2 | 3 | 4
}

/**
 * Calendar heatmap for [startISO, endISO]: whole weeks, Monday first, as
 * columns of seven days. Days outside the range are null (padding in the first
 * and last week). Weeks are oldest first.
 */
export function spendingCalendar(transactions: Transaction[], startISO: string, endISO: string): Array<Array<CalendarDay | null>> {
  const start = Date.parse(startISO + "T12:00:00Z")
  const days = (Date.parse(endISO + "T12:00:00Z") - start) / 86400000 + 1
  const totals = new Map<string, number>()
  for (const row of transactions) {
    if (isSpending(row) && row.dateISO >= startISO && row.dateISO <= endISO) {
      totals.set(row.dateISO, (totals.get(row.dateISO) ?? 0) - row.amount)
    }
  }
  const nonZero = [...totals.values()].sort((a, b) => a - b)
  const levels = new Map<number, CalendarDay["level"]>()
  nonZero.forEach((spent, index) => {
    if (levels.has(spent)) return
    const quartile = Math.ceil(4 * (index + 1) / nonZero.length)
    const level = quartile <= 1 ? 1 : quartile <= 2 ? 2 : quartile <= 3 ? 3 : 4
    levels.set(spent, level)
  })
  const padding = (new Date(start).getUTCDay() + 6) % 7
  const weeks: Array<Array<CalendarDay | null>> = []
  for (let offset = -padding; offset < days; offset += 7) {
    const week: Array<CalendarDay | null> = []
    for (let row = 0; row < 7; row++) {
      const day = offset + row
      if (day < 0 || day >= days) {
        week.push(null)
      } else {
        const dateISO = dayISO(start, day)
        const spent = totals.get(dateISO) ?? 0
        week.push({ dateISO, spent, level: levels.get(spent) ?? 0 })
      }
    }
    weeks.push(week)
  }
  return weeks
}

function isSpending(row: Transaction): boolean {
  return row.amount < 0 && !row.internal && !row.tagNames.some((tag) => tag.toUpperCase() === "IGNORE")
}

function dayISO(today: number, offset: number): string {
  return new Date(today + offset * 86400000).toISOString().slice(0, 10)
}
