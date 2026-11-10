import { Index, Show, createMemo } from "solid-js"
import type { CalendarDay } from "../../domain/spending"
import { MONTHS } from "../../domain/days"
import { data } from "../../state/dataStore"
import { fade, ink, theme, tone, whenThemeChanges } from "../../theme"
import { muted, type Span } from "../primitives/spans"
import { StyledLine, type StyledSpan } from "../primitives/StyledLine"
import { shortMoney } from "../text"

export const LEVEL_BG: string[] = []
let FUTURE_BG = ""
whenThemeChanges(() => {
  LEVEL_BG.splice(0, LEVEL_BG.length, theme.surface0, fade(theme.mauve, 0.75), fade(theme.mauve, 0.55), fade(theme.mauve, 0.3), theme.mauve)
  FUTURE_BG = theme.base
})

const WEEKDAYS = () => (data.state.weekStart === "sunday" ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"])
const LABEL = 4
const MAX_CELL = 20
const MAX_BAND = 6

interface CalendarLayout {
  weeks: number
  widths: number[]
  cell: number
  gap: 0 | 1
  band: number
  bandGap: 0 | 1
  dayNumbers: boolean
  amounts: "below" | "beside" | null
}

function calendarLayout(weekCount: number, width: number, rows: number): CalendarLayout {
  const across = Math.max(1, width - LABEL)
  const weeks = Math.max(1, Math.min(weekCount, across))
  const share = Math.min(MAX_CELL * weeks, across)
  const widths = Array.from({ length: weeks }, (_, i) => Math.floor(((i + 1) * share) / weeks) - Math.floor((i * share) / weeks))
  const cell = Math.min(...widths)
  const dayNumbers = cell >= 5
  const gap = dayNumbers ? 1 : 0
  const inner = cell - gap
  const gapFor = (b: number) => (b >= 3 ? 1 : 0)
  let band = 1
  while (band < MAX_BAND && 1 + 7 * (band + 1) - gapFor(band + 1) <= rows) band++
  const bandGap = gapFor(band)
  const lines = band - bandGap
  const amounts = !dayNumbers ? null : lines >= 2 && inner >= 6 ? "below" : inner >= 10 ? "beside" : null
  return { weeks, widths, cell, gap: gap as 0 | 1, band, bandGap: bandGap as 0 | 1, dayNumbers, amounts }
}

export function CalendarView(props: { weeks: Array<Array<CalendarDay | null>>; width: number; rows: number; today: string; through?: string; markColor?: string }) {
  const layout = createMemo(() => calendarLayout(props.weeks.length, props.width, props.rows))
  const shown = createMemo(() => props.weeks.slice(-layout().weeks))
  const totalsBelow = () => props.rows - 1 - gridLines(layout()) >= 1 && !totalsFitBeside(shown(), layout().widths, props.today)
  const lines = createMemo(() => calendarLines(shown(), layout(), WEEKDAYS(), props.today, props.through, props.markColor))
  return (
    <>
      <text wrapMode="none" fg={ink.note}>{" ".repeat(LABEL) + monthLabels(shown(), layout().widths, props.today)}</text>
      <Index each={lines()}>{(line) => <StyledLine spans={line()} />}</Index>
      <Show when={totalsBelow()}>
        <text wrapMode="none" fg={ink.label}>{" ".repeat(LABEL) + monthTotals(shown(), layout().widths, props.today)}</text>
      </Show>
    </>
  )
}

function gridLines(layout: CalendarLayout): number {
  return 7 * layout.band - layout.bandGap
}

function calendarLines(weeks: Array<Array<CalendarDay | null>>, layout: CalendarLayout, weekdays: string[], today: string, through?: string, markColor: string = ink.figure): StyledSpan[][] {
  const out: StyledSpan[][] = []
  for (let row = 0; row < 7; row++) {
    for (let line = 0; line < layout.band; line++) {
      if (row === 6 && line === layout.band - 1 && layout.bandGap) break
      const spans: StyledSpan[] = [{ text: (line === 0 ? weekdays[row]! : "").padEnd(LABEL), fg: ink.note }]
      weeks.forEach((week, i) => {
        const d = week[row] ?? null
        const day = d && through !== undefined && d.dateISO > through ? null : d
        cell(spans, day, layout.widths[i] ?? layout.cell, layout, line, today, markColor)
      })
      out.push(spans)
    }
  }
  return out
}

function push(spans: StyledSpan[], span: StyledSpan) {
  const last = spans[spans.length - 1]
  if (last && last.fg === span.fg && last.bg === span.bg && !last.bold === !span.bold) last.text += span.text
  else spans.push(span)
}

function cell(spans: StyledSpan[], day: CalendarDay | null, width: number, layout: CalendarLayout, line: number, today: string, markColor: string) {
  const w = width - layout.gap
  const past = day != null && day.dateISO <= today
  const isToday = day?.dateISO === today
  const blankLine = layout.bandGap === 1 && line === layout.band - 1
  const bg = day == null || blankLine || day.outside ? theme.canvas : past ? LEVEL_BG[day.level] : FUTURE_BG
  const expected = !past && day?.expected ? day.expected : 0
  const amount = day?.mark ?? (past && day!.spent > 0 ? shortMoney(day!.spent) : expected ? shortMoney(expected) : "")
  const text = (() => {
    if (day == null || blankLine) return " ".repeat(w)
    const { dayNumbers, amounts } = layout
    if (!dayNumbers) return isToday && line === 0 ? "•".padEnd(w) : " ".repeat(w)
    const num = ` ${Number(day.dateISO.slice(8, 10))}`
    if (line === 0 && amounts === "beside" && amount && num.length + 1 + amount.length < w) return num + amount.padStart(w - num.length - 1) + " "
    if (line === 0) return num.padEnd(w)
    if (line === 1 && amounts === "below" && amount.length < w) return ` ${amount}`.padEnd(w)
    return " ".repeat(w)
  })()
  const marked = day?.mark != null && line > 0 || (day?.mark != null && layout.amounts === "beside")
  const fg = marked ? markColor : isToday ? theme.chartToday : day?.outside ? ink.note : !past ? (expected ? tone.caution : ink.faint) : day!.level >= 4 ? theme.crust : line === 0 ? ink.label : ink.figure
  push(spans, { text, fg, bg, bold: isToday || marked })
  if (layout.gap) push(spans, { text: " ", bg: theme.canvas })
}

function monthStarts(weeks: Array<Array<CalendarDay | null>>, widths: number[], today: string) {
  const at = widths.map((_, i) => widths.slice(0, i).reduce((a, b) => a + b, 0))
  const totals = new Map<string, number>()
  for (const d of weeks.flat()) if (d && d.dateISO <= today) totals.set(d.dateISO.slice(0, 7), (totals.get(d.dateISO.slice(0, 7)) ?? 0) + d.spent)
  const starts: Array<{ pos: number; name: string; total: string }> = []
  weeks.forEach((week, i) => {
    const first = week.find((d) => d?.dateISO.endsWith("-01")) ?? (i === 0 ? week.find((d) => d) : undefined)
    if (!first) return
    const month = first.dateISO.slice(0, 7)
    starts.push({ pos: at[i]!, name: MONTHS[Number(month.slice(5, 7)) - 1]!, total: totals.get(month) ? shortMoney(totals.get(month)!) : "" })
  })
  return { starts, width: widths.reduce((a, b) => a + b, 0) }
}

function placeAt(width: number, items: Array<{ pos: number; text: string }>): string {
  const out = new Array<string>(width).fill(" ")
  let free = 0
  for (const { pos, text } of items) {
    if (pos < free || !text) continue
    for (let c = 0; c < text.length && pos + c < width; c++) out[pos + c] = text[c]!
    free = pos + text.length + 1
  }
  return out.join("")
}

function totalsFitBeside(weeks: Array<Array<CalendarDay | null>>, widths: number[], today: string): boolean {
  const { starts, width } = monthStarts(weeks, widths, today)
  return starts.every((m, k) => m.pos + m.name.length + (m.total ? m.total.length + 1 : 0) < (starts[k + 1]?.pos ?? width + 1))
}

function monthLabels(weeks: Array<Array<CalendarDay | null>>, widths: number[], today: string): string {
  const { starts, width } = monthStarts(weeks, widths, today)
  const beside = totalsFitBeside(weeks, widths, today)
  return placeAt(width, starts.map((m) => ({ pos: m.pos, text: beside && m.total ? `${m.name} ${m.total}` : m.name })))
}

function monthTotals(weeks: Array<Array<CalendarDay | null>>, widths: number[], today: string): string {
  const { starts, width } = monthStarts(weeks, widths, today)
  return placeAt(width, starts.map((m) => ({ pos: m.pos, text: m.total })))
}

export function calendarLegend(weeks: Array<Array<CalendarDay | null>>, today: string): Span[] {
  const days = weeks.flat().filter((d): d is CalendarDay => d != null && d.dateISO <= today)
  if (!days.length) return [muted("No days yet")]
  const noSpend = days.filter((d) => d.spent === 0).length
  const totals = [0, 0, 0, 0, 0, 0, 0], counts = [0, 0, 0, 0, 0, 0, 0]
  for (const week of weeks) week.forEach((d, i) => { if (d && d.dateISO <= today) { totals[i]! += d.spent; counts[i]!++ } })
  const avg = totals.map((t, i) => (counts[i] ? t / counts[i]! : 0))
  const busiest = avg.indexOf(Math.max(...avg))
  return [
    muted("less "),
    ...LEVEL_BG.map((fg): Span => ({ text: "■", fg })),
    muted(" more"),
    muted(`   ${noSpend} no-spend ${noSpend === 1 ? "day" : "days"}   busiest ${WEEKDAYS()[busiest]}`),
  ]
}
