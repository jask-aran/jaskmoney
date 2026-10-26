import { For, Show, createMemo } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { SectionCard } from "../primitives/SectionCard"
import { S } from "../primitives/S"
import { BALANCE_VIEWS, TRACKER_VIEWS, ui, type SectionId } from "../../state/uiStore"
import { data } from "../../state/dataStore"
import { theme } from "../../theme"
import { computeCategorySpend, cumulative, dailySpendSeries, weeklyTotals, formatMoney, formatPct, formatWholeMoney, groupCategorySpend } from "../../domain/dashboard"
import { balanceHistory, computePeriodFlows, computePosition } from "../../domain/position"
import { budgetProgress, type BudgetProgress } from "../../domain/budget"
import type { Account, Transaction } from "../../domain/types"
import {
  LOOKBACKS,
  PERIODS,
  PERIOD_LABEL,
  activeChipIndex,
  dataClock,
  filterByTimeframe,
  timeframeBounds,
  toISODate,
} from "../../domain/timeframe"
import { fit, shortDate, shortMoney } from "../text"
import { columnBars } from "./charts"
import { AXIS, ChartBody, type ChartModel } from "./ChartBody"
import { dateAxis, lineChart, niceRange, niceScale, tickRows } from "./lineChart"

/**
 * Dashboard: "now" (balances, pending, runway; ignores the timeframe) above
 * the period chosen in Date Range: flows, the spending tracker and balances
 * charts (each with views), and spending by category.
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
  const position = createMemo(() => computePosition(data.state.accounts, data.state.transactions, toISODate(new Date())))
  const groups = createMemo(() => groupCategorySpend(computeCategorySpend(scoped(), data.state.categories), data.state.categories))
  const series = createMemo(() => dailySpendSeries(scoped(), bounds().start, bounds().end))
  // The overall budget for the current cycle, when one is set.
  const overallBudget = createMemo(() => {
    const budget = data.state.budgets.find((b) => b.scope.kind === "overall")
    if (!budget) return null
    return budgetProgress([budget], data.state.budgetCycle, toISODate(new Date()), data.state.accounts, data.state.categories, data.state.transactions)[0] ?? null
  })
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

  // Fixed rows: tab bar + gap (2), status + footer (2), Now (7), Date Range (4).
  // The chart row takes the rest: the tracker above Balances on the left
  // (Balances dropped on short terminals), categories on the right.
  const middleHeight = () => Math.max(5, dims().height - 15)
  const showBalances = () => middleHeight() >= 20
  const trackerHeight = () => (showBalances() ? Math.ceil(middleHeight() / 2) : middleHeight())
  const balancesHeight = () => middleHeight() - trackerHeight()
  // Left column is 60% of the width; the card spends 4 cells on border + padding.
  const leftInner = () => Math.floor((dims().width - 1) * 0.6) - 4
  // Right column: what the 60% column and the 1-cell gap leave, minus the
  // card's border + padding (4) and one cell of rounding slack.
  const rightInner = () => dims().width - 1 - Math.floor((dims().width - 1) * 0.6) - 5
  const plotWidth = () => Math.max(1, leftInner() - AXIS)
  const trackerView = () => TRACKER_VIEWS[ui.state.trackerView] ?? TRACKER_VIEWS[0]
  const balanceView = () => BALANCE_VIEWS[ui.state.balanceView] ?? BALANCE_VIEWS[0]
  // Card rows less border (2), x labels and summary.
  const trackerModel = createMemo(() => spendingChart(trackerView(), series(), plotWidth(), Math.max(1, trackerHeight() - 4), toISODate(new Date()), data.spendingTransactions()))
  const balancesModel = createMemo(() => balancesChart(balanceView(), series().dates, plotWidth(), Math.max(1, balancesHeight() - 4), toISODate(new Date()), data.state.accounts, data.state.transactions))
  // Every group gets a line; the remaining lines go to the largest
  // subcategories overall, shown under their group.
  const categoryLines = createMemo(() => {
    const budget = Math.max(1, middleHeight() - 2)
    const shownGroups = groups().slice(0, budget)
    const spare = budget - shownGroups.length
    const children = shownGroups.flatMap((g) => g.children).sort((a, b) => b.amount - a.amount).slice(0, Math.max(0, spare))
    const keep = new Set(children)
    return shownGroups.flatMap((g) => [
      { label: g.name, color: g.color, amount: g.amount, pct: g.pct as number | null, child: false },
      ...g.children.filter((c) => keep.has(c)).map((c) => ({ label: c.name, color: g.color, amount: c.amount, pct: null, child: true })),
    ])
  })
  // Category lines: name, then amount (9) and share (5) right-aligned.
  const catNameWidth = () => Math.max(8, rightInner() - 14)

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
          <Show when={overallBudget()}>
            {(p: () => BudgetProgress) => (
              <text wrapMode="none">
                <S fg={theme.subtext0}>{"Budget".padEnd(LABEL)}</S>
                <S fg={p().remaining < 0 ? theme.error : theme.text}>{(p().remaining < 0 ? `${formatWholeMoney(-p().remaining)} over` : `${formatWholeMoney(p().remaining)} left`).padEnd(VALUE)}</S>
                <S fg={theme.overlay1}>{p().remaining < 0 ? `${p().daysLeft} days to go` : `${formatWholeMoney(p().dailyAllowance)}/day, ${p().daysLeft} days`}</S>
              </text>
            )}
          </Show>
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
        <box flexDirection="column" width="60%" height={middleHeight()}>
          <SectionCard title="Spending Tracker" titleSuffix={`· ${trackerView()}`} titleSuffixColor={theme.subtext0} height={trackerHeight()} focused={props.focused === "dash.tracker"}>
            <ChartBody model={trackerModel()} inks={INKS} />
          </SectionCard>
          <Show when={showBalances()}>
            <SectionCard title="Balances" titleSuffix={`· ${balanceView()}`} titleSuffixColor={theme.subtext0} height={balancesHeight()} focused={props.focused === "dash.cashflow"}>
              <ChartBody model={balancesModel()} inks={INKS} />
            </SectionCard>
          </Show>
        </box>
        <box flexGrow={1} flexBasis={0} minWidth={0} height={middleHeight()} overflow="hidden">
        <SectionCard title="Spending by Category" height={middleHeight()} focused={props.focused === "dash.composition"}>
          {groups().length === 0 ? (
            <text fg={theme.overlay1}>No spending in range</text>
          ) : (
            <For each={categoryLines()}>
              {(line) => (
                <text wrapMode="none">
                  <S fg={line.child ? theme.subtext0 : line.color} bold={!line.child}>{fit(line.child ? `  ${line.label}` : line.label, catNameWidth())}</S>
                  <S fg={line.child ? theme.subtext0 : theme.text} bold={!line.child}>{formatWholeMoney(line.amount).padStart(9)}</S>
                  <S fg={theme.overlay1}>{(line.pct != null ? `${Math.round(line.pct)}%` : "").padStart(5)}</S>
                </text>
              )}
            </For>
          )}
        </SectionCard>
        </box>
      </box>
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

const INKS: Record<string, string> = {
  spend: theme.peach,
  partial: theme.overlay1,
  prev: theme.overlay0,
  ref: theme.surface2,
  balance: theme.lavender,
  savers: theme.green,
  month: theme.surface2,
  week: theme.surface0,
  today: theme.green,
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0)

/** "2026-10-05" shifted by `days`. */
function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso + "T12:00:00Z") + days * 86400000).toISOString().slice(0, 10)
}

/**
 * The Spending Tracker in one of its views, over the period's `dates`:
 * - Daily: spend per day, with the period's daily average so far.
 * - Cumulative: running total against the previous period of equal length.
 * - Weekly: totals per Monday-start week; partial weeks in grey.
 * Days after today are not drawn.
 */
function spendingChart(
  view: (typeof TRACKER_VIEWS)[number],
  series: { dates: string[]; values: number[] },
  width: number,
  height: number,
  todayISO: string,
  spendingRows: Transaction[],
): ChartModel {
  const { dates, values } = series
  const n = dates.length
  const elapsed = dates.filter((d) => d <= todayISO).length
  const upToToday = (vs: number[]) => vs.map((v, i) => (i < elapsed ? v : null))
  const axis = dateAxis(dates, width, todayISO)
  const muted = (text: string) => ({ text, fg: theme.overlay1 })
  if (n === 0) return { rows: [], ticks: new Map(), labels: "", summary: [muted("No days in range")] }

  if (view === "Weekly") {
    const weeks = weeklyTotals(dates, values)
    const scale = niceScale(Math.max(0, ...weeks.map((w) => w.total)))
    const bars = weeks.map((w) => ({ value: w.startISO <= todayISO ? w.total : 0, ink: w.days < 7 || addDays(w.startISO, 6) >= todayISO ? "partial" : "spend" }))
    const { rows, slots } = columnBars(bars, width, height, scale.max)
    const line = new Array<string>(width).fill(" ")
    slots.forEach((slot, i) => {
      const iso = weeks[i]!.startISO
      const label = slot.width >= 6 ? shortDate(iso) : String(Number(iso.slice(8, 10)))
      if (label.length <= slot.width + (slot.width > 2 ? 1 : 0)) {
        for (let c = 0; c < label.length && slot.col + c < width; c++) line[slot.col + c] = label[c]!
      }
    })
    const full = weeks.filter((w, i) => bars[i]!.ink === "spend")
    const current = weeks.find((w) => w.startISO <= todayISO && addDays(w.startISO, 6) >= todayISO)
    return {
      rows,
      ticks: tickRows(0, scale.max, scale.step, height, shortMoney),
      labels: line.join(""),
      summary: [
        muted(full.length ? `avg ${formatWholeMoney(sum(full.map((w) => w.total)) / full.length)}/week` : "no full weeks yet"),
        ...(current ? [muted(` · this week ${formatWholeMoney(current.total)} so far`)] : []),
      ],
    }
  }

  if (view === "Cumulative") {
    const total = cumulative(values)
    const prevStart = addDays(dates[0]!, -n)
    const prev = cumulative(dailySpendSeries(spendingRows, prevStart, addDays(dates[0]!, -1)).values)
    const now = elapsed > 0 ? total[elapsed - 1]! : 0
    const then = elapsed > 0 ? prev[elapsed - 1] ?? 0 : 0
    const scale = niceScale(Math.max(now, ...prev))
    const diff = then > 0 ? Math.round(((now - then) / then) * 100) : null
    return {
      rows: lineChart({ series: [{ values: prev, ink: "prev" }, { values: upToToday(total), ink: "spend" }], length: n, width, height, min: 0, max: scale.max, markers: axis.markers }),
      ticks: tickRows(0, scale.max, scale.step, height, shortMoney),
      labels: axis.labels,
      summary: [
        { text: `${formatWholeMoney(now)} spent`, fg: theme.peach },
        muted(` vs ${formatWholeMoney(then)} ${elapsed < n ? "at this point last period" : "previous period"}`),
        ...(diff != null ? [{ text: ` (${diff > 0 ? "+" : ""}${diff}%)`, fg: diff > 0 ? theme.error : theme.success }] : []),
      ],
    }
  }

  const shown = values.slice(0, elapsed)
  const avg = elapsed ? sum(shown) / elapsed : 0
  const peak = shown.reduce((best, v, i) => (v > shown[best]! ? i : best), 0)
  const scale = niceScale(Math.max(0, ...shown))
  return {
    rows: lineChart({
      series: [{ values: upToToday(values.map(() => avg)), ink: "ref" }, { values: upToToday(values), ink: "spend" }],
      length: n, width, height, min: 0, max: scale.max, markers: axis.markers,
    }),
    ticks: tickRows(0, scale.max, scale.step, height, shortMoney),
    labels: axis.labels,
    summary: [
      muted(`avg ${formatWholeMoney(avg)}/day`),
      ...(shown[peak] ? [muted(` · peak ${formatWholeMoney(shown[peak]!)} on ${shortDate(dates[peak]!)}`)] : []),
    ],
  }
}

/** End-of-day balances over the period's `dates` (up to today) for one view:
 * everything, spending accounts, or savers. */
function balancesChart(
  view: (typeof BALANCE_VIEWS)[number],
  dates: string[],
  width: number,
  height: number,
  todayISO: string,
  accounts: Account[],
  transactions: Transaction[],
): ChartModel {
  const last = dates.filter((d) => d <= todayISO).at(-1)
  if (!dates.length || !last) return { rows: [], ticks: new Map(), labels: "", summary: [{ text: "No balances in range", fg: theme.overlay1 }] }
  const history = balanceHistory(accounts, transactions, dates[0]!, last)
  const pick = (p: (typeof history)[number]) => (view === "Available" ? p.spending : view === "Savers" ? p.savers : p.net)
  const values = history.map(pick)
  const lo = Math.min(...values), hi = Math.max(...values)
  const range = niceRange(lo, hi)
  const axis = dateAxis(dates, width, todayISO)
  const change = values[values.length - 1]! - values[0]!
  const low = values.indexOf(lo)
  return {
    rows: lineChart({ series: [{ values, ink: view === "Savers" ? "savers" : "balance" }], length: dates.length, width, height, min: range.min, max: range.max, markers: axis.markers }),
    ticks: tickRows(range.min, range.max, range.step, height, shortMoney),
    labels: axis.labels,
    summary: [
      { text: formatWholeMoney(values[values.length - 1]!), fg: theme.text },
      { text: ` ${change >= 0 ? "+" : "-"}${formatWholeMoney(Math.abs(change))}`, fg: Math.abs(change) < 0.5 ? theme.overlay1 : change > 0 ? theme.success : theme.error },
      { text: ` since ${shortDate(dates[0]!)} · low ${formatWholeMoney(lo)} on ${shortDate(history[low]!.dateISO)}`, fg: theme.overlay1 },
    ],
  }
}

