import { Index, Show, createMemo } from "solid-js"
import { data } from "../../state/dataStore"
import { categoryColor, ink, theme, tone } from "../../theme"
import { formatMoney, formatWholeMoney } from "../../domain/dashboard"
import { addDays, daysBetween } from "../../domain/days"
import { monthlyTotal, upcomingCharges, type Subscription } from "../../domain/subscriptions"
import { categoryMark } from "../icons"
import { count, fit, shortDate, shortMoney, truncate } from "../text"
import type { Span } from "../primitives/spans"
import { StyledLine, type StyledSpan } from "../primitives/StyledLine"

export function subscriptionsLegend(list: Subscription[], dueBeforePayday: number): Span[] {
  const active = list.filter((s) => !s.stopped)
  const changed = active.filter((s) => s.change).length
  const stopped = list.length - active.length
  const monthly = monthlyTotal(list)
  return [
    { text: `${active.length} active · ${formatWholeMoney(monthly)} a month · ${formatWholeMoney(monthly * 12)} a year`, fg: ink.label },
    ...(dueBeforePayday > 0 ? [{ text: ` · ${formatWholeMoney(dueBeforePayday)} due before payday`, fg: ink.label }] : []),
    ...(changed ? [{ text: ` · ${count(changed, "price change")}`, fg: tone.caution }] : []),
    ...(stopped ? [{ text: ` · ${stopped} stopped`, fg: ink.note }] : []),
  ]
}

const SUB_COLUMNS = { every: 12, charge: 10, month: 10, next: 11, change: 30 }
const SUB_AHEAD = 30
const SUB_SOON = 3

export function SubscriptionsView(props: { list: Subscription[]; width: number; rows: number; today: string; payday: string; progress?: number }) {
  const p = () => props.progress ?? 1
  const rowsIn = () => Math.ceil(Math.min(1, p() / 0.5) * shown().length)
  const stripEdge = () => Math.min(1, Math.max(0, (p() - 0.35) / 0.65)) * props.width
  const showChange = () => props.width >= 80
  const nameWidth = () => Math.max(10, props.width - 2 - SUB_COLUMNS.every - SUB_COLUMNS.charge - SUB_COLUMNS.month - SUB_COLUMNS.next - (showChange() ? SUB_COLUMNS.change : 0))
  const strip = () => props.rows - 1 - props.list.length >= 4
  const room = () => Math.max(0, props.rows - 1 - (strip() ? 4 : 0))
  const shown = createMemo(() => props.list.length > room() ? props.list.slice(0, Math.max(0, room() - 1)) : props.list)
  const more = () => props.list.length - shown().length
  const colour = (id: number | null) => categoryColor(data.state.categories.find((c) => c.id === id)?.color)
  const line = (s: Subscription): StyledSpan[] => {
    const dim = s.stopped
    const soon = !s.stopped && daysBetween(props.today, s.next) <= SUB_SOON
    const due = s.stopped ? "stopped" : s.next < props.today ? "due" : shortDate(s.next)
    const pct = s.change ? Math.round(((s.change.to - s.change.from) / s.change.from) * 100) : 0
    return [
      { text: `${categoryMark(s.categoryId)} `, fg: dim ? ink.note : colour(s.categoryId) },
      { text: fit(s.name, nameWidth()), fg: dim ? ink.note : ink.figure },
      { text: s.cadence.padStart(SUB_COLUMNS.every), fg: ink.note },
      { text: formatMoney(s.amount).padStart(SUB_COLUMNS.charge), fg: dim ? ink.note : ink.figure },
      { text: formatMoney(s.monthly).padStart(SUB_COLUMNS.month), fg: dim ? ink.note : ink.label },
      { text: due.padStart(SUB_COLUMNS.next), fg: s.stopped ? ink.note : soon ? tone.caution : ink.label },
      ...(showChange() && s.change ? [{
        text: `  ${s.change.to > s.change.from ? "▲" : "▼"} from ${formatMoney(s.change.from)} ${shortDate(s.change.since)} (${pct > 0 ? "+" : ""}${pct}%)`.slice(0, SUB_COLUMNS.change),
        fg: s.change.to > s.change.from ? tone.caution : tone.good,
      }] : []),
    ]
  }
  const ahead = createMemo(() => upcomingCharges(props.list, props.today, addDays(props.today, SUB_AHEAD)))
  const colOf = (iso: string) => Math.round((daysBetween(props.today, iso) * (props.width - 1)) / SUB_AHEAD)
  const stripLines = createMemo((): StyledSpan[][] => {
    const w = props.width
    const marks = Array.from({ length: w }, (): StyledSpan => ({ text: "─", fg: ink.rule }))
    const names = Array.from({ length: w }, (): StyledSpan => ({ text: " ", fg: ink.label }))
    const dates = Array.from({ length: w }, (): StyledSpan => ({ text: " ", fg: ink.note }))
    const put = (cells: StyledSpan[], col: number, text: string, fg: string) => {
      if (col < 0 || col + text.length > w || cells.slice(Math.max(0, col - 1), col + text.length + 1).some((c) => c.text !== " ")) return false
      ;[...text].forEach((ch, k) => (cells[col + k] = { text: ch, fg }))
      return true
    }
    const paydayCol = props.payday > props.today && props.payday <= addDays(props.today, SUB_AHEAD) ? colOf(props.payday) : -1
    if (paydayCol >= 0) marks[paydayCol] = { text: "┃", fg: tone.good }
    marks[0] = { text: "┃", fg: theme.chartToday }
    for (const c of ahead()) {
      const col = colOf(c.dateISO)
      const sub = props.list.find((s) => s.name === c.name)
      marks[col] = { text: "●", fg: colour(sub?.categoryId ?? null) }
      ;[`${c.name} ${shortMoney(c.amount)}`, `${truncate(c.name, 12)} ${shortMoney(c.amount)}`, shortMoney(c.amount)].some((text) => put(names, col, text, ink.label))
    }
    put(dates, 0, "today", theme.chartToday)
    if (paydayCol >= 0) put(dates, paydayCol, "payday", tone.good)
    for (let d = 7; d <= SUB_AHEAD; d += 7) put(dates, colOf(addDays(props.today, d)), shortDate(addDays(props.today, d)), ink.note)
    return [marks, names, dates]
  })
  return (
    <Show when={props.list.length} fallback={<text fg={ink.note}>No regular payments found</text>}>
      <StyledLine spans={[
        { text: "  " + "Payment".padEnd(nameWidth()), fg: ink.label, bold: true },
        { text: "Every".padStart(SUB_COLUMNS.every), fg: ink.label, bold: true },
        { text: "Charge".padStart(SUB_COLUMNS.charge), fg: ink.label, bold: true },
        { text: "A month".padStart(SUB_COLUMNS.month), fg: ink.label, bold: true },
        { text: "Next".padStart(SUB_COLUMNS.next), fg: ink.label, bold: true },
        ...(showChange() ? [{ text: "  Change", fg: ink.label, bold: true }] : []),
      ]} />
      <Index each={shown()}>{(s, i) => <StyledLine spans={i < rowsIn() ? line(s()) : [{ text: " " }]} />}</Index>
      <Show when={more() > 0}><text fg={ink.note}>{`… ${more()} more`}</text></Show>
      <Show when={strip()}>
        <box flexGrow={1} />
        <Index each={stripLines()}>{(cells) => <StyledLine spans={p() >= 1 ? cells() : cells().map((c, col) => (col < stripEdge() ? c : { text: " ", fg: c.fg }))} />}</Index>
      </Show>
    </Show>
  )
}
