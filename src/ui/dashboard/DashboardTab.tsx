import { For, Show, createMemo } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { SectionCard } from "../primitives/SectionCard"
import { S } from "../primitives/S"
import type { SectionId } from "../../state/uiStore"
import { data } from "../../state/dataStore"
import { theme } from "../../theme"
import { computeCategorySpend, dailySpendSeries, fitCategoryLines, formatMoney, formatWholeMoney, groupCategorySpend } from "../../domain/dashboard"
import { computePeriodFlows, computePosition } from "../../domain/position"
import { budgetProgress, cycleFor } from "../../domain/budget"
import { budgetLabel } from "../../domain/budgetScopes"
import { accountRole } from "../../domain/types"
import { toISODate } from "../../domain/timeframe"
import { fit, shortDate, shortMoney } from "../text"
import { levelChart } from "../charts/bars"
import { AXIS, ChartBody } from "../charts/ChartBody"
import { dateAxis } from "../charts/lineChart"
import { INKS, addDays, spendingChart } from "../spending/periodCharts"

/**
 * Dashboard: how things stand today. Balances and runway, savers, a year of
 * net position, the current budget cycle (budgets, spending against the last
 * cycle, categories), pending holds, and the latest transactions. Nothing here follows the Date Range (that is the Spending
 * tab's job).
 */
export function DashboardTab(_props: { focused: SectionId }) {
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
  const pending = createMemo(() => data.state.transactions
    .filter((t) => t.status === "HELD" && t.accountId != null && spendingIds().has(t.accountId))
    .sort((a, b) => b.dateISO.localeCompare(a.dateISO) || b.id - a.id))
  // Settled spending-account rows (a transfer to a saver shows once, from
  // the spending side); held rows are listed under Pending.
  const recent = createMemo(() => data.state.transactions
    .filter((t) => t.status !== "HELD" && t.accountId != null && spendingIds().has(t.accountId))
    .sort((a, b) => b.dateISO.localeCompare(a.dateISO) || b.id - a.id))
  // Spending by category in the cycle so far.
  const cycleGroups = createMemo(() => {
    const rows = data.state.transactions.filter((t) => t.accountId != null && spendingIds().has(t.accountId) && t.dateISO >= cycle().start && t.dateISO <= today())
    return groupCategorySpend(computeCategorySpend(rows, data.state.categories), data.state.categories)
  })

  // Fixed rows: tab bar + gap (2), status + footer (2), Now (7), and on
  // taller terminals the Net Position strip (8). The lower row takes the
  // rest: this cycle above recent transactions on the left (recent dropped
  // when short), pending holds above the cycle's categories on the right.
  const showNetStrip = () => dims().height >= 36
  const lowerHeight = () => Math.max(6, dims().height - 11 - (showNetStrip() ? 8 : 0))
  const budgetLines = () => Math.max(1, budgets().length)
  // Border (2), budget lines, a blank line, a 14-row chart, labels + summary.
  const showRecent = () => lowerHeight() >= 2 + budgetLines() + 1 + 14 + 2 + 6
  const cycleHeight = () => (showRecent() ? 2 + budgetLines() + 1 + 14 + 2 : lowerHeight())
  // Left column is 60% of the width; the card spends 4 cells on border + padding.
  const leftInner = () => Math.floor((dims().width - 1) * 0.6) - 4
  // Right column: what the 60% column and the 1-cell gap leave, minus the
  // card's border + padding (4) and one cell of rounding slack.
  const rightInner = () => dims().width - 1 - Math.floor((dims().width - 1) * 0.6) - 5
  const pendingHeight = () => Math.min(Math.max(1, pending().length), 8) + 2
  const recentRows = () => Math.max(1, lowerHeight() - cycleHeight() - 2)

  // Cycle card: budget rows (or a hint), a blank line, then the chart with
  // its labels and summary.
  const cycleChartRows = () => cycleHeight() - 2 - budgetLines() - 1 - 2
  const cycleChart = createMemo(() => {
    const spending = data.state.transactions.filter((t) => t.accountId != null && spendingIds().has(t.accountId))
    return spendingChart("Cumulative", dailySpendSeries(spending, cycle().start, cycle().end), Math.max(1, leftInner() - AXIS), Math.max(1, cycleChartRows()), today(), spending, overall()?.amount)
  })

  const netStrip = createMemo(() => levelChart(position().history.map((h) => h.value), Math.max(1, dims().width - 4 - AXIS), 5))
  const netStripLabels = createMemo(() => dateAxis(position().history.map((h) => h.dateISO), Math.max(1, dims().width - 4 - AXIS), today()).labels)

  // Recent rows: date (7), description, category (24), amount (12).
  const recentDescWidth = () => Math.max(8, leftInner() - 7 - 24 - 12)
  const categoryLines = createMemo(() => fitCategoryLines(cycleGroups(), lowerHeight() - pendingHeight() - 2))

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
      </box>

      <Show when={showNetStrip()}>
        <SectionCard title="Net Position" titleSuffix="· 1 year" titleSuffixColor={theme.subtext0} height={8}>
          <For each={netStrip().rows}>
            {(row, i) => (
              <text wrapMode="none">
                <S fg={theme.overlay1}>{(i() === 0 ? shortMoney(netStrip().max) : i() === netStrip().rows.length - 1 ? shortMoney(netStrip().min) : "").padStart(AXIS - 2) + " ┤"}</S>
                <S fg={theme.lavender}>{row}</S>
              </text>
            )}
          </For>
          <text wrapMode="none" fg={theme.overlay1}>{" ".repeat(AXIS) + netStripLabels()}</text>
        </SectionCard>
      </Show>

      <box flexDirection="row" gap={1} width="100%" height={lowerHeight()}>
        <box flexDirection="column" width="60%" height={lowerHeight()}>
        <SectionCard
          title="This Cycle"
          titleSuffix={`· ${shortDate(cycle().start)} – ${shortDate(cycle().end)} · ${cycleDaysLeft()} ${cycleDaysLeft() === 1 ? "day" : "days"} left`}
          titleSuffixColor={theme.subtext0}
          height={cycleHeight()}
        >
          <Show when={budgets().length} fallback={<text fg={theme.overlay1}>No budgets · add them in Settings › Budgets</text>}>
            <For each={budgets()}>
              {(p) => {
                const over = () => p.remaining < 0
                const pctColor = () => (p.usedPct > 100 ? theme.error : p.usedPct >= 80 ? theme.warning : theme.success)
                return (
                  <text wrapMode="none">
                    <S fg={theme.text}>{fit(budgetLabel(p.budget, data.state.accounts, data.state.categories), Math.max(10, leftInner() - 44))}</S>
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
            <ChartBody model={cycleChart()} inks={INKS} />
          </Show>
        </SectionCard>
        <Show when={showRecent()}>
          <SectionCard title="Recent" flexGrow={1}>
            <For each={recent().slice(0, recentRows())}>
              {(t) => (
                <text wrapMode="none">
                  <S fg={theme.overlay1}>{shortDate(t.dateISO).padEnd(7)}</S>
                  <S fg={theme.text}>{fit(t.description, recentDescWidth())}</S>
                  <S fg={t.categoryColor || theme.overlay1}>{fit(` ${t.categoryName}`, 24)}</S>
                  <S fg={t.amount < 0 ? theme.error : theme.success}>{formatMoney(t.amount).padStart(12)}</S>
                </text>
              )}
            </For>
          </SectionCard>
        </Show>
        </box>
        <box flexGrow={1} flexBasis={0} minWidth={0} height={lowerHeight()} flexDirection="column" overflow="hidden">
          <SectionCard title="Pending" titleSuffix={pending().length ? `· ${pending().length}` : undefined} titleSuffixColor={theme.subtext0} height={pendingHeight()}>
            <Show when={pending().length} fallback={<text fg={theme.overlay1}>Nothing pending</text>}>
              <For each={pending().slice(0, 8)}>
                {(t) => (
                  <text wrapMode="none">
                    <S fg={theme.overlay1}>{shortDate(t.dateISO).padEnd(7)}</S>
                    <S fg={theme.text}>{fit(t.description, rightInner() - 7 - 12)}</S>
                    <S fg={t.amount < 0 ? theme.error : theme.success}>{formatMoney(t.amount).padStart(12)}</S>
                  </text>
                )}
              </For>
            </Show>
          </SectionCard>
          <SectionCard title="Spending by Category" titleSuffix="· this cycle" titleSuffixColor={theme.subtext0} flexGrow={1}>
            <Show when={cycleGroups().length} fallback={<text fg={theme.overlay1}>No spending this cycle</text>}>
              <For each={categoryLines()}>
                {(line) => (
                  <text wrapMode="none">
                    <S fg={line.child ? theme.subtext0 : line.color} bold={!line.child}>{fit(line.child ? `  ${line.label}` : line.label, Math.max(8, rightInner() - 14))}</S>
                    <S fg={line.child ? theme.subtext0 : theme.text} bold={!line.child}>{formatWholeMoney(line.amount).padStart(9)}</S>
                    <S fg={theme.overlay1}>{(line.pct != null ? `${Math.round(line.pct)}%` : "").padStart(5)}</S>
                  </text>
                )}
              </For>
            </Show>
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
