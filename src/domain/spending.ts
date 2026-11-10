import { addDays, dayOfWeek, daysBetween, type WeekStart } from "./days"
import { dailySpendSeries } from "./dashboard"
import type { Transaction } from "./types"

export interface CalendarDay {
  dateISO: string
  spent: number
  level: 0 | 1 | 2 | 3 | 4
  expected?: number
  outside?: true
  mark?: string
}

export function spendingCalendar(transactions: Transaction[], startISO: string, endISO: string, weekStart: WeekStart = "monday", options: { through?: string } = {}): Array<Array<CalendarDay | null>> {
  const shownEnd = options.through && options.through > endISO ? options.through : endISO
  const days = daysBetween(startISO, shownEnd) + 1
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
        if (dateISO > endISO) { week.push({ dateISO, spent: 0, level: 0, outside: true }); continue }
        const spent = totals.get(dateISO) ?? 0
        week.push({ dateISO, spent, level: levels.get(spent) ?? 0 })
      }
    }
    weeks.push(week)
  }
  return weeks
}
