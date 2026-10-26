import { For, Show, createEffect, createMemo } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { SectionCard } from "../primitives/SectionCard"
import { S } from "../primitives/S"
import { ui, type SectionId } from "../../state/uiStore"
import { data } from "../../state/dataStore"
import { theme } from "../../theme"
import { computeCategorySpend, formatWholeMoney, groupCategorySpend } from "../../domain/dashboard"
import { computePeriodFlows } from "../../domain/position"
import { merchantSummaries, spendingCalendar, type CalendarDay } from "../../domain/spending"
import { dataClock, filterByTimeframe, timeframeBounds, toISODate } from "../../domain/timeframe"
import { fit, shortDate } from "../text"
import { budgetProgress, cycleFor } from "../../domain/budget"
import { budgetLabel } from "../../domain/budgetScopes"

/** Calendar cell colours by spending level (0 = none). */
const LEVEL_BG = [theme.surface0, "#5b4636", "#8c6146", "#c47f55", theme.peach] as const
const WEEKDAYS = ["Mon", "", "Wed", "", "Fri", "", "Sun"]

/**
 * Spending analysis for the Date Range period (shared with the Dashboard):
 * totals against the previous period, categories by group, a calendar of daily
 * spending, and merchants. Spending accounts only; internal transfers excluded.
 */
export function SpendingTab(props: { focused: SectionId }) {
  const dims = useTerminalDimensions()
  const clock = createMemo(() => dataClock(data.state.transactions))
  const bounds = createMemo(() => timeframeBounds(ui.state.timeframe, clock()))
  const previous = createMemo(() => previousWindow(bounds().start, bounds().end))
  const spending = createMemo(() => data.spendingTransactions())
  const inPeriod = createMemo(() => filterByTimeframe(spending(), ui.state.timeframe, clock()))
  const inPrevious = createMemo(() => spending().filter((t) => t.dateISO >= previous().start && t.dateISO <= previous().end))
  const flows = createMemo(() => computePeriodFlows(data.state.accounts, inPeriod()))
  const previousFlows = createMemo(() => computePeriodFlows(data.state.accounts, inPrevious()))
  const days = createMemo(() => dayCount(bounds().start, bounds().end))
  const groups = createMemo(() => groupCategorySpend(computeCategorySpend(inPeriod(), data.state.categories), data.state.categories))
  const merchants = createMemo(() => merchantSummaries(spending(), bounds().start, bounds().end))
  const calendar = createMemo(() => spendingCalendar(inPeriod(), bounds().start, bounds().end))
  // Budgets always show the current cycle, whatever the Date Range.
  const today = toISODate(new Date())
  const cycle = createMemo(() => data.state.budgets.length ? cycleFor(data.state.budgetCycle, today) : null)
  const budgets = createMemo(() => data.state.budgets.length
    ? budgetProgress(data.state.budgets, data.state.budgetCycle, today, data.state.accounts, data.state.categories, data.state.transactions)
    : [])
  const budgetHeight = () => (budgets().length ? budgets().length + 2 : 0)

  // Fixed rows: tab bar + gap (2), status + footer (2), summary card (3).
  const bodyHeight = () => Math.max(8, dims().height - 7)
  const leftWidth = () => Math.floor((dims().width - 1) * 0.42)
  // Right column inner width: border + padding (4) and a cell of rounding slack.
  const rightInner = () => dims().width - 1 - leftWidth() - 5
  // Calendar: label column (4) then one column per week, 2–6 cells wide;
  // long periods show the latest weeks that fit at the minimum width.
  const calendarWeeks = createMemo(() => calendar().slice(-Math.max(1, Math.floor((rightInner() - 4) / 2))))
  const cellWidth = () => Math.max(2, Math.min(6, Math.floor((rightInner() - 4) / Math.max(1, calendarWeeks().length))))
  const merchantRows = () => Math.max(1, bodyHeight() - 11 - budgetHeight() - 3)
  createEffect(() => {
    const n = merchantRows()
    const cur = ui.state.merchantCursor
    if (cur >= merchants().length && merchants().length) ui.setState({ merchantCursor: merchants().length - 1 })
    if (cur < ui.state.merchantTop) ui.setState({ merchantTop: cur })
    else if (cur >= ui.state.merchantTop + n) ui.setState({ merchantTop: cur - n + 1 })
  })
  // Total (9), count (4), average (9), change (8), last seen (7).
  const merchantNameWidth = () => Math.max(10, rightInner() - 9 - 4 - 9 - 8 - 7)

  return (
    <box width="100%" height="100%" flexDirection="column" backgroundColor={theme.canvas}>
      <SectionCard title="Spending" titleSuffix={`· ${bounds().label}`} titleSuffixColor={theme.peach} height={3}>
        <text wrapMode="none">
          <S fg={theme.subtext0}>{"Spent "}</S>
          <S fg={theme.text} bold>{formatWholeMoney(flows().spent)}</S>
          <S fg={changeColor(flows().spent, previousFlows().spent)}>{`  ${changePct(flows().spent, previousFlows().spent)}`}</S>
          <S fg={theme.overlay1}>{` vs ${formatWholeMoney(previousFlows().spent)} previous`}</S>
          <S fg={theme.subtext0}>{"     Daily avg "}</S>
          <S fg={theme.text}>{formatWholeMoney(days() ? flows().spent / days() : 0)}</S>
          <S fg={theme.subtext0}>{"     Transactions "}</S>
          <S fg={theme.text}>{String(flows().txnCount)}</S>
          <S fg={theme.subtext0}>{"     Merchants "}</S>
          <S fg={theme.text}>{String(merchants().length)}</S>
        </text>
      </SectionCard>
      <box flexDirection="row" gap={1} width="100%" height={bodyHeight()}>
        <SectionCard title="Categories" width={leftWidth()} height={bodyHeight()} focused={props.focused === "spend.categories"}>
          <Show when={groups().length} fallback={<text fg={theme.overlay1}>No spending in this period</text>}>
            <For each={groups()}>
              {(group) => (
                <>
                  <text wrapMode="none">
                    <S fg={group.color} bold>{fit(group.name, leftWidth() - 4 - 14)}</S>
                    <S fg={theme.text} bold>{formatWholeMoney(group.amount).padStart(9)}</S>
                    <S fg={theme.overlay1}>{`${Math.round(group.pct)}%`.padStart(5)}</S>
                  </text>
                  <For each={group.children}>
                    {(child) => (
                      <text wrapMode="none">
                        <S fg={theme.subtext0}>{fit(`  ${child.name}`, leftWidth() - 4 - 14)}</S>
                        <S fg={theme.subtext0}>{formatWholeMoney(child.amount).padStart(9)}</S>
                      </text>
                    )}
                  </For>
                </>
              )}
            </For>
          </Show>
        </SectionCard>
        <box flexGrow={1} flexBasis={0} minWidth={0} height={bodyHeight()} flexDirection="column" overflow="hidden">
          <Show when={budgets().length}>
            <SectionCard title="Budget" titleSuffix={cycle() ? `· ${shortDate(cycle()!.start)} – ${shortDate(cycle()!.end)}` : undefined} titleSuffixColor={theme.peach} height={budgetHeight()}>
              <For each={budgets()}>
                {(p) => {
                  const over = () => p.remaining < 0
                  const pctColor = () => (p.usedPct > 100 ? theme.error : p.usedPct >= 80 ? theme.warning : theme.success)
                  return (
                    <text wrapMode="none">
                      <S fg={theme.text}>{fit(budgetLabel(p.budget, data.state.accounts, data.state.categories), Math.max(10, rightInner() - 44))}</S>
                      <S fg={theme.text}>{formatWholeMoney(p.spent).padStart(8)}</S>
                      <S fg={theme.overlay1}>{` of ${formatWholeMoney(p.budget.amount)}`.padEnd(10)}</S>
                      <S fg={pctColor()} bold>{(Number.isFinite(p.usedPct) ? `${Math.round(p.usedPct)}%` : "—").padStart(5)}</S>
                      <S fg={over() ? theme.error : theme.subtext0}>
                        {over() ? `  ${formatWholeMoney(-p.remaining)} over` : `  ${formatWholeMoney(p.dailyAllowance)}/day, ${p.daysLeft}d`}
                      </S>
                      <Show when={!over() && p.projected > p.budget.amount}>
                        <S fg={theme.warning}>{"  ▲ pace"}</S>
                      </Show>
                    </text>
                  )
                }}
              </For>
            </SectionCard>
          </Show>
          <SectionCard title="Calendar" height={11}>
            <text wrapMode="none" fg={theme.overlay1}>{"    " + monthLabels(calendarWeeks(), cellWidth())}</text>
            <For each={WEEKDAYS}>
              {(label, row) => (
                <text wrapMode="none">
                  <S fg={theme.overlay1}>{label.padEnd(4)}</S>
                  <For each={calendarWeeks()}>
                    {(week) => <Cell day={week[row()] ?? null} width={cellWidth()} today={today} />}
                  </For>
                </text>
              )}
            </For>
            <text wrapMode="none">
              <S fg={theme.overlay1}>{"    less "}</S>
              <For each={[0, 1, 2, 3, 4]}>{(level) => <S bg={LEVEL_BG[level]}>{"  "}</S>}</For>
              <S fg={theme.overlay1}>{" more"}</S>
            </text>
          </SectionCard>
          <SectionCard title="Merchants" focused={props.focused === "spend.merchants"} active={props.focused === "spend.merchants"} flexGrow={1}>
            <text wrapMode="none" fg={theme.overlay1}>
              {fit("Merchant", merchantNameWidth()) + "Total".padStart(9) + "#".padStart(4) + "Avg".padStart(9) + "vs prev".padStart(8) + "Last".padStart(7)}
            </text>
            <Show when={merchants().length} fallback={<text fg={theme.overlay1}>No spending in this period</text>}>
              <For each={merchants().slice(ui.state.merchantTop, ui.state.merchantTop + merchantRows())}>
                {(m, i) => {
                  const selected = () => props.focused === "spend.merchants" && ui.state.merchantTop + i() === ui.state.merchantCursor
                  const bg = () => (selected() ? theme.surface0 : theme.canvas)
                  return (
                    <text wrapMode="none" bg={bg()}>
                      <S fg={theme.text} bg={bg()} bold={selected()}>{fit(m.merchant, merchantNameWidth())}</S>
                      <S fg={theme.text} bg={bg()}>{formatWholeMoney(m.total).padStart(9)}</S>
                      <S fg={theme.subtext0} bg={bg()}>{String(m.count).padStart(4)}</S>
                      <S fg={theme.subtext0} bg={bg()}>{formatWholeMoney(m.average).padStart(9)}</S>
                      <S fg={changeColor(m.total, m.previousTotal)} bg={bg()}>{changePct(m.total, m.previousTotal).padStart(8)}</S>
                      <S fg={theme.overlay1} bg={bg()}>{shortDate(m.lastISO).padStart(7)}</S>
                    </text>
                  )
                }}
              </For>
            </Show>
          </SectionCard>
        </box>
      </box>
    </box>
  )
}

/** One day; a gap column keeps wide cells apart. Days after today are blank. */
function Cell(props: { day: CalendarDay | null; width: number; today: string }) {
  const filled = () => props.day != null && props.day.dateISO <= props.today
  return (
    <>
      <S bg={filled() ? LEVEL_BG[props.day!.level] : theme.canvas}>{" ".repeat(props.width > 2 ? props.width - 1 : props.width)}</S>
      {props.width > 2 ? <S bg={theme.canvas}>{" "}</S> : null}
    </>
  )
}

/** Three-letter month names over the week where each month starts; a name
 * may run over the following columns and is skipped if it would touch the
 * previous one. */
function monthLabels(weeks: Array<Array<CalendarDay | null>>, width: number): string {
  const out = new Array<string>(weeks.length * width).fill(" ")
  let last = ""
  let free = 0
  weeks.forEach((week, i) => {
    const month = (week.find((d) => d)?.dateISO ?? "").slice(5, 7)
    if (month && month !== last) {
      const pos = i * width
      if (pos >= free) {
        const name = MONTHS[Number(month) - 1]!
        for (let k = 0; k < name.length && pos + k < out.length; k++) out[pos + k] = name[k]!
        free = pos + name.length + 1
      }
    }
    last = month || last
  })
  return out.join("")
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** "+12%", "-8%", "new" (nothing before), "—" (nothing now or before). */
function changePct(now: number, before: number): string {
  if (before <= 0) return now > 0 ? "new" : "—"
  const pct = Math.round(((now - before) / before) * 100)
  return `${pct > 0 ? "+" : ""}${pct}%`
}

/** More spending than before is red, less is green. */
function changeColor(now: number, before: number): string {
  if (before <= 0 || Math.abs(now - before) < 0.005) return theme.overlay1
  return now > before ? theme.error : theme.success
}

function dayCount(startISO: string, endISO: string): number {
  return Math.round((Date.parse(endISO + "T12:00:00Z") - Date.parse(startISO + "T12:00:00Z")) / 86400000) + 1
}

/** The window of equal length ending the day before `startISO`. */
function previousWindow(startISO: string, endISO: string): { start: string; end: string } {
  const start = Date.parse(startISO + "T12:00:00Z")
  const days = dayCount(startISO, endISO)
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10)
  return { start: iso(start - days * 86400000), end: iso(start - 86400000) }
}
