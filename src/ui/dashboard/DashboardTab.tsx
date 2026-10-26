import { For, Show, createMemo } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { SectionCard } from "../primitives/SectionCard"
import { S } from "../primitives/S"
import { CYCLE_VIEWS, ui, type SectionId } from "../../state/uiStore"
import { data } from "../../state/dataStore"
import { theme } from "../../theme"
import { dailySpendSeries, formatMoney, formatWholeMoney } from "../../domain/dashboard"
import { computePeriodFlows, computePosition } from "../../domain/position"
import { budgetProgress, cycleFor } from "../../domain/budget"
import { budgetLabel } from "../../domain/budgetScopes"
import { accountRole } from "../../domain/types"
import { toISODate } from "../../domain/timeframe"
import { fit, shortDate, shortMoney } from "../text"
import { AXIS, ChartBody } from "../charts/ChartBody"
import { dateAxis, lineChart, niceRange } from "../charts/lineChart"
import { INKS, addDays, spendingChart } from "../spending/periodCharts"
import { SpendingPane } from "./SpendingPane"

/**
 * Dashboard: how things stand today. Balances and runway, savers, a year of
 * net position, the current budget cycle (budgets and a chart with views),
 * and a fixed look at the spending accounts with the cycle's categories. Nothing here follows the Date Range (that is the Spending tab's
 * job).
 */
export function DashboardTab(props: { focused: SectionId }) {
  const dims = useTerminalDimensions()
  const today = () => toISODate(new Date())
  // A year of history feeds the Net Position strip (and the 30-day change).
  const position = createMemo(() => computePosition(data.state.accounts, data.state.transactions, today(), { historyDays: 365 }))
  // Savers' change covers the last 30 days, like Now's 30-day change.
  const saverChanges = createMemo(() => {
    const since = addDays(today(), -30)
    return computePeriodFlows(data.state.accounts, data.state.transactions.filter((t) => t.dateISO > since && t.dateISO <= today())).saverChanges
  })
  const saversChange = () => saverChanges().reduce((sum, c) => sum + c.change, 0)
  const saverChange = (accountId: number) => saverChanges().find((c) => c.accountId === accountId)?.change ?? 0

  // The budget cycle containing today (Settings › Budgets sets its shape).
  const cycle = createMemo(() => cycleFor(data.state.budgetCycle, today()))
  const budgets = createMemo(() => budgetProgress(data.state.budgets, data.state.budgetCycle, today(), data.state.accounts, data.state.categories, data.state.transactions))
  const overall = () => data.state.budgets.find((b) => b.scope.kind === "overall")
  const cycleDaysLeft = () => Math.round((Date.parse(cycle().end) - Date.parse(today())) / 86400000) + 1

  const spendingIds = createMemo(() => new Set(data.state.accounts.filter((a) => accountRole(a) === "spending").map((a) => a.id)))


  // Wide (120+ cols): Now beside Savers (up to SIDE_MAX wide), the Net
  // Position strip, then This Cycle beside the Spending pane (Savers' width).
  // Narrow: everything stacks, Savers two to a line; the Spending pane shows
  // when there is room under This Cycle.
  const wide = () => dims().width >= WIDE
  // Fixed rows: tab bar + gap (2), status + footer (2), Now (7).
  const saversHeight = () => (wide() ? 0 : Math.ceil((position().savers.length + 1) / 2) + 2)
  const showNetStrip = () => dims().height >= (wide() ? 36 : 44)
  const lowerHeight = () => Math.max(6, dims().height - 11 - saversHeight() - (showNetStrip() ? 8 : 0))
  const budgetLines = () => Math.max(1, budgets().length)
  const saversWidth = () => Math.min(SIDE_MAX, Math.floor((dims().width - 1) * 0.4))
  const nowWidth = () => (wide() ? dims().width - 1 - saversWidth() : dims().width)
  // Narrow: the Spending pane needs about 24 rows below a usable cycle chart.
  const showPaneNarrow = () => !wide() && lowerHeight() >= 40
  const cycleHeight = () => (showPaneNarrow() ? Math.floor(lowerHeight() * 0.45) : lowerHeight())
  const paneHeight = () => (wide() ? lowerHeight() : lowerHeight() - cycleHeight())
  // This Cycle's content width: its card spends 4 cells on border + padding.
  const inner = () => nowWidth() - 4


  // The cycle chart in its current view (h/l), with the overall budget as a
  // rule on the cumulative view.
  const cycleView = () => CYCLE_VIEWS[ui.state.cycleView] ?? CYCLE_VIEWS[0]
  const cycleChartRows = () => cycleHeight() - 2 - budgetLines() - 1 - 1 - 2
  const cycleChart = createMemo(() => {
    const spending = data.state.transactions.filter((t) => t.accountId != null && spendingIds().has(t.accountId))
    return spendingChart(cycleView(), dailySpendSeries(spending, cycle().start, cycle().end), Math.max(1, inner() - AXIS), Math.max(1, cycleChartRows()), today(), spending, overall()?.amount)
  })

  // Net position: a braille line over a faint dotted fill on round axis
  // bounds, month rules above the line, and the year's change, high and low
  // in the title.
  const netWidth = () => Math.max(1, dims().width - 4 - AXIS)
  const netStrip = createMemo(() => {
    const history = position().history
    const values = history.map((h) => h.value)
    const width = netWidth()
    if (!values.length) return { rows: [], ticks: new Map<number, string>(), labels: "", note: "" }
    const lo = Math.min(...values), hi = Math.max(...values)
    const range = niceRange(lo, hi, 3)
    const axis = dateAxis(history.map((h) => h.dateISO), width, today())
    const months = axis.markers.filter((m) => m.ink === "month")
    const change = values[values.length - 1]! - values[0]!
    const when = (v: number) => shortDate(history[values.indexOf(v)]!.dateISO)
    return {
      rows: lineChart({ series: [{ values, ink: "line", fill: "area" }], length: values.length, width, height: NET_ROWS, min: range.min, max: range.max, markers: months }),
      ticks: new Map([[0, shortMoney(range.max)], [NET_ROWS - 1, shortMoney(range.min)]]),
      labels: axis.labels,
      note: `· 1 year · ${change >= 0 ? "+" : "-"}${formatWholeMoney(Math.abs(change))} · high ${shortMoney(hi)} ${when(hi)} · low ${shortMoney(lo)} ${when(lo)}`,
    }
  })
  // Narrow Savers: two "name balance change" cells per line.
  const saverPairs = createMemo(() => {
    const cells = [
      ...position().savers.map((s) => ({ name: s.name, balance: s.balance, change: saverChange(s.accountId), total: false })),
      { name: "Total", balance: position().saversTotal, change: saversChange(), total: true },
    ]
    const pairs: Array<typeof cells> = []
    for (let i = 0; i < cells.length; i += 2) pairs.push(cells.slice(i, i + 2))
    return pairs
  })
  const saverCellWidth = () => Math.floor((dims().width - 4) / 2)

  const nowCard = () => (
    <SectionCard title="Now" width={nowWidth()} height={7}>
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
  )

  const saversCard = () => (
    <Show
      when={wide()}
      fallback={
        <SectionCard title="Savers" titleSuffix="· 30-day change" titleSuffixColor={theme.subtext0} height={saversHeight()}>
          <Show when={position().savers.length} fallback={<text fg={theme.overlay1}>No savers synced</text>}>
            <For each={saverPairs()}>
              {(pair) => (
                <text wrapMode="none">
                  <For each={pair}>
                    {(cell) => (
                      <>
                        <S fg={cell.total ? theme.subtext0 : theme.text}>{fit(cell.name, Math.max(6, saverCellWidth() - 25))}</S>
                        <S fg={cell.total ? theme.text : theme.subtext1} bold={cell.total}>{formatWholeMoney(cell.balance).padStart(9)}</S>
                        <S fg={changeColor(cell.change)}>{` ${changeText(cell.change)}`.padEnd(16)}</S>
                      </>
                    )}
                  </For>
                </text>
              )}
            </For>
          </Show>
        </SectionCard>
      }
    >
      <box flexGrow={1} flexBasis={0} minWidth={0} height={7} overflow="hidden">
        <SectionCard title="Savers" titleSuffix="· 30-day change" titleSuffixColor={theme.subtext0} height={7}>
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
              <S fg={changeColor(saversChange())}>{`  ${changeText(saversChange())}`}</S>
            </text>
          </Show>
        </SectionCard>
      </box>
    </Show>
  )

  const netCard = () => (
    <Show when={showNetStrip()}>
      <SectionCard title="Net Position" titleSuffix={netStrip().note || "· 1 year"} titleSuffixColor={theme.subtext0} height={NET_ROWS + 3}>
        <For each={netStrip().rows}>
          {(runs, i) => (
            <text wrapMode="none">
              <S fg={theme.overlay1}>{(netStrip().ticks.get(i()) ?? "").padStart(AXIS - 2) + (netStrip().ticks.has(i()) ? " ┤" : " │")}</S>
              <For each={runs}>{(run) => <S fg={run.ink ? NET_INKS[run.ink] : undefined}>{run.text}</S>}</For>
            </text>
          )}
        </For>
        <text wrapMode="none" fg={theme.overlay1}>{" ".repeat(AXIS) + netStrip().labels}</text>
      </SectionCard>
    </Show>
  )

  const cycleCard = () => (
    <SectionCard
      title="This Cycle"
      titleSuffix={`· ${shortDate(cycle().start)} – ${shortDate(cycle().end)} · ${cycleDaysLeft()} ${cycleDaysLeft() === 1 ? "day" : "days"} left`}
      titleSuffixColor={theme.subtext0}
      width={nowWidth()}
      height={cycleHeight()}
      focused={props.focused === "dash.cycle"}
    >
      <Show when={budgets().length} fallback={<text fg={theme.overlay1}>No budgets · add them in Settings › Budgets</text>}>
        <For each={budgets()}>
          {(p) => {
            const over = () => p.remaining < 0
            const pctColor = () => (p.usedPct > 100 ? theme.error : p.usedPct >= 80 ? theme.warning : theme.success)
            return (
              <text wrapMode="none">
                <S fg={theme.text}>{fit(budgetLabel(p.budget, data.state.accounts, data.state.categories), Math.max(10, inner() - 44))}</S>
                <S fg={theme.text}>{formatWholeMoney(p.spent).padStart(8)}</S>
                <S fg={theme.overlay1}>{` of ${formatWholeMoney(p.budget.amount)}`.padEnd(10)}</S>
                <S fg={pctColor()} bold>{(Number.isFinite(p.usedPct) ? `${Math.round(p.usedPct)}%` : "—").padStart(5)}</S>
                <S fg={over() ? theme.error : theme.subtext0}>
                  {over() ? `  ${formatWholeMoney(-p.remaining)} over` : `  ${formatWholeMoney(p.dailyAllowance)}/day left`}
                </S>
                <Show when={!over() && p.projected > p.budget.amount}>
                  <S fg={theme.warning}>{"  ▲ pace"}</S>
                </Show>
              </text>
            )
          }}
        </For>
      </Show>
      <Show when={cycleChartRows() >= 3}>
        <text> </text>
        <text wrapMode="none">
          <For each={CYCLE_VIEWS}>
            {(view, i) => (
              <>
                <S fg={theme.surface2}>{i() === 0 ? "" : "  "}</S>
                <S fg={view === cycleView() ? theme.accent : theme.overlay1} bg={view === cycleView() ? theme.surface0 : undefined} bold={view === cycleView()}>{view}</S>
              </>
            )}
          </For>
        </text>
        <ChartBody model={cycleChart()} inks={INKS} />
      </Show>
    </SectionCard>
  )


  return (
    <box width="100%" height="100%" flexDirection="column" gap={0} backgroundColor={theme.canvas}>
      <Show
        when={wide()}
        fallback={
          <>
            {nowCard()}
            {saversCard()}
            {netCard()}
            {cycleCard()}
            <Show when={showPaneNarrow()}>
              <SpendingPane width={dims().width} height={paneHeight()} cycle={cycle()} today={today()} />
            </Show>
          </>
        }
      >
        <box flexDirection="row" gap={1} width="100%" height={7}>
          {nowCard()}
          {saversCard()}
        </box>
        {netCard()}
        <box flexDirection="row" gap={1} width="100%" height={lowerHeight()}>
          {cycleCard()}
          <SpendingPane width={saversWidth()} height={paneHeight()} cycle={cycle()} today={today()} />
        </box>
      </Show>
    </box>
  )

  function change30(): number {
    const h = position().history
    if (h.length < 31) return 0
    return h[h.length - 1]!.value - h[h.length - 31]!.value
  }
}

/** Below this width the Dashboard stacks its cards. */
const WIDE = 120
/** Savers' widest useful size. */
const SIDE_MAX = 48
const LABEL = 15
/** Net position chart rows. */
const NET_ROWS = 4
/** Net position inks: the line, its faint fill, and month rules. */
const NET_INKS: Record<string, string> = { line: theme.lavender, area: "#3d4060", month: theme.surface0, week: theme.surface0, today: theme.green }
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
