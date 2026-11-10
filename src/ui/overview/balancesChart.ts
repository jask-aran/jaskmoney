import { INKS } from "../charts/inks"
import { signedWholeMoney, formatWholeMoney } from "../../domain/dashboard"
import { balanceHistory, biggestRow, saverHistories } from "../../domain/position"
import { accountRole, type Account, type Transaction } from "../../domain/types"
import type { WeekStart } from "../../domain/days"
import { shortDate, shortMoney, truncate } from "../text"
import { muted } from "../primitives/spans"
import { changeColor } from "../colors"
import type { ChartModel } from "../charts/ChartBody"
import { annotate, lineAnchors, type ChartLabel } from "../charts/annotate"
import { dateAxis, fitRange, lineChart, pointCell } from "../charts/lineChart"
import { saverInks } from "../charts/saverInks"
import { GAP, LINE, emptyChart, mark, moneyTicks, rowNames } from "./periodChartsParts"

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
  projection: ReadonlyArray<{ dateISO: string; value: number }> = [],
): ChartModel {
  const last = dates.filter((d) => d <= todayISO).at(-1)
  if (!dates.length || !last) return emptyChart("No balances in range")
  if (view === "Savers") return saversChart(dates, last, width, height, todayISO, accounts, transactions, weekStart, zeroAxis)
  const history = balanceHistory(accounts, transactions, dates[0]!, last)
  const pick = (p: (typeof history)[number]) => (view === "Available" ? p.spending : p.net)
  const values = history.map(pick)
  const latest = values.length - 1
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
  const moveLabels = biggestMoves(view, values, { lo, hi }, dates, width, accounts, transactions, at)
  const end = ahead.at(-1)
  const ends = (v: number) => (v < 0 ? `≈ ${shortMoney(-v)} short` : `≈ ${shortMoney(v)}`)
  const runsOut = ahead.find((p, k) => p.value < 0 && (k ? ahead[k - 1]!.value : values[latest]!) >= 0)
  const marks: ChartLabel[] = [
    { ...at(latest), text: shortMoney(values[latest]!), ink },
    ...(end ? [{ ...at(dates.indexOf(end.dateISO), end.value), text: `${ends(end.value)} by ${shortDate(end.dateISO)}`, short: ends(end.value), ink: "projection" }] : []),
    ...(runsOut ? [{ ...at(dates.indexOf(runsOut.dateISO), runsOut.value), text: `$0 by ${shortDate(runsOut.dateISO)}`, ink: "projection" }] : []),
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
      ...(end ? [GAP, mark(LINE, "projection"), muted(runsOut
        ? `runs out ${shortDate(runsOut.dateISO)}, ${formatWholeMoney(-end.value)} short by ${shortDate(end.dateISO)}`
        : `${end.value < 0 ? `${formatWholeMoney(-end.value)} short` : `≈ ${formatWholeMoney(end.value)}`} by ${shortDate(end.dateISO)} at usual spending`)]
        : [GAP, muted(`low ${formatWholeMoney(lo)} on ${shortDate(history[low]!.dateISO)}`)]),
    ],
  }
}

function biggestMoves(
  view: "Net position" | "Available",
  values: number[],
  { lo, hi }: { lo: number; hi: number },
  dates: string[],
  width: number,
  accounts: Account[],
  transactions: Transaction[],
  at: (i: number) => { row: number; col: number },
): ChartLabel[] {
  const counted = new Set(accounts.filter((a) => a.balance !== null && (view !== "Available" || accountRole(a) === "spending")).map((a) => a.id))
  const moving = transactions.filter((t) => t.accountId != null && counted.has(t.accountId) && (view === "Available" || !t.internal))
  const moves = values.map((v, i) => ({ i, d: i ? v - values[i - 1]! : 0 }))
    .filter((m) => Math.abs(m.d) >= (hi - lo) * 0.08 && m.d !== 0)
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))
    .slice(0, Math.max(1, Math.floor(width / 30)))
  const moveLabels: ChartLabel[] = moves.map(({ i, d }) => {
    const row = biggestRow(moving.filter((t) => Math.sign(t.amount) === Math.sign(d)), dates[i]!, dates[i]!)
    const amount = `${d > 0 ? "+" : "-"}${shortMoney(Math.abs(d))}`
    const [text, ...shorter] = row ? rowNames(row.description).map((name) => `${amount} ${name}`) : [amount]
    return { ...at(i), text: text!, short: [...shorter, amount], ink: d > 0 ? "in" : "out" }
  })
  return moveLabels
}

const MAX_SAVER_LINES = 6
const ROWS_PER_SAVER_LINE = 3
const SAVER_LABEL = 16

function saversChart(dates: string[], last: string, width: number, height: number, todayISO: string, accounts: Account[], transactions: Transaction[], weekStart: WeekStart, zeroAxis: boolean): ChartModel {
  const all = saverHistories(accounts, transactions, dates[0]!, last)
  if (!all.length) return emptyChart("No savers")
  const total = all[0]!.values.map((_, i) => all.reduce((sum, s) => sum + s.values[i]!, 0))
  const room = Math.max(1, Math.min(MAX_SAVER_LINES, Math.floor(height / ROWS_PER_SAVER_LINE)))
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
    rows: annotate(lineChart({
      series: [...shown.map((s) => ({ values: s.values, ink: `saver${s.accountId}` })), { values: total, ink: "total" }],
      length: dates.length, width, height, min: range.min, max: range.max, markers: axis.markers,
    }), [
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
