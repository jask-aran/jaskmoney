import { tone } from "../../theme"
import { cumulative, dailySpendSeries, formatWholeMoney, signedWholeMoney, weeklyTotals } from "../../domain/dashboard"
import { biggestPayee, computePeriodFlows, flowRows, historyCovers, historyStart } from "../../domain/position"
import type { Account, Transaction } from "../../domain/types"
import { isSpending } from "../../domain/moneyRules"
import { MONTHS, addDays, dayOfWeek, daysBetween, type WeekStart } from "../../domain/days"
import { shortDate, shortMoney } from "../text"
import { barSlots, barTopRow, columnBars, ruleRow } from "../charts/bars"
import { muted, type Span } from "../primitives/spans"
import { changeColor, spendChangeColor } from "../colors"
import type { ChartModel } from "../charts/ChartBody"
import { annotate, lineAnchors, stamp, type ChartLabel } from "../charts/annotate"
import { cellColumn, dateAxis, lineChart, niceScale, pointCell, valueRow } from "../charts/lineChart"
import { BAR, DEFAULT_NAMES, GAP, LINE, RULE, barNames, emptyChart, lineMarkers, mark, moneyTicks, monthYear, runRules, spendName, sum, unshownPeriod, type PeriodNames } from "./periodChartsParts"

const PROJECT_FROM = 3

export { INKS } from "../charts/inks"
export { GAP, type PeriodNames } from "./periodChartsParts"
export { balancesChart } from "./balancesChart"

interface SpendingFrame {
  dates: string[]
  values: number[]
  n: number
  elapsed: number
  upToToday: (vs: number[]) => Array<number | null>
  axis: ReturnType<typeof dateAxis>
  named: (start: string, end: string) => ReturnType<typeof biggestPayee>
  width: number
  height: number
  todayISO: string
  spendingRows: Transaction[]
  budget?: number
  names: PeriodNames
  weekStart: WeekStart
}

export function spendingChart(
  view: "Daily" | "Cumulative" | "Weekly",
  series: { dates: string[]; values: number[] },
  width: number,
  height: number,
  todayISO: string,
  spendingRows: Transaction[],
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

  const outs = spendingRows.filter((t) => t.amount < 0 && isSpending(t))
  const named = (start: string, end: string) => biggestPayee(outs, start, end)

  const frame: SpendingFrame = { dates, values, n, elapsed, upToToday, axis, named, width, height, todayISO, spendingRows, budget, names, weekStart }
  if (view === "Weekly") return weeklySpending(frame)
  if (view === "Cumulative") return cumulativeSpending(frame)
  return dailySpending(frame)
}

function weeklySpending({ dates, values, n, upToToday, axis, named, width, height, todayISO, budget, weekStart }: SpendingFrame): ChartModel {
  const weeks = weeklyTotals(dates, upToToday(values).map((v) => v ?? 0), weekStart)
  const perWeek = budget != null ? (budget * 7) / n : null
  const scale = niceScale(Math.max(0, perWeek ?? 0, ...weeks.map((w) => w.total)))
  const partial = (w: (typeof weeks)[number]) => w.days < 7 || addDays(w.startISO, 6) >= todayISO
  const bars = weeks.map((w) => ({ value: w.startISO <= todayISO ? w.total : 0, ink: partial(w) ? "partial" : "spend" }))
  const { markers, spans } = runRules(weeks.map((w) => w.startISO), dates, width, todayISO, () => "week")
  const { rows: plain, slots } = columnBars(bars, width, height, scale.max, perWeek ? { value: perWeek, ink: "limit" } : undefined, markers, 1, spans)
  const current = weeks.findLastIndex((w) => w.startISO <= todayISO && addDays(w.startISO, 6) >= todayISO)
  const bySize = bars.map((_, i) => i).filter((i) => bars[i]!.value > 0).sort((a, b) => bars[b]!.value - bars[a]!.value)
  const roomy = Math.min(...slots.filter((s) => s.width).map((s) => s.width)) >= 5
  const order = [...new Set([...(current >= 0 && bars[current]!.value > 0 ? [current] : []), ...bySize.slice(0, roomy ? bySize.length : 3)])]
  const at = (i: number) => ({ row: barTopRow(bars[i]!.value, scale.max, height), col: slots[i]!.col + Math.floor((slots[i]!.width - 1) / 2), bar: slots[i]! })
  const biggest = bySize[0]
  const marks: ChartLabel[] = order.filter((i) => slots[i]?.width).map((i) => {
    const total = shortMoney(bars[i]!.value)
    const row = i === biggest ? named(weeks[i]!.startISO, addDays(weeks[i]!.startISO, 6)) : undefined
    const [text, ...shorter] = barNames(total, bars[i]!.value, row)
    return { ...at(i), text: text!, short: [...shorter, total], ink: "note" }
  }).filter((l) => l.row >= 0)
  if (current >= 0 && !slots[current]?.width) marks.unshift(...unshownPeriod("this week", [{ value: weeks[current]!.total, sign: "", ink: "note" }], dates, todayISO, width))
  if (perWeek) marks.push({ row: ruleRow(perWeek, scale.max, height), col: width - 1 - "budget".length - 2, text: "budget", ink: "limit" })
  return {
    rows: annotate(plain, marks),
    ticks: moneyTicks(0, scale.max, scale.step, height),
    labels: axis.labels,
    today: axis.today,
    legend: [
      mark(BAR, "spend"),
      muted(bars.some((b) => b.ink === "spend") ? `Weeks, avg ${formatWholeMoney(sum(weeks.filter((w, i) => bars[i]!.ink === "spend").map((w) => w.total)) / bars.filter((b) => b.ink === "spend").length)}` : "No full weeks yet"),
      ...(bars.some((b) => b.ink === "partial") ? [GAP, mark(BAR, "partial"), muted(current >= 0 ? `partial week · this week ${formatWholeMoney(weeks[current]!.total)} so far` : "partial week")] : []),
      ...(perWeek ? [GAP, mark(RULE, "limit"), muted(`Budget ${formatWholeMoney(perWeek)} a week`)] : []),
    ],
  }
}

function cumulativeSpending({ dates, values, n, elapsed, upToToday, axis, width, height, spendingRows, budget, names }: SpendingFrame): ChartModel {
  const total = cumulative(values)
  const prevStart = addDays(dates[0]!, -n)
  const covered = elapsed > 0 && historyCovers(spendingRows, { start: prevStart, end: addDays(prevStart, elapsed - 1) }, { start: dates[0]!, end: dates[elapsed - 1]! })
  const prev = covered ? cumulative(dailySpendSeries(spendingRows, prevStart, addDays(dates[0]!, -1)).values) : []
  const now = elapsed > 0 ? total[elapsed - 1]! : 0
  const then = elapsed > 0 ? prev[elapsed - 1] ?? 0 : 0
  const projected = elapsed >= PROJECT_FROM && elapsed < n ? (now / elapsed) * n : null
  const ahead = projected == null ? [] : dates.map((_, i) => (i < elapsed - 1 ? null : now + ((projected - now) * (i - elapsed + 1)) / (n - elapsed)))
  const scale = niceScale(Math.max(now, budget ?? 0, projected ?? 0, ...prev))
  const diff = then > 0 ? Math.round(((now - then) / then) * 100) : null
  const pace = (i: number) => (budget ?? 0) * ((i + 1) / n)
  const limit = budget != null ? [{ values: dates.map((_, i) => pace(i)), ink: "limit" }] : []
  const overPace = budget != null && elapsed > 0 ? now - pace(elapsed - 1) : null
  const at = (index: number, value: number) => pointCell(index, value, n, width, height, 0, scale.max)
  const paceLine = dates.map((_, i) => pace(i))
  const marks: ChartLabel[] = [
    ...(elapsed > 0 ? [{ ...at(elapsed - 1, now), text: `${names.current} ${shortMoney(now)}`, ink: "spend", required: true }] : []),
    ...(budget != null && elapsed > 0 && elapsed < n ? [{ ...at(elapsed - 1, pace(elapsed - 1)), text: shortMoney(pace(elapsed - 1)), ink: "limit" }] : []),
    ...(projected != null ? [{ ...at(n - 1, projected), text: `≈ ${shortMoney(projected)}`, ink: "spend" }] : []),
    ...(prev.length ? [{ ...at(n - 1, prev[n - 1]!), text: names.previous, name: names.previous, along: lineAnchors(prev, n - 2, at), ink: "prev" }] : []),
    ...(budget != null ? [{ ...at(n - 1, budget), text: "Budget", name: "Budget", along: lineAnchors(paceLine, n - 2, at), ink: "limit" }] : []),
  ]
  return {
    rows: annotate(lineChart({ series: [...limit, { values: prev, ink: "prev" }, { values: ahead, ink: "partial" }, { values: upToToday(total), ink: "spend" }], length: n, width, height, min: 0, max: scale.max, markers: axis.markers }), marks),
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
          { text: `${formatWholeMoney(Math.abs(overPace))} ${overPace > 0 ? "over" : "under"}${elapsed < n ? " pace" : ""}`, fg: spendChangeColor(overPace) },
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

function dailySpending(frame: SpendingFrame): ChartModel {
  const { dates, values, n, elapsed, named, width } = frame
  const shown = values.slice(0, elapsed)
  const avg = elapsed ? sum(shown) / elapsed : 0
  const peak = shown.reduce((best, v, i) => (v > shown[best]! ? i : best), 0)
  const peakRow = shown[peak] ? named(dates[peak]!, dates[peak]!) : undefined
  const biggestDays = shown.map((_, i) => i).filter((i) => shown[i]! > 0).sort((a, b) => shown[b]! - shown[a]!).slice(0, Math.max(1, Math.floor(width / 24)))
  const dayLabel = (i: number) => {
    const row = named(dates[i]!, dates[i]!)
    const [text, ...shorter] = barNames(shortMoney(shown[i]!), shown[i]!, row)
    return { text: text!, short: [...shorter, shortMoney(shown[i]!)] }
  }
  const peakNote = shown[peak] ? [muted(`, peak ${formatWholeMoney(shown[peak]!)} on ${shortDate(dates[peak]!)}${peakRow ? ` (${spendName(peakRow.name)})` : ""}`)] : []

  const days: DailyDays = { shown, avg, biggestDays, dayLabel, peakNote }
  if (n > width) return dailyAverage(frame, days)
  return dailyBars(frame, days)
}

interface DailyDays {
  shown: number[]
  avg: number
  biggestDays: number[]
  dayLabel: (i: number) => { text: string; short: string[] }
  peakNote: Span[]
}

function dailyAverage({ values, n, elapsed, axis, width, height }: SpendingFrame, { shown, avg, biggestDays, dayLabel, peakNote }: DailyDays): ChartModel {
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

function dailyBars({ dates, values, n, elapsed, axis, width, height, todayISO, budget }: SpendingFrame, { shown, avg, biggestDays, dayLabel, peakNote }: DailyDays): ChartModel {
  const slots = barSlots(n, width)
  const todayIndex = elapsed - 1
  const daysLeft = n - elapsed
  const spentSoFar = sum(shown)
  const left = budget != null && daysLeft > 0 ? Math.max(0, (budget - spentSoFar) / daysLeft) : null
  const bars = dates.map((d, i) => ({ value: i < elapsed ? values[i]! : 0, ink: d === todayISO ? "partial" : "spend" }))
  const pastEnd = elapsed > 0 ? slots[todayIndex]!.col + slots[todayIndex]!.width : 0
  const scale = niceScale(Math.max(0, left ?? 0, ...bars.map((b) => b.value)))
  const { rows: plain } = columnBars(bars, width, height, scale.max, [
    ...(avg > 0 ? [{ value: avg, ink: "ref", to: pastEnd }] : []),
    ...(left ? [{ value: left, ink: "limit", from: pastEnd + 1 }] : []),
  ], lineMarkers(axis.markers, n, width))
  const marks: ChartLabel[] = [
    ...biggestDays.map((i) => {
      const row = barTopRow(shown[i]!, scale.max, height)
      return { row, col: slots[i]!.col, ...dayLabel(i), bar: slots[i]!, ink: "note" }
    }).filter((l) => l.row >= 0),
    ...(avg > 0 && pastEnd > 6 ? [{ row: ruleRow(avg, scale.max, height), col: pastEnd - 1 - "avg".length - 1, text: "avg", ink: "ref" }] : []),
    ...(left ? [{ row: ruleRow(left, scale.max, height), col: pastEnd + 2, text: `${shortMoney(left)}/day left`, short: shortMoney(left), ink: "limit" }] : []),
  ]
  return {
    rows: annotate(plain, marks),
    ticks: moneyTicks(0, scale.max, scale.step, height),
    labels: axis.labels,
    today: axis.today,
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
  const buckets = flowBuckets(dates, monthly, weekStart)
  const first = dates[0]!, last = dates[dates.length - 1]!
  const inRange = transactions.filter((t) => t.dateISO >= first && t.dateISO <= last && t.dateISO <= todayISO)
  const flows = buckets.map((b) => computePeriodFlows(accounts, inRange.filter((t) => t.dateISO >= b.start && t.dateISO <= b.end), scopeIds))
  const rowsOf = flowRows(accounts, inRange, scopeIds)
  const scale = niceScale(Math.max(0, ...flows.flatMap((f) => [f.income, f.spent])))
  const future = (i: number) => buckets[i]!.start > todayISO
  const bars = flows.flatMap((f, i) => [{ value: future(i) ? 0 : f.income, ink: "in" }, { value: future(i) ? 0 : f.spent, ink: "out" }])
  const { markers, spans } = runRules(buckets.map((b) => b.start), dates, width, todayISO, (iso) => (monthly ? (iso.slice(5, 7) === "01" ? "year" : "month") : "week"))
  const whole = (i: number) => (monthly ? buckets[i]!.start.endsWith("-01") && addDays(buckets[i]!.end, 1).endsWith("-01") : daysBetween(buckets[i]!.start, buckets[i]!.end) === 6)
  const wholeSpans = spans.filter((_, i) => whole(i))
  const narrowest = Math.min(...(wholeSpans.length ? wholeSpans : spans).map((s) => s.width))
  const barWidth = Math.max(1, Math.floor(narrowest / 2))
  const pairs = spans.flatMap((p) => {
    const w = Math.min(barWidth, Math.floor(p.width / 2))
    return [{ col: p.col, width: w }, { col: p.col + w, width: w }]
  })
  const { rows: plain, slots } = columnBars(bars, width, height, scale.max, undefined, markers, 2, pairs)
  const frame: FlowFrame = { dates, width, height, todayISO, monthly, buckets, flows, bars, slots, future, whole }
  const { marks, unshown, currentName } = flowMarks(frame, barWidth, rowsOf, scale)
  const { line, labelInks } = flowLabels(frame)
  const rows = annotate(plain, marks)
  const missed = unshown.filter((l) => !rows.some((r) => r.map((run) => run.text).join("").includes(l.text)))
  const income = sum(flows.map((f) => f.income)), spent = sum(flows.map((f) => f.spent))
  const net = income - spent
  const firstIn = historyStart(flowRows(accounts, transactions, scopeIds).income)
  const inFrom = firstIn && firstIn > addDays(first, 31) && firstIn <= todayISO ? firstIn : null
  return {
    rows,
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
      ...(missed.length ? [GAP, muted(`${currentName} `), ...missed.flatMap((l, k) => [...(k ? [muted(" ")] : []), { text: l.text.slice(currentName.length + 1), fg: changeColor(l.ink === "in" ? 1 : -1) }])] : []),
    ],
  }
}

function flowBuckets(dates: string[], monthly: boolean, weekStart: WeekStart): Array<{ start: string; end: string }> {
  const buckets: Array<{ start: string; end: string }> = []
  for (const iso of dates) {
    const startsWeek = dayOfWeek(iso, weekStart) === 0
    const newBucket = !buckets.length || (monthly ? iso.slice(8, 10) === "01" : startsWeek)
    if (newBucket) buckets.push({ start: iso, end: iso })
    else buckets[buckets.length - 1]!.end = iso
  }
  return buckets
}

interface FlowFrame {
  dates: string[]
  width: number
  height: number
  todayISO: string
  monthly: boolean
  buckets: Array<{ start: string; end: string }>
  flows: Array<ReturnType<typeof computePeriodFlows>>
  bars: Array<{ value: number; ink: string }>
  slots: ReturnType<typeof columnBars>["slots"]
  future: (i: number) => boolean
  whole: (i: number) => boolean
}

function flowMarks(
  { dates, width, height, todayISO, monthly, buckets, flows, bars, slots }: FlowFrame,
  barWidth: number,
  rowsOf: ReturnType<typeof flowRows>,
  scale: { max: number },
): { marks: ChartLabel[]; unshown: ChartLabel[]; currentName: string } {
  const roomy = barWidth >= 4
  const order = (kind: 0 | 1) => bars.map((_, i) => i).filter((i) => i % 2 === kind && bars[i]!.value > 0).sort((a, b) => bars[b]!.value - bars[a]!.value).slice(0, roomy ? undefined : 2)
  const [ins, outs] = [order(0), order(1)]
  const ranked = [ins[0], outs[0], ...[...ins.slice(1), ...outs.slice(1)].sort((a, b) => bars[b]!.value - bars[a]!.value)].filter((i): i is number => i != null)
  const marks: ChartLabel[] = ranked.filter((i) => slots[i]?.width).map((i) => {
    const b = buckets[Math.floor(i / 2)]!
    const payee = i === ins[0] || i === outs[0] ? biggestPayee(i % 2 === 0 ? rowsOf.income : rowsOf.spent, b.start, b.end) : undefined
    const total = shortMoney(bars[i]!.value)
    const sign = i % 2 === 0 ? "+" : "-"
    const [text, ...shorter] = barNames(`${sign}${total}`, bars[i]!.value, payee, sign)
    return { row: barTopRow(bars[i]!.value, scale.max, height), col: slots[i]!.col, bar: slots[i]!, text: text!, short: [...shorter, `${sign}${total}`], ink: i % 2 === 0 ? "in" : "out" }
  }).filter((l) => l.row >= 0)
  const current = buckets.findIndex((b) => b.start <= todayISO && b.end >= todayISO)
  const currentName = monthly && current >= 0 ? `${MONTHS[Number(buckets[current]!.start.slice(5, 7)) - 1]} so far` : "this week"
  const unshown = current >= 0 && !slots[current * 2]?.width
    ? unshownPeriod(currentName, [{ value: flows[current]!.spent, sign: "-", ink: "out" }, { value: flows[current]!.income, sign: "+", ink: "in" }], dates, todayISO, width)
    : []
  marks.unshift(...unshown)
  return { marks, unshown, currentName }
}

function flowLabels({ width, monthly, buckets, flows, slots, future, whole }: FlowFrame): { line: string[]; labelInks: NonNullable<ChartModel["labelInks"]> } {
  const name = (b: (typeof buckets)[number]) => (monthly ? MONTHS[Number(b.start.slice(5, 7)) - 1]! : shortDate(b.start))
  const netText = (i: number) => (future(i) || (!flows[i]!.income && !flows[i]!.spent) ? "" : `${flows[i]!.net > 0.5 ? "+" : ""}${shortMoney(flows[i]!.net)}`)
  const pairEnd = (i: number) => slots[i * 2 + 1] ?? slots[i * 2]
  const withNet = buckets.every((b, i) => {
    const slot = slots[i * 2], next = slots[(i + 1) * 2]
    if (!slot?.width || !whole(i)) return true
    const text = `${name(b)} ${netText(i)}`.trim()
    return slot.col + text.length < (next?.col ?? width + 1)
  })
  const line = new Array<string>(width).fill(" ")
  const labelInks: NonNullable<ChartModel["labelInks"]> = []
  let free = 0
  buckets.forEach((b, i) => {
    const slot = slots[i * 2]
    if (!slot?.width || !pairEnd(i)) return
    const date = name(b)
    const next = slots[(i + 1) * 2]
    const fits = (text: string) => slot.col + text.length < (next?.col ?? width + 1)
    const net = withNet && fits(`${date} ${netText(i)}`) ? netText(i) : ""
    const text = net ? `${date} ${net}` : date
    if (slot.col < free || slot.col + text.length > width) return
    for (let c = 0; c < text.length; c++) line[slot.col + c] = text[c]!
    if (net) labelInks.push({ start: slot.col + date.length + 1, length: net.length, ink: flows[i]!.net >= 0 ? "in" : "out" })
    free = slot.col + text.length + 1
  })
  return { line, labelInks }
}
