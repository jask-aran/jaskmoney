/** Chart models for the Budgets tab's chart: how a budget is going this
 * cycle, and how it went cycle by cycle. Pure: each returns a ChartModel
 * for ChartBody, in the Overview's inks (periodCharts INKS). */
import { cumulative, formatWholeMoney } from "../../domain/dashboard"
import { MONTHS, addDays, type WeekStart } from "../../domain/days"
import type { Cycle } from "../../domain/budget"
import { shortMoney } from "../text"
import { columnBars } from "../charts/bars"
import { muted } from "../primitives/spans"
import { spendChangeColor } from "../colors"
import type { ChartModel } from "../charts/ChartBody"
import { annotate, lineAnchors, type ChartLabel } from "../charts/annotate"
import { barTopRow } from "../charts/bars"
import { dateAxis, lineChart, niceScale, pointCell } from "../charts/lineChart"
import { BAR, GAP, LINE, RULE, emptyChart, mark, moneyTicks } from "../overview/periodCharts"

/** A cycle's spending a day: one value per day of it (nothing after today). */
export interface CycleDays {
  cycle: Cycle
  daily: number[]
}

/** Where a cycle's spending ends at its pace so far, from a few days in
 * (earlier, one big day says too much) until its last day; else null. */
export function cycleProjection(spent: number, elapsed: number, days: number): number | null {
  return elapsed >= 3 && elapsed < days ? (spent / elapsed) * days : null
}

/**
 * This cycle so far as a running total, against the budget as a pace line
 * (nothing at the start, all of it by the end) and last cycle by the same
 * day; from a few days in, a dotted line to where the cycle ends at the
 * pace so far. The pace line is named in the chart, so the legend leaves
 * it out.
 */
export function thisCycleChart(now: CycleDays, last: CycleDays | null, budget: number | null, width: number, height: number, todayISO: string, weekStart: WeekStart): ChartModel {
  const { cycle } = now
  const n = cycle.days
  const dates = Array.from({ length: n }, (_, i) => addDays(cycle.start, i))
  const elapsed = dates.filter((d) => d <= todayISO).length
  if (!elapsed) return emptyChart("The cycle hasn't started")
  const total = cumulative(now.daily)
  const spent = total[elapsed - 1] ?? 0
  const prev = last ? cumulative(last.daily).slice(0, n) : []
  const then = prev.length ? prev[Math.min(elapsed, prev.length) - 1] ?? 0 : null
  const projected = cycleProjection(spent, elapsed, n)
  const ahead = projected == null ? [] : dates.map((_, i) => (i < elapsed - 1 ? null : spent + ((projected - spent) * (i - elapsed + 1)) / (n - elapsed)))
  const pace = dates.map((_, i) => (budget ?? 0) * ((i + 1) / n))
  const scale = niceScale(Math.max(spent, budget ?? 0, projected ?? 0, ...prev))
  const axis = dateAxis(dates, width, todayISO, undefined, weekStart)
  const at = (index: number, value: number) => pointCell(index, value, n, width, height, 0, scale.max)
  const marks: ChartLabel[] = [
    { ...at(elapsed - 1, spent), text: `This cycle ${shortMoney(spent)}`, short: shortMoney(spent), ink: "spend", required: true },
    ...(projected != null ? [{ ...at(n - 1, projected), text: `≈ ${shortMoney(projected)}`, ink: "spend" }] : []),
    ...(budget != null ? [{ ...at(n - 1, budget), text: `Budget ${shortMoney(budget)}`, short: "Budget", name: "Budget", along: lineAnchors(pace, n - 2, at), ink: "limit" }] : []),
    ...(prev.length ? [{ ...at(prev.length - 1, prev.at(-1)!), text: "Last cycle", name: "Last cycle", along: lineAnchors(prev, prev.length - 2, at), ink: "prev" }] : []),
  ]
  const diff = then ? Math.round(((spent - then) / then) * 100) : null
  return {
    rows: annotate(lineChart({
      series: [
        ...(budget != null ? [{ values: pace, ink: "limit" }] : []),
        { values: prev, ink: "prev" },
        { values: ahead, ink: "partial" },
        { values: total.map((v, i) => (i < elapsed ? v : null)), ink: "spend" },
      ],
      length: n, width, height, min: 0, max: scale.max, markers: axis.markers,
    }), marks),
    ticks: moneyTicks(0, scale.max, scale.step, height),
    labels: axis.labels,
    today: axis.today,
    legend: [
      mark(LINE, "spend"),
      muted(`This cycle ${formatWholeMoney(spent)}`),
      ...(then != null ? [GAP, mark(LINE, "prev"), muted(`Last cycle ${formatWholeMoney(then)} by now`), ...(diff != null ? [{ text: ` ${diff > 0 ? "+" : ""}${diff}%`, fg: spendChangeColor(diff) }] : [])] : []),
    ],
  }
}

/**
 * Cycle by cycle, oldest first, then this one so far (lighter, its month
 * in today's colour under it): a bar per
 * cycle, green where it kept to the budget and red where it went over,
 * with the budget as a rule across them; each bar's total over it where
 * it fits. Without a budget the bars are plain spending.
 */
export function cyclesChart(past: Array<{ cycle: Cycle; spent: number }>, current: { cycle: Cycle; spent: number }, budget: number | null, width: number, height: number): ChartModel {
  const all = [...past, current]
  const ink = (spent: number) => (budget == null ? "spend" : spent > budget ? "out" : "in")
  const bars = all.map((c, i) => ({ value: c.spent, ink: i === all.length - 1 ? "partial" : ink(c.spent) }))
  const scale = niceScale(Math.max(budget ?? 0, ...bars.map((b) => b.value)))
  const { rows, slots } = columnBars(bars, width, height, scale.max, budget != null ? { value: budget, ink: "limit" } : undefined)
  const marks: ChartLabel[] = bars.flatMap((b, i) => {
    const row = barTopRow(b.value, scale.max, height)
    return row < 0 || !slots[i] ? [] : [{ row, col: slots[i]!.col, bar: slots[i]!, text: shortMoney(b.value), ink: "note" }]
  })
  // Under each bar its cycle's start: the day too where bars are wide.
  const roomy = Math.min(...slots.map((s) => s.width)) >= 6
  const line = new Array<string>(width).fill(" ")
  let free = 0
  let today: ChartModel["today"]
  all.forEach((c, i) => {
    const slot = slots[i]
    if (!slot) return
    const month = MONTHS[Number(c.cycle.start.slice(5, 7)) - 1]!
    const text = roomy ? `${Number(c.cycle.start.slice(8, 10))} ${month}` : month
    if (slot.col < free || slot.col + text.length > width) return
    for (let k = 0; k < text.length; k++) line[slot.col + k] = text[k]!
    if (i === all.length - 1) today = { start: slot.col, length: text.length }
    free = slot.col + text.length + 1
  })
  const avg = past.length ? past.reduce((sum, c) => sum + c.spent, 0) / past.length : null
  const over = budget == null ? 0 : past.filter((c) => c.spent > budget).length
  return {
    rows: annotate(rows, marks),
    ticks: moneyTicks(0, scale.max, scale.step, height),
    labels: line.join(""),
    ...(today ? { today } : {}),
    legend: [
      ...(budget != null
        ? [mark(BAR, "in"), muted("under"), GAP, mark(BAR, "out"), muted("over"), GAP, mark(RULE, "limit"), muted(`Budget ${formatWholeMoney(budget)}`), ...(past.length ? [muted(` · over in ${over} of ${past.length}`)] : [])]
        : [mark(BAR, "spend"), muted("Spent a cycle")]),
      ...(avg != null ? [muted(` · avg ${formatWholeMoney(avg)}`)] : []),
    ],
  }
}
