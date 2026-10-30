/** Chart models for the Overview's chart pane. Pure: each returns a
 * ChartModel for ChartBody. */
import { fade, ink, theme, tone } from "../../theme"
import { cumulative, dailySpendSeries, formatWholeMoney, signedWholeMoney, weeklyTotals } from "../../domain/dashboard"
import { balanceHistory, biggestRow, computePeriodFlows, flowRows, historyCovers, historyStart, saverHistories } from "../../domain/position"
import { accountRole, type Account, type Transaction } from "../../domain/types"
import { isSpending } from "../../domain/moneyRules"
import { MONTHS, addDays, dayOfWeek, type WeekStart } from "../../domain/days"
import { shortDate, shortMoney, truncate } from "../text"
import { barSlots, barTopRow, columnBars, ruleRow } from "../charts/bars"
import { muted, type Span } from "../primitives/spans"
import { changeColor, spendChangeColor } from "../colors"
import type { ChartModel } from "../charts/ChartBody"
import { annotate, lineAnchors, stamp, type ChartLabel } from "../charts/annotate"
import { cellColumn, dateAxis, fitRange, lineChart, niceScale, pointCell, tickRows, valueRow } from "../charts/lineChart"
import { saverInks } from "../charts/saverInks"

export const INKS: Record<string, string> = {
  // Spending: the calendar's purple, lighter where a day or week isn't over.
  spend: theme.mauve,
  partial: fade(theme.mauve, 0.45),
  prev: theme.overlay0,
  ref: theme.surface2,
  in: tone.good,
  out: tone.bad,
  limit: theme.chartBudget,
  balance: theme.lavender,
  // Where Available is headed: the balance line, faded.
  projection: fade(theme.lavender, 0.5),
  // Savers' total; each saver's own line takes a colour from saverInks.
  total: ink.figure,
  // Gridlines, as in the Go app.
  week: theme.surface1,
  month: theme.blue,
  year: theme.pink,
  today: theme.chartToday,
  // In-chart notes (highs, lows, totals): grey, so the coloured label is
  // always the latest value.
  note: ink.note,
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
 * - Daily: spend per day as bars, the biggest days named after their
 *   biggest spend, the daily average so far and, with a `budget`, what's
 *   left a day over the days to come; more days than columns, a widening
 *   average line with the biggest days as points.
 * - Cumulative: running total against the previous period of equal length
 *   where the history covers it (and `budget`, when given, as a pace line
 *   rising from nothing at the start to the whole budget at the end).
 * - Weekly: totals per configured week, partial weeks lighter, a week's
 *   share of a `budget`, the biggest named; months under narrow bars.
 * Bars share the whole width out. Days after today are not drawn.
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

  // Each spending row that took money out, to name what made a bar tall.
  const outs = spendingRows.filter((t) => t.amount < 0 && isSpending(t))
  const named = (start: string, end: string) => biggestRow(outs, start, end)

  if (view === "Weekly") {
    // Spending dated after today waits for its day, as in the other views.
    const weeks = weeklyTotals(dates, upToToday(values).map((v) => v ?? 0), weekStart)
    // A cycle's budget, a week's share of it.
    const perWeek = budget != null ? (budget * 7) / n : null
    const scale = niceScale(Math.max(0, perWeek ?? 0, ...weeks.map((w) => w.total)))
    const partial = (w: (typeof weeks)[number]) => w.days < 7 || addDays(w.startISO, 6) >= todayISO
    const bars = weeks.map((w) => ({ value: w.startISO <= todayISO ? w.total : 0, ink: partial(w) ? "partial" : "spend" }))
    const { rows: plain, slots } = columnBars(bars, width, height, scale.max, perWeek ? { value: perWeek, ink: "limit" } : undefined)
    // Labels: this week, then the biggest (named by its biggest spend where
    // it fits), then the rest by size; all of them when bars are wide, else
    // the biggest few.
    const current = weeks.findLastIndex((w) => w.startISO <= todayISO && addDays(w.startISO, 6) >= todayISO)
    const bySize = bars.map((_, i) => i).filter((i) => bars[i]!.value > 0).sort((a, b) => bars[b]!.value - bars[a]!.value)
    const roomy = Math.min(...slots.map((s) => s.width)) >= 5
    const order = [...new Set([...(current >= 0 && bars[current]!.value > 0 ? [current] : []), ...bySize.slice(0, roomy ? bySize.length : 3)])]
    const at = (i: number) => ({ row: barTopRow(bars[i]!.value, scale.max, height), col: slots[i]!.col + Math.floor((slots[i]!.width - 1) / 2), above: true })
    const biggest = bySize[0]
    const marks: ChartLabel[] = order.filter((i) => slots[i]).map((i) => {
      const total = shortMoney(bars[i]!.value)
      const row = i === biggest ? named(weeks[i]!.startISO, addDays(weeks[i]!.startISO, 6)) : undefined
      return { ...at(i), ...besideBar(slots[i]!, at(i).row), text: barName(total, bars[i]!.value, row), short: total, ink: "note" }
    }).filter((l) => l.row >= 0)
    if (perWeek) marks.push({ row: ruleRow(perWeek, scale.max, height), col: width - 1 - "budget".length - 2, text: "budget", ink: "limit" })
    const starts = weeks.map((w) => w.startISO)
    return {
      rows: annotate(plain, marks),
      ticks: moneyTicks(0, scale.max, scale.step, height),
      labels: weekAxis(starts, slots, width, roomy),
      legend: [
        mark(BAR, "spend"),
        muted(bars.some((b) => b.ink === "spend") ? `Weeks, avg ${formatWholeMoney(sum(weeks.filter((w, i) => bars[i]!.ink === "spend").map((w) => w.total)) / bars.filter((b) => b.ink === "spend").length)}` : "No full weeks yet"),
        ...(bars.some((b) => b.ink === "partial") ? [GAP, mark(BAR, "partial"), muted(current >= 0 ? `partial week · this week ${formatWholeMoney(weeks[current]!.total)} so far` : "partial week")] : []),
        ...(perWeek ? [GAP, mark(RULE, "limit"), muted(`Budget ${formatWholeMoney(perWeek)} a week`)] : []),
      ],
    }
  }

  if (view === "Cumulative") {
    const total = cumulative(values)
    const prevStart = addDays(dates[0]!, -n)
    // Compared only where the history covers the period before (stray old
    // rows don't): one with little in it isn't a period to compare with.
    const covered = elapsed > 0 && historyCovers(spendingRows, { start: prevStart, end: addDays(prevStart, elapsed - 1) }, { start: dates[0]!, end: dates[elapsed - 1]! })
    const prev = covered ? cumulative(dailySpendSeries(spendingRows, prevStart, addDays(dates[0]!, -1)).values) : []
    const now = elapsed > 0 ? total[elapsed - 1]! : 0
    const then = elapsed > 0 ? prev[elapsed - 1] ?? 0 : 0
    const scale = niceScale(Math.max(now, budget ?? 0, ...prev))
    const diff = then > 0 ? Math.round(((now - then) / then) * 100) : null
    // The budget as a pace line: nothing at the start of the period, the
    // whole budget by the end of its last day.
    const pace = (i: number) => (budget ?? 0) * ((i + 1) / n)
    const limit = budget != null ? [{ values: dates.map((_, i) => pace(i)), ink: "limit" }] : []
    const overPace = budget != null && elapsed > 0 ? now - pace(elapsed - 1) : null
    // Each line named at its end, or further back along it where the end
    // is crowded.
    const at = (index: number, value: number) => pointCell(index, value, n, width, height, 0, scale.max)
    const paceLine = dates.map((_, i) => pace(i))
    const marks: ChartLabel[] = [
      ...(elapsed > 0 ? [{ ...at(elapsed - 1, now), text: `${names.current} ${shortMoney(now)}`, ink: "spend", required: true }] : []),
      ...(prev.length ? [{ ...at(n - 1, prev[n - 1]!), text: names.previous, name: names.previous, along: lineAnchors(prev, n - 2, at), ink: "prev" }] : []),
      ...(budget != null ? [{ ...at(n - 1, budget), text: "Budget", name: "Budget", along: lineAnchors(paceLine, n - 2, at), ink: "limit" }] : []),
    ]
    return {
      rows: annotate(lineChart({ series: [...limit, { values: prev, ink: "prev" }, { values: upToToday(total), ink: "spend" }], length: n, width, height, min: 0, max: scale.max, markers: axis.markers }), marks),
      ticks: moneyTicks(0, scale.max, scale.step, height),
      labels: axis.labels,
    today: axis.today,
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
        ...(covered ? [
          mark(LINE, "prev"),
          muted(`${names.previous} ${formatWholeMoney(then)}${elapsed < n ? " by now" : ""}`),
          ...(diff != null ? [GAP, { text: `${diff > 0 ? "+" : ""}${diff}%`, fg: spendChangeColor(diff) }] : []),
        ] : [muted(`${names.previous}: too little history to compare`)]),
      ],
    }
  }

  // Daily, a day a column or wider: a bar per day (today's lighter, as the
  // day isn't over), the average so far, and with a budget what's left
  // per day over the days to come. More days than columns: a 7-day
  // average line, with the biggest days as points above it.
  const shown = values.slice(0, elapsed)
  const avg = elapsed ? sum(shown) / elapsed : 0
  const peak = shown.reduce((best, v, i) => (v > shown[best]! ? i : best), 0)
  const peakRow = shown[peak] ? named(dates[peak]!, dates[peak]!) : undefined
  // The biggest days, as many as the width has room to name.
  const biggestDays = shown.map((_, i) => i).filter((i) => shown[i]! > 0).sort((a, b) => shown[b]! - shown[a]!).slice(0, Math.max(1, Math.floor(width / 24)))
  const dayLabel = (i: number) => {
    const row = named(dates[i]!, dates[i]!)
    return { text: barName(shortMoney(shown[i]!), shown[i]!, row), short: shortMoney(shown[i]!) }
  }
  const peakNote = shown[peak] ? [muted(`, peak ${formatWholeMoney(shown[peak]!)} on ${shortDate(dates[peak]!)}${peakRow ? ` (${spendName(peakRow)})` : ""}`)] : []

  if (n > width) {
    // A week's average, longer as days crowd the columns (a month's at a
    // year), so the line shows the trend rather than every day's noise.
    const window = Math.min(30, 7 * Math.ceil(n / width))
    const rolling = values.map((_, i) => (i < elapsed ? sum(values.slice(Math.max(0, i - window + 1), i + 1)) / Math.min(window, i + 1) : null))
    const scale = niceScale(Math.max(0, ...rolling.map((v) => v ?? 0)))
    const top = (i: number) => (shown[i]! >= scale.max ? 0 : valueRow(shown[i]!, 0, scale.max, height))
    const points = biggestDays.map((i) => ({ row: top(i), col: cellColumn(i, n, width), text: shown[i]! >= scale.max ? "▲" : "•", ink: "spend" }))
    const line = lineChart({ series: [{ values: rolling, ink: "spend" }], length: n, width, height, min: 0, max: scale.max, markers: axis.markers })
    return {
      rows: annotate(stamp(line, points), biggestDays.map((i) => ({ row: top(i), col: cellColumn(i, n, width), ...dayLabel(i), ink: "spend" }))),
      ticks: moneyTicks(0, scale.max, scale.step, height),
      labels: axis.labels,
      today: axis.today,
      legend: [mark(LINE, "spend"), muted(`${window}-day average, ${formatWholeMoney(avg)} a day overall`), ...peakNote, GAP, muted("• ▲ biggest days")],
    }
  }

  const slots = barSlots(n, width)
  const todayIndex = elapsed - 1
  const daysLeft = n - elapsed
  const spentSoFar = sum(shown)
  const left = budget != null && daysLeft > 0 ? Math.max(0, (budget - spentSoFar) / daysLeft) : null
  // Where a marker goes: today's rule runs through its own bar's column;
  // week and month rules sit in the gap before their day's bar, and the
  // closing month end in the gap after the last.
  const markerCol = (i: number, ink: string) => (ink === "today" || slots[i]!.col === 0 ? slots[i]!.col : i === n - 1 ? slots[i]!.col + slots[i]!.width : slots[i]!.col - 1)
  const bars = dates.map((d, i) => ({ value: i < elapsed ? values[i]! : 0, ink: d === todayISO ? "partial" : "spend" }))
  const pastEnd = elapsed > 0 ? slots[todayIndex]!.col + slots[todayIndex]!.width : 0
  const scale = niceScale(Math.max(0, left ?? 0, ...bars.map((b) => b.value)))
  const { rows: plain } = columnBars(bars, width, height, scale.max, [
    ...(avg > 0 ? [{ value: avg, ink: "ref", to: pastEnd }] : []),
    ...(left ? [{ value: left, ink: "limit", from: pastEnd + 1 }] : []),
  ], axis.markers.map((m) => ({ col: markerCol(m.index, m.ink), ink: m.ink })))
  const marks: ChartLabel[] = [
    ...biggestDays.map((i) => {
      const row = barTopRow(shown[i]!, scale.max, height)
      return { row, col: slots[i]!.col, ...dayLabel(i), ...besideBar(slots[i]!, row), ink: "note", above: true }
    }).filter((l) => l.row >= 0),
    ...(avg > 0 && pastEnd > 6 ? [{ row: ruleRow(avg, scale.max, height), col: pastEnd - 1 - "avg".length - 1, text: "avg", ink: "ref" }] : []),
    ...(left ? [{ row: ruleRow(left, scale.max, height), col: pastEnd + 2, text: `${shortMoney(left)}/day left`, short: shortMoney(left), ink: "limit" }] : []),
  ]
  const { labels, today } = dateAxis(dates, width, todayISO, (i) => slots[i]!.col, weekStart)
  return {
    rows: annotate(plain, marks),
    ticks: moneyTicks(0, scale.max, scale.step, height),
    labels,
    today,
    legend: [
      mark(BAR, "spend"),
      muted("Spent per day"),
      ...peakNote,
      GAP,
      mark(RULE, "ref"),
      muted(`Average ${formatWholeMoney(avg)}`),
      ...(left == null ? [] : left > 0 ? [GAP, mark(RULE, "limit"), muted(`${formatWholeMoney(left)} a day left in the budget`)] : [GAP, { text: "budget spent", fg: tone.bad }]),
    ],
  }
}

/** "Nov 2025". */
const monthYear = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`

/** What a spending row is called in a chart label: short. */
const spendName = (row: Transaction) => truncate(row.description, 14)

/** Where a bar's label may go when there's no room over the bar (a bar
 * that fills the chart's height): beside its top, past its right edge. */
const besideBar = (slot: { col: number; width: number }, row: number) => ({ alsoAt: [{ row, col: slot.col + slot.width - 1 }] })

/** A bar's label naming what made it tall: "Centre Com $826" when that one
 * row is (nearly) the whole bar, else "$1.3k · Centre Com", its biggest. */
const barName = (amount: string, total: number, row: Transaction | undefined) =>
  !row ? amount : Math.abs(row.amount) >= 0.9 * total ? `${spendName(row)} ${amount}` : `${amount} · ${spendName(row)}`

/** Labels under weekly bars: each week's start date where bars are wide,
 * else the month over the week holding its 1st. */
function weekAxis(starts: string[], slots: Array<{ col: number; width: number }>, width: number, roomy: boolean): string {
  const line = new Array<string>(width).fill(" ")
  let free = 0
  starts.forEach((iso, i) => {
    const slot = slots[i]
    if (!slot) return
    // The week holding a month's 1st names that month (the first week, its own).
    const end = addDays(iso, 6)
    const first = iso.endsWith("-01") || i === 0 ? iso : end.slice(5, 7) !== iso.slice(5, 7) ? end : null
    const label = roomy ? shortDate(iso) : first ? MONTHS[Number(first.slice(5, 7)) - 1]! : ""
    if (!label || slot.col < free || slot.col + label.length > width) return
    for (let c = 0; c < label.length; c++) line[slot.col + c] = label[c]!
    free = slot.col + label.length + 1
  })
  return line.join("")
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
  /** Available only: where it's headed after today (projectAvailable). */
  projection: ReadonlyArray<{ dateISO: string; value: number }> = [],
): ChartModel {
  const last = dates.filter((d) => d <= todayISO).at(-1)
  if (!dates.length || !last) return emptyChart("No balances in range")
  if (view === "Savers") return saversChart(dates, last, width, height, todayISO, accounts, transactions, weekStart, zeroAxis)
  const history = balanceHistory(accounts, transactions, dates[0]!, last)
  const pick = (p: (typeof history)[number]) => (view === "Available" ? p.spending : p.net)
  const values = history.map(pick)
  const latest = values.length - 1
  // The projection, from today's point on, within the range.
  const ahead = view === "Available" ? projection.filter((p) => p.dateISO > last && p.dateISO <= dates[dates.length - 1]!) : []
  const projected = ahead.length ? dates.map((d, i) => (i === latest ? values[latest]! : ahead.find((p) => p.dateISO === d)?.value ?? null)) : []
  const all = [...values, ...ahead.map((p) => p.value)]
  const lo = Math.min(...values), hi = Math.max(...values)
  const range = fitRange(Math.min(...all), Math.max(...all), height, zeroAxis)
  const axis = dateAxis(dates, width, todayISO, undefined, weekStart)
  const change = values[latest]! - values[0]!
  const low = values.indexOf(lo)
  const high = values.indexOf(hi)
  const ink = "balance"
  const at = (i: number, value = values[i]!) => pointCell(i, value, dates.length, width, height, range.min, range.max)
  // The biggest one-day moves, named after the row that made most of each
  // (on the accounts the line counts; moving money between your own
  // accounts doesn't move the net), as many as the width has room for.
  const counted = new Set(accounts.filter((a) => a.balance !== null && (view !== "Available" || accountRole(a) === "spending")).map((a) => a.id))
  const moving = transactions.filter((t) => t.accountId != null && counted.has(t.accountId) && (view === "Available" || !t.internal))
  const moves = values.map((v, i) => ({ i, d: i ? v - values[i - 1]! : 0 }))
    .filter((m) => Math.abs(m.d) >= (hi - lo) * 0.08 && m.d !== 0)
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))
    .slice(0, Math.max(1, Math.floor(width / 30)))
  const moveLabels: ChartLabel[] = moves.map(({ i, d }) => {
    const row = biggestRow(moving.filter((t) => Math.sign(t.amount) === Math.sign(d)), dates[i]!, dates[i]!)
    const amount = `${d > 0 ? "+" : "-"}${shortMoney(Math.abs(d))}`
    return { ...at(i), text: row ? `${amount} ${truncate(row.description, 14)}` : amount, short: amount, ink: d > 0 ? "in" : "out" }
  })
  const end = ahead.at(-1)
  // The latest value in the line's colour, placed first so it gets the best
  // spot; where it's headed; the biggest moves; the high and the low in
  // grey where they happened (not at the ends: the start is on the axis,
  // the end is the latest; nor when they read the same as the latest).
  const marks: ChartLabel[] = [
    { ...at(latest), text: shortMoney(values[latest]!), ink },
    ...(end ? [{ ...at(dates.indexOf(end.dateISO), end.value), text: `≈ ${shortMoney(end.value)} by ${shortDate(end.dateISO)}`, short: `≈ ${shortMoney(end.value)}`, ink: "projection" }] : []),
    ...moveLabels,
    ...(high > 0 && high < latest && hi > lo && shortMoney(hi) !== shortMoney(values[latest]!) ? [{ ...at(high), text: `high ${shortMoney(hi)}`, ink: "note" }] : []),
    ...(low > 0 && low < latest && hi > lo && shortMoney(lo) !== shortMoney(values[latest]!) ? [{ ...at(low), text: `low ${shortMoney(lo)}`, ink: "note" }] : []),
  ]
  return {
    rows: annotate(lineChart({ series: [...(projected.length ? [{ values: projected, ink: "projection" }] : []), { values, ink }], length: dates.length, width, height, min: range.min, max: range.max, markers: axis.markers }), marks),
    ticks: moneyTicks(range.min, range.max, range.step, height),
    labels: axis.labels,
    today: axis.today,
    legend: [
      mark(LINE, ink),
      muted(`${view} ${formatWholeMoney(values[latest]!)}`),
      GAP,
      { text: signedWholeMoney(change), fg: changeColor(change) },
      muted(` since ${shortDate(dates[0]!)}`),
      GAP,
      muted(`low ${formatWholeMoney(lo)} on ${shortDate(history[low]!.dateISO)}`),
      ...(end ? [GAP, mark(LINE, "projection"), muted(`≈ ${formatWholeMoney(end.value)} by ${shortDate(end.dateISO)} at usual spending`)] : []),
    ],
  }
}

/** Savers drawn one line each: as many as the chart's height keeps apart. */
const MAX_SAVER_LINES = 6
const ROWS_PER_SAVER_LINE = 3
/** A saver's name in its line's label, at most (cells, emoji included). */
const SAVER_LABEL = 16

/**
 * Savers: their total (white) and a line per saver in its own colour
 * (saverInks: from its emoji, kept apart), the largest first when there are
 * more than the height has room for (the rest are in the total). Each
 * line's latest value sits at its end.
 */
function saversChart(dates: string[], last: string, width: number, height: number, todayISO: string, accounts: Account[], transactions: Transaction[], weekStart: WeekStart, zeroAxis: boolean): ChartModel {
  const all = saverHistories(accounts, transactions, dates[0]!, last)
  if (!all.length) return emptyChart("No savers")
  const total = all[0]!.values.map((_, i) => all.reduce((sum, s) => sum + s.values[i]!, 0))
  const room = Math.max(1, Math.min(MAX_SAVER_LINES, Math.floor(height / ROWS_PER_SAVER_LINE)))
  // One saver is its own total: just the total.
  const shown = all.length > 1 ? [...all].sort((a, b) => b.balance - a.balance).slice(0, room) : []
  const colours = saverInks(shown.map((s) => s.name))
  const inks: Record<string, string> = { total: INKS.total! }
  shown.forEach((s, i) => { inks[`saver${s.accountId}`] = colours[i]! })
  const values = [...total, ...shown.flatMap((s) => s.values)]
  const lo = Math.min(...values), hi = Math.max(...values)
  const range = fitRange(lo, hi, height, zeroAxis)
  const axis = dateAxis(dates, width, todayISO, undefined, weekStart)
  const latest = total.length - 1
  const cell = (index: number, value: number) => pointCell(index, value, dates.length, width, height, range.min, range.max)
  const at = (series: number[]) => cell(latest, series[latest]!)
  const change = total[latest]! - total[0]!
  const hidden = all.length - Math.max(1, shown.length)
  return {
    // The total drawn last: where lines meet, it shows.
    rows: annotate(lineChart({
      series: [...shown.map((s) => ({ values: s.values, ink: `saver${s.accountId}` })), { values: total, ink: "total" }],
      length: dates.length, width, height, min: range.min, max: range.max, markers: axis.markers,
    }), [
      // Named with today's value at the end where there's room, else the
      // value alone there, else the name further back along the line.
      { ...at(total), text: `Total ${shortMoney(total[latest]!)}`, short: shortMoney(total[latest]!), name: "Total", along: lineAnchors(total, latest - 1, cell), ink: "total" },
      ...shown.map((s) => {
        const name = truncate(s.name, SAVER_LABEL)
        return { ...at(s.values), text: `${name} ${shortMoney(s.values[latest]!)}`, short: shortMoney(s.values[latest]!), name, along: lineAnchors(s.values, latest - 1, cell), ink: `saver${s.accountId}` }
      }),
    ]),
    ticks: moneyTicks(range.min, range.max, range.step, height),
    labels: axis.labels,
    today: axis.today,
    inks,
    legend: [
      { text: LINE, fg: inks.total! },
      muted(`Total ${formatWholeMoney(total[latest]!)} `),
      { text: signedWholeMoney(change), fg: changeColor(change) },
      muted(` since ${shortDate(dates[0]!)}`),
      ...shown.flatMap((s) => [GAP, { text: LINE, fg: inks[`saver${s.accountId}`]! }, muted(s.name)]),
      ...(hidden > 0 ? [GAP, muted(`+${hidden} more in the total`)] : []),
    ],
  }
}


/**
 * Cash flow over the period's `dates`: money in (green) beside money out
 * (red) per configured week while a week's pair has room (5 columns), else
 * per calendar month, by the same rules as the Date Range flows (internal
 * transfers and not-spending categories excluded; `scopeIds` narrows to
 * the selected spending accounts). The tallest bars are named after their
 * biggest transaction, as many as fit; each period's net sits beside its
 * date where every period has room. Buckets after today are empty.
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
  const monthly = width / Math.ceil(dates.length / 7) < 5
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
  const rowsOf = flowRows(accounts, inRange, scopeIds)
  const scale = niceScale(Math.max(0, ...flows.flatMap((f) => [f.income, f.spent])))
  const future = (i: number) => buckets[i]!.start > todayISO
  const bars = flows.flatMap((f, i) => [{ value: future(i) ? 0 : f.income, ink: "in" }, { value: future(i) ? 0 : f.spent, ink: "out" }])
  const { rows: plain, slots } = columnBars(bars, width, height, scale.max, undefined, [], 2)
  // Names over the tallest bars: the tallest in and out first, then by
  // height; all when pairs are wide, else two of each.
  const roomy = Math.min(...slots.map((s) => s.width)) >= 4
  const order = (kind: 0 | 1) => bars.map((_, i) => i).filter((i) => i % 2 === kind && bars[i]!.value > 0).sort((a, b) => bars[b]!.value - bars[a]!.value).slice(0, roomy ? undefined : 2)
  const [ins, outs] = [order(0), order(1)]
  const ranked = [ins[0], outs[0], ...[...ins.slice(1), ...outs.slice(1)].sort((a, b) => bars[b]!.value - bars[a]!.value)].filter((i): i is number => i != null)
  const marks: ChartLabel[] = ranked.filter((i) => slots[i]).map((i) => {
    const b = buckets[Math.floor(i / 2)]!
    const row = biggestRow(i % 2 === 0 ? rowsOf.income : rowsOf.spent, b.start, b.end)
    const total = shortMoney(bars[i]!.value)
    const text = barName(`${i % 2 === 0 ? "+" : "-"}${total}`, bars[i]!.value, row)
    const top = barTopRow(bars[i]!.value, scale.max, height)
    return { row: top, col: slots[i]!.col, text, short: total, ...besideBar(slots[i]!, top), ink: i % 2 === 0 ? "in" : "out", above: true }
  }).filter((l) => l.row >= 0)
  // A label under each pair: the month or the week's start, with the
  // period's net beside it when every period has room for one.
  const name = (b: (typeof buckets)[number]) => (monthly ? MONTHS[Number(b.start.slice(5, 7)) - 1]! : shortDate(b.start))
  const netText = (i: number) => (future(i) || (!flows[i]!.income && !flows[i]!.spent) ? "" : `${flows[i]!.net > 0.5 ? "+" : ""}${shortMoney(flows[i]!.net)}`)
  const pairEnd = (i: number) => slots[i * 2 + 1] ?? slots[i * 2]
  const withNet = buckets.every((b, i) => {
    const slot = slots[i * 2], next = slots[(i + 1) * 2]
    if (!slot) return true
    const text = `${name(b)} ${netText(i)}`.trim()
    return slot.col + text.length < (next?.col ?? width + 1)
  })
  const line = new Array<string>(width).fill(" ")
  const labelInks: NonNullable<ChartModel["labelInks"]> = []
  let free = 0
  buckets.forEach((b, i) => {
    const slot = slots[i * 2]
    if (!slot || !pairEnd(i)) return
    const date = name(b)
    const net = withNet ? netText(i) : ""
    const text = net ? `${date} ${net}` : date
    if (slot.col < free || slot.col + text.length > width) return
    for (let c = 0; c < text.length; c++) line[slot.col + c] = text[c]!
    if (net) labelInks.push({ start: slot.col + date.length + 1, length: net.length, ink: flows[i]!.net >= 0 ? "in" : "out" })
    free = slot.col + text.length + 1
  })
  const income = sum(flows.map((f) => f.income)), spent = sum(flows.map((f) => f.spent))
  const net = income - spent
  // Money in that only starts partway: say so, rather than suggest nothing
  // came in before it.
  const firstIn = historyStart(flowRows(accounts, transactions, scopeIds).income)
  const inFrom = firstIn && firstIn > addDays(first, 31) && firstIn <= todayISO ? firstIn : null
  return {
    rows: annotate(plain, marks),
    ticks: moneyTicks(0, scale.max, scale.step, height),
    labels: line.join(""),
    labelInks,
    legend: [
      mark(BAR, "in"),
      muted(`In ${formatWholeMoney(income)}`),
      ...(inFrom ? [muted(` (recorded from ${monthYear(inFrom)})`)] : []),
      GAP,
      mark(BAR, "out"),
      muted(`Out ${formatWholeMoney(spent)}`),
      GAP,
      muted("Net "),
      { text: signedWholeMoney(net), fg: changeColor(net) },
      muted(` · ${monthly ? "monthly" : "weekly"}`),
    ],
  }
}
