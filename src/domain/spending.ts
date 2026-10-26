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
export function spendingCalendar(transactions: Transaction[], startISO: string, endISO: string, weekStart: "monday" | "sunday" = "monday"): Array<Array<CalendarDay | null>> {
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
  const padding = (new Date(start).getUTCDay() + (weekStart === "sunday" ? 0 : 6)) % 7
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
  return row.amount < 0 && !row.excluded && !row.tagNames.some((tag) => tag.toUpperCase() === "IGNORE")
}

function dayISO(today: number, offset: number): string {
  return new Date(today + offset * 86400000).toISOString().slice(0, 10)
}
