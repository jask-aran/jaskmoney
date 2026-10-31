/**
 * The Overview's chart models for the web (and the Budgets tab's, which
 * are the spending ones): the TUI's periodCharts.ts, view for view, with
 * the same figures, words and choices (what's labelled, what's averaged,
 * when a projection shows), sized in px rather than cells. The decisions
 * the TUI takes in terminal columns are taken here at CELL px a column.
 * Pure: each returns a ChartModel for charts.tsx.
 */
import { cumulative, dailySpendSeries, formatMoney, formatWholeMoney, signedWholeMoney, weeklyTotals } from "../../../domain/dashboard"
import { balanceHistory, biggestPayee, biggestRow, computePeriodFlows, flowRows, historyCovers, historyStart, saverHistories } from "../../../domain/position"
import { accountRole, type Account, type Transaction } from "../../../domain/types"
import { isSpending } from "../../../domain/moneyRules"
import { MONTHS, addDays, dayOfWeek, daysBetween, type WeekStart } from "../../../domain/days"
import { shortDate, shortMoney } from "../../../ui/text"
import { CELL, INKS, fitRange, niceScale, ticksOf, type ChartModel, type LegendItem, type Marker, type PointLabel, type TipRow, type XLabel } from "../../charts"
import { saverInks } from "../../../ui/charts/saverInks"

/** Days into a period before Cumulative says where it's heading. */
const PROJECT_FROM = 3

/** What the range and the one before it are called in legends and labels. */
export interface PeriodNames { current: string; previous: string }
const DEFAULT_NAMES: PeriodNames = { current: "This period", previous: "Last period" }

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0)
const WEEKDAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

/** "Thu 16 Oct" (with the year when it isn't today's). */
export function dayTitle(iso: string, todayISO: string): string {
  const wd = WEEKDAY[(dayOfWeek(iso, "monday") + 7) % 7]
  return `${wd} ${shortDate(iso)}${iso.slice(0, 4) === todayISO.slice(0, 4) ? "" : ` ${iso.slice(0, 4)}`}`
}
/** "13 – 19 Oct", "28 Sep – 4 Oct". */
export function spanTitle(start: string, end: string): string {
  if (start === end) return shortDate(start)
  return start.slice(5, 7) === end.slice(5, 7) ? `${Number(start.slice(8, 10))} – ${shortDate(end)}` : `${shortDate(start)} – ${shortDate(end)}`
}

const muted = (text: string) => ({ text, cls: "note" })
const fig = (text: string) => ({ text, cls: "figure" })
/** Up green, down red, about nothing grey (colors.ts changeColor). */
export const changeCls = (d: number) => (Math.abs(d) < 0.5 ? "note" : d > 0 ? "good" : "bad")
/** Spending more red, less green (colors.ts spendChangeColor). */
export const spendChangeCls = (d: number) => (Math.abs(d) < 0.5 ? "note" : d > 0 ? "bad" : "good")

/** A chart with nothing to draw, saying why. */
const emptyChart = (why: string): ChartModel => ({ x: "points", length: 0, y: { min: 0, max: 1, ticks: [] }, legend: [{ parts: [muted(why)] }], empty: why })

/** A name, at most `n` columns (an emoji takes two). */
export function clip(name: string, n: number): string {
  let width = 0, out = ""
  for (const { segment } of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(name)) {
    const w = /\p{Extended_Pictographic}/u.test(segment) ? 2 : 1
    if (width + w > n - 1) return out.trimEnd() + "…"
    out += segment; width += w
  }
  return out
}

/** What a row is called in a chart label: in full up to NAME_LONG, then NAME_SHORT. */
const NAME_LONG = 28
const NAME_SHORT = 14
const spendName = (name: string) => clip(name, NAME_SHORT)
const rowNames = (name: string) => [...new Set([clip(name, NAME_LONG), spendName(name)])]

/** A bar's label naming what made it tall (the TUI's barNames): "Centre Com $826"
 * when that payee is (nearly) the whole bar, else "$1.3k · Centre Com $826";
 * just the figure when no payee is a quarter of it. */
const barNames = (amount: string, total: number, payee: { name: string; amount: number } | undefined, sign = ""): string[] =>
  !payee || payee.amount < 0.25 * total ? [amount] : rowNames(payee.name).map((name) => (payee.amount >= 0.9 * total ? `${name} ${amount}` : `${amount} · ${name} ${sign}${shortMoney(payee.amount)}`))

/** The date axis for a daily series (the TUI's dateAxis): month rules (only
 * quarters' when months are narrow), week rules where weeks have room, the
 * closing month end, today's rule; labels by priority: today, the ends, the
 * months, week starts. `at` maps a date index to x units (bars: slot
 * edges via `edge`). */
function dateAxis(dates: string[], width: number, todayISO: string, weekStart: WeekStart, slots: boolean): { markers: Marker[]; labels: XLabel[] } {
  const n = dates.length
  const markers: Marker[] = []
  const labels: XLabel[] = []
  if (!n) return { markers, labels }
  const cols = width / CELL
  const weekCells = (7 * cols) / n
  const day = (iso: string) => Number(iso.slice(8, 10))
  const month = (iso: string) => MONTHS[Number(iso.slice(5, 7)) - 1] ?? ""
  const cross = dates[0]!.slice(0, 4) !== dates[n - 1]!.slice(0, 4)
  const dayLabel = (iso: string) => `${day(iso)} ${month(iso)}${cross ? ` ${iso.slice(2, 4)}` : ""}`
  // Rules between bars sit on the edge before a day's bar.
  const edge = (i: number) => (slots ? i - 0.5 : i)
  labels.push({ at: slots ? -0.5 : 0, text: dayLabel(dates[0]!), priority: 1, align: "start" })
  labels.push({ at: slots ? n - 0.5 : n - 1, text: dayLabel(dates[n - 1]!), priority: 1, align: "end" })
  const colsPerMonth = cols / new Set(dates.map((iso) => iso.slice(0, 7))).size
  const weekDays = weekCells >= 6 ? [] : colsPerMonth >= 24 ? [7, 14, 21] : colsPerMonth >= 12 ? [14] : []
  const quartersOnly = colsPerMonth < 4
  const yearOrMonth = (iso: string) => (iso.slice(5, 7) === "01" ? "year" : "month") as Marker["kind"]
  dates.forEach((iso, i) => {
    if (i === 0) return
    if (day(iso) === 1) {
      if (!quartersOnly || [1, 4, 7, 10].includes(Number(iso.slice(5, 7)))) markers.push({ at: edge(i), kind: yearOrMonth(iso) })
      labels.push({ at: edge(i), text: iso.slice(5, 7) === "01" ? iso.slice(0, 4) : month(iso), priority: 2, align: "start" })
    } else if (weekCells >= 6 && dayOfWeek(iso, weekStart) === 0) {
      markers.push({ at: edge(i), kind: "week" })
      labels.push({ at: slots ? i : i, text: String(day(iso)), priority: 3, align: slots ? "center" : "start" })
    } else if (weekDays.includes(day(iso))) markers.push({ at: edge(i), kind: "week" })
  })
  const last = dates[n - 1]!
  if (n > 1 && day(addDays(last, 1)) === 1) markers.push({ at: slots ? n - 0.5 : n - 1, kind: yearOrMonth(addDays(last, 1)) })
  const today = dates.indexOf(todayISO)
  if (today >= 0) {
    if (today > 0) {
      for (let i = markers.length - 1; i >= 0; i--) if (Math.abs(markers[i]!.at - edge(today)) < 0.01 || Math.abs(markers[i]!.at - today) < 0.01) markers.splice(i, 1)
      if (!slots) markers.push({ at: today, kind: "today" })
    }
    const text = n <= 45 ? `${day(todayISO)} ${month(todayISO)}` : n <= 732 ? `${day(todayISO)} ${month(todayISO)}` : `${month(todayISO)} ${todayISO.slice(2, 4)}`
    labels.push({ at: today, text, priority: 0, align: "center", cls: "today" })
  }
  return { markers, labels }
}

/**
 * Rules for bars that each stand for a run of days (a week, a month): a
 * month's rule in the gap nearest its 1st, only quarters' when months are
 * narrow, only years' when each bar is a month; the closing month end;
 * today where its day falls across its bar (the TUI's periodMarkers).
 */
function periodMarkers(runs: Array<{ start: string; end: string }>, width: number, todayISO: string, months = true): Marker[] {
  if (!runs.length) return []
  const first = runs[0]!.start, last = runs[runs.length - 1]!.end
  const quartersOnly = width / CELL / (Math.floor(daysBetween(first, last) / 30.44) + 1) < 4
  const kindOf = (iso: string) => (iso.slice(5, 7) === "01" ? "year" : "month") as Marker["kind"]
  const wanted = (iso: string) => kindOf(iso) === "year" || (months && (!quartersOnly || ["04", "07", "10"].includes(iso.slice(5, 7))))
  const markers: Marker[] = []
  runs.forEach((run, i) => {
    for (let iso = run.start; iso <= run.end; iso = addDays(iso, 1)) {
      if (!iso.endsWith("-01") || iso === first || !wanted(iso)) continue
      const late = 2 * daysBetween(run.start, iso) > daysBetween(run.start, run.end) + 1
      markers.push({ at: late ? i + 0.5 : i - 0.5, kind: kindOf(iso) })
    }
  })
  if (addDays(last, 1).endsWith("-01") && wanted(addDays(last, 1))) markers.push({ at: runs.length - 0.5, kind: kindOf(addDays(last, 1)) })
  const current = runs.findIndex((r) => r.start <= todayISO && todayISO <= r.end)
  if (current >= 0) {
    const run = runs[current]!
    const at = (daysBetween(run.start, todayISO) + 0.5) / (daysBetween(run.start, run.end) + 1)
    markers.push({ at: current - 0.5 + at, kind: "today" })
  }
  return markers
}

/**
 * The Spending chart in one of its views, over the period's dates (the
 * TUI's spendingChart):
 * - Daily: spend per day as bars, the biggest days named after their
 *   biggest spend, the average so far and, with a `budget`, what's left a
 *   day; too many days for bars, a widening average line with the biggest
 *   days as points.
 * - Cumulative: running total against the previous period of equal length
 *   where the history covers it, the budget as a pace line, and from a few
 *   days in, dotted on to where it ends at its pace so far.
 * - Weekly: totals per configured week, partial weeks lighter, a week's
 *   share of a `budget`, the biggest named.
 */
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
  if (n === 0) return emptyChart("No days in range")
  const elapsed = dates.filter((d) => d <= todayISO).length
  const upToToday = (vs: number[]) => vs.map((v, i) => (i < elapsed ? v : null))
  const cols = width / CELL
  const outs = spendingRows.filter((t) => t.amount < 0 && isSpending(t))
  const named = (start: string, end: string) => biggestPayee(outs, start, end)
  const ticks = (max: number, step: number) => ({ min: 0, max, ticks: ticksOf(0, max, step) })

  if (view === "Weekly") {
    const weeks = weeklyTotals(dates, upToToday(values).map((v) => v ?? 0), weekStart)
    const perWeek = budget != null ? (budget * 7) / n : null
    const scale = niceScale(Math.max(0, perWeek ?? 0, ...weeks.map((w) => w.total)))
    const partial = (w: (typeof weeks)[number]) => w.days < 7 || addDays(w.startISO, 6) >= todayISO
    const bars = weeks.map((w, i) => ({ slot: i, value: w.startISO <= todayISO ? w.total : 0, color: partial(w) ? INKS.partial : INKS.spend, partial: partial(w) }))
    const current = weeks.findLastIndex((w) => w.startISO <= todayISO && addDays(w.startISO, 6) >= todayISO)
    const bySize = bars.map((_, i) => i).filter((i) => bars[i]!.value > 0).sort((a, b) => bars[b]!.value - bars[a]!.value)
    const roomy = cols / weeks.length >= 5
    const order = [...new Set([...(current >= 0 && bars[current]!.value > 0 ? [current] : []), ...bySize.slice(0, roomy ? bySize.length : 3)])]
    const biggest = bySize[0]
    const endOf = (w: (typeof weeks)[number]) => addDays(w.startISO, w.days - 1)
    const labels: PointLabel[] = order.map((i) => {
      const total = shortMoney(bars[i]!.value)
      const payee = i === biggest ? named(weeks[i]!.startISO, addDays(weeks[i]!.startISO, 6)) : undefined
      const texts = barNames(total, bars[i]!.value, payee)
      return { at: i, value: bars[i]!.value, texts: [...texts, total], role: "label", bar: { slot: i } }
    })
    if (perWeek) labels.push({ at: weeks.length - 1, value: perWeek, texts: ["budget"], role: "note", swatch: INKS.limit, swatchStyle: "dashed" })
    const runs = weeks.map((w) => ({ start: w.startISO, end: endOf(w) }))
    // Under the bars: each week's start where bars are wide, else the month
    // over the week holding most of its days; today's date first.
    const xLabels: XLabel[] = []
    if (current >= 0) {
      const w = weeks[current]!
      const at = current - 0.5 + (daysBetween(w.startISO, todayISO) + 0.5) / w.days
      xLabels.push({ at, text: n <= 45 ? shortDate(todayISO) : shortDate(todayISO), priority: 0, cls: "today" })
    }
    weeks.forEach((w, i) => {
      const mid = addDays(w.startISO, 3)
      const isNamed = i === 0 || mid.slice(0, 7) !== addDays(weeks[i - 1]!.startISO, 3).slice(0, 7)
      const label = roomy ? shortDate(w.startISO) : isNamed ? MONTHS[Number((i === 0 ? w.startISO : mid).slice(5, 7)) - 1]! : ""
      if (label) xLabels.push({ at: i, text: label, priority: 1 + i / 1000, align: "center" })
    })
    const full = weeks.filter((_, i) => !bars[i]!.partial)
    return {
      x: "slots",
      length: weeks.length,
      y: ticks(scale.max, scale.step),
      bars,
      rules: perWeek ? [{ value: perWeek, color: INKS.limit, style: "dashed" }] : [],
      markers: periodMarkers(runs, width, todayISO),
      labels,
      xLabels,
      legend: [
        { mark: { kind: "bar", color: INKS.spend }, parts: [full.length ? fig(`Weeks, avg ${formatWholeMoney(sum(full.map((w) => w.total)) / full.length)}`) : muted("No full weeks yet")] },
        ...(bars.some((b) => b.partial) ? [{ mark: { kind: "bar" as const, color: INKS.partial }, parts: [muted(current >= 0 ? `partial week · this week ${formatWholeMoney(weeks[current]!.total)} so far` : "partial week")] }] : []),
        ...(perWeek ? [{ mark: { kind: "line" as const, color: INKS.limit, style: "dashed" as const }, parts: [muted(`Budget ${formatWholeMoney(perWeek)} a week`)] }] : []),
      ],
      tip: (i) => {
        const w = weeks[i]
        if (!w) return null
        const end = endOf(w)
        const future = w.startISO > todayISO
        const payee = future ? undefined : named(w.startISO, end)
        const rows: TipRow[] = [{ color: bars[i]!.color, style: "bar", label: future ? "Not yet" : end >= todayISO ? "Spent so far" : "Spent", value: future ? "—" : formatMoney(w.total) }]
        if (payee) rows.push({ label: clip(payee.name, 24), value: formatMoney(payee.amount), cls: "label", sub: true })
        if (perWeek) rows.push({ color: INKS.limit, style: "dashed", label: "Budget a week", value: formatWholeMoney(perWeek) })
        return { title: `${w.days < 7 ? `${w.days} days · ` : "Week · "}${spanTitle(w.startISO, end)}`, rows }
      },
    }
  }

  if (view === "Cumulative") {
    const total = cumulative(values)
    const prevStart = addDays(dates[0]!, -n)
    // Compared only where the history covers the period before.
    const covered = elapsed > 0 && historyCovers(spendingRows, { start: prevStart, end: addDays(prevStart, elapsed - 1) }, { start: dates[0]!, end: dates[elapsed - 1]! })
    const prev = covered ? cumulative(dailySpendSeries(spendingRows, prevStart, addDays(dates[0]!, -1)).values) : []
    const now = elapsed > 0 ? total[elapsed - 1]! : 0
    const then = elapsed > 0 ? prev[elapsed - 1] ?? 0 : 0
    // Where the period ends at its pace so far: dotted on from today, from
    // a few days in (earlier, one big day says too much).
    const projected = elapsed >= PROJECT_FROM && elapsed < n ? (now / elapsed) * n : null
    const ahead = projected == null ? [] : dates.map((_, i) => (i < elapsed - 1 ? null : now + ((projected - now) * (i - elapsed + 1)) / (n - elapsed)))
    const scale = niceScale(Math.max(now, budget ?? 0, projected ?? 0, ...prev))
    const diff = then > 0 ? Math.round(((now - then) / then) * 100) : null
    // The budget as a pace line: nothing at the start, all of it by the end.
    const pace = (i: number) => (budget ?? 0) * ((i + 1) / n)
    const paceLine = dates.map((_, i) => pace(i))
    const overPace = budget != null && elapsed > 0 ? now - pace(elapsed - 1) : null
    const back = (vs: number[]) => Array.from({ length: Math.min(n - 1, 40) }, (_, k) => n - 2 - Math.round((k * (n - 2)) / 39)).filter((i, k, a) => i >= 0 && a.indexOf(i) === k).map((i) => ({ at: i, value: vs[i]! }))
    const labels: PointLabel[] = [
      ...(elapsed > 0 ? [{ at: elapsed - 1, value: now, texts: [`${names.current} ${shortMoney(now)}`, shortMoney(now)], role: "figure" as const, required: true }] : []),
      ...(projected != null ? [{ at: n - 1, value: projected, texts: [`≈ ${shortMoney(projected)}`], role: "label" as const, swatch: INKS.spend, swatchStyle: "dotted" as const }] : []),
      ...(prev.length ? [{ at: n - 1, value: prev[n - 1]!, texts: [names.previous], name: names.previous, along: back(prev), role: "note" as const, swatch: INKS.prev }] : []),
      ...(budget != null ? [{ at: n - 1, value: budget, texts: ["Budget"], name: "Budget", along: back(paceLine), role: "note" as const, swatch: INKS.limit, swatchStyle: "dashed" as const }] : []),
    ]
    const axis = dateAxis(dates, width, todayISO, weekStart, false)
    return {
      x: "points",
      length: n,
      y: ticks(scale.max, scale.step),
      series: [
        ...(budget != null ? [{ values: paceLine, color: INKS.limit, name: "Budget pace", style: "dashed" as const, width: 1.5 }] : []),
        ...(prev.length ? [{ values: prev, color: INKS.prev, name: names.previous, width: 1.5 }] : []),
        ...(ahead.length ? [{ values: ahead.map((v, i) => (i < elapsed ? null : v)), color: INKS.spend, name: "At this pace", style: "dotted" as const }] : []),
        { values: upToToday(total), color: INKS.spend, name: names.current, area: true, endDot: true },
      ],
      markers: axis.markers,
      xLabels: axis.labels,
      labels,
      legend: [
        { mark: { kind: "line", color: INKS.spend }, parts: [muted(`${names.current} `), fig(formatWholeMoney(now))] },
        ...(projected != null ? [{ mark: { kind: "line" as const, color: INKS.spend, style: "dotted" as const }, parts: [muted("≈ "), fig(formatWholeMoney(projected)), muted(" by the end at this pace")] }] : []),
        ...(budget != null ? [{
          mark: { kind: "line" as const, color: INKS.limit, style: "dashed" as const },
          parts: [muted("Budget "), fig(formatWholeMoney(budget)), ...(overPace != null ? [muted(", "), { text: `${formatWholeMoney(Math.abs(overPace))} ${overPace > 0 ? "over" : "under"}${elapsed < n ? " pace" : ""}`, cls: spendChangeCls(overPace) }] : [])],
        }] : []),
        covered
          ? { mark: { kind: "line" as const, color: INKS.prev }, parts: [muted(`${names.previous} `), fig(formatWholeMoney(then)), muted(elapsed < n ? " by now" : ""), ...(diff != null ? [muted("  "), { text: `${diff > 0 ? "+" : ""}${diff}%`, cls: spendChangeCls(diff) }] : [])] }
          : { parts: [muted(`${names.previous}: too little history to compare`)] },
      ],
      tip: (i) => {
        const iso = dates[i]
        if (!iso) return null
        const rows: TipRow[] = []
        if (i < elapsed) rows.push({ color: INKS.spend, label: i === elapsed - 1 && iso === todayISO ? `${names.current}, so far` : names.current, value: formatMoney(total[i]!) })
        else if (projected != null) rows.push({ color: INKS.spend, style: "dotted", label: "At this pace", value: `≈ ${formatWholeMoney(ahead[i]!)}` })
        if (prev.length) rows.push({ color: INKS.prev, label: `${names.previous}, day ${i + 1}`, value: formatMoney(prev[i]!) })
        if (budget != null) rows.push({ color: INKS.limit, style: "dashed", label: "Budget pace", value: formatWholeMoney(pace(i)) })
        if (i < elapsed && values[i]) rows.push({ label: "That day", value: formatMoney(values[i]!), cls: "label" })
        return { title: `${dayTitle(iso, todayISO)} · day ${i + 1} of ${n}`, rows }
      },
    }
  }

  // Daily.
  const shown = values.slice(0, elapsed)
  const avg = elapsed ? sum(shown) / elapsed : 0
  const peak = shown.reduce((best, v, i) => (v > shown[best]! ? i : best), 0)
  const peakRow = shown[peak] ? named(dates[peak]!, dates[peak]!) : undefined
  const biggestDays = shown.map((_, i) => i).filter((i) => shown[i]! > 0).sort((a, b) => shown[b]! - shown[a]!).slice(0, Math.max(1, Math.floor(cols / 24)))
  const dayTexts = (i: number) => {
    const texts = barNames(shortMoney(shown[i]!), shown[i]!, named(dates[i]!, dates[i]!))
    return [...texts, shortMoney(shown[i]!)]
  }
  const peakNote = shown[peak] ? [muted(", peak "), fig(formatWholeMoney(shown[peak]!)), muted(` on ${shortDate(dates[peak]!)}${peakRow ? ` (${spendName(peakRow.name)})` : ""}`)] : []
  const dayTip = (i: number, rows: TipRow[]) => {
    const iso = dates[i]
    if (!iso) return null
    if (i >= elapsed) return { title: dayTitle(iso, todayISO), rows: [{ label: "Not yet", value: "—" }] }
    const payee = named(iso, iso)
    return {
      title: dayTitle(iso, todayISO),
      rows: [
        { color: iso === todayISO ? INKS.partial : INKS.spend, style: "bar" as const, label: iso === todayISO ? "Spent so far" : "Spent", value: formatMoney(values[i]!) },
        ...(payee ? [{ label: clip(payee.name, 24), value: formatMoney(payee.amount), cls: "label", sub: true }] : []),
        ...rows,
      ],
    }
  }

  // More days than the width has room for as bars: a week's average,
  // longer as days crowd (a month's at a year), the biggest days as points.
  if (width / n < 4) {
    const window = Math.min(30, 7 * Math.ceil((n * 4) / width))
    const rolling = values.map((_, i) => (i < elapsed ? sum(values.slice(Math.max(0, i - window + 1), i + 1)) / Math.min(window, i + 1) : null))
    const scale = niceScale(Math.max(0, ...rolling.map((v) => v ?? 0)))
    const axis = dateAxis(dates, width, todayISO, weekStart, false)
    return {
      x: "points",
      length: n,
      y: ticks(scale.max, scale.step),
      series: [{ values: rolling, color: INKS.spend, name: `${window}-day average`, area: true, endDot: true }],
      points: biggestDays.map((i) => ({ at: i, value: shown[i]!, color: INKS.spend })),
      markers: axis.markers,
      xLabels: axis.labels,
      labels: biggestDays.map((i) => ({ at: i, value: Math.min(shown[i]!, scale.max), texts: dayTexts(i), role: "label" as const })),
      legend: [
        { mark: { kind: "line", color: INKS.spend }, parts: [muted(`${window}-day average, `), fig(formatWholeMoney(avg)), muted(" a day overall"), ...peakNote] },
        { parts: [muted("• ▲ biggest days")] },
      ],
      tip: (i) => dayTip(i, rolling[i] != null ? [{ color: INKS.spend, label: `${window}-day average`, value: formatMoney(rolling[i]!) }] : []),
    }
  }

  const daysLeft = n - elapsed
  const spentSoFar = sum(shown)
  const left = budget != null && daysLeft > 0 ? Math.max(0, (budget - spentSoFar) / daysLeft) : null
  const bars = dates.map((d, i) => ({ slot: i, value: i < elapsed ? values[i]! : 0, color: d === todayISO ? INKS.partial : INKS.spend }))
  const scale = niceScale(Math.max(0, left ?? 0, ...bars.map((b) => b.value)))
  const axis = dateAxis(dates, width, todayISO, weekStart, true)
  // Today's rule falls through its own bar in the TUI; here its bar is
  // the lighter one and its date is marked under it.
  const markers = axis.markers
  const pastEnd = elapsed // slot edge after today's bar
  const labels: PointLabel[] = [
    ...biggestDays.map((i) => ({ at: i, value: shown[i]!, texts: dayTexts(i), role: "label" as const, bar: { slot: i } })),
    ...(avg > 0 && elapsed > 1 ? [{ at: elapsed - 1, value: avg, texts: ["avg"], role: "note" as const, swatch: INKS.ref, swatchStyle: "dashed" as const }] : []),
    ...(left ? [{ at: Math.min(n - 1, elapsed + 1), value: left, texts: [`${shortMoney(left)}/day left`, shortMoney(left)], role: "note" as const, swatch: INKS.limit, swatchStyle: "dashed" as const }] : []),
  ]
  return {
    x: "slots",
    length: n,
    y: ticks(scale.max, scale.step),
    bars,
    rules: [
      ...(avg > 0 ? [{ value: avg, color: INKS.ref, to: pastEnd, style: "dashed" as const }] : []),
      ...(left ? [{ value: left, color: INKS.limit, from: pastEnd, style: "dashed" as const }] : []),
    ],
    markers,
    xLabels: axis.labels,
    labels,
    legend: [
      { mark: { kind: "bar", color: INKS.spend }, parts: [muted("Spent per day"), ...peakNote] },
      { mark: { kind: "line", color: INKS.ref, style: "dashed" }, parts: [muted("Average "), fig(formatWholeMoney(avg))] },
      ...(left == null ? [] : left > 0
        ? [{ mark: { kind: "line" as const, color: INKS.limit, style: "dashed" as const }, parts: [fig(formatWholeMoney(left)), muted(" a day left in the budget")] }]
        : [{ parts: [{ text: "budget spent", cls: "bad" }] }]),
    ],
    tip: (i) => dayTip(i, [
      { color: INKS.ref, style: "dashed", label: "Average so far", value: formatWholeMoney(avg) },
      ...(left != null && i >= elapsed - 1 ? [{ color: INKS.limit, style: "dashed" as const, label: "Left a day", value: formatWholeMoney(left) }] : []),
    ]),
  }
}

/** End-of-day balances over the period's dates (up to today) for one view:
 * everything, spending accounts, or savers; Available with where it's
 * headed (the TUI's balancesChart). */
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
  const values = history.map((p) => (view === "Available" ? p.spending : p.net))
  const latest = values.length - 1
  const ahead = view === "Available" ? projection.filter((p) => p.dateISO > last && p.dateISO <= dates[dates.length - 1]!) : []
  const projected = ahead.length ? dates.map((d, i) => (i === latest ? values[latest]! : ahead.find((p) => p.dateISO === d)?.value ?? null)) : []
  const all = [...values, ...ahead.map((p) => p.value)]
  const lo = Math.min(...values), hi = Math.max(...values)
  const range = fitRange(Math.min(...all), Math.max(...all), Math.max(4, Math.round(height / 16)), zeroAxis)
  const axis = dateAxis(dates, width, todayISO, weekStart, false)
  const change = values[latest]! - values[0]!
  const low = values.indexOf(lo)
  const high = values.indexOf(hi)
  // The biggest one-day moves, named after the row that made most of each.
  const counted = new Set(accounts.filter((a) => a.balance !== null && (view !== "Available" || accountRole(a) === "spending")).map((a) => a.id))
  const moving = transactions.filter((t) => t.accountId != null && counted.has(t.accountId) && (view === "Available" || !t.internal))
  const moves = values.map((v, i) => ({ i, d: i ? v - values[i - 1]! : 0 }))
    .filter((m) => Math.abs(m.d) >= (hi - lo) * 0.08 && m.d !== 0)
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))
    .slice(0, Math.max(1, Math.floor(width / CELL / 30)))
  const moveLabels: PointLabel[] = moves.map(({ i, d }) => {
    const row = biggestRow(moving.filter((t) => Math.sign(t.amount) === Math.sign(d)), dates[i]!, dates[i]!)
    const amount = `${d > 0 ? "+" : "-"}${shortMoney(Math.abs(d))}`
    const texts = row ? rowNames(row.description).map((name) => `${amount} ${name}`) : [amount]
    return { at: i, value: values[i]!, texts: [...texts, amount], role: d > 0 ? "good" : "bad" }
  })
  const end = ahead.at(-1)
  const ends = (v: number) => (v < 0 ? `≈ ${shortMoney(-v)} short` : `≈ ${shortMoney(v)}`)
  const runsOut = ahead.find((p, k) => p.value < 0 && (k ? ahead[k - 1]!.value : values[latest]!) >= 0)
  const labels: PointLabel[] = [
    { at: latest, value: values[latest]!, texts: [shortMoney(values[latest]!)], role: "figure", required: true },
    ...(end ? [{ at: dates.indexOf(end.dateISO), value: end.value, texts: [`${ends(end.value)} by ${shortDate(end.dateISO)}`, ends(end.value)], role: "label" as const, swatch: INKS.projection, swatchStyle: "dotted" as const }] : []),
    ...(runsOut ? [{ at: dates.indexOf(runsOut.dateISO), value: runsOut.value, texts: [`$0 by ${shortDate(runsOut.dateISO)}`], role: "bad" as const }] : []),
    ...moveLabels,
    ...(high > 0 && high < latest && hi > lo && shortMoney(hi) !== shortMoney(values[latest]!) ? [{ at: high, value: hi, texts: [`high ${shortMoney(hi)}`], role: "note" as const }] : []),
    ...(low > 0 && low < latest && hi > lo && shortMoney(lo) !== shortMoney(values[latest]!) ? [{ at: low, value: lo, texts: [`low ${shortMoney(lo)}`], role: "note" as const }] : []),
  ]
  const projectedText = end
    ? runsOut
      ? [muted(`runs out ${shortDate(runsOut.dateISO)}, `), fig(formatWholeMoney(-end.value)), muted(` short by ${shortDate(end.dateISO)}`)]
      : end.value < 0 ? [fig(formatWholeMoney(-end.value)), muted(` short by ${shortDate(end.dateISO)}`)] : [muted("≈ "), fig(formatWholeMoney(end.value)), muted(` by ${shortDate(end.dateISO)} at usual spending`)]
    : []
  return {
    x: "points",
    length: dates.length,
    y: { min: range.min, max: range.max, ticks: ticksOf(range.min, range.max, range.step) },
    series: [
      ...(projected.length ? [{ values: projected, color: INKS.projection, name: "Usual spending", style: "dotted" as const }] : []),
      { values: [...values, ...Array<null>(dates.length - values.length).fill(null)], color: INKS.balance, name: view, endDot: true },
    ],
    markers: axis.markers,
    xLabels: axis.labels,
    labels,
    legend: [
      { mark: { kind: "line", color: INKS.balance }, parts: [muted(`${view} `), fig(formatWholeMoney(values[latest]!))] },
      { parts: [{ text: signedWholeMoney(change), cls: changeCls(change) }, muted(` since ${shortDate(dates[0]!)}`)] },
      ...(end
        ? [{ mark: { kind: "line" as const, color: INKS.projection, style: "dotted" as const }, parts: projectedText, title: "Where Available is headed to the day before payday: a usual day's spending (the last 90 days without regular payments and the biggest tenth of days) and the regular payments due" }]
        : [{ parts: [muted("low "), fig(formatWholeMoney(lo)), muted(` on ${shortDate(history[low]!.dateISO)}`)] }]),
    ],
    tip: (i) => {
      const iso = dates[i]
      if (!iso) return null
      if (i <= latest) {
        const d = i ? values[i]! - values[i - 1]! : 0
        return { title: dayTitle(iso, todayISO), rows: [{ color: INKS.balance, label: view, value: formatMoney(values[i]!) }, ...(i ? [{ label: "That day", value: signedWholeMoney(d), cls: changeCls(d) }] : [])] }
      }
      const p = projected[i]
      return { title: dayTitle(iso, todayISO), rows: p == null ? [{ label: "Not yet", value: "—" }] : [{ color: INKS.projection, style: "dotted", label: "At usual spending", value: `≈ ${formatWholeMoney(p)}` }] }
    },
  }
}

/** Savers drawn one line each: as many as the height keeps apart. */
const MAX_SAVER_LINES = 6
const PX_PER_SAVER_LINE = 48
const SAVER_LABEL = 16

/** Savers: their total and a line per saver in its own colour (from its
 * emoji), the largest first when there are more than fit (the rest are in
 * the total). Each line's latest value at its end. */
function saversChart(dates: string[], last: string, width: number, height: number, todayISO: string, accounts: Account[], transactions: Transaction[], weekStart: WeekStart, zeroAxis: boolean): ChartModel {
  const all = saverHistories(accounts, transactions, dates[0]!, last)
  if (!all.length) return emptyChart("No savers")
  const total = all[0]!.values.map((_, i) => all.reduce((s, x) => s + x.values[i]!, 0))
  const room = Math.max(1, Math.min(MAX_SAVER_LINES, Math.floor(height / PX_PER_SAVER_LINE)))
  const shown = all.length > 1 ? [...all].sort((a, b) => b.balance - a.balance).slice(0, room) : []
  const colours = saverInks(shown.map((s) => s.name))
  const values = [...total, ...shown.flatMap((s) => s.values)]
  const range = fitRange(Math.min(...values), Math.max(...values), Math.max(4, Math.round(height / 16)), zeroAxis)
  const axis = dateAxis(dates, width, todayISO, weekStart, false)
  const latest = total.length - 1
  const change = total[latest]! - total[0]!
  const hidden = all.length - Math.max(1, shown.length)
  const pad = (vs: number[]) => [...vs, ...Array<null>(dates.length - vs.length).fill(null)]
  const back = (vs: number[]) => Array.from({ length: 30 }, (_, k) => latest - 1 - Math.round((k * (latest - 1)) / 29)).filter((i, k, a) => i >= 0 && a.indexOf(i) === k).map((i) => ({ at: i, value: vs[i]! }))
  return {
    x: "points",
    length: dates.length,
    y: { min: range.min, max: range.max, ticks: ticksOf(range.min, range.max, range.step) },
    // The total drawn last: where lines meet, it shows.
    series: [
      ...shown.map((s, i) => ({ values: pad(s.values), color: colours[i]!, name: s.name, width: 1.5, endDot: true })),
      { values: pad(total), color: INKS.total, name: "Total", endDot: true },
    ],
    markers: axis.markers,
    xLabels: axis.labels,
    labels: [
      { at: latest, value: total[latest]!, texts: [`Total ${shortMoney(total[latest]!)}`, shortMoney(total[latest]!)], name: "Total", along: back(total), role: "figure" },
      ...shown.map((s, i): PointLabel => {
        const name = clip(s.name, SAVER_LABEL)
        return { at: latest, value: s.values[latest]!, texts: [`${name} ${shortMoney(s.values[latest]!)}`, shortMoney(s.values[latest]!)], name, along: back(s.values), role: "label", swatch: colours[i] }
      }),
    ],
    legend: [
      { mark: { kind: "line", color: INKS.total }, parts: [muted("Total "), fig(formatWholeMoney(total[latest]!)), muted(" "), { text: signedWholeMoney(change), cls: changeCls(change) }, muted(` since ${shortDate(dates[0]!)}`)] },
      ...shown.map((s, i): LegendItem => ({ mark: { kind: "line", color: colours[i]! }, parts: [{ text: s.name, cls: "label" }] })),
      ...(hidden > 0 ? [{ parts: [muted(`+${hidden} more in the total`)] }] : []),
    ],
    tip: (i) => {
      const iso = dates[i]
      if (!iso || i > latest) return iso ? { title: dayTitle(iso, todayISO), rows: [{ label: "Not yet", value: "—" }] } : null
      return {
        title: dayTitle(iso, todayISO),
        rows: [
          { color: INKS.total, label: "Total", value: formatMoney(total[i]!) },
          ...shown.map((s, k) => ({ color: colours[k]!, label: clip(s.name, 22), value: formatMoney(s.values[i]!), cls: "label" })),
        ],
      }
    },
  }
}

/** Cash flow over the period's dates: money in beside money out per week
 * while a week's pair has room, else per month, by the Totals' rules; the
 * tallest named after their biggest payee; each period's net beside its
 * date where every period has room (the TUI's cashFlowChart). */
export function cashFlowChart(
  dates: string[],
  width: number,
  todayISO: string,
  accounts: Account[],
  transactions: Transaction[],
  scopeIds: ReadonlySet<number>,
  weekStart: WeekStart = "monday",
): ChartModel {
  if (!dates.length) return emptyChart("No days in range")
  const cols = width / CELL
  const monthly = cols / Math.ceil(dates.length / 7) < 5
  const buckets: Array<{ start: string; end: string }> = []
  for (const iso of dates) {
    const startsWeek = dayOfWeek(iso, weekStart) === 0
    const newBucket = !buckets.length || (monthly ? iso.slice(8, 10) === "01" : startsWeek)
    if (newBucket) buckets.push({ start: iso, end: iso })
    else buckets[buckets.length - 1]!.end = iso
  }
  const first = dates[0]!, last = dates[dates.length - 1]!
  const inRange = transactions.filter((t) => t.dateISO >= first && t.dateISO <= last && t.dateISO <= todayISO)
  const flows = buckets.map((b) => computePeriodFlows(accounts, inRange.filter((t) => t.dateISO >= b.start && t.dateISO <= b.end), scopeIds))
  const rowsOf = flowRows(accounts, inRange, scopeIds)
  const scale = niceScale(Math.max(0, ...flows.flatMap((f) => [f.income, f.spent])))
  const future = (i: number) => buckets[i]!.start > todayISO
  const bars = flows.flatMap((f, i) => [
    { slot: i, sub: 0, subs: 2, value: future(i) ? 0 : f.income, color: INKS.in },
    { slot: i, sub: 1, subs: 2, value: future(i) ? 0 : f.spent, color: INKS.out },
  ])
  const roomy = cols / buckets.length >= 8
  const order = (kind: 0 | 1) => bars.map((_, i) => i).filter((i) => i % 2 === kind && bars[i]!.value > 0).sort((a, b) => bars[b]!.value - bars[a]!.value).slice(0, roomy ? undefined : 2)
  const [ins, outs] = [order(0), order(1)]
  const ranked = [ins[0], outs[0], ...[...ins.slice(1), ...outs.slice(1)].sort((a, b) => bars[b]!.value - bars[a]!.value)].filter((i): i is number => i != null)
  const labels: PointLabel[] = ranked.map((i) => {
    const b = buckets[Math.floor(i / 2)]!
    const payee = biggestPayee(i % 2 === 0 ? rowsOf.income : rowsOf.spent, b.start, b.end)
    const total = shortMoney(bars[i]!.value)
    const sign = i % 2 === 0 ? "+" : "-"
    const texts = barNames(`${sign}${total}`, bars[i]!.value, payee, sign)
    return { at: bars[i]!.slot, value: bars[i]!.value, texts: [...texts, `${sign}${total}`], role: "label", bar: { slot: bars[i]!.slot, sub: bars[i]!.sub, subs: 2 } }
  })
  const name = (b: (typeof buckets)[number]) => (monthly ? MONTHS[Number(b.start.slice(5, 7)) - 1]! : shortDate(b.start))
  const netOf = (i: number) => (future(i) || (!flows[i]!.income && !flows[i]!.spent) ? "" : `${flows[i]!.net > 0.5 ? "+" : ""}${shortMoney(flows[i]!.net)}`)
  // The net beside each date only when every period has room for it.
  const slotPx = width / buckets.length
  const withNet = buckets.every((b, i) => (Math.max(name(b).length, netOf(i).length) + 2) * 6.7 < slotPx)
  const xLabels: XLabel[] = buckets.map((b, i) => {
    const net = withNet ? netOf(i) : ""
    return { at: i, text: name(b), priority: 1 + i / 1000, ...(net ? { below: { text: net, cls: flows[i]!.net >= 0 ? "good" : "bad" } } : {}) }
  })
  const income = sum(flows.map((f) => f.income)), spent = sum(flows.map((f) => f.spent))
  const net = income - spent
  const firstIn = historyStart(flowRows(accounts, transactions, scopeIds).income)
  const inFrom = firstIn && firstIn > addDays(first, 31) && firstIn <= todayISO ? firstIn : null
  return {
    x: "slots",
    length: buckets.length,
    y: { min: 0, max: scale.max, ticks: ticksOf(0, scale.max, scale.step) },
    bars,
    markers: periodMarkers(buckets, width, todayISO, !monthly),
    labels,
    xLabels,
    legend: [
      { mark: { kind: "bar", color: INKS.in }, parts: [muted("In "), fig(formatWholeMoney(income)), ...(inFrom ? [muted(` (recorded from ${MONTHS[Number(inFrom.slice(5, 7)) - 1]} ${inFrom.slice(0, 4)})`)] : [])] },
      { mark: { kind: "bar", color: INKS.out }, parts: [muted("Out "), fig(formatWholeMoney(spent))] },
      { parts: [muted("Net "), { text: signedWholeMoney(net), cls: changeCls(net) }, muted(` · ${monthly ? "monthly" : "weekly"}`)] },
    ],
    tip: (i) => {
      const b = buckets[i], f = flows[i]
      if (!b || !f) return null
      if (future(i)) return { title: spanTitle(b.start, b.end), rows: [{ label: "Not yet", value: "—" }] }
      const payIn = biggestPayee(rowsOf.income, b.start, b.end), payOut = biggestPayee(rowsOf.spent, b.start, b.end)
      return {
        title: `${monthly ? `${MONTHS[Number(b.start.slice(5, 7)) - 1]} ${b.start.slice(0, 4)} · ` : "Week · "}${spanTitle(b.start, b.end)}`,
        rows: [
          { color: INKS.in, style: "bar", label: "In", value: formatMoney(f.income) },
          ...(payIn ? [{ label: clip(payIn.name, 24), value: formatWholeMoney(payIn.amount), cls: "label", sub: true }] : []),
          { color: INKS.out, style: "bar", label: "Out", value: formatMoney(f.spent) },
          ...(payOut ? [{ label: clip(payOut.name, 24), value: formatWholeMoney(payOut.amount), cls: "label", sub: true }] : []),
          { label: "Net", value: signedWholeMoney(f.net), cls: changeCls(f.net) },
        ],
      }
    },
  }
}

