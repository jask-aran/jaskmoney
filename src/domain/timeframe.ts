import { addDays, addMonths, appNow, daysBetween, MONTHS, parseDay, parseISODate, toISODay } from "./days"
import type { Transaction } from "./types"
import { cycleFor, type CycleConfig } from "./budget"
import { rangeDayFromText } from "./typedInput"

type LookbackId = "1M" | "2M" | "3M" | "6M" | "1Y"
export type PeriodId = "cycle" | "month" | "qtr" | "half" | "fy" | "year"
type TimeframeFamily = "lookback" | "period" | "custom"

const LOOKBACK_MONTHS: Record<LookbackId, number> = { "1M": 1, "2M": 2, "3M": 3, "6M": 6, "1Y": 12 }

export interface TimeframeState {
  family: TimeframeFamily
  lookback: LookbackId
  period: PeriodId
  periodAnchor: string
  custom: { start: string; end: string } | null
  lookbackOffset?: number
}

export const LOOKBACKS: LookbackId[] = ["1M", "2M", "3M", "6M", "1Y"]
export const PERIODS: PeriodId[] = ["cycle", "month", "qtr", "half", "fy", "year"]

export const PERIOD_LABEL: Record<PeriodId, string> = {
  cycle: "Budget",
  month: "Month",
  qtr: "QTR",
  half: "Half",
  fy: "FY",
  year: "Year",
}

const MONTHLY_CYCLE: CycleConfig = { unit: "month", anchor: "calendar", anchorDate: null }

export function defaultTimeframe(now: Date = appNow(), cycle: CycleConfig = MONTHLY_CYCLE): TimeframeState {
  return {
    family: "period",
    lookback: "1M",
    period: "cycle",
    periodAnchor: cycleFor(cycle, toISODay(now)).start,
    custom: null,
  }
}

interface DateBounds {
  start: string
  end: string
  label: string
}

export function timeframeBounds(tf: TimeframeState, now: Date, cycle: CycleConfig = MONTHLY_CYCLE): DateBounds {
  const day = toISODay(now)

  if (tf.family === "custom" && tf.custom) {
    return { start: tf.custom.start, end: tf.custom.end, label: formatDays(tf.custom.start, tf.custom.end) }
  }
  if (tf.family === "lookback") {
    const months = LOOKBACK_MONTHS[tf.lookback]
    const end = tf.lookbackOffset ? addMonths(day, tf.lookbackOffset * months) : day
    const start = addMonths(end, -months)
    return { start, end, label: formatDays(start, end) }
  }

  if (tf.period === "cycle") {
    const c = cycleFor(cycle, tf.periodAnchor)
    return { start: c.start, end: c.end, label: formatDays(c.start, c.end) }
  }
  const year = Number(tf.periodAnchor.slice(0, 4))
  const month = Number(tf.periodAnchor.slice(5, 7)) - 1
  let start: string
  let months: number
  switch (tf.period) {
    case "month":
      start = tf.periodAnchor.slice(0, 8) + "01"
      months = 1
      break
    case "qtr":
      start = `${year}-${String(Math.floor(month / 3) * 3 + 1).padStart(2, "0")}-01`
      months = 3
      break
    case "half":
      start = `${year}-${month < 6 ? "01" : "07"}-01`
      months = 6
      break
    case "fy":
      start = `${month >= 6 ? year : year - 1}-07-01`
      months = 12
      break
    case "year":
      start = `${year}-01-01`
      months = 12
      break
  }
  const end = addDays(addMonths(start, months), -1)
  return { start, end, label: periodLabel(tf.period, start, end) }
}

const yy = (iso: string) => iso.slice(2, 4)

function periodLabel(period: Exclude<PeriodId, "cycle">, start: string, end: string): string {
  const month = Number(start.slice(5, 7))
  switch (period) {
    case "month": return `${MONTHS[month - 1]} ${yy(start)}`
    case "qtr": return `Q${Math.floor((month - 1) / 3) + 1} ${yy(start)}`
    case "half": return `${month < 7 ? 1 : 2}H ${yy(start)}`
    case "fy": return `FY${yy(end)}`
    case "year": return start.slice(0, 4)
  }
}

function formatDays(start: string, end: string): string {
  const day = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`
  return start.slice(0, 4) === end.slice(0, 4)
    ? `${day(start)} – ${day(end)} '${yy(end)}`
    : `${day(start)} '${yy(start)} – ${day(end)} '${yy(end)}`
}

export function filterByTimeframe(
  rows: Transaction[],
  tf: TimeframeState,
  now: Date,
  cycle: CycleConfig = MONTHLY_CYCLE,
): Transaction[] {
  const b = timeframeBounds(tf, now, cycle)
  return rows.filter((r) => r.dateISO >= b.start && r.dateISO <= b.end)
}

export const CUSTOM_CHIP = LOOKBACKS.length + PERIODS.length

export function chipCount(): number {
  return CUSTOM_CHIP + 1
}

export function chipLabel(index: number): string {
  if (index < LOOKBACKS.length) return LOOKBACKS[index]!
  if (index === CUSTOM_CHIP) return "Custom"
  return PERIOD_LABEL[PERIODS[index - LOOKBACKS.length]!]
}

export function customRange(start: string, end: string): { start: string; end: string } | string {
  if (!parseDay(start) || Number(start.slice(0, 4)) < 1000) return "Start must be a date: YYYY-MM-DD"
  if (!parseDay(end) || Number(end.slice(0, 4)) < 1000) return "End must be a date: YYYY-MM-DD"
  if (end < start) return "End is before start"
  return { start, end }
}

export function readCustomRange(startText: string, endText: string, today: string):
  { start: string; end: string; label: string; days: number } | { error: string; field: "from" | "to" } {
  const start = rangeDayFromText(startText, today, "start")
  if (start === null) return { error: `From isn't a date: ${CUSTOM_DATE_FORMS}`, field: "from" }
  const end = rangeDayFromText(endText, today, "end")
  if (end === null) return { error: `To isn't a date: ${CUSTOM_DATE_FORMS}`, field: "to" }
  if (end < start) return { error: "To is before From", field: "to" }
  return { start, end, label: formatDays(start, end), days: daysBetween(start, end) + 1 }
}

export const CUSTOM_DATE_FORMS = "18/11, 1 oct, oct, -14, today"

export function applyChip(tf: TimeframeState, index: number, now: Date, cycle: CycleConfig = MONTHLY_CYCLE): TimeframeState {
  if (index < 0) index = 0
  const n = chipCount()
  if (index >= n) index = n - 1
  if (index === CUSTOM_CHIP) return tf.custom ? { ...tf, family: "custom" } : tf
  if (index < LOOKBACKS.length) {
    return { ...tf, family: "lookback", lookback: LOOKBACKS[index]!, lookbackOffset: 0 }
  }
  const period = PERIODS[index - LOOKBACKS.length]!
  const tmp: TimeframeState = {
    ...tf,
    family: "period",
    period,
    periodAnchor: toISODay(now),
  }
  const b = timeframeBounds(tmp, now, cycle)
  return { ...tmp, periodAnchor: b.start }
}

function stepCustom(tf: TimeframeState, delta: number): TimeframeState {
  if (tf.family !== "custom" || !tf.custom) return tf
  const shift = delta * (daysBetween(tf.custom.start, tf.custom.end) + 1)
  return { ...tf, custom: { start: addDays(tf.custom.start, shift), end: addDays(tf.custom.end, shift) } }
}

export function activeChipIndex(tf: TimeframeState): number {
  if (tf.family === "custom") return CUSTOM_CHIP
  if (tf.family === "lookback") return LOOKBACKS.indexOf(tf.lookback)
  return LOOKBACKS.length + PERIODS.indexOf(tf.period)
}

function stepPeriod(tf: TimeframeState, delta: number, cycle: CycleConfig = MONTHLY_CYCLE): TimeframeState {
  if (tf.family !== "period") return tf
  if (tf.period === "cycle") {
    let current = cycleFor(cycle, tf.periodAnchor)
    for (let i = 0; i < Math.abs(delta); i++) {
      const edge = addDays(delta < 0 ? current.start : current.end, delta < 0 ? -1 : 1)
      current = cycleFor(cycle, edge)
    }
    return { ...tf, periodAnchor: current.start }
  }
  const months = { month: 1, qtr: 3, half: 6, fy: 12, year: 12 }[tf.period]
  const anchor = addMonths(tf.periodAnchor, delta * months)
  const next = { ...tf, periodAnchor: anchor }
  const b = timeframeBounds(next, parseISODate(anchor), cycle)
  return { ...next, periodAnchor: b.start }
}

export function rangeOffsetLabel(tf: TimeframeState, now: Date, cycle: CycleConfig = MONTHLY_CYCLE): string {
  const offset = periodOffset(tf, now, cycle)
  if (tf.family !== "lookback") return offsetLabel(tf.period, offset)
  if (!offset) return ""
  const months = Math.abs(offset) * LOOKBACK_MONTHS[tf.lookback]
  const [n, unit] = months % 12 === 0 ? [months / 12, "year"] : [months, "month"]
  return `${n} ${unit}${n === 1 ? "" : "s"} ${offset < 0 ? "back" : "ahead"}`
}

function periodOffset(tf: TimeframeState, now: Date, cycle: CycleConfig = MONTHLY_CYCLE): number {
  if (tf.family === "lookback") return tf.lookbackOffset ?? 0
  if (tf.family !== "period") return 0
  const target = timeframeBounds(tf, now, cycle).start
  const current = applyChip(tf, LOOKBACKS.length + PERIODS.indexOf(tf.period), now, cycle)
  const start = timeframeBounds(current, now, cycle).start
  if (target === start) return 0
  const direction = target < start ? -1 : 1
  let at = current
  for (let steps = 1; steps <= 1000; steps++) {
    at = stepPeriod(at, direction, cycle)
    const atStart = timeframeBounds(at, now, cycle).start
    if (atStart === target) return direction * steps
    if (direction < 0 ? atStart < target : atStart > target) break
  }
  return 0
}

export function timeframeNow(tf: TimeframeState, now: Date, cycle: CycleConfig = MONTHLY_CYCLE): TimeframeState {
  if (tf.family === "period") return applyChip(tf, LOOKBACKS.length + PERIODS.indexOf(tf.period), now, cycle)
  if (tf.family === "lookback") return { ...tf, lookbackOffset: 0 }
  if (!tf.custom) return tf
  const today = toISODay(now)
  const shift = daysBetween(tf.custom.end, today)
  return { ...tf, custom: { start: addDays(tf.custom.start, shift), end: today } }
}

export function stepRange(tf: TimeframeState, delta: number, cycle: CycleConfig = MONTHLY_CYCLE): TimeframeState {
  if (tf.family === "period") return stepPeriod(tf, delta, cycle)
  if (tf.family === "lookback") return { ...tf, lookbackOffset: (tf.lookbackOffset ?? 0) + delta }
  return stepCustom(tf, delta)
}

export function stepUnit(tf: TimeframeState): string {
  if (tf.family === "period") return { cycle: "cycle", month: "month", qtr: "quarter", half: "half", fy: "FY", year: "year" }[tf.period]
  if (tf.family === "lookback") return { "1M": "month", "2M": "2 months", "3M": "3 months", "6M": "6 months", "1Y": "year" }[tf.lookback]
  return tf.custom ? `${daysBetween(tf.custom.start, tf.custom.end) + 1} days` : "range"
}

function offsetLabel(period: PeriodId, offset: number): string {
  if (!offset) return ""
  const unit = { cycle: "cycle", month: "month", qtr: "quarter", half: "half", fy: "FY", year: "year" }[period]
  const n = Math.abs(offset)
  return `${n} ${unit}${n === 1 || unit === "FY" ? "" : "s"} ${offset < 0 ? "back" : "ahead"}`
}

export function stepChip(tf: TimeframeState, delta: 1 | -1): number {
  const n = chipCount()
  let i = activeChipIndex(tf)
  do i = (i + delta + n) % n
  while (i === CUSTOM_CHIP)
  return i
}

export function comparisonWindows(startISO: string, endISO: string, todayISO: string): {
  days: number
  partial: boolean
  previous: { start: string; end: string }
} {
  const length = daysBetween(startISO, endISO) + 1
  const lastISO = todayISO < endISO ? todayISO : endISO
  const days = Math.max(0, daysBetween(startISO, lastISO) + 1)
  const previousStart = addDays(startISO, -length)
  return { days, partial: days < length, previous: { start: previousStart, end: addDays(previousStart, days - 1) } }
}

export const OPEN_RANGES = ["1M", "3M", "6M", "1Y", "cycle", "month", "last"] as const
export type OpenRange = typeof OPEN_RANGES[number]
export const DEFAULT_OPEN_RANGE: OpenRange = "1M"
export const OPEN_RANGE_LABELS: Record<OpenRange, string> = {
  "1M": "1M", "3M": "3M", "6M": "6M", "1Y": "1Y",
  cycle: "this budget cycle", month: "this month", last: "where you left it",
}

export function nextOpenRange(value: OpenRange = DEFAULT_OPEN_RANGE): OpenRange {
  return OPEN_RANGES[(OPEN_RANGES.indexOf(value) + 1) % OPEN_RANGES.length]!
}
