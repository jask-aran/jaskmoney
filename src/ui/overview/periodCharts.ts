/** Chart models for the Overview's chart pane. Pure: each returns a
 * ChartModel for ChartBody. */
import { theme } from "../../theme"
import { cumulative, dailySpendSeries, formatWholeMoney, signedWholeMoney, weeklyTotals } from "../../domain/dashboard"
import { balanceHistory, computePeriodFlows } from "../../domain/position"
import type { Account, Transaction } from "../../domain/types"
import { shortDate, shortMoney } from "../text"
import { barTopRow, columnBars } from "../charts/bars"
import { muted } from "../primitives/spans"
import type { ChartModel } from "../charts/ChartBody"
import { annotate, type ChartLabel } from "../charts/annotate"
import { dateAxis, lineChart, niceRange, niceScale, pointCell, tickRows } from "../charts/lineChart"

export const INKS: Record<string, string> = {
  spend: theme.peach,
  partial: theme.overlay1,
  prev: theme.overlay0,
  ref: theme.surface2,
  in: theme.success,
  out: theme.error,
  limit: theme.yellow,
  balance: theme.lavender,
  savers: theme.green,
  // Gridlines, as in the Go app.
  week: theme.surface1,
  month: theme.blue,
  year: theme.accent,
  today: theme.green,
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0)

/** Legend marks: a line series, a bar, a rule. */
const LINE = "⠒⠒ "
const BAR = "▆ "
const RULE = "┈┈ "
const GAP = muted("   ")

/** What the range and the one before it are called in legends and labels. */
export interface PeriodNames {
  current: string
  previous: string
}
const DEFAULT_NAMES: PeriodNames = { current: "This period", previous: "Last period" }

/** "2026-10-05" shifted by `days`. */
export function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso + "T12:00:00Z") + days * 86400000).toISOString().slice(0, 10)
}

/**
 * The Spending Tracker in one of its views, over the period's `dates`:
 * - Daily: spend per day as bars, with the period's daily average so far.
 * - Cumulative: running total against the previous period of equal length
 *   (and `budget`, when given).
 * - Weekly: totals per Monday-start week; partial weeks in grey.
 * Days after today are not drawn.
 */
export function spendingChart(
  view: "Daily" | "Cumulative" | "Weekly",
  series: { dates: string[]; values: number[] },
  width: number,
  height: number,
  todayISO: string,
  spendingRows: Transaction[],
  /** Cumulative only: a spending limit drawn as a rule and named in the legend. */
  budget?: number,
  names: PeriodNames = DEFAULT_NAMES,
): ChartModel {
  const { dates, values } = series
  const n = dates.length
  const elapsed = dates.filter((d) => d <= todayISO).length
  const upToToday = (vs: number[]) => vs.map((v, i) => (i < elapsed ? v : null))
  const axis = dateAxis(dates, width, todayISO)
  if (n === 0) return { rows: [], ticks: new Map(), labels: "", legend: [muted("No days in range")] }

  if (view === "Weekly") {
    const weeks = weeklyTotals(dates, values)
    const scale = niceScale(Math.max(0, ...weeks.map((w) => w.total)))
    const bars = weeks.map((w) => ({ value: w.startISO <= todayISO ? w.total : 0, ink: w.days < 7 || addDays(w.startISO, 6) >= todayISO ? "partial" : "spend" }))
    const { rows: plain, slots } = columnBars(bars, width, height, scale.max)
    // Each week's total over its bar, where it fits.
    const rows = annotate(plain, slots.map((slot, i) => ({ row: barTopRow(bars[i]!.value, scale.max, height), col: slot.col + Math.floor((slot.width - 1) / 2), text: bars[i]!.value > 0 ? shortMoney(bars[i]!.value) : "", ink: bars[i]!.ink, above: true })).filter((l) => l.text && l.row > 0))
    const line = new Array<string>(width).fill(" ")
    slots.forEach((slot, i) => {
      const iso = weeks[i]!.startISO
      const label = slot.width >= 6 ? shortDate(iso) : String(Number(iso.slice(8, 10)))
      if (label.length <= slot.width + (slot.width > 2 ? 1 : 0)) {
        for (let c = 0; c < label.length && slot.col + c < width; c++) line[slot.col + c] = label[c]!
      }
    })
    const full = weeks.filter((w, i) => bars[i]!.ink === "spend")
    const current = weeks.find((w) => w.startISO <= todayISO && addDays(w.startISO, 6) >= todayISO)
    return {
      rows,
      ticks: tickRows(0, scale.max, scale.step, height, shortMoney),
      labels: line.join(""),
      legend: [
        { text: BAR, fg: theme.peach },
        muted(full.length ? `Weeks, avg ${formatWholeMoney(sum(full.map((w) => w.total)) / full.length)}` : "No full weeks yet"),
        ...(current ? [GAP, { text: BAR, fg: theme.overlay1 }, muted(`This week ${formatWholeMoney(current.total)} so far`)] : []),
      ],
    }
  }

  if (view === "Cumulative") {
    const total = cumulative(values)
    const prevStart = addDays(dates[0]!, -n)
    const prev = cumulative(dailySpendSeries(spendingRows, prevStart, addDays(dates[0]!, -1)).values)
    const now = elapsed > 0 ? total[elapsed - 1]! : 0
    const then = elapsed > 0 ? prev[elapsed - 1] ?? 0 : 0
    const scale = niceScale(Math.max(now, budget ?? 0, ...prev))
    const diff = then > 0 ? Math.round(((now - then) / then) * 100) : null
    const limit = budget != null ? [{ values: dates.map(() => budget), ink: "limit" }] : []
    // Each line named at its end, the budget on its rule.
    const at = (index: number, value: number) => pointCell(index, value, n, width, height, 0, scale.max)
    const marks: ChartLabel[] = [
      ...(elapsed > 0 ? [{ ...at(elapsed - 1, now), text: names.current, ink: "spend" }] : []),
      ...(prev.length ? [{ ...at(n - 1, prev[n - 1]!), text: names.previous, ink: "prev" }] : []),
      ...(budget != null ? [{ ...at(n - 1, budget), text: "Budget", ink: "limit" }] : []),
    ]
    return {
      rows: annotate(lineChart({ series: [...limit, { values: prev, ink: "prev" }, { values: upToToday(total), ink: "spend" }], length: n, width, height, min: 0, max: scale.max, markers: axis.markers }), marks),
      ticks: tickRows(0, scale.max, scale.step, height, shortMoney),
      labels: axis.labels,
      legend: [
        { text: LINE, fg: theme.peach },
        muted(`${names.current} ${formatWholeMoney(now)}`),
        ...(budget != null ? [muted(` of ${formatWholeMoney(budget)}`)] : []),
        GAP,
        { text: LINE, fg: theme.overlay0 },
        muted(`${names.previous} ${formatWholeMoney(then)}${elapsed < n ? " by now" : ""}`),
        ...(diff != null ? [GAP, { text: `${diff > 0 ? "+" : ""}${diff}%`, fg: diff > 0 ? theme.error : theme.success }] : []),
      ],
    }
  }

  // Daily: a bar per day (today's in grey, as the day isn't over); a long
  // period averages its days into one bar per column.
  const shown = values.slice(0, elapsed)
  const avg = elapsed ? sum(shown) / elapsed : 0
  const peak = shown.reduce((best, v, i) => (v > shown[best]! ? i : best), 0)
  let bars: Array<{ value: number; ink: string }>
  let colOf: (i: number) => number
  // Where a marker goes: today's rule runs through its own bar's column;
  // week and month rules sit in the gap before their day's bar.
  let markerCol: (index: number, ink: string) => number
  let used: number
  if (n <= width) {
    const slot = Math.floor(width / n)
    // The closing month end sits in the gap after the last bar.
    markerCol = (i, ink) => (ink === "today" || slot === 1 ? i * slot : i === n - 1 ? i * slot + slot - 1 : i * slot - 1)
    bars = dates.map((d, i) => ({ value: i < elapsed ? values[i]! : 0, ink: d === todayISO ? "partial" : "spend" }))
    colOf = (i) => i * slot
    used = (n - 1) * slot + (slot > 1 ? slot - 1 : 1)
  } else {
    const bucketOf = (i: number) => Math.floor((i * width) / n)
    const sums = new Array<number>(width).fill(0), counts = new Array<number>(width).fill(0)
    shown.forEach((v, i) => { sums[bucketOf(i)]! += v; counts[bucketOf(i)]!++ })
    bars = sums.map((total, b) => ({ value: counts[b] ? total / counts[b]! : 0, ink: "spend" }))
    colOf = bucketOf
    markerCol = bucketOf
    used = width
  }
  const scale = niceScale(Math.max(0, ...bars.map((b) => b.value)))
  const { rows: plain, slots } = columnBars(bars, width, height, scale.max, { value: avg, ink: "ref" }, axis.markers.map((m) => ({ col: markerCol(m.index, m.ink), ink: m.ink })))
  // The tallest bar's value over it, and the average at the end of its rule.
  const tallest = bars.reduce((best, b, i) => (b.value > bars[best]!.value ? i : best), 0)
  const avgRow = avg > 0 ? height - 1 - Math.min(height - 1, Math.floor((avg / scale.max) * height)) : -1
  const marks: ChartLabel[] = [
    ...(bars[tallest]!.value > 0 && slots[tallest] ? [{ row: barTopRow(bars[tallest]!.value, scale.max, height), col: slots[tallest]!.col, text: shortMoney(bars[tallest]!.value), ink: "spend", above: true }] : []),
    ...(avgRow >= 0 ? [{ row: avgRow, col: width - 1 - "avg".length - 2, text: "avg", ink: "partial" }] : []),
  ]
  return {
    rows: annotate(plain, marks),
    ticks: tickRows(0, scale.max, scale.step, height, shortMoney),
    labels: dateAxis(dates, used, todayISO, colOf).labels,
    legend: [
      { text: BAR, fg: theme.peach },
      muted(n > width ? "Spent per day (averaged)" : "Spent per day"),
      ...(shown[peak] ? [muted(`, peak ${formatWholeMoney(shown[peak]!)} on ${shortDate(dates[peak]!)}`)] : []),
      GAP,
      { text: RULE, fg: theme.surface2 },
      muted(`Average ${formatWholeMoney(avg)}`),
    ],
  }
}

/** End-of-day balances over the period's `dates` (up to today) for one view:
 * everything, spending accounts, or savers. */
export function balancesChart(
  view: "Net position" | "Available" | "Savers",
  dates: string[],
  width: number,
  height: number,
  todayISO: string,
  accounts: Account[],
  transactions: Transaction[],
): ChartModel {
  const last = dates.filter((d) => d <= todayISO).at(-1)
  if (!dates.length || !last) return { rows: [], ticks: new Map(), labels: "", legend: [muted("No balances in range")] }
  const history = balanceHistory(accounts, transactions, dates[0]!, last)
  const pick = (p: (typeof history)[number]) => (view === "Available" ? p.spending : view === "Savers" ? p.savers : p.net)
  const values = history.map(pick)
  const lo = Math.min(...values), hi = Math.max(...values)
  const range = niceRange(lo, hi)
  const axis = dateAxis(dates, width, todayISO)
  const change = values[values.length - 1]! - values[0]!
  const low = values.indexOf(lo)
  // The low and the high marked where they happened (not at the ends,
  // which the legend and the axis already give).
  const high = values.indexOf(hi)
  const ink = view === "Savers" ? "savers" : "balance"
  const at = (i: number) => pointCell(i, values[i]!, dates.length, width, height, range.min, range.max)
  const marks: ChartLabel[] = [
    ...(high > 0 && high < values.length - 1 && hi > lo ? [{ ...at(high), text: shortMoney(hi), ink }] : []),
    ...(low > 0 && low < values.length - 1 && hi > lo ? [{ ...at(low), text: shortMoney(lo), ink }] : []),
  ]
  return {
    rows: annotate(lineChart({ series: [{ values, ink }], length: dates.length, width, height, min: range.min, max: range.max, markers: axis.markers }), marks),
    ticks: tickRows(range.min, range.max, range.step, height, shortMoney),
    labels: axis.labels,
    legend: [
      { text: LINE, fg: view === "Savers" ? theme.green : theme.lavender },
      muted(`${view} ${formatWholeMoney(values[values.length - 1]!)}`),
      GAP,
      { text: signedWholeMoney(change), fg: Math.abs(change) < 0.5 ? theme.overlay1 : change > 0 ? theme.success : theme.error },
      muted(` since ${shortDate(dates[0]!)}`),
      GAP,
      muted(`low ${formatWholeMoney(lo)} on ${shortDate(history[low]!.dateISO)}`),
    ],
  }
}


/**
 * Cash flow over the period's `dates`: money in (green) beside money out (red)
 * per Monday-start week, or per calendar month when the period is longer than
 * about three months, by the same rules as the Date Range flows (internal
 * transfers and not-spending categories excluded; `scopeIds` narrows to the
 * selected spending accounts). Buckets after today are empty.
 */
export function cashFlowChart(
  dates: string[],
  width: number,
  height: number,
  todayISO: string,
  accounts: Account[],
  transactions: Transaction[],
  scopeIds: ReadonlySet<number>,
): ChartModel {
  if (!dates.length) return { rows: [], ticks: new Map(), labels: "", legend: [muted("No days in range")] }
  const monthly = dates.length > 92
  const buckets: Array<{ start: string; end: string }> = []
  for (const iso of dates) {
    const monday = (new Date(iso + "T12:00:00Z").getUTCDay() + 6) % 7 === 0
    const newBucket = !buckets.length || (monthly ? iso.slice(8, 10) === "01" : monday)
    if (newBucket) buckets.push({ start: iso, end: iso })
    else buckets[buckets.length - 1]!.end = iso
  }
  const first = dates[0]!, last = dates[dates.length - 1]!
  const inRange = transactions.filter((t) => t.dateISO >= first && t.dateISO <= last)
  const flows = buckets.map((b) => computePeriodFlows(accounts, inRange.filter((t) => t.dateISO >= b.start && t.dateISO <= b.end), scopeIds))
  const scale = niceScale(Math.max(0, ...flows.flatMap((f) => [f.income, f.spent])))
  const bars = flows.flatMap((f, i) => {
    const future = buckets[i]!.start > todayISO
    return [{ value: future ? 0 : f.income, ink: "in" }, { value: future ? 0 : f.spent, ink: "out" }]
  })
  const { rows, slots } = columnBars(bars, width, height, scale.max)
  // A label under each pair: the month, or the week's start.
  const line = new Array<string>(width).fill(" ")
  let free = 0
  buckets.forEach((b, i) => {
    const slot = slots[i * 2]
    if (!slot) return
    const label = monthly ? MONTH_NAMES[Number(b.start.slice(5, 7)) - 1]! : shortDate(b.start)
    if (slot.col < free || slot.col + label.length > width) return
    for (let c = 0; c < label.length; c++) line[slot.col + c] = label[c]!
    free = slot.col + label.length + 1
  })
  const income = sum(flows.map((f) => f.income)), spent = sum(flows.map((f) => f.spent))
  const net = income - spent
  return {
    rows,
    ticks: tickRows(0, scale.max, scale.step, height, shortMoney),
    labels: line.join(""),
    legend: [
      { text: BAR, fg: theme.success },
      muted(`In ${formatWholeMoney(income)}`),
      GAP,
      { text: BAR, fg: theme.error },
      muted(`Out ${formatWholeMoney(spent)}`),
      GAP,
      muted(`Net ${signedWholeMoney(net)} · ${monthly ? "monthly" : "weekly"}`),
    ],
  }
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
