/**
 * The Calendar view (the TUI's CalendarView): the range's days as a grid, a
 * column per week and a row per weekday, coloured by how much was spent
 * (one purple, darker to brighter), month names over the week each starts
 * in with the month's spending where it fits. Cells as big as the pane
 * allows; what goes in them (day numbers, amounts) is decided by how big
 * they came out, never by the range. Today is outlined in today's colour;
 * days to come are dim. A day opens its spending in Transactions.
 */
import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import type { CalendarDay } from "../../../domain/spending"
import { MONTHS } from "../../../domain/days"
import { formatMoney } from "../../../domain/dashboard"
import { shortMoney } from "../../../ui/text"
import { textWidth, type LegendItem } from "../../charts"
import { theme } from "../../theme"
import { dayTitle } from "./periodCharts"

/** Day colours by spending level (0 = none): the TUI's LEVEL_BG. Data colours. */
export const LEVEL_BG = [theme.surface0, "#3f3459", "#5f4888", "#8d68bd", "#cba6f7"] as const
const FUTURE_BG = theme.base

const weekdays = (weekStart: string) => (weekStart === "sunday" ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"])
/** The weekday names' column, the month names' row, the gap between cells. */
const LABEL = 34
const HEAD = 16
const GAP = 3
/** A cell's widest and tallest: past these a grid looks sparse rather than big. */
const MAX_W = 200
const MAX_H = 54

export function CalendarView(props: { weeks: Array<Array<CalendarDay | null>>; today: string; weekStart: string; onPick?: (iso: string) => void }) {
  let box!: HTMLDivElement
  const [size, setSize] = createSignal({ w: 0, h: 0 })
  onMount(() => {
    const observer = new ResizeObserver((entries) => {
      const r = entries[0]!.contentRect
      if (r.width < 10 || r.height < 10) return
      setSize({ w: Math.round(r.width), h: Math.round(r.height) })
    })
    observer.observe(box)
    onCleanup(() => observer.disconnect())
  })
  const layout = createMemo(() => {
    const { w, h } = size()
    if (!w) return null
    const across = w - LABEL
    // As many weeks as fit (the latest), each at least 6px.
    const fit = Math.max(1, Math.min(props.weeks.length, Math.floor((across + GAP) / (6 + GAP))))
    const weeks = props.weeks.slice(-fit)
    const cw = Math.min(MAX_W, Math.floor((across + GAP) / weeks.length - GAP))
    const ch = Math.max(6, Math.min(MAX_H, Math.floor((h - HEAD - GAP + GAP) / 7 - GAP)))
    const numbers = cw >= 22 && ch >= 15
    const amounts = numbers && ((cw >= 40 && ch >= 30) || cw >= 72)
    // Month names over the week holding each 1st (the first week names its
    // own), with the month's spending when every name has room for it.
    const totals = new Map<string, number>()
    for (const d of weeks.flat()) if (d && d.dateISO <= props.today) totals.set(d.dateISO.slice(0, 7), (totals.get(d.dateISO.slice(0, 7)) ?? 0) + d.spent)
    const starts: Array<{ week: number; name: string; total: string }> = []
    weeks.forEach((week, i) => {
      const first = week.find((d) => d?.dateISO.endsWith("-01")) ?? (i === 0 ? week.find((d) => d) : undefined)
      if (!first) return
      const month = first.dateISO.slice(0, 7)
      starts.push({ week: i, name: MONTHS[Number(month.slice(5, 7)) - 1]!, total: totals.get(month) ? shortMoney(totals.get(month)!) : "" })
    })
    const room = (k: number) => ((starts[k + 1]?.week ?? weeks.length) - starts[k]!.week) * (cw + GAP) - 8
    const beside = starts.every((m, k) => textWidth(`${m.name} ${m.total}`) < room(k))
    const months = starts.filter((m, k) => textWidth(m.name) < room(k) || k === starts.length - 1).map((m, k) => ({
      ...m, total: beside ? m.total : "", span: `${m.week + 2} / ${(starts[k + 1]?.week ?? weeks.length) + 2}`,
    }))
    return { weeks, cw, ch, numbers, amounts, months, carpet: !numbers }
  })
  return (
    <div class="calendar-box" ref={box} style={{ position: "relative", flex: "1 1 auto", "min-height": "160px" }}>
      <Show when={layout()}>{(l) => (
        <div class="calendar" classList={{ carpet: l().carpet }}
          style={{ "grid-template-columns": `${LABEL - GAP}px repeat(${l().weeks.length}, ${l().cw}px)`, "grid-template-rows": `${HEAD}px repeat(7, ${l().ch}px)` }}>
          <For each={l().months}>{(m) => (
            <span class="month" style={{ "grid-row": "1", "grid-column": m.span }}>{m.name}<Show when={m.total}><small>{m.total}</small></Show></span>
          )}</For>
          <For each={weekdays(props.weekStart)}>{(name, row) => (
            <span class="wd" style={{ "grid-row": String(row() + 2), "grid-column": "1" }}>{l().ch >= 10 ? name : ""}</span>
          )}</For>
          <For each={l().weeks}>{(week, col) => (
            <For each={week}>{(day, row) => (
              <Show when={day}>{(d) => {
                const past = () => d().dateISO <= props.today
                const amount = () => (past() && d().spent > 0 ? shortMoney(d().spent) : "")
                return (
                  <button type="button" class="day" disabled={!past()}
                    classList={{ future: !past(), today: d().dateISO === props.today, bright: past() && d().level >= 4 }}
                    style={{ "grid-row": String(row() + 2), "grid-column": String(col() + 2), background: past() ? LEVEL_BG[d().level] : FUTURE_BG }}
                    title={`${dayTitle(d().dateISO, props.today)} · ${!past() ? "to come" : formatMoney(d().spent)}`}
                    onClick={() => props.onPick?.(d().dateISO)}>
                    <Show when={l().numbers}><span class="num">{Number(d().dateISO.slice(8, 10))}</span></Show>
                    <Show when={l().amounts && amount()}><span class="amt">{amount()}</span></Show>
                  </button>
                )
              }}</Show>
            )}</For>
          )}</For>
        </div>
      )}</Show>
    </div>
  )
}

/** The calendar's legend (the TUI's calendarLegend): the levels as swatches,
 * the no-spend days and the busiest weekday. */
export function calendarLegend(weeks: Array<Array<CalendarDay | null>>, today: string, weekStart: string): LegendItem[] {
  const days = weeks.flat().filter((d): d is CalendarDay => d != null && d.dateISO <= today)
  if (!days.length) return [{ parts: [{ text: "No days yet", cls: "note" }] }]
  const noSpend = days.filter((d) => d.spent === 0).length
  const totals = [0, 0, 0, 0, 0, 0, 0], counts = [0, 0, 0, 0, 0, 0, 0]
  for (const week of weeks) week.forEach((d, i) => { if (d && d.dateISO <= today) { totals[i]! += d.spent; counts[i]!++ } })
  const avg = totals.map((t, i) => (counts[i] ? t / counts[i]! : 0))
  const busiest = avg.indexOf(Math.max(...avg))
  return [
    { parts: [{ text: "less", cls: "note" }] },
    { mark: { kind: "swatches", color: LEVEL_BG[4], colors: LEVEL_BG }, parts: [{ text: "more", cls: "note" }] },
    { parts: [{ text: `${noSpend} no-spend ${noSpend === 1 ? "day" : "days"}`, cls: "note" }] },
    { parts: [{ text: `busiest ${weekdays(weekStart)[busiest]}`, cls: "note" }] },
  ]
}
