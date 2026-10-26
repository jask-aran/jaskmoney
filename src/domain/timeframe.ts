import { addDays, addMonths, appNow, daysBetween, MONTHS, parseDay, parseISODate, toISODay } from "./days"
import type { Transaction } from "./types"
import { cycleFor, type CycleConfig } from "./budget"

export type LookbackId = "1M" | "2M" | "3M" | "6M" | "1Y"
export type PeriodId = "cycle" | "month" | "qtr" | "half" | "fy" | "year"
export type TimeframeFamily = "lookback" | "period" | "custom"

export interface TimeframeState {
  family: TimeframeFamily
  lookback: LookbackId
  period: PeriodId
  /** YYYY-MM-DD start of active period instance (period family). */
  periodAnchor: string
  /** The last custom range entered, inclusive (custom family); kept while
   * another family is active so the Custom chip can return to it. */
  custom: { start: string; end: string } | null
}

export const LOOKBACKS: LookbackId[] = ["1M", "2M", "3M", "6M", "1Y"]
export const PERIODS: PeriodId[] = ["cycle", "month", "qtr", "half", "fy", "year"]

export const PERIOD_LABEL: Record<PeriodId, string> = {
  cycle: "Cycle",
  month: "Month",
  qtr: "QTR",
  half: "Half",
  fy: "FY",
  year: "Year",
}

/** Calendar months: the budget cycle when none is configured. */
export const MONTHLY_CYCLE: CycleConfig = { unit: "month", anchor: "calendar", anchorDate: null }

/** The budget cycle containing `now`. */
export function defaultTimeframe(now: Date = appNow(), cycle: CycleConfig = MONTHLY_CYCLE): TimeframeState {
  return {
    family: "period",
    lookback: "1M",
    period: "cycle",
    periodAnchor: cycleFor(cycle, toISODay(now)).start,
    custom: null,
  }
}

/** Compatibility export for the local calendar date formatter. */
export { toISODay as toISODate } from "./days"

/** Compatibility export for callers that need a local Date. */
export { parseISODate } from "./days"

/** Data clock: prefer latest txn day so lookbacks hit fixture/ANZ ranges. */
export function dataClock(rows: Transaction[], fallback: Date = appNow()): Date {
  let max = ""
  for (const r of rows) {
    if (r.dateISO > max) max = r.dateISO
  }
  if (!max) return fallback
  return parseISODate(max)
}

export interface DateBounds {
  start: string // inclusive YYYY-MM-DD
  end: string // inclusive YYYY-MM-DD
  label: string
}

export function timeframeBounds(tf: TimeframeState, now: Date, cycle: CycleConfig = MONTHLY_CYCLE): DateBounds {
  const day = toISODay(now)

  if (tf.family === "custom" && tf.custom) {
    return { start: tf.custom.start, end: tf.custom.end, label: formatDays(tf.custom.start, tf.custom.end) }
  }
  if (tf.family === "lookback") {
    const months = { "1M": 1, "2M": 2, "3M": 3, "6M": 6, "1Y": 12 }[tf.lookback]
    const start = addMonths(day, -months)
    return { start, end: day, label: formatRange(start, day) }
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
  // Convert the internal exclusive end to the inclusive public bound.
  const end = addDays(addMonths(start, months), -1)
  return { start, end, label: formatRange(start, end) }
}

/** "1 Oct – 31 Oct 2026", or "16 Dec 2026 – 15 Jan 2027" across years. */
function formatDays(start: string, end: string): string {
  const day = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`
  return start.slice(0, 4) === end.slice(0, 4)
    ? `${day(start)} – ${day(end)} ${end.slice(0, 4)}`
    : `${day(start)} ${start.slice(0, 4)} – ${day(end)} ${end.slice(0, 4)}`
}

function formatRange(start: string, end: string): string {
  // One month reads "Aug 2026", not "Aug 2026 – Aug 2026".
  if (pretty(start) === pretty(end)) return pretty(start)
  return `${pretty(start)} – ${pretty(end)}`
}

function pretty(iso: string): string {
  return `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(0, 4))}`
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

/** The Custom chip's index: after the lookbacks and periods. */
export const CUSTOM_CHIP = LOOKBACKS.length + PERIODS.length

/** Chips: lookbacks, periods, then Custom. */
export function chipCount(): number {
  return CUSTOM_CHIP + 1
}

export function chipLabel(index: number): string {
  if (index < LOOKBACKS.length) return LOOKBACKS[index]!
  if (index === CUSTOM_CHIP) return "Custom"
  return PERIOD_LABEL[PERIODS[index - LOOKBACKS.length]!]
}

/**
 * A custom range from two typed dates (YYYY-MM-DD), or an error message:
 * both must be real dates and the end not before the start (Go app).
 */
export function customRange(start: string, end: string): { start: string; end: string } | string {
  // Preserve the original local-Date round trip: years need four digits.
  if (!parseDay(start) || Number(start.slice(0, 4)) < 1000) return "Start must be a date: YYYY-MM-DD"
  if (!parseDay(end) || Number(end.slice(0, 4)) < 1000) return "End must be a date: YYYY-MM-DD"
  if (end < start) return "End is before start"
  return { start, end }
}

export function applyChip(tf: TimeframeState, index: number, now: Date, cycle: CycleConfig = MONTHLY_CYCLE): TimeframeState {
  if (index < 0) index = 0
  const n = chipCount()
  if (index >= n) index = n - 1
  // Custom returns to the last range entered; without one, nothing changes
  // (the caller asks for dates).
  if (index === CUSTOM_CHIP) return tf.custom ? { ...tf, family: "custom" } : tf
  if (index < LOOKBACKS.length) {
    return { ...tf, family: "lookback", lookback: LOOKBACKS[index]! }
  }
  const period = PERIODS[index - LOOKBACKS.length]!
  // Snap anchor to current period start containing `now`
  const tmp: TimeframeState = {
    ...tf,
    family: "period",
    period,
    periodAnchor: toISODay(now),
  }
  const b = timeframeBounds(tmp, now, cycle)
  return { ...tmp, periodAnchor: b.start }
}

/** A custom range moved by its own length: `delta` ranges back or forward. */
export function stepCustom(tf: TimeframeState, delta: number): TimeframeState {
  if (tf.family !== "custom" || !tf.custom) return tf
  const shift = delta * (daysBetween(tf.custom.start, tf.custom.end) + 1)
  return { ...tf, custom: { start: addDays(tf.custom.start, shift), end: addDays(tf.custom.end, shift) } }
}

export function activeChipIndex(tf: TimeframeState): number {
  if (tf.family === "custom") return CUSTOM_CHIP
  if (tf.family === "lookback") return LOOKBACKS.indexOf(tf.lookback)
  return LOOKBACKS.length + PERIODS.indexOf(tf.period)
}

export function stepPeriod(tf: TimeframeState, delta: number, cycle: CycleConfig = MONTHLY_CYCLE): TimeframeState {
  if (tf.family !== "period") return tf
  if (tf.period === "cycle") {
    // Step a cycle at a time: the cycle containing the day before this one's
    // start, or the day after its end.
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
  // Period bounds use the anchor, not the clock, for the period family.
  const b = timeframeBounds(next, parseISODate(anchor), cycle)
  return { ...next, periodAnchor: b.start }
}

/** How many steps a period is from the one containing `now`: negative
 * back, positive ahead, 0 for the current one (and for other families). */
export function periodOffset(tf: TimeframeState, now: Date, cycle: CycleConfig = MONTHLY_CYCLE): number {
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

/** The same kind of range, now: a period's current instance, a custom range
 * moved to end today (same length); a lookback already ends today. */
export function timeframeNow(tf: TimeframeState, now: Date, cycle: CycleConfig = MONTHLY_CYCLE): TimeframeState {
  if (tf.family === "period") return applyChip(tf, LOOKBACKS.length + PERIODS.indexOf(tf.period), now, cycle)
  if (tf.family !== "custom" || !tf.custom) return tf
  const today = toISODay(now)
  const shift = daysBetween(tf.custom.end, today)
  return { ...tf, custom: { start: addDays(tf.custom.start, shift), end: today } }
}

/** "2 cycles back", "1 quarter ahead"; "" for the current period. */
export function offsetLabel(period: PeriodId, offset: number): string {
  if (!offset) return ""
  const unit = { cycle: "cycle", month: "month", qtr: "quarter", half: "half", fy: "FY", year: "year" }[period]
  const n = Math.abs(offset)
  return `${n} ${unit}${n === 1 || unit === "FY" ? "" : "s"} ${offset < 0 ? "back" : "ahead"}`
}

/** The next (or previous) chip to apply when stepping through them directly:
 * every chip in order, Custom only once a custom range exists. */
export function stepChip(tf: TimeframeState, delta: 1 | -1): number {
  const n = chipCount()
  let i = activeChipIndex(tf)
  do i = (i + delta + n) % n
  while (i === CUSTOM_CHIP && !tf.custom)
  return i
}

/**
 * The part of [startISO, endISO] up to today, and the same stretch of the
 * previous period (the window of equal length ending the day before
 * startISO): both cover the period's first `days` days, all of them once the
 * period is over. `partial` is true while the period is still running.
 */
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
