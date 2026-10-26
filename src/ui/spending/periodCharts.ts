/** Chart models for the Spending tab's period charts (and the Dashboard's
 * budget-cycle chart). Pure: each returns a ChartModel for ChartBody. */
import type { BALANCE_VIEWS, TRACKER_VIEWS } from "../../state/uiStore"
import { theme } from "../../theme"
import { cumulative, dailySpendSeries, formatWholeMoney, weeklyTotals } from "../../domain/dashboard"
import { balanceHistory } from "../../domain/position"
import type { Account, Transaction } from "../../domain/types"
import { shortDate, shortMoney } from "../text"
import { columnBars } from "../charts/bars"
import type { ChartModel } from "../charts/ChartBody"
import { dateAxis, lineChart, niceRange, niceScale, tickRows } from "../charts/lineChart"

export const INKS: Record<string, string> = {
  spend: theme.peach,
  partial: theme.overlay1,
  prev: theme.overlay0,
  ref: theme.surface2,
  limit: theme.yellow,
  balance: theme.lavender,
  savers: theme.green,
  month: theme.surface2,
  week: theme.surface0,
  today: theme.green,
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0)

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
  view: (typeof TRACKER_VIEWS)[number],
  series: { dates: string[]; values: number[] },
  width: number,
  height: number,
  todayISO: string,
  spendingRows: Transaction[],
  /** Cumulative only: a spending limit drawn as a rule and named in the summary. */
  budget?: number,
): ChartModel {
  const { dates, values } = series
  const n = dates.length
  const elapsed = dates.filter((d) => d <= todayISO).length
  const upToToday = (vs: number[]) => vs.map((v, i) => (i < elapsed ? v : null))
  const axis = dateAxis(dates, width, todayISO)
  const muted = (text: string) => ({ text, fg: theme.overlay1 })
  if (n === 0) return { rows: [], ticks: new Map(), labels: "", summary: [muted("No days in range")] }

  if (view === "Weekly") {
    const weeks = weeklyTotals(dates, values)
    const scale = niceScale(Math.max(0, ...weeks.map((w) => w.total)))
    const bars = weeks.map((w) => ({ value: w.startISO <= todayISO ? w.total : 0, ink: w.days < 7 || addDays(w.startISO, 6) >= todayISO ? "partial" : "spend" }))
    const { rows, slots } = columnBars(bars, width, height, scale.max)
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
      summary: [
        muted(full.length ? `avg ${formatWholeMoney(sum(full.map((w) => w.total)) / full.length)}/week` : "no full weeks yet"),
        ...(current ? [muted(` · this week ${formatWholeMoney(current.total)} so far`)] : []),
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
    return {
      rows: lineChart({ series: [...limit, { values: prev, ink: "prev" }, { values: upToToday(total), ink: "spend" }], length: n, width, height, min: 0, max: scale.max, markers: axis.markers }),
      ticks: tickRows(0, scale.max, scale.step, height, shortMoney),
      labels: axis.labels,
      summary: [
        { text: `${formatWholeMoney(now)} spent`, fg: theme.peach },
        ...(budget != null ? [muted(` of ${formatWholeMoney(budget)}`)] : []),
        muted(` vs ${formatWholeMoney(then)} ${elapsed < n ? "at this point last period" : "previous period"}`),
        ...(diff != null ? [{ text: ` (${diff > 0 ? "+" : ""}${diff}%)`, fg: diff > 0 ? theme.error : theme.success }] : []),
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
    markerCol = (i, ink) => (ink === "today" || slot === 1 ? i * slot : i * slot - 1)
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
  return {
    rows: columnBars(bars, width, height, scale.max, { value: avg, ink: "ref" }, axis.markers.map((m) => ({ col: markerCol(m.index, m.ink), ink: m.ink }))).rows,
    ticks: tickRows(0, scale.max, scale.step, height, shortMoney),
    labels: dateAxis(dates, used, todayISO, colOf).labels,
    summary: [
      muted(`avg ${formatWholeMoney(avg)}/day`),
      ...(n > width ? [muted(" · bars average days")] : []),
      ...(shown[peak] ? [muted(` · peak ${formatWholeMoney(shown[peak]!)} on ${shortDate(dates[peak]!)}`)] : []),
    ],
  }
}

/** End-of-day balances over the period's `dates` (up to today) for one view:
 * everything, spending accounts, or savers. */
export function balancesChart(
  view: (typeof BALANCE_VIEWS)[number],
  dates: string[],
  width: number,
  height: number,
  todayISO: string,
  accounts: Account[],
  transactions: Transaction[],
): ChartModel {
  const last = dates.filter((d) => d <= todayISO).at(-1)
  if (!dates.length || !last) return { rows: [], ticks: new Map(), labels: "", summary: [{ text: "No balances in range", fg: theme.overlay1 }] }
  const history = balanceHistory(accounts, transactions, dates[0]!, last)
  const pick = (p: (typeof history)[number]) => (view === "Available" ? p.spending : view === "Savers" ? p.savers : p.net)
  const values = history.map(pick)
  const lo = Math.min(...values), hi = Math.max(...values)
  const range = niceRange(lo, hi)
  const axis = dateAxis(dates, width, todayISO)
  const change = values[values.length - 1]! - values[0]!
  const low = values.indexOf(lo)
  return {
    rows: lineChart({ series: [{ values, ink: view === "Savers" ? "savers" : "balance" }], length: dates.length, width, height, min: range.min, max: range.max, markers: axis.markers }),
    ticks: tickRows(range.min, range.max, range.step, height, shortMoney),
    labels: axis.labels,
    summary: [
      { text: formatWholeMoney(values[values.length - 1]!), fg: theme.text },
      { text: ` ${change >= 0 ? "+" : "-"}${formatWholeMoney(Math.abs(change))}`, fg: Math.abs(change) < 0.5 ? theme.overlay1 : change > 0 ? theme.success : theme.error },
      { text: ` since ${shortDate(dates[0]!)} · low ${formatWholeMoney(lo)} on ${shortDate(history[low]!.dateISO)}`, fg: theme.overlay1 },
    ],
  }
}

