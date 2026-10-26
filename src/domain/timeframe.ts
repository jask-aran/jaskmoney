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
export function defaultTimeframe(now: Date = new Date(), cycle: CycleConfig = MONTHLY_CYCLE): TimeframeState {
  return {
    family: "period",
    lookback: "1M",
    period: "cycle",
    periodAnchor: cycleFor(cycle, toISODate(now)).start,
    custom: null,
  }
}

export function toISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number)
  return new Date(y!, (m ?? 1) - 1, d ?? 1)
}

/** Data clock: prefer latest txn day so lookbacks hit fixture/ANZ ranges. */
export function dataClock(rows: Transaction[], fallback: Date = new Date()): Date {
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
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  if (tf.family === "custom" && tf.custom) {
    return { start: tf.custom.start, end: tf.custom.end, label: formatDays(tf.custom.start, tf.custom.end) }
  }
  if (tf.family === "lookback") {
    const end = day
    const start = new Date(day)
    switch (tf.lookback) {
      case "1M":
        start.setMonth(start.getMonth() - 1)
        break
      case "2M":
        start.setMonth(start.getMonth() - 2)
        break
      case "3M":
        start.setMonth(start.getMonth() - 3)
        break
      case "6M":
        start.setMonth(start.getMonth() - 6)
        break
      case "1Y":
        start.setFullYear(start.getFullYear() - 1)
        break
    }
    return {
      start: toISODate(start),
      end: toISODate(end),
      label: formatRange(toISODate(start), toISODate(end)),
    }
  }

  // period family
  if (tf.period === "cycle") {
    const c = cycleFor(cycle, tf.periodAnchor)
    return { start: c.start, end: c.end, label: formatDays(c.start, c.end) }
  }
  let start = parseISODate(tf.periodAnchor)
  start = new Date(start.getFullYear(), start.getMonth(), start.getDate())
  let endExcl: Date
  switch (tf.period) {
    case "month":
      start = new Date(start.getFullYear(), start.getMonth(), 1)
      endExcl = new Date(start.getFullYear(), start.getMonth() + 1, 1)
      break
    case "qtr": {
      const q = Math.floor(start.getMonth() / 3) * 3
      start = new Date(start.getFullYear(), q, 1)
      endExcl = new Date(start.getFullYear(), start.getMonth() + 3, 1)
      break
    }
    case "half": {
      const h = start.getMonth() < 6 ? 0 : 6
      start = new Date(start.getFullYear(), h, 1)
      endExcl = new Date(start.getFullYear(), start.getMonth() + 6, 1)
      break
    }
    case "fy": {
      // AU FY Jul–Jun
      const y = start.getMonth() >= 6 ? start.getFullYear() : start.getFullYear() - 1
      start = new Date(y, 6, 1)
      endExcl = new Date(y + 1, 6, 1)
      break
    }
    case "year":
    default:
      start = new Date(start.getFullYear(), 0, 1)
      endExcl = new Date(start.getFullYear() + 1, 0, 1)
      break
  }
  const endIncl = new Date(endExcl)
  endIncl.setDate(endIncl.getDate() - 1)
  return {
    start: toISODate(start),
    end: toISODate(endIncl),
    label: formatRange(toISODate(start), toISODate(endIncl)),
  }
}

/** "1 Oct – 31 Oct 2026", or "16 Dec 2026 – 15 Jan 2027" across years. */
function formatDays(start: string, end: string): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  const day = (iso: string) => `${Number(iso.slice(8, 10))} ${months[Number(iso.slice(5, 7)) - 1]}`
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
  const d = parseISODate(iso)
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  return `${months[d.getMonth()]} ${d.getFullYear()}`
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
  const valid = (iso: string) => /^\d{4}-\d{2}-\d{2}$/.test(iso) && toISODate(parseISODate(iso)) === iso
  if (!valid(start)) return "Start must be a date: YYYY-MM-DD"
  if (!valid(end)) return "End must be a date: YYYY-MM-DD"
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
    periodAnchor: toISODate(now),
  }
  const b = timeframeBounds(tmp, now, cycle)
  return { ...tmp, periodAnchor: b.start }
}

/** A custom range moved by its own length: `delta` ranges back or forward. */
export function stepCustom(tf: TimeframeState, delta: number): TimeframeState {
  if (tf.family !== "custom" || !tf.custom) return tf
  const day = (iso: string) => Date.parse(iso + "T12:00:00Z")
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10)
  const length = Math.round((day(tf.custom.end) - day(tf.custom.start)) / 86400000) + 1
  const shift = delta * length * 86400000
  return { ...tf, custom: { start: iso(day(tf.custom.start) + shift), end: iso(day(tf.custom.end) + shift) } }
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
      const edge = Date.parse((delta < 0 ? current.start : current.end) + "T12:00:00Z") + (delta < 0 ? -1 : 1) * 86400000
      current = cycleFor(cycle, new Date(edge).toISOString().slice(0, 10))
    }
    return { ...tf, periodAnchor: current.start }
  }
  const start = parseISODate(tf.periodAnchor)
  switch (tf.period) {
    case "month":
      start.setMonth(start.getMonth() + delta)
      break
    case "qtr":
      start.setMonth(start.getMonth() + delta * 3)
      break
    case "half":
      start.setMonth(start.getMonth() + delta * 6)
      break
    case "fy":
      start.setFullYear(start.getFullYear() + delta)
      break
    case "year":
      start.setFullYear(start.getFullYear() + delta)
      break
  }
  const next = { ...tf, periodAnchor: toISODate(start) }
  const b = timeframeBounds(next, start, cycle)
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
  const day = (iso: string) => Date.parse(iso + "T12:00:00Z")
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10)
  const length = Math.round((day(endISO) - day(startISO)) / 86400000) + 1
  const lastISO = todayISO < endISO ? todayISO : endISO
  const days = Math.max(0, Math.round((day(lastISO) - day(startISO)) / 86400000) + 1)
  const previousStart = day(startISO) - length * 86400000
  return { days, partial: days < length, previous: { start: iso(previousStart), end: iso(previousStart + (days - 1) * 86400000) } }
}
