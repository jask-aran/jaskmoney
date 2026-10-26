import { For, Show, createMemo } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { SectionCard } from "../primitives/SectionCard"
import { S } from "../primitives/S"
import { ui, type SectionId } from "../../state/uiStore"
import { data } from "../../state/dataStore"
import { theme } from "../../theme"
import { barFill, computeCategorySpend, dailySpendSeries, formatMoney, formatPct } from "../../domain/dashboard"
import { computePeriodFlows, computePosition } from "../../domain/position"
import {
  LOOKBACKS,
  PERIODS,
  PERIOD_LABEL,
  activeChipIndex,
  dataClock,
  filterByTimeframe,
  timeframeBounds,
} from "../../domain/timeframe"
import { fit } from "../text"
import { barChart, levelChart } from "./charts"

/**
 * Dashboard: "now" (balances, pending, runway; ignores the timeframe) above
 * the period (flows, spending tracker, categories) chosen in Date Range, then
 * net position over the last 90 days.
 */
export function DashboardTab(props: { focused: SectionId }) {
  const dims = useTerminalDimensions()
  const clock = createMemo(() => dataClock(data.state.transactions))
  const bounds = createMemo(() => timeframeBounds(ui.state.timeframe, clock()))
  const inPeriod = createMemo(() => filterByTimeframe(data.state.transactions, ui.state.timeframe, clock()))
  // Spending detail covers every spending account; the Manager's account
  // selection does not apply here.
  const scoped = createMemo(() => filterByTimeframe(data.spendingTransactions(), ui.state.timeframe, clock()))
  const flows = createMemo(() => computePeriodFlows(data.state.accounts, inPeriod()))
  const position = createMemo(() => computePosition(data.state.accounts, data.state.transactions, localTodayISO()))
  const cats = createMemo(() => computeCategorySpend(scoped(), data.state.categories).slice(0, 12))
  const series = createMemo(() => dailySpendSeries(scoped(), bounds().start, bounds().end))
  const saversPeriodChange = () => flows().saverChanges.reduce((sum, c) => sum + c.change, 0)
  const saverChange = (accountId: number) => flows().saverChanges.find((c) => c.accountId === accountId)?.change ?? 0

  // Go narrow fallback: the preset chips keep priority and the timeframe
  // label is shown only when both fit on the card's single content line.
  const presetsWidth =
    "Presets ".length +
    LOOKBACKS.reduce((n, lb) => n + lb.length + 3, 0) +
    " | ".length +
    PERIODS.reduce((n, p) => n + PERIOD_LABEL[p].length + 3, 0)
  const showTimeframe = () =>
    dims().width - 4 >= presetsWidth + 2 + `Timeframe ${bounds().label}`.length

  const dateFocused = () => props.focused === "dash.date"
  const chipCursor = () =>
    dateFocused() ? ui.state.dashChipCursor : activeChipIndex(ui.state.timeframe)

  // Fixed rows: tab bar + gap (2), status + footer (2), Now (7), Date Range (4),
  // Net position (8, dropped on short terminals). The middle row takes the rest.
  const showNetChart = () => dims().height >= 36
  const middleHeight = () => Math.max(5, dims().height - 15 - (showNetChart() ? 8 : 0))
  // Left column is 60% of the width; the card spends 4 cells on border + padding.
  const leftInner = () => Math.floor((dims().width - 1) * 0.6) - 4
  // Right column: what the 60% column and the 1-cell gap leave, minus the
  // card's border + padding (4) and one cell of rounding slack.
  const rightInner = () => dims().width - 1 - Math.floor((dims().width - 1) * 0.6) - 5
  const AXIS = 9
  const trackerRows = () => Math.max(1, middleHeight() - 4)
  const tracker = createMemo(() => barChart(series().values, Math.max(1, leftInner() - AXIS), trackerRows()))
  const trackerMax = createMemo(() => {
    const width = Math.max(1, leftInner() - AXIS)
    const v = series().values
    if (v.length <= width) return Math.max(0, ...v)
    // Bars are bucket averages; label the tallest bucket, not the tallest day.
    const per = v.length / width
    let max = 0
    for (let c = 0; c < width; c++) {
      const slice = v.slice(Math.floor(c * per), Math.floor((c + 1) * per))
      if (slice.length) max = Math.max(max, slice.reduce((a, b) => a + b, 0) / slice.length)
    }
    return max
  })
  const netChart = createMemo(() =>
    levelChart(position().history.map((h) => h.value), Math.max(1, dims().width - 4 - AXIS), 5),
  )
  // name (15) + "  NN%" (5) + " $12,345.67" (13) beside the bar.
  const catBarWidth = () => Math.max(4, rightInner() - 15 - 5 - 13)

  return (
    <box width="100%" height="100%" flexDirection="column" gap={0} backgroundColor={theme.canvas}>
      <box flexDirection="row" gap={1} width="100%" height={7}>
        <SectionCard title="Now" width="60%" height={7}>
          {/* Label | value | note columns, so every row lines up. */}
          <text wrapMode="none">
            <S fg={theme.subtext0}>{"Net position".padEnd(LABEL)}</S>
            <S fg={theme.text} bold>{money(position().netPosition).padEnd(VALUE)}</S>
          </text>
          <text wrapMode="none">
            <S fg={theme.subtext0}>{"Available".padEnd(LABEL)}</S>
            <S fg={theme.text}>{money(position().spendingBalance).padEnd(VALUE)}</S>
            <Show when={position().pendingCount > 0}>
              <S fg={theme.overlay1}>{`${formatMoney(Math.abs(position().pendingAmount))} pending, ${position().pendingCount} txn`}</S>
            </Show>
          </text>
          <text wrapMode="none">
            <S fg={theme.subtext0}>{"Runway".padEnd(LABEL)}</S>
            <S fg={theme.peach}>{(position().runwayDays != null ? `${Math.round(position().runwayDays!)} days` : "—").padEnd(VALUE)}</S>
            <Show when={position().dailySpend != null}>
              <S fg={theme.overlay1}>{`${formatMoney(position().dailySpend!)}/day, 90 day avg`}</S>
            </Show>
          </text>
          <text wrapMode="none">
            <S fg={theme.subtext0}>{"30-day change".padEnd(LABEL)}</S>
            <S fg={change30() >= 0 ? theme.success : theme.error}>{signedMoney(change30()).padEnd(VALUE)}</S>
          </text>
        </SectionCard>
        <box flexGrow={1} flexBasis={0} minWidth={0} height={7} overflow="hidden">
        <SectionCard title="Savers" height={7}>
          <Show when={position().savers.length} fallback={<text fg={theme.overlay1}>No savers synced</text>}>
            <For each={position().savers.slice(0, 4)}>
              {(saver) => (
                <text wrapMode="none">
                  <S fg={theme.text}>{fit(saver.name, 14)}</S>
                  <S fg={theme.subtext1}>{formatMoney(saver.balance).padStart(12)}</S>
                  <S fg={changeColor(saverChange(saver.accountId))}>{`  ${changeText(saverChange(saver.accountId))}`}</S>
                </text>
              )}
            </For>
            <text wrapMode="none">
              <S fg={theme.subtext0}>{fit("Total", 14)}</S>
              <S fg={theme.text} bold>{formatMoney(position().saversTotal).padStart(12)}</S>
              <S fg={changeColor(saversPeriodChange())}>{`  ${changeText(saversPeriodChange())}`}</S>
            </text>
          </Show>
        </SectionCard>
        </box>
      </box>

      <SectionCard title="Date Range" focused={dateFocused()} height={4}>
        <box flexDirection="row" justifyContent="space-between" width="100%">
          <text fg={theme.subtext0} wrapMode="none">
            Presets{" "}
            <For each={LOOKBACKS}>
              {(lb, i) => {
                const idx = () => i()
                const active = () =>
                  ui.state.timeframe.family === "lookback" &&
                  ui.state.timeframe.lookback === lb
                const cur = () => chipCursor() === idx()
                return (
                  <S
                    fg={active() ? theme.accent : theme.overlay1}
                    bg={cur() && dateFocused() ? theme.surface0 : undefined}
                    bold={active()}
                  >
                    {cur() && dateFocused() ? ">" : " "}[{lb}]
                  </S>
                )
              }}
            </For>
            <S fg={theme.overlay1}> | </S>
            <For each={PERIODS}>
              {(p, i) => {
                const idx = () => LOOKBACKS.length + i()
                const active = () =>
                  ui.state.timeframe.family === "period" && ui.state.timeframe.period === p
                const cur = () => chipCursor() === idx()
                return (
                  <S
                    fg={active() ? theme.accent : theme.overlay1}
                    bg={cur() && dateFocused() ? theme.surface0 : undefined}
                    bold={active()}
                  >
                    {cur() && dateFocused() ? ">" : " "}[{PERIOD_LABEL[p]}]
                  </S>
                )
              }}
            </For>
          </text>
          <Show when={showTimeframe()}>
            <text fg={theme.subtext0} flexShrink={0}>
              Timeframe <S fg={theme.peach}>{bounds().label}</S>
            </text>
          </Show>
        </box>
        <text wrapMode="none">
          <S fg={theme.subtext0}>{"Spent "}</S>
          <S fg={theme.error}>{formatMoney(flows().spent)}</S>
          <S fg={theme.subtext0}>{"   Income "}</S>
          <S fg={theme.success}>{formatMoney(flows().income)}</S>
          <S fg={theme.subtext0}>{"   Net "}</S>
          <S fg={flows().net >= 0 ? theme.success : theme.error}>{signedMoney(flows().net)}</S>
          <S fg={theme.subtext0}>{"   Saved to savers "}</S>
          <S fg={flows().savedToSavers >= 0 ? theme.peach : theme.error}>{signedMoney(flows().savedToSavers)}</S>
          <S fg={theme.subtext0}>{"   Savings rate "}</S>
          <S fg={theme.peach}>{formatPct(flows().savingsRate)}</S>
          <S fg={theme.overlay1}>{`   ${flows().txnCount} transactions`}</S>
        </text>
      </SectionCard>

      <box flexDirection="row" gap={1} width="100%" height={middleHeight()}>
        <SectionCard title="Spending Tracker" width="60%" height={middleHeight()}>
          <For each={tracker()}>
            {(row, i) => (
              <text wrapMode="none">
                <S fg={theme.overlay1}>{(i() === 0 ? shortMoney(trackerMax()) : i() === tracker().length - 1 ? "$0" : "").padStart(AXIS - 2) + " ┤"}</S>
                <S fg={theme.peach}>{row}</S>
              </text>
            )}
          </For>
          <text wrapMode="none" fg={theme.overlay1}>
            {" ".repeat(AXIS) + spreadLabels(shortDate(bounds().start), shortDate(bounds().end), Math.max(1, leftInner() - AXIS))}
          </text>
          <text wrapMode="none">
            <S fg={theme.overlay1}>{`max ${formatMoney(Math.max(0, ...series().values))}/day · `}</S>
            <S fg={theme.overlay1}>{`avg ${formatMoney(series().values.length ? flows().spent / series().values.length : 0)}/day`}</S>
          </text>
        </SectionCard>
        <box flexGrow={1} flexBasis={0} minWidth={0} height={middleHeight()} overflow="hidden">
        <SectionCard title="Spending by Category" height={middleHeight()} focused={props.focused === "dash.composition"}>
          {cats().length === 0 ? (
            <text fg={theme.overlay1}>No spending in range</text>
          ) : (
            <For each={cats().slice(0, Math.max(1, middleHeight() - 2))}>
              {(c) => (
                <text wrapMode="none">
                  <S fg={c.color}>{fit(c.name, 15)}</S>
                  <S fg={c.color}>{barFill(c.pct, catBarWidth())}</S>
                  <S fg={theme.subtext0}>{`${Math.round(c.pct).toString().padStart(4)}% ${formatMoney(c.amount).padStart(12)}`}</S>
                </text>
              )}
            </For>
          )}
        </SectionCard>
        </box>
      </box>

      <Show when={showNetChart()}>
        <SectionCard title="Net Position · 90 days" focused={props.focused === "dash.cashflow"} height={8}>
          <For each={netChart().rows}>
            {(row, i) => (
              <text wrapMode="none">
                <S fg={theme.overlay1}>{(i() === 0 ? shortMoney(netChart().max) : i() === netChart().rows.length - 1 ? shortMoney(netChart().min) : "").padStart(AXIS - 2) + " ┤"}</S>
                <S fg={theme.lavender}>{row}</S>
              </text>
            )}
          </For>
          <text wrapMode="none" fg={theme.overlay1}>
            {" ".repeat(AXIS) + spreadLabels(shortDate(position().history[0]?.dateISO ?? ""), "today", Math.max(1, dims().width - 4 - AXIS))}
          </text>
        </SectionCard>
      </Show>
    </box>
  )

  function change30(): number {
    const h = position().history
    if (h.length < 31) return 0
    return h[h.length - 1]!.value - h[h.length - 31]!.value
  }
}

const LABEL = 15
const VALUE = 14

function money(n: number | null): string {
  return n == null ? "—" : formatMoney(n)
}

function signedMoney(n: number): string {
  return n > 0 ? `+${formatMoney(n)}` : formatMoney(n)
}

function changeText(n: number): string {
  return Math.abs(n) < 0.005 ? "—" : signedMoney(n)
}

function changeColor(n: number): string {
  return Math.abs(n) < 0.005 ? theme.overlay1 : n > 0 ? theme.success : theme.error
}

/** Compact axis label: $950, $4.5k, $12k. */
function shortMoney(n: number): string {
  const a = Math.abs(n)
  const sign = n < 0 ? "-" : ""
  if (a >= 10000) return `${sign}$${Math.round(a / 1000)}k`
  if (a >= 1000) return `${sign}$${(a / 1000).toFixed(1)}k`
  return `${sign}$${Math.round(a)}`
}

/** "2026-08-26" → "26 Aug". */
function shortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number)
  if (!y || !m || !d) return iso
  return `${d} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]}`
}

/** Left label at the start, right label flush with the end of `width`. */
function spreadLabels(left: string, right: string, width: number): string {
  return left + " ".repeat(Math.max(1, width - left.length - right.length)) + right
}

/** Today's date in the local timezone, for point-in-time figures. */
function localTodayISO(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
}
