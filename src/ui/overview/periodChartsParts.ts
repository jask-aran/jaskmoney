import { INKS } from "../charts/inks"
import { MONTHS } from "../../domain/days"
import { shortMoney, truncate } from "../text"
import { muted, type Span } from "../primitives/spans"
import type { ChartModel } from "../charts/ChartBody"
import type { ChartLabel } from "../charts/annotate"
import { cellColumn, tickRows } from "../charts/lineChart"

export const sum = (values: number[]) => values.reduce((a, b) => a + b, 0)

export const LINE = "⠒⠒ "
export const BAR = "▆ "
export const RULE = "┈┈ "
export const mark = (shape: string, ink: keyof typeof INKS): Span => ({ text: shape, fg: INKS[ink]! })
export const GAP = muted("   ")

export const emptyChart = (why: string): ChartModel => ({ rows: [], ticks: new Map(), labels: "", legend: [muted(why)] })

export const moneyTicks = (min: number, max: number, step: number, height: number) => tickRows(min, max, step, height, shortMoney)

export interface PeriodNames {
  current: string
  previous: string
}
export const DEFAULT_NAMES: PeriodNames = { current: "This period", previous: "Last period" }

export const monthYear = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`

const NAME_LONG = 28
const NAME_SHORT = 14
export const spendName = (name: string) => truncate(name, NAME_SHORT)
export const rowNames = (name: string) => [...new Set([truncate(name, NAME_LONG), spendName(name)])]

export const barNames = (amount: string, total: number, payee: { name: string; amount: number } | undefined, sign = ""): string[] =>
  !payee || payee.amount < 0.25 * total ? [amount] : rowNames(payee.name).map((name) => (payee.amount >= 0.9 * total ? `${name} ${amount}` : `${amount} · ${name} ${sign}${shortMoney(payee.amount)}`))

export function lineMarkers(markers: Array<{ index: number; ink: string }>, days: number, width: number): Array<{ col: number; ink: string }> {
  return markers.map((m) => ({ col: cellColumn(m.index, days, width), ink: m.ink }))
}

function dateSlots(starts: string[], dates: string[], width: number): Array<{ col: number; width: number }> {
  const n = dates.length
  const cols = starts.map((iso) => cellColumn(Math.max(0, dates.indexOf(iso)), n, width))
  return cols.map((col, k) => {
    const from = k === 0 ? col : col + 1
    const to = k === cols.length - 1 ? width - 1 : cols[k + 1]! - 1
    return { col: Math.min(from, width - 1), width: Math.max(1, to - from + 1) }
  })
}

export function unshownPeriod(name: string, amounts: Array<{ value: number; sign: string; ink: string }>, dates: string[], todayISO: string, width: number): ChartLabel[] {
  const col = cellColumn(Math.max(0, dates.indexOf(todayISO)), dates.length, width)
  const shown = amounts.filter((a) => a.value > 0)
  return shown.map((a, k) => {
    const money = `${a.sign}${shortMoney(a.value)}`
    return { row: k, col, text: `${name} ${money}`, ink: a.ink }
  })
}

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
  const spans = dateSlots(starts, dates, width).map((s) =>
    todayCol != null && s.col + s.width > todayCol ? { col: s.col, width: Math.max(0, todayCol - s.col) } : s)
  return { markers, spans }
}
