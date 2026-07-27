import type { Transaction } from "./types"

export type LookbackId = "1M" | "2M" | "3M" | "6M" | "1Y"
export type PeriodId = "month" | "qtr" | "half" | "fy" | "year"
export type TimeframeFamily = "lookback" | "period"

export interface TimeframeState {
  family: TimeframeFamily
  lookback: LookbackId
  period: PeriodId
  /** YYYY-MM-DD start of active period instance (period family). */
  periodAnchor: string
}

export const LOOKBACKS: LookbackId[] = ["1M", "2M", "3M", "6M", "1Y"]
export const PERIODS: PeriodId[] = ["month", "qtr", "half", "fy", "year"]

export const PERIOD_LABEL: Record<PeriodId, string> = {
  month: "Month",
  qtr: "QTR",
  half: "Half",
  fy: "FY",
  year: "Year",
}

export function defaultTimeframe(now: Date = new Date()): TimeframeState {
  const anchor = new Date(now.getFullYear(), now.getMonth(), 1)
  return {
    family: "period",
    lookback: "1M",
    period: "month",
    periodAnchor: toISODate(anchor),
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

export function timeframeBounds(tf: TimeframeState, now: Date): DateBounds {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate())

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

function formatRange(start: string, end: string): string {
  if (start === end) return pretty(start)
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
): Transaction[] {
  const b = timeframeBounds(tf, now)
  return rows.filter((r) => r.dateISO >= b.start && r.dateISO <= b.end)
}

/** Chip index 0..lookbacks+periods-1 (+ custom later). */
export function chipCount(): number {
  return LOOKBACKS.length + PERIODS.length
}

export function chipLabel(index: number): string {
  if (index < LOOKBACKS.length) return LOOKBACKS[index]!
  return PERIOD_LABEL[PERIODS[index - LOOKBACKS.length]!]
}

export function applyChip(tf: TimeframeState, index: number, now: Date): TimeframeState {
  if (index < 0) index = 0
  const n = chipCount()
  if (index >= n) index = n - 1
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
  const b = timeframeBounds(tmp, now)
  return { ...tmp, periodAnchor: b.start }
}

export function activeChipIndex(tf: TimeframeState): number {
  if (tf.family === "lookback") return LOOKBACKS.indexOf(tf.lookback)
  return LOOKBACKS.length + PERIODS.indexOf(tf.period)
}

export function stepPeriod(tf: TimeframeState, delta: number): TimeframeState {
  if (tf.family !== "period") return tf
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
  const b = timeframeBounds(next, start)
  return { ...next, periodAnchor: b.start }
}
