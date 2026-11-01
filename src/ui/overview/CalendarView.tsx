import { For, Index, Show, createMemo } from "solid-js"
import type { CalendarDay } from "../../domain/spending"
import { MONTHS } from "../../domain/days"
import { data } from "../../state/dataStore"
import { ink, theme } from "../../theme"
import { muted, type Span } from "../primitives/spans"
import { S } from "../primitives/S"
import { shortMoney } from "../text"

/** Day colours by spending level (0 = none): one purple, darker to
 * brighter for more, up to the palette's mauve. Data colours. */
export const LEVEL_BG = [theme.surface0, "#3f3459", "#5f4888", "#8d68bd", "#cba6f7"] as const
/** Days still to come in the range: the grid's extent, barely there. */
const FUTURE_BG = theme.base

const WEEKDAYS = () => (data.state.weekStart === "sunday" ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"])
/** The weekday names' column. */
const LABEL = 4
/** A week's widest column and a weekday's tallest band: past these a grid
 * looks sparse rather than big. */
const MAX_CELL = 20
const MAX_BAND = 6

export interface CalendarLayout {
  /** How many weeks fit (the latest). */
  weeks: number
  /** Columns each shown week takes, its gap included: the pane's width
   * shared out, so a year still fills it (some weeks a column wider). */
  widths: number[]
  /** The narrowest week's columns: what fits in every cell. */
  cell: number
  /** A blank column after each day, when cells are wide enough to want one. */
  gap: 0 | 1
  /** Lines a weekday takes, its gap included. */
  band: number
  /** A blank line after each weekday, when bands are tall enough. */
  bandGap: 0 | 1
  /** Day numbers in the cells; without them the days are a carpet of
   * colour. */
  dayNumbers: boolean
  /** A day's spending: on the line under its number, beside it, or not. */
  amounts: "below" | "beside" | null
}

/**
 * How the days fit the pane: cells as big as the pane allows, and what goes
 * in them decided by how big they came out, never by the range. A month
 * in a big pane gets roomy cells with day numbers and amounts; the same
 * month squeezed, or a year anywhere, becomes a carpet of colour.
 */
export function calendarLayout(weekCount: number, width: number, rows: number): CalendarLayout {
  const across = Math.max(1, width - LABEL)
  const weeks = Math.max(1, Math.min(weekCount, across))
  const share = Math.min(MAX_CELL * weeks, across)
  const widths = Array.from({ length: weeks }, (_, i) => Math.floor(((i + 1) * share) / weeks) - Math.floor((i * share) / weeks))
  const cell = Math.min(...widths)
  // Numbers want a cell of " 12 " and a gap after it; narrower, the days
  // are bare colour, and a gap between them would only stripe it.
  const dayNumbers = cell >= 5
  const gap = dayNumbers ? 1 : 0
  const inner = cell - gap
  // The month names take the first line.
  const band = Math.max(1, Math.min(MAX_BAND, Math.floor((rows - 1) / 7)))
  const bandGap = band >= 3 ? 1 : 0
  const lines = band - bandGap
  // An amount shows only where the largest ("$1.2k") fits, so no day goes
  // without one for want of room.
  const amounts = !dayNumbers ? null : lines >= 2 && inner >= 6 ? "below" : inner >= 10 ? "beside" : null
  return { weeks, widths, cell, gap: gap as 0 | 1, band, bandGap: bandGap as 0 | 1, dayNumbers, amounts }
}

/**
 * The range's days as a grid: a column per week, a band of lines per
 * weekday, month names on top (with the month's spending where it fits
 * before the next). Sized and filled by calendarLayout. Today is marked in
 * today's chart colour; days to come are dim.
 */
/** `through`: drawing in, the days after it are blank (the tiles come in in date order). */
export function CalendarView(props: { weeks: Array<Array<CalendarDay | null>>; width: number; rows: number; today: string; through?: string }) {
  const layout = createMemo(() => calendarLayout(props.weeks.length, props.width, props.rows))
  const shown = createMemo(() => props.weeks.slice(-layout().weeks))
  const lines = () => Array.from({ length: layout().band }, (_, k) => k)
  // Months' spending under the grid when their names have no room for it
  // and a line is spare.
  const totalsBelow = () => props.rows - 1 - 7 * layout().band >= 1 && !totalsFitBeside(shown(), layout().widths, props.today)
  return (
    <>
      <text wrapMode="none" fg={ink.note}>{" ".repeat(LABEL) + monthLabels(shown(), layout().widths, props.today)}</text>
      <For each={WEEKDAYS()}>
        {(label, row) => (
          <For each={lines()}>
            {(line) => (
              <text wrapMode="none">
                <S fg={ink.note}>{(line === 0 ? label : "").padEnd(LABEL)}</S>
                {/* Index: a new range brings new weeks; their cells update in place. */}
                <Index each={shown()}>
                  {(week, i) => <Cell day={((d) => (d && props.through !== undefined && d.dateISO > props.through ? null : d))(week()[row()] ?? null)} width={layout().widths[i] ?? layout().cell} layout={layout()} line={line} today={props.today} />}
                </Index>
              </text>
            )}
          </For>
        )}
      </For>
      <Show when={totalsBelow()}>
        <text wrapMode="none" fg={ink.label}>{" ".repeat(LABEL) + monthTotals(shown(), layout().widths, props.today)}</text>
      </Show>
    </>
  )
}

/** One line of one day's cell, then its gap column. */
function Cell(props: { day: CalendarDay | null; width: number; layout: CalendarLayout; line: number; today: string }) {
  const inner = () => props.width - props.layout.gap
  const past = () => props.day != null && props.day.dateISO <= props.today
  const isToday = () => props.day?.dateISO === props.today
  // The band's last line is its gap: blank, so weekdays read as rows.
  const blankLine = () => props.layout.bandGap === 1 && props.line === props.layout.band - 1
  const bg = () => (props.day == null || blankLine() ? theme.canvas : past() ? LEVEL_BG[props.day.level] : FUTURE_BG)
  const amount = () => (past() && props.day!.spent > 0 ? shortMoney(props.day!.spent) : "")
  const text = () => {
    const w = inner()
    if (props.day == null || blankLine()) return " ".repeat(w)
    const { dayNumbers, amounts } = props.layout
    if (!dayNumbers) return isToday() && props.line === 0 ? "•".padEnd(w) : " ".repeat(w)
    const day = ` ${Number(props.day.dateISO.slice(8, 10))}`
    if (props.line === 0 && amounts === "beside" && amount() && day.length + 1 + amount().length < w) return day + amount().padStart(w - day.length - 1) + " "
    if (props.line === 0) return day.padEnd(w)
    // Under its day's number, so it reads as that day's.
    if (props.line === 1 && amounts === "below" && amount().length < w) return ` ${amount()}`.padEnd(w)
    return " ".repeat(w)
  }
  // Text: dark on the brighter levels; days to come faint; today in its colour.
  const fg = () => (isToday() ? theme.chartToday : !past() ? ink.faint : props.day!.level >= 4 ? theme.crust : props.line === 0 ? ink.label : ink.figure)
  return (
    <>
      <S fg={fg()} bg={bg()} bold={isToday()}>{text()}</S>
      {props.layout.gap ? <S bg={theme.canvas}>{" "}</S> : null}
    </>
  )
}

/** Where each month starts on the grid: the week holding its 1st (the
 * grid's first week names the range's first month unless a 1st comes in
 * it too), with its spending so far. */
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

/** Texts at their columns; one that would touch the one before is skipped. */
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

/** Whether every month's name has room for its spending beside it. */
export function totalsFitBeside(weeks: Array<Array<CalendarDay | null>>, widths: number[], today: string): boolean {
  const { starts, width } = monthStarts(weeks, widths, today)
  return starts.every((m, k) => m.pos + m.name.length + (m.total ? m.total.length + 1 : 0) < (starts[k + 1]?.pos ?? width + 1))
}

/** Month names over the week each month starts in, with each month's
 * spending so far when every name has room for it, else names alone. */
export function monthLabels(weeks: Array<Array<CalendarDay | null>>, widths: number[], today: string): string {
  const { starts, width } = monthStarts(weeks, widths, today)
  const beside = totalsFitBeside(weeks, widths, today)
  return placeAt(width, starts.map((m) => ({ pos: m.pos, text: beside && m.total ? `${m.name} ${m.total}` : m.name })))
}

/** Each month's spending alone, under its weeks: for a grid whose names
 * have no room for it. */
export function monthTotals(weeks: Array<Array<CalendarDay | null>>, widths: number[], today: string): string {
  const { starts, width } = monthStarts(weeks, widths, today)
  return placeAt(width, starts.map((m) => ({ pos: m.pos, text: m.total })))
}

/** The calendar's legend for the pane's bottom border: the levels as
 * swatches, the no-spend days and the busiest weekday. */
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
