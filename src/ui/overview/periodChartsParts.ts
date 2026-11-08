/** What the Overview's chart models share: legend marks, an empty chart,
 * money ticks, bar labels and the rules bars for runs of days sit on. */
import { INKS } from "../charts/inks"
import { MONTHS } from "../../domain/days"
import { shortMoney, truncate } from "../text"
import { muted, type Span } from "../primitives/spans"
import type { ChartModel } from "../charts/ChartBody"
import type { ChartLabel } from "../charts/annotate"
import { cellColumn, tickRows } from "../charts/lineChart"

export const sum = (values: number[]) => values.reduce((a, b) => a + b, 0)

/** Legend marks: a line series, a bar, a rule, each in its series' ink. */
export const LINE = "⠒⠒ "
export const BAR = "▆ "
export const RULE = "┈┈ "
export const mark = (shape: string, ink: keyof typeof INKS): Span => ({ text: shape, fg: INKS[ink]! })
export const GAP = muted("   ")

/** A chart with nothing to draw, saying why in its legend. */
export const emptyChart = (why: string): ChartModel => ({ rows: [], ticks: new Map(), labels: "", legend: [muted(why)] })

/** Money labels down the y-axis for ticks every `step` from `min` to `max`. */
export const moneyTicks = (min: number, max: number, step: number, height: number) => tickRows(min, max, step, height, shortMoney)

/** What the range and the one before it are called in legends and labels. */
export interface PeriodNames {
  current: string
  previous: string
}
export const DEFAULT_NAMES: PeriodNames = { current: "This period", previous: "Last period" }

/** "Nov 2025". */
export const monthYear = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`

/** What a row is called in a chart label: in full up to NAME_LONG cells,
 * and as a label falls back for room, NAME_SHORT. */
const NAME_LONG = 28
const NAME_SHORT = 14
export const spendName = (name: string) => truncate(name, NAME_SHORT)
export const rowNames = (name: string) => [...new Set([truncate(name, NAME_LONG), spendName(name)])]

/** A bar's label naming what made it tall: "Centre Com $826" when that
 * payee is (nearly) the whole bar, else the bar's figure and then the
 * biggest payee's own, "$1.3k · Centre Com $826", so a name never reads
 * as the whole bar; just the figure when no payee is a quarter of it.
 * `sign` prefixes the payee's figure as it does `amount`. */
export const barNames = (amount: string, total: number, payee: { name: string; amount: number } | undefined, sign = ""): string[] =>
  !payee || payee.amount < 0.25 * total ? [amount] : rowNames(payee.name).map((name) => (payee.amount >= 0.9 * total ? `${name} ${amount}` : `${amount} · ${name} ${sign}${shortMoney(payee.amount)}`))

/** The rules a line chart over the same `days` draws (dateAxis), at its
 * columns: the layer under a bar chart's bars, so both panes' gridlines
 * and today's rule fall in the same columns whatever their views. */
export function lineMarkers(markers: Array<{ index: number; ink: string }>, days: number, width: number): Array<{ col: number; ink: string }> {
  return markers.map((m) => ({ col: cellColumn(m.index, days, width), ink: m.ink }))
}

/** Where bars standing for runs of days go: each from its first day's
 * column to the next's (cellColumn, as a line chart places days), less
 * the column a line chart's rule for the next run's start would take,
 * which is left as its gap; the last runs to the right edge. `starts` are
 * the runs' first days, in `dates`. Widths follow the days a run has: a
 * partial week is narrower. */
function dateSlots(starts: string[], dates: string[], width: number): Array<{ col: number; width: number }> {
  const n = dates.length
  const cols = starts.map((iso) => cellColumn(Math.max(0, dates.indexOf(iso)), n, width))
  return cols.map((col, k) => {
    const from = k === 0 ? col : col + 1
    const to = k === cols.length - 1 ? width - 1 : cols[k + 1]! - 1
    return { col: Math.min(from, width - 1), width: Math.max(1, to - from + 1) }
  })
}

/**
 * Labels for a run of days with no room for its bars (today its first day
 * or so: runRules leaves it no columns before today's rule): each amount
 * named for the run ("this week -$120"), from the top beside today's rule,
 * one row each; nothing at all when it has none. A bar chart's labels go
 * where their cells are free, so these keep clear of the bars, or aren't
 * placed: whole or not at all, so the caller can tell and say them
 * elsewhere.
 */
export function unshownPeriod(name: string, amounts: Array<{ value: number; sign: string; ink: string }>, dates: string[], todayISO: string, width: number): ChartLabel[] {
  const col = cellColumn(Math.max(0, dates.indexOf(todayISO)), dates.length, width)
  const shown = amounts.filter((a) => a.value > 0)
  return shown.map((a, k) => {
    const money = `${a.sign}${shortMoney(a.value)}`
    return { row: k, col, text: `${name} ${money}`, ink: a.ink }
  })
}

/**
 * The gridlines and spans for bars standing for runs of days (a week, a
 * month): a rule where each run starts and on today, and no other (a
 * month's first day inside a week's bar would run through it, as would
 * today's), with each span cut short of today's rule. A run with no
 * columns left before today's rule gets an empty span (width 0): it draws
 * nothing. The rules sit where a line chart over the same days draws them,
 * so the panes still share them.
 */
export function runRules(
  starts: string[],
  dates: string[],
  width: number,
  todayISO: string,
  ink: (iso: string) => string,
): { markers: Array<{ col: number; ink: string }>; spans: Array<{ col: number; width: number }> } {
  const n = dates.length
  const markers = starts.slice(1).map((iso) => ({ col: cellColumn(Math.max(0, dates.indexOf(iso)), n, width), ink: ink(iso) }))
  const today = dates.indexOf(todayISO)
  const todayCol = today > 0 ? cellColumn(today, n, width) : null
  if (todayCol != null) {
    for (let i = markers.length - 1; i >= 0; i--) if (markers[i]!.col === todayCol) markers.splice(i, 1)
    markers.push({ col: todayCol, ink: "today" })
  }
  // Anything at or past today's rule is cut back to it: a run starting
  // today begins a column past the rule, so has none.
  const spans = dateSlots(starts, dates, width).map((s) =>
    todayCol != null && s.col + s.width > todayCol ? { col: s.col, width: Math.max(0, todayCol - s.col) } : s)
  return { markers, spans }
}
