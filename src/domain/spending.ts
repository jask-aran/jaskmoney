import { addDays, dayOfWeek, daysBetween, type WeekStart } from "./days"
import { dailySpendSeries } from "./dashboard"
import type { Transaction } from "./types"

/**
 * Spending-tab aggregates. Callers pass the transactions to consider (already
 * limited to spending accounts); these functions apply the shared spending
 * rules: only outflows (amount < 0), never `excluded` rows (internal transfers
 * or a not-spending category), never rows tagged
 * IGNORE (case-insensitive). Amounts in results are positive dollars.
 */

export interface CalendarDay {
  dateISO: string
  spent: number
  /** 0 = no spending; 1–4 = quartile of the period's non-zero days (1 lowest). */
  level: 0 | 1 | 2 | 3 | 4
}

/**
 * Calendar heatmap for [startISO, endISO]: whole weeks, configured weekday first, as
 * columns of seven days. Days outside the range are null (padding in the first
 * and last week). Weeks are oldest first.
 */
export function spendingCalendar(transactions: Transaction[], startISO: string, endISO: string, weekStart: WeekStart = "monday"): Array<Array<CalendarDay | null>> {
  const days = daysBetween(startISO, endISO) + 1
  const { dates, values } = dailySpendSeries(transactions, startISO, endISO)
  const totals = new Map(dates.map((date, i) => [date, values[i]!]))
  const nonZero = values.filter((spent) => spent !== 0).sort((a, b) => a - b)
  const levels = new Map<number, CalendarDay["level"]>()
  nonZero.forEach((spent, index) => {
    if (levels.has(spent)) return
    const quartile = Math.ceil(4 * (index + 1) / nonZero.length)
    const level = quartile <= 1 ? 1 : quartile <= 2 ? 2 : quartile <= 3 ? 3 : 4
    levels.set(spent, level)
  })
  const padding = dayOfWeek(startISO, weekStart)
  const weeks: Array<Array<CalendarDay | null>> = []
  for (let offset = -padding; offset < days; offset += 7) {
    const week: Array<CalendarDay | null> = []
    for (let row = 0; row < 7; row++) {
      const day = offset + row
      if (day < 0 || day >= days) {
        week.push(null)
      } else {
        const dateISO = addDays(startISO, day)
        const spent = totals.get(dateISO) ?? 0
        week.push({ dateISO, spent, level: levels.get(spent) ?? 0 })
      }
    }
    weeks.push(week)
  }
  return weeks
}
