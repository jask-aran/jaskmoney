/** Chart models for the Budgets tab's chart: how a budget is going this
 * cycle, and how it went cycle by cycle. Pure: each returns a ChartModel
 * for ChartBody, in the Overview's inks (periodCharts INKS). */
import { cumulative, formatWholeMoney } from "../../domain/dashboard"
import { MONTHS, addDays, type WeekStart } from "../../domain/days"
import type { Cycle } from "../../domain/budget"
import { shortMoney } from "../text"
import { barSlots, columnBars } from "../charts/bars"
import { muted, type Span } from "../primitives/spans"
import { spendChangeColor } from "../colors"
import type { ChartModel } from "../charts/ChartBody"
import { annotate, lineAnchors, type ChartLabel } from "../charts/annotate"
import { barTopRow } from "../charts/bars"
import { dateAxis, lineChart, niceScale, pointCell } from "../charts/lineChart"
import { BAR, GAP, INKS, LINE, RULE, emptyChart, mark, moneyTicks } from "../overview/periodCharts"
import { ink, tone } from "../../theme"

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

/** A cycle's spending and the budget in force in it (null: none). */
export interface CycleSpent {
  cycle: Cycle
  spent: number
  budget: number | null
}

/** Over or under its budget, and by how much ("$780 over"). */
const verdict = (c: CycleSpent): Span | null =>
  c.budget == null ? null : c.spent > c.budget ? { text: `${formatWholeMoney(c.spent - c.budget)} over`, fg: tone.bad } : { text: `${formatWholeMoney(c.budget - c.spent)} under`, fg: tone.good }

/** How the cycles before this one went: over budget in how many, and
 * their average. */
const pastSummary = (past: CycleSpent[]): Span[] => {
  const budgeted = past.filter((c) => c.budget != null)
  const over = budgeted.filter((c) => c.spent > c.budget!).length
  const avg = past.length ? past.reduce((sum, c) => sum + c.spent, 0) / past.length : null
  return [
    ...(budgeted.length ? [muted(`over in ${over} of ${budgeted.length}`)] : []),
    ...(avg != null ? [muted(`${budgeted.length ? " · " : ""}avg ${formatWholeMoney(avg)}`)] : []),
  ]
}

/**
 * Cycle by cycle, oldest first, then this one so far (lighter, its month
 * in today's colour under it): a bar per cycle, green where it kept to its
 * budget and red where it went over, with each cycle's budget as a rule
 * across its bar (it steps where the budget changed); each bar's total over
 * it where it fits. Without a budget the bars are plain spending.
 */
export function cyclesChart(cycles: CycleSpent[], width: number, height: number): ChartModel {
  const past = cycles.slice(0, -1)
  const bars = cycles.map((c, i) => ({ value: c.spent, ink: i === cycles.length - 1 ? "partial" : c.budget == null ? "spend" : c.spent > c.budget ? "out" : "in" }))
  const scale = niceScale(Math.max(...cycles.map((c) => Math.max(c.budget ?? 0, c.spent))))
  const slots = barSlots(cycles.length, width)
  // Each budget from its bar's first column to the next bar's.
  const rules = cycles.flatMap((c, i) => (c.budget == null || !slots[i] ? [] : [{ value: c.budget, ink: "limit", from: slots[i]!.col, to: slots[i + 1]?.col ?? width }]))
  const { rows } = columnBars(bars, width, height, scale.max, rules)
  const marks: ChartLabel[] = bars.flatMap((b, i) => {
    const row = barTopRow(b.value, scale.max, height)
    return row < 0 || !slots[i] ? [] : [{ row, col: slots[i]!.col, bar: slots[i]!, text: shortMoney(b.value), ink: "note" }]
  })
  // Under each bar its cycle's start: the day too where bars are wide.
  const roomy = Math.min(...slots.map((s) => s.width)) >= 6
  const line = new Array<string>(width).fill(" ")
  let free = 0
  let today: ChartModel["today"]
  cycles.forEach((c, i) => {
    const slot = slots[i]
    if (!slot) return
    const month = MONTHS[Number(c.cycle.start.slice(5, 7)) - 1]!
    const text = roomy ? `${Number(c.cycle.start.slice(8, 10))} ${month}` : month
    if (slot.col < free || slot.col + text.length > width) return
    for (let k = 0; k < text.length; k++) line[slot.col + k] = text[k]!
    if (i === cycles.length - 1) today = { start: slot.col, length: text.length }
    free = slot.col + text.length + 1
  })
  const budgets = new Set(cycles.map((c) => c.budget).filter((b) => b != null))
  return {
    rows: annotate(rows, marks),
    ticks: moneyTicks(0, scale.max, scale.step, height),
    labels: line.join(""),
    ...(today ? { today } : {}),
    legend: [
      ...(budgets.size
        ? [mark(BAR, "in"), muted("under"), GAP, mark(BAR, "out"), muted("over"), GAP, mark(RULE, "limit"), muted(budgets.size === 1 ? `Budget ${formatWholeMoney([...budgets][0]!)}` : "Budget"), muted(" · ")]
        : [mark(BAR, "spend"), muted("Spent a cycle · ")]),
      ...pastSummary(past),
    ],
  }
}

/**
 * The cycles newest first, a line each: its dates, what was spent, a bar on
 * one scale for them all (green up to the cycle's budget and red past it,
 * the budget marked │ where the bar falls short of it; this cycle's
 * coloured by its pace, ▏ where an even pace would be by now if it falls
 * short of that; without a budget, plain spending), and how far under or
 * over (a year that isn't this one after its dates). `width` is the
 * line's; `pace` is how far through this cycle is.
 */
export function cycleLines(cycles: CycleSpent[], width: number, pace: number, todayISO: string): Span[][] {
  if (!cycles.length) return []
  const scale = Math.max(1, ...cycles.map((c) => Math.max(c.spent, c.budget ?? 0)))
  const day = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`
  const dates = cycles.map((c) => `${day(c.cycle.start)} – ${day(c.cycle.end)}${c.cycle.end.slice(0, 4) === todayISO.slice(0, 4) ? "" : ` ${c.cycle.end.slice(2, 4)}`}`)
  const verdicts = cycles.map(verdict)
  // Columns as wide as what's in them; the bar takes the rest.
  const DATES = Math.max(...dates.map((d) => d.length)) + 2
  const SPENT = Math.max(...cycles.map((c) => formatWholeMoney(c.spent).length)) + 1
  const VERDICT = Math.max(0, ...verdicts.map((v) => (v ? v.text.length + 1 : 0)))
  const bar = Math.max(1, width - DATES - SPENT - 2 - VERDICT)
  return cycles.map((c, i) => {
    const now = i === 0
    const cells = (v: number) => Math.round((v / scale) * bar)
    const filled = cells(c.spent)
    const limit = c.budget == null ? -1 : Math.min(bar - 1, cells(c.budget))
    const paceAt = now && c.budget != null ? Math.min(bar - 1, cells(c.budget * pace)) : -1
    const fillInk = (k: number) => c.budget == null ? INKS.spend!
      : k >= limit ? tone.bad
      : now ? (c.spent > c.budget * pace ? tone.caution : tone.good)
      : tone.good
    const spans: Span[] = []
    const push = (text: string, fg: string) => {
      const last = spans.at(-1)
      if (last && last.fg === fg) last.text += text
      else spans.push({ text, fg })
    }
    for (let k = 0; k < bar; k++) {
      if (k < filled) push("█", fillInk(k))
      else if (k === limit) push("│", ink.figure)
      else if (k === paceAt) push("▏", ink.note)
      else push(k < Math.max(limit, 0) ? "─" : " ", ink.rule)
    }
    const v = verdicts[i]
    return [
      { text: dates[i]!.padEnd(DATES), fg: now ? ink.figure : ink.label, bold: now },
      { text: `${formatWholeMoney(c.spent).padStart(SPENT - 1)} `, fg: now ? ink.strong : ink.figure, bold: now },
      { text: " ", fg: ink.rule },
      ...spans,
      { text: " ", fg: ink.rule },
      v ? { ...v, text: v.text.padStart(VERDICT) } : { text: "".padStart(VERDICT), fg: ink.note },
    ]
  })
}

/** The cycles' bars' legend: how they went, and what the marks mean. */
export function cycleLinesLegend(cycles: CycleSpent[]): Span[] {
  const budgeted = cycles.some((c) => c.budget != null)
  return [
    ...pastSummary(cycles.slice(1)),
    ...(budgeted ? [GAP, { text: "│", fg: ink.figure }, muted(" budget  "), { text: "▏", fg: ink.note }, muted(" pace now")] : []),
  ]
}
