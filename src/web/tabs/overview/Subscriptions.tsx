/**
 * The Subscriptions view (the TUI's SubscriptionsView): regular payments,
 * one a line: what, how often, the latest charge, a month's worth, the
 * next charge (soon ones in caution) and a price change; stopped ones
 * dimmed after the rest. Under the table, the next 30 days as a strip: a
 * mark on each day a payment is due, its name where it fits, and payday.
 */
import { For, Show, createMemo } from "solid-js"
import { PlotlineLineStylePresets } from "@unovis/ts"
import { VisAxis, VisPlotline, VisScatter, VisXYContainer } from "@unovis/solid"
import { formatMoney, formatWholeMoney } from "../../../domain/dashboard"
import { addDays, daysBetween } from "../../../domain/days"
import { monthlyTotal, upcomingCharges, type Subscription } from "../../../domain/subscriptions"
import type { Category } from "../../../domain/types"
import { count } from "../../../domain/words"
import { shortDate, shortMoney } from "../../../ui/text"
import type { LegendItem } from "../../charts"
import { catColor, ink, theme, tone } from "../../theme"
import { clip } from "./periodCharts"

/** Days the strip looks ahead; a charge this many days off (or fewer) wants a look. */
const AHEAD = 30
const SOON = 3

export function SubscriptionsView(props: { list: Subscription[]; today: string; payday: string; categories: Category[] }) {
  const colour = (id: number | null) => catColor(props.categories.find((c) => c.id === id)?.color)
  const due = (s: Subscription) => (s.stopped ? "stopped" : s.next < props.today ? "due" : shortDate(s.next))
  const soon = (s: Subscription) => !s.stopped && daysBetween(props.today, s.next) <= SOON
  const change = (s: Subscription) => {
    if (!s.change) return ""
    const pct = Math.round(((s.change.to - s.change.from) / s.change.from) * 100)
    return `${s.change.to > s.change.from ? "▲" : "▼"} from ${formatMoney(s.change.from)} ${shortDate(s.change.since)} (${pct > 0 ? "+" : ""}${pct}%)`
  }
  return (
    <div class="subs">
      <Show when={props.list.length} fallback={<div class="chart-empty">No regular payments found</div>}>
        <div class="subs-table">
          <div class="subs-row head">
            <span class="name">Payment</span><span class="every">Every</span><span class="num">Charge</span><span class="num">A month</span><span class="next">Next</span><span class="change">Change</span>
          </div>
          <For each={props.list}>{(s) => (
            <div class="subs-row" classList={{ stopped: s.stopped }}>
              <span class="name"><span class="dot" style={{ background: s.stopped ? ink.note : colour(s.categoryId) }} /><span class="ellipsis">{s.name}</span></span>
              <span class="every note">{s.cadence}</span>
              <span class="num figure money">{formatMoney(s.amount)}</span>
              <span class="num label money">{formatMoney(s.monthly)}</span>
              <span class={`next ${s.stopped ? "note" : soon(s) ? "caution" : "label"}`}>{due(s)}</span>
              <span class={`change ${!s.change ? "" : s.change.to > s.change.from ? "caution" : "good"}`}>{change(s)}</span>
            </div>
          )}</For>
        </div>
        <Strip list={props.list} today={props.today} payday={props.payday} colour={colour} />
      </Show>
    </div>
  )
}

/** The next 30 days (Unovis): today and payday as rules, a dot per charge
 * with its name and amount under it where they don't collide. */
function Strip(props: { list: Subscription[]; today: string; payday: string; colour: (id: number | null) => string }) {
  type Charge = { x: number; y: number; color: string; label: string }
  const charges = createMemo((): Charge[] => upcomingCharges(props.list, props.today, addDays(props.today, AHEAD)).map((c) => ({
    x: daysBetween(props.today, c.dateISO), y: 0,
    color: props.colour(props.list.find((s) => s.name === c.name)?.categoryId ?? null),
    label: `${clip(c.name, 18)} ${shortMoney(c.amount)}`,
  })))
  const paydayAt = () => (props.payday > props.today && props.payday <= addDays(props.today, AHEAD) ? daysBetween(props.today, props.payday) : null)
  const ticks = () => [0, 7, 14, 21, 28].filter((d) => paydayAt() == null || Math.abs(d - paydayAt()!) > 2 || d === 0).concat(paydayAt() != null ? [paydayAt()!] : []).sort((a, b) => a - b)
  const tick = (d: number) => (d === 0 ? "today" : d === paydayAt() ? "payday" : shortDate(addDays(props.today, d)))
  return (
    <div class="subs-strip chart">
      <VisXYContainer<Charge> class="chart-vis" height={64} margin={{ left: 64, right: 64, top: 4, bottom: 16 }} clipPathExtend={64} xDomain={[0, AHEAD]} yDomain={[-1, 1]} autoMargin={false} bleed={{ top: 0, bottom: 0, left: 0, right: 0 }}>
        <VisAxis<Charge> type="x" tickValues={ticks()} tickFormat={(v: number | Date) => tick(Number(v))} gridLine={false} domainLine tickLine={false} tickPadding={4} tickTextWidth={80} tickTextHideOverlapping={false} />
        <VisPlotline<Charge> axis="x" value={0} color={theme.chartToday} lineWidth={2} lineStyle={PlotlineLineStylePresets.Solid} duration={0} />
        <Show when={paydayAt() != null}><VisPlotline<Charge> axis="x" value={paydayAt()!} color={tone.good} lineWidth={2} lineStyle={PlotlineLineStylePresets.Solid} duration={0} /></Show>
        <VisScatter<Charge> data={charges()} x={(d) => d.x} y={() => 0.5} color={(d) => d.color} size={9} strokeColor="var(--background)" strokeWidth={1.5}
          label={(d) => d.label} labelPosition="bottom" labelColor={() => ink.label} labelHideOverlapping duration={0} excludeFromDomainCalculation />
      </VisXYContainer>
    </div>
  )
}

/** The Subscriptions legend: how many, a month and a year, what's due before payday, what changed. */
export function subscriptionsLegend(list: Subscription[], dueBeforePayday: number): LegendItem[] {
  const active = list.filter((s) => !s.stopped)
  const changed = active.filter((s) => s.change).length
  const stopped = list.length - active.length
  const monthly = monthlyTotal(list)
  return [
    { parts: [{ text: `${active.length} active · `, cls: "label" }, { text: formatWholeMoney(monthly), cls: "figure" }, { text: " a month · ", cls: "label" }, { text: formatWholeMoney(monthly * 12), cls: "figure" }, { text: " a year", cls: "label" }] },
    ...(dueBeforePayday > 0 ? [{ parts: [{ text: formatWholeMoney(dueBeforePayday), cls: "figure" }, { text: " due before payday", cls: "label" }] }] : []),
    ...(changed ? [{ parts: [{ text: count(changed, "price change"), cls: "caution" }] }] : []),
    ...(stopped ? [{ parts: [{ text: `${stopped} stopped`, cls: "note" }] }] : []),
  ]
}
