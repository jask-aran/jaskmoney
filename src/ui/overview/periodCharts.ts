/** Chart models for the Overview's chart pane. Pure: each returns a
 * ChartModel for ChartBody. */
import { theme } from "../../theme"
import { cumulative, dailySpendSeries, formatWholeMoney, signedWholeMoney, weeklyTotals } from "../../domain/dashboard"
import { balanceHistory, computePeriodFlows } from "../../domain/position"
import type { Account, Transaction } from "../../domain/types"
import { MONTHS, addDays, dayOfWeek, type WeekStart } from "../../domain/days"
import { shortDate, shortMoney } from "../text"
import { barTopRow, columnBars } from "../charts/bars"
import { muted, type Span } from "../primitives/spans"
import { changeColor, spendChangeColor } from "../colors"
import type { ChartModel } from "../charts/ChartBody"
import { annotate, type ChartLabel } from "../charts/annotate"
import { dateAxis, fitRange, lineChart, niceScale, pointCell, tickRows } from "../charts/lineChart"

export const INKS: Record<string, string> = {
  spend: theme.peach,
  partial: theme.overlay1,
  prev: theme.overlay0,
  ref: theme.surface2,
  in: theme.success,
  out: theme.error,
  limit: theme.chartBudget,
  balance: theme.lavender,
  savers: theme.green,
  // Gridlines, as in the Go app.
  week: theme.surface1,
  month: theme.blue,
  year: theme.accent,
  today: theme.chartToday,
  // In-chart notes (highs, lows, totals): grey, so the coloured label is
  // always the latest value.
  note: theme.overlay1,
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0)

/** Legend marks: a line series, a bar, a rule, each in its series' ink. */
const LINE = "⠒⠒ "
const BAR = "▆ "
const RULE = "┈┈ "
const mark = (shape: string, ink: keyof typeof INKS): Span => ({ text: shape, fg: INKS[ink]! })
const GAP = muted("   ")

/** A chart with nothing to draw, saying why in its legend. */
const emptyChart = (why: string): ChartModel => ({ rows: [], ticks: new Map(), labels: "", legend: [muted(why)] })

/** Money labels down the y-axis for ticks every `step` from `min` to `max`. */
const moneyTicks = (min: number, max: number, step: number, height: number) => tickRows(min, max, step, height, shortMoney)

/** What the range and the one before it are called in legends and labels. */
export interface PeriodNames {
  current: string
  previous: string
}
const DEFAULT_NAMES: PeriodNames = { current: "This period", previous: "Last period" }

/**
 * The Spending chart in one of its views, over the period's `dates`:
 * - Daily: spend per day as bars, with the period's daily average so far.
 * - Cumulative: running total against the previous period of equal length
 *   (and `budget`, when given, as a pace line rising from nothing at the
 *   start to the whole budget at the end).
 * - Weekly: totals per configured week; partial weeks in grey.
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
  weekStart: WeekStart = "monday",
): ChartModel {
  const { dates, values } = series
  const n = dates.length
  const elapsed = dates.filter((d) => d <= todayISO).length
  const upToToday = (vs: number[]) => vs.map((v, i) => (i < elapsed ? v : null))
  const axis = dateAxis(dates, width, todayISO, undefined, weekStart)
  if (n === 0) return emptyChart("No days in range")

  if (view === "Weekly") {
    // Spending dated after today waits for its day, as in the other views.
    const weeks = weeklyTotals(dates, upToToday(values).map((v) => v ?? 0), weekStart)
    const scale = niceScale(Math.max(0, ...weeks.map((w) => w.total)))
    const bars = weeks.map((w) => ({ value: w.startISO <= todayISO ? w.total : 0, ink: w.days < 7 || addDays(w.startISO, 6) >= todayISO ? "partial" : "spend" }))
    const { rows: plain, slots } = columnBars(bars, width, height, scale.max)
    // Each week's total over its bar, where it fits.
    const rows = annotate(plain, slots.map((slot, i) => ({ row: barTopRow(bars[i]!.value, scale.max, height), col: slot.col + Math.floor((slot.width - 1) / 2), text: bars[i]!.value > 0 ? shortMoney(bars[i]!.value) : "", ink: "note", above: true })).filter((l) => l.text && l.row > 0))
    const line = new Array<string>(width).fill(" ")
    slots.forEach((slot, i) => {
      const iso = weeks[i]!.startISO
      const label = slot.width >= 6 ? shortDate(iso) : String(Number(iso.slice(8, 10)))
      if (label.length <= slot.width + (slot.width > 2 ? 1 : 0)) {
        for (let c = 0; c < label.length && slot.col + c < width; c++) line[slot.col + c] = label[c]!
      }
    })
    const full = weeks.filter((w, i) => bars[i]!.ink === "spend")
    const current = weeks.findLast((w) => w.startISO <= todayISO && addDays(w.startISO, 6) >= todayISO)
    return {
      rows,
      ticks: moneyTicks(0, scale.max, scale.step, height),
      labels: line.join(""),
      legend: [
        mark(BAR, "spend"),
        muted(full.length ? `Weeks, avg ${formatWholeMoney(sum(full.map((w) => w.total)) / full.length)}` : "No full weeks yet"),
        ...(current ? [GAP, mark(BAR, "partial"), muted(`This week ${formatWholeMoney(current.total)} so far`)] : []),
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
    // The budget as a pace line: nothing at the start of the period, the
    // whole budget by the end of its last day.
    const pace = (i: number) => (budget ?? 0) * ((i + 1) / n)
    const limit = budget != null ? [{ values: dates.map((_, i) => pace(i)), ink: "limit" }] : []
    const overPace = budget != null && elapsed > 0 ? now - pace(elapsed - 1) : null
    // Each line named at its end.
    const at = (index: number, value: number) => pointCell(index, value, n, width, height, 0, scale.max)
    const marks: ChartLabel[] = [
      ...(elapsed > 0 ? [{ ...at(elapsed - 1, now), text: `${names.current} ${shortMoney(now)}`, ink: "spend", required: true }] : []),
      ...(prev.length ? [{ ...at(n - 1, prev[n - 1]!), text: names.previous, ink: "prev" }] : []),
      ...(budget != null ? [{ ...at(n - 1, budget), text: "Budget", ink: "limit" }] : []),
    ]
    return {
      rows: annotate(lineChart({ series: [...limit, { values: prev, ink: "prev" }, { values: upToToday(total), ink: "spend" }], length: n, width, height, min: 0, max: scale.max, markers: axis.markers }), marks),
      ticks: moneyTicks(0, scale.max, scale.step, height),
      labels: axis.labels,
      legend: [
        mark(LINE, "spend"),
        muted(`${names.current} ${formatWholeMoney(now)}`),
        ...(budget != null ? [
          GAP,
          mark(LINE, "limit"),
          muted(`Budget ${formatWholeMoney(budget)}`),
          ...(overPace != null ? [
            muted(", "),
            { text: `${formatWholeMoney(Math.abs(overPace))} ${overPace > 0 ? "over" : "under"} pace`, fg: spendChangeColor(overPace) },
          ] : []),
        ] : []),
        GAP,
        mark(LINE, "prev"),
        muted(`${names.previous} ${formatWholeMoney(then)}${elapsed < n ? " by now" : ""}`),
        ...(diff != null ? [GAP, { text: `${diff > 0 ? "+" : ""}${diff}%`, fg: spendChangeColor(diff) }] : []),
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
    ...(bars[tallest]!.value > 0 && slots[tallest] ? [{ row: barTopRow(bars[tallest]!.value, scale.max, height), col: slots[tallest]!.col, text: shortMoney(bars[tallest]!.value), ink: "note", above: true }] : []),
    ...(avgRow >= 0 ? [{ row: avgRow, col: width - 1 - "avg".length - 2, text: "avg", ink: "partial" }] : []),
  ]
  return {
    rows: annotate(plain, marks),
    ticks: moneyTicks(0, scale.max, scale.step, height),
    labels: dateAxis(dates, used, todayISO, colOf, weekStart).labels,
    legend: [
      mark(BAR, "spend"),
      muted(n > width ? "Spent per day (averaged)" : "Spent per day"),
      ...(shown[peak] ? [muted(`, peak ${formatWholeMoney(shown[peak]!)} on ${shortDate(dates[peak]!)}`)] : []),
      GAP,
      mark(RULE, "ref"),
      muted(`Average ${formatWholeMoney(avg)}`),
    ],
  }
}

/** End-of-day balances over the period's `dates` (up to today) for one view:
 * everything, spending accounts, or savers. The axis fits the balances, or
 * runs from $0 with `zeroAxis`. */
export function balancesChart(
  view: "Net position" | "Available" | "Savers",
  dates: string[],
  width: number,
  height: number,
  todayISO: string,
  accounts: Account[],
  transactions: Transaction[],
  weekStart: WeekStart = "monday",
  zeroAxis = false,
): ChartModel {
  const last = dates.filter((d) => d <= todayISO).at(-1)
  if (!dates.length || !last) return emptyChart("No balances in range")
  const history = balanceHistory(accounts, transactions, dates[0]!, last)
  const pick = (p: (typeof history)[number]) => (view === "Available" ? p.spending : view === "Savers" ? p.savers : p.net)
  const values = history.map(pick)
  const lo = Math.min(...values), hi = Math.max(...values)
  const range = fitRange(lo, hi, height, zeroAxis)
  const axis = dateAxis(dates, width, todayISO, undefined, weekStart)
  const change = values[values.length - 1]! - values[0]!
  const low = values.indexOf(lo)
  // The latest value in the line's colour, placed first so it gets the best
  // spot; the high and the low in grey where they happened (not at the
  // ends: the start is on the axis, the end is the latest; nor when they
  // read the same as the latest).
  const high = values.indexOf(hi)
  const latest = values.length - 1
  const ink = view === "Savers" ? "savers" : "balance"
  const at = (i: number) => pointCell(i, values[i]!, dates.length, width, height, range.min, range.max)
  const marks: ChartLabel[] = [
    { ...at(latest), text: shortMoney(values[latest]!), ink },
    ...(high > 0 && high < latest && hi > lo && shortMoney(hi) !== shortMoney(values[latest]!) ? [{ ...at(high), text: `high ${shortMoney(hi)}`, ink: "note" }] : []),
    ...(low > 0 && low < latest && hi > lo && shortMoney(lo) !== shortMoney(values[latest]!) ? [{ ...at(low), text: `low ${shortMoney(lo)}`, ink: "note" }] : []),
  ]
  return {
    rows: annotate(lineChart({ series: [{ values, ink }], length: dates.length, width, height, min: range.min, max: range.max, markers: axis.markers }), marks),
    ticks: moneyTicks(range.min, range.max, range.step, height),
    labels: axis.labels,
    legend: [
      mark(LINE, ink),
      muted(`${view} ${formatWholeMoney(values[values.length - 1]!)}`),
      GAP,
      { text: signedWholeMoney(change), fg: changeColor(change) },
      muted(` since ${shortDate(dates[0]!)}`),
      GAP,
      muted(`low ${formatWholeMoney(lo)} on ${shortDate(history[low]!.dateISO)}`),
    ],
  }
}


/**
 * Cash flow over the period's `dates`: money in (green) beside money out (red)
 * per configured week, or per calendar month when the period is longer than
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
  weekStart: WeekStart = "monday",
): ChartModel {
  if (!dates.length) return emptyChart("No days in range")
  const monthly = dates.length > 92
  const buckets: Array<{ start: string; end: string }> = []
  for (const iso of dates) {
    const startsWeek = dayOfWeek(iso, weekStart) === 0
    const newBucket = !buckets.length || (monthly ? iso.slice(8, 10) === "01" : startsWeek)
    if (newBucket) buckets.push({ start: iso, end: iso })
    else buckets[buckets.length - 1]!.end = iso
  }
  const first = dates[0]!, last = dates[dates.length - 1]!
  // Up to today: rows dated later wait for their day, as in the budget.
  const inRange = transactions.filter((t) => t.dateISO >= first && t.dateISO <= last && t.dateISO <= todayISO)
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
    const label = monthly ? MONTHS[Number(b.start.slice(5, 7)) - 1]! : shortDate(b.start)
    if (slot.col < free || slot.col + label.length > width) return
    for (let c = 0; c < label.length; c++) line[slot.col + c] = label[c]!
    free = slot.col + label.length + 1
  })
  const income = sum(flows.map((f) => f.income)), spent = sum(flows.map((f) => f.spent))
  const net = income - spent
  return {
    rows,
    ticks: moneyTicks(0, scale.max, scale.step, height),
    labels: line.join(""),
    legend: [
      mark(BAR, "in"),
      muted(`In ${formatWholeMoney(income)}`),
      GAP,
      mark(BAR, "out"),
      muted(`Out ${formatWholeMoney(spent)}`),
      GAP,
      muted(`Net ${signedWholeMoney(net)} · ${monthly ? "monthly" : "weekly"}`),
    ],
  }
}
