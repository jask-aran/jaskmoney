import { regionRef } from "../regions"
import { onPointer } from "../../app/pointer"
import { drillDown, handleOverviewRange, moveOverviewCategory, stepOverviewRange } from "../../app/keys"
import { keyEvent } from "../../app/keyEvent"
import { For, Index, Show, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js"
import { hasMarks } from "../charts/reveal"
import type { BoxRenderable, ScrollBoxRenderable } from "@opentui/core"
import { categoryMark } from "../icons"
import { useTerminalDimensions } from "@opentui/solid"
import { SectionCard } from "../primitives/SectionCard"
import { chipLook } from "../primitives/chip"
import { centredTop } from "../primitives/ListRow"
import { changeColor, spendChangeColor } from "../colors"
import type { Span } from "../primitives/spans"
import { S } from "../primitives/S"
import { CHART_SECTIONS, CHART_VIEWS, chartPaneOf, ui, type SectionId } from "../../state/uiStore"
import { data } from "../../state/dataStore"
import { ink, theme, tone } from "../../theme"
import { dailySpendSeries, fitCategoryLines, formatMoney, formatPct, formatWholeMoney, signedWholeMoney } from "../../domain/dashboard"
import { computePeriodFlows, computePosition, historyCovers, projectAvailable, usualDailySpend } from "../../domain/position"
import { allocation, budgetProgress, cycleFor, cycleSpending, progressOf, type BudgetProgress } from "../../domain/budget"
import { spendingCalendar, type CalendarDay } from "../../domain/spending"
import { accountRole, type Account, type Transaction } from "../../domain/types"
import { addDays, appNow, appToday, type WeekStart } from "../../domain/days"
import { isSpending, isUncategorised, isUnsortedIn } from "../../domain/moneyRules"
import { GROUP_NAMES, chipLayout } from "./rangeChips"
import { CustomRangeDialog } from "./CustomRangeDialog"
import { CUSTOM_CHIP, LOOKBACKS, PERIODS, comparisonWindows, filterByTimeframe, rangeOffsetLabel } from "../../domain/timeframe"
import { fit } from "../text"
import { subscriptions, upcomingCharges } from "../../domain/subscriptions"
import { merchantRows, trendRows, type MerchantRow, type TrendGroup, type TrendRow } from "../../domain/periodTables"
import { MerchantsView, TrendsView, merchantsLegend, trendsLegend } from "./TableViews"
import { openGroups, overviewCategoryLines, overviewRange } from "../../state/overviewRange"
import { AXIS_GUESS, CHART_RIGHT_PAD, axisWidth, type ChartModel } from "../charts/ChartBody"
import { ChartCard } from "../charts/ChartCard"
import { chartSpeedMs, showings, takeLaunchReveal, useReveal, type ChartLabelMode } from "../charts/motion"
import { balancesChart, cashFlowChart, spendingChart, type PeriodNames } from "./periodCharts"
import { UP_LOGO_WIDTH } from "../primitives/UpLogo"
import { CalendarView, calendarLegend } from "./CalendarView"
import { cycleTrack } from "../budgets/PlanGraphics"
import { rangeBar } from "./RangeGraphics"
import { cyclePay } from "../../domain/payday"
import { computeCategorySpend, groupCategorySpend } from "../../domain/dashboard"


/** At or above this width the cards take a right-hand column beside the
 * two charts; below it one chart spans the tab with the cards under it. */
export const WIDE = 90
/** The categories column's widest useful size: Up's longest names fit. */
const SIDE_MAX = 48
/** The side column's widest with the Range pane. */
const RANGE_SIDE_MAX = 56
/** The side stack's narrowest: Accounts' and Totals' labels still fit. */
const SIDE_MIN = 40
/** A grid pane's narrowest: the chart column splits into a 2×2 grid of
 * chart panes once each would be at least this wide (a full-screen
 * terminal; a split one keeps the two stacked). */
export const GRID_PANE_MIN = 64
/** Narrow: the chart's fewest rows before the column scrolls. */
const NARROW_CHART_MIN = 10
/** Stack columns: value and note widths; the label takes the rest. */
const VALUE = 11
const NOTE = 12
/** Savers fold to their subtotal before Categories drop under this many rows. */
const MIN_CATEGORIES = 8
/** The Range pane's Before column: a category's change on before. */
const BEFORE = 8

/**
 * The overview: the Date Range (opens on the current budget cycle), two chart
 * panes cycling through spending, cash flow, balance and calendar views (h/l
 * the top or focused pane, H/L the bottom), and a column of stacks: Accounts
 * (balances now, with no range), Totals (the range against the same days of
 * the previous period, with the overall budget when the range is the current
 * cycle) and Categories. Spending figures cover the selected spending account
 * (see spendingScope); internal transfers and not-spending categories are
 * excluded.
 */
/** The side column's width on a wide terminal (the Budgets tab's too). */
export function sideColumnWidth(width: number, max = SIDE_MAX, share = 0.4): number {
  return Math.max(SIDE_MIN, Math.min(max, Math.floor((width - 1) * share)))
}

export function OverviewTab(props: { focused: SectionId }) {
  // Hidden (another tab shown, the tab kept mounted), the tab's inputs keep
  // their last values, so the costly results stop following the data;
  // showing the tab passes on only the inputs that changed meanwhile, so a
  // tab whose data didn't change wakes nothing.
  const shown = () => ui.state.activeTab === "overview"
  const held = <T,>(fn: () => T): (() => T) => createMemo<T | undefined>((was) => (shown() || was === undefined ? fn() : was)) as () => T
  const terminal = useTerminalDimensions()
  const dims = held(() => terminal())
  const transactions = held(() => data.transactions())
  // The clock isn't reactive: read fresh as before, and showing the tab on
  // a new day brings its results up to date.
  const shownOn = held(() => appToday())
  const today = () => (shownOn(), appToday())
  const cycleConfig = held(() => data.cycle())
  // The range, scope and category spending, shared with the tab's keys.
  // Through the held inputs: hidden, the range doesn't follow every write.
  const rangeAccounts = held(() => data.state.accounts)
  const rangeSelection = held(() => data.state.accountSelection)
  const rangeCategories = held(() => data.state.categories)
  const range = createMemo(() => overviewRange({ state: { accounts: rangeAccounts(), accountSelection: rangeSelection(), categories: rangeCategories() }, transactions, cycle: cycleConfig }, ui.state))
  const clock = () => range().clock
  const bounds = () => range().bounds
  const scope = () => range().scope
  const scopeIds = () => range().scopeIds
  // Compare like with like: the period so far against the same days of the
  // previous period.
  const windows = createMemo(() => comparisonWindows(bounds().start, bounds().end, today()))
  const previous = () => windows().previous
  const spending = () => range().spending
  const inPeriod = () => range().inPeriod
  // A memo reads its inputs once, not once a row: each read is a tracked
  // lookup (today() a new Date), over the whole history.
  const inPrevious = createMemo(() => {
    const { start, end } = previous()
    return transactions().filter((t) => t.dateISO >= start && t.dateISO <= end)
  })
  // Flows see every tracked account (money moved to savers), narrowed to the
  // scope for spending and income.
  const flows = createMemo(() => computePeriodFlows(data.state.accounts, filterByTimeframe(transactions(), ui.state.timeframe, clock(), cycleConfig()), scopeIds()))
  const previousFlows = createMemo(() => computePeriodFlows(data.state.accounts, inPrevious(), scopeIds()))
  // Before is a comparison only where the history covers the earlier
  // period (historyCovers); else "—".
  const covered = createMemo(() => windows().days === 0 || historyCovers(transactions(), previous(), { start: bounds().start, end: addDays(bounds().start, windows().days - 1) }))
  const before = (text: string) => (covered() ? text : "—")
  const groups = () => range().groups
  /** The views on screen (overviewCharts, set below from the layout): a
   * hidden pane's view builds nothing. */
  const shownViews = () => ui.state.chartViews.slice(0, ui.state.overviewCharts)
  // Built only while a pane shows it.
  const calendarShown = () => shownViews().some((i) => CHART_VIEWS[i]?.view === "Calendar")
  const calendar = createMemo(() => (calendarShown() ? spendingCalendar(inPeriod(), bounds().start, bounds().end, data.state.weekStart) : []))
  const inScope = (rows: Transaction[]) => {
    const ids = scopeIds()
    return rows.filter((t) => t.accountId != null && ids.has(t.accountId))
  }
  // Regular payments now, from the scope's whole history (no range).
  // Built only while a pane shows it.
  // The tables, each built only while a pane shows it: the range's spending
  // a month (or week) a row by category group, and by merchant against
  // Before (when the history covers it, as Totals compares).
  const shows = (view: string) => shownViews().some((i) => CHART_VIEWS[i]?.view === view)
  const trends = createMemo(() => (shows("Trends") ? trendRows(inPeriod(), data.state.categories, bounds().start, bounds().end, today(), data.state.weekStart) : { groups: [], rows: [] }))
  const merchants = createMemo(() => (shows("Merchants") ? merchantRows(inPeriod(), covered() ? inScope(inPrevious()) : null) : []))
  const series = createMemo(() => dailySpendSeries(inPeriod(), bounds().start, bounds().end))
  // The next payday: the day after the current cycle ends.
  const payday = () => addDays(cycleFor(cycleConfig(), today()).end, 1)

  // Accounts: point-in-time figures, whatever the range.
  const position = createMemo(() => computePosition(data.state.accounts, transactions(), today()))
  const saverChanges = createMemo(() => {
    const now = today(), since = addDays(now, -30)
    return computePeriodFlows(data.state.accounts, transactions().filter((t) => t.dateISO > since && t.dateISO <= now)).saverChanges
  })
  // Where Available is headed, up to the day before the next payday (or
  // the range's end): built only while a pane shows Available.
  const availableShown = () => shownViews().some((i) => CHART_VIEWS[i]?.view === "Available")
  const projection = createMemo(() => {
    const p = position()
    if (!availableShown() || p.spendingBalance == null || p.dailySpend == null) return []
    const until = [addDays(payday(), -1), bounds().end].sort()[0]!
    if (until <= today()) return []
    const regular = subscriptions(inScope(transactions()), today(), { people: true })
    const usual = usualDailySpend(data.state.accounts, transactions(), today(), new Set(regular.flatMap((s) => s.chargeIds)))
    return projectAvailable(p.spendingBalance, today(), until, usual, upcomingCharges(regular, today(), until))
  })
  const change30 = () => {
    const h = position().history
    return h.length >= 31 ? h[h.length - 1]!.value - h[h.length - 31]!.value : 0
  }
  // The budget for the spending in scope applies while the range is the
  // current cycle: every budget added up (allocation's total) against all
  // spending when the scope is every spending account, so it reconciles
  // with the money; else the one selected account's own budget.
  const budget = createMemo(() => {
    const ids = [...scopeIds()]
    const all = data.state.accounts.filter((a) => accountRole(a) === "spending").every((a) => ids.includes(a.id))
    const current = cycleFor(cycleConfig(), today())
    if (bounds().start !== current.start || bounds().end !== current.end) return null
    if (all) {
      const total = allocation(data.state.budgets, data.state.categories)
      if (total.overall == null && !total.allocated) return null
      const spent = cycleSpending(current, today(), data.state.accounts, transactions()).reduce((sum, t) => sum - t.amount, 0)
      return progressOf({ id: -1, scope: { kind: "overall" }, amount: total.total }, spent, current, today())
    }
    const match = data.state.budgets.find((b) => b.scope.kind === "account" && ids.length === 1 && b.scope.accountId === ids[0])
    return match ? budgetProgress([match], cycleConfig(), today(), data.state.accounts, data.state.categories, transactions())[0] ?? null : null
  })

  // What the range and the one before it are called in chart labels.
  const periodNames = (): PeriodNames => {
    const tf = ui.state.timeframe
    if (tf.family !== "period") return { current: "Range", previous: "Before" }
    const unit = PERIOD_UNIT[tf.period]
    return { current: `This ${unit}`, previous: `Last ${unit}` }
  }

  // Fixed rows: tab bar + gap (2), status + footer (2), Date Range (3).
  // Wide: two chart panes share the left column; the right column (SIDE_MIN
  // to SIDE_MAX wide) stacks Accounts, Totals and Categories. Narrow: the
  // top chart across the tab takes what the cards leave; under it Accounts
  // and Totals stack beside Categories, the two columns one height.
  // When even the smallest chart doesn't fit, the column scrolls.
  const wide = () => dims().width >= WIDE
  // The side column as the Range pane (the default) or, after t, the
  // Totals and Categories cards.
  const rangePane = () => !data.state.uiPrefs.totalsCards
  const bodyHeight = () => Math.max(8, dims().height - 7)
  // The Range pane's column is wider: its Before column and the names both fit.
  const sideWidth = () => (wide() ? (rangePane() ? sideColumnWidth(dims().width, RANGE_SIDE_MAX, 0.45) : sideColumnWidth(dims().width)) : Math.floor((dims().width - 1) / 2))
  const mainWidth = () => (wide() ? dims().width - 1 - sideWidth() : dims().width)
  // Wide and wide enough: the charts in a 2×2 grid, two columns of panes.
  const grid = () => wide() && mainWidth() >= 2 * GRID_PANE_MIN + 1
  const charts = () => (grid() ? 4 : wide() ? 2 : 1)
  /** A chart pane's width: the chart column, or half of it in the grid. */
  const paneWidth = (pane: number) => (!grid() ? mainWidth() : pane < 2 ? Math.ceil((mainWidth() - 1) / 2) : Math.floor((mainWidth() - 1) / 2))
  // The keys act on the charts on screen: focus on one that's gone moves
  // to the top one.
  createEffect(() => {
    const n = charts()
    if (ui.state.overviewCharts !== n) ui.setState({ overviewCharts: n })
    if (chartPaneOf(ui.state.focusedSection) >= n) ui.applyJump("ov.chart")
  })


  // The stacks: label, value (VALUE) and a note or comparison (NOTE).
  // Accounts: available, the balance with what's pending, runway and the
  // 30 day change; then, with savers, a heading, each saver and their
  // subtotal (folded: the subtotal alone), and the net position.
  const hasSavers = () => position().savers.length > 0
  // With savers: a blank line, the heading, each saver and their total
  // (folded: one line), a blank line and the net position. Without: the
  // 30 day change.
  const saverRows = (full: boolean) => (!hasSavers() ? 1 : (full ? 2 + position().savers.length : 1) + 3)
  // Runway is the Range pane's, with it.
  const accountRows = (full: boolean) => (rangePane() ? 1 : 2) + (position().pendingCount > 0 ? 1 : 0) + saverRows(full)
  // Column headings sit in the top border, so no row of their own.
  const totalsRows = () => 7 + (budget() ? (budget()!.remaining > 0 ? 2 : 1) : 0)
  // Narrow: the stack beside Categories, and so the height of both (the
  // Range pane's too: Accounts alone beside it). Wide, the Range pane
  // takes Totals' place and Categories'.
  const lowerHeight = (full: boolean) => accountRows(full) + 2 + (wide() && rangePane() ? 0 : totalsRows() + 2)
  // Savers fold to their total when Categories (wide) or the chart (narrow)
  // would get too small.
  const saversFull = () =>
    wide()
      ? bodyHeight() - lowerHeight(true) >= MIN_CATEGORIES + 2 + rangeTop()
      : bodyHeight() - lowerHeight(true) >= NARROW_CHART_MIN
  const categoriesHeight = () => Math.max(3, wide() ? bodyHeight() - lowerHeight(saversFull()) : lowerHeight(saversFull()))
  // Wide: the two charts split the column equally with a blank line
  // between them; an odd line left over widens that gap, so the panes
  // (and a Calendar in each) are the same size whatever their views.
  const topChartHeight = () => (wide() ? Math.floor((bodyHeight() - 1) / 2) : Math.max(NARROW_CHART_MIN, bodyHeight() - lowerHeight(saversFull())))
  const bottomChartHeight = () => topChartHeight()
  const stackWidth = () => sideWidth() - 4
  const labelWidth = () => Math.max(6, stackWidth() - VALUE - NOTE)

  // Chart panes: border + padding (4) across; border (2), the x-axis line
  // (Settings › Database b, default off) and the x labels down. The view
  // picker and the legend sit in the borders.
  const baseline = () => data.state.uiPrefs.xAxis === true
  // The y-axis is as wide as its labels: build once with a guessed width,
  // then again if the labels need a different one.
  // The axis width each chart had last: the first guess next time, so a
  // chart is usually built once, not twice.
  const axisWas = [AXIS_GUESS, AXIS_GUESS, AXIS_GUESS, AXIS_GUESS]
  // What the charts draw from, read lazily: a view reads only its own.
  const chartInput: OverviewChartInput = {
    get series() { return series() }, get today() { return today() }, get spending() { return spending() },
    get budget() { return budget()?.budget.amount }, get names() { return periodNames() }, get weekStart() { return data.state.weekStart },
    get accounts() { return data.state.accounts }, get transactions() { return transactions() }, get scopeIds() { return scopeIds() },
    get zeroAxis() { return data.state.uiPrefs.zeroAxis === true }, get projection() { return projection() },
  }
  const model = (slot: number, index: number, height: number): ChartModel | null => {
    const m = overviewChartModel((CHART_VIEWS[index] ?? CHART_VIEWS[0]).view, chartInput, paneWidth(slot) - 4, chartRows(height, baseline()), axisWas[slot])
    if (m && m.ticks.size) axisWas[slot] = axisWidth(m.ticks)
    return m
  }
  // Each chart follows its own view: switching one leaves the others alone.
  // A pane off screen builds no model.
  const paneModel = (slot: number) => {
    const view = createMemo(() => ui.state.chartViews[slot]!)
    return createMemo(() => (slot < charts() ? model(slot, view(), slot % 2 ? bottomChartHeight() : topChartHeight()) : null))
  }
  const models = [0, 1, 2, 3].map(paneModel)
  const topModel = models[0]!

  // Category lines: name, then amount (9) and share (5).
  const categoryWidth = () => (wide() ? sideWidth() : dims().width - 1 - sideWidth())
  const categoryNameWidth = () => Math.max(8, categoryWidth() - 5 - 14 - (rangePane() ? BEFORE : 0))

  // The dates on the right, between the [ ] that step them, and how far
  // the range is from the current period (with 0 to come back).
  const offsetText = createMemo(() => rangeOffsetLabel(ui.state.timeframe, appNow(), cycleConfig()))
  const timeframeWidth = () => bounds().label.length + 4 + (offsetText() ? offsetText().length + 11 : 0)
  // The card leaves the Up logo its columns; border and padding take 4.
  const rangeCardWidth = () => Math.max(20, dims().width - UP_LOGO_WIDTH - 1)
  const chipsFit = createMemo(() => chipLayout(rangeCardWidth() - 4, timeframeWidth()))
  const showTimeframe = () => chipsFit().timeframe
  const dateFocused = () => props.focused === "ov.range"
  // Chips are padded labels on a pill (chipLook); the cursor shows only
  // while the Date Range is focused.
  const chip = (label: string, idx: number, active: () => boolean) => {
    // `active` is a function: For runs its callback once per chip, so a plain
    // boolean would keep the first render's value.
    const look = () => chipLook({ active: active(), cursor: dateFocused() && ui.state.dashChipCursor === idx })
    return <S fg={look().fg} bg={look().bg} bold={look().bold}>{` ${label} `}</S>
  }
  // The space between chips: none when the row is tight (an empty text
  // would still take a column).
  const gap = () => <text wrapMode="none" fg={ink.label}>{chipsFit().gap}</text>
  /** A range chip as its own text: a click on it chooses it. */
  const stepPointer = (delta: -1 | 1) => onPointer((s) => s === "bar" || s === "overview" || s === "overview.range", () => stepOverviewRange(ui, delta, data))
  const chipText = (label: string, idx: number, active: () => boolean) => (
    <text wrapMode="none" fg={ink.label} onMouseDown={onPointer((s) => s === "bar" || s === "overview" || s === "overview.range", () => {
      ui.applyJump("ov.range")
      ui.setDashChipCursor(idx)
      handleOverviewRange(ui, keyEvent("return"), data)
    })}>{chip(label, idx, active)}</text>
  )

  // A note too long for its column (a space before it) takes room from the
  // label's padding.
  const stat = (label: string, value: string, note = "", colors: { label?: string; value?: string; note?: string; bold?: boolean } = {}) => {
    const spill = Math.max(0, Math.min(note.length + 1 - NOTE, labelWidth() - label.length - 1))
    return (
      <text wrapMode="none">
        <S fg={colors.label ?? ink.label} bold={colors.bold}>{fit(label, labelWidth() - spill)}</S>
        <S fg={colors.value ?? ink.figure} bold={colors.bold}>{value.padStart(VALUE)}</S>
        <S fg={colors.note ?? ink.note}>{note.padStart(NOTE + spill)}</S>
      </text>
    )
  }
  // Value and note column headings for a stack's top border, right-aligned
  // over their columns.
  const headings = (value: string, note: string): Span[] => [{ text: `${value}${" ".repeat(Math.max(1, NOTE - note.length))}${note}`, fg: ink.label }]

  // Available is what Up shows: the balance less what's pending. The
  // balance's note is the pending money and how many rows it is.
  const available = () => position().spendingBalance
  const saverChange = (accountId: number) => saverChanges().find((c) => c.accountId === accountId)?.change ?? 0
  const saversTotalChange = () => saverChanges().reduce((sum, c) => sum + c.change, 0)
  const panePointer = (id: SectionId) => onPointer((s) => s === "bar" || s === "overview" || s === "overview.range", () => ui.applyJump(id))
  // Narrow beside the Range pane, Accounts is its height: the two end on one row.
  const accountsHeight = () => (!wide() && rangePane() ? categoriesHeight() : accountRows(saversFull()) + 2)
  const accountsCard = () => (
    <box ref={regionRef("ov.accounts", "overview")} width={sideWidth()} height={accountsHeight()} flexShrink={0} onMouseDown={panePointer("ov.accounts")}>
    <SectionCard title="Accounts" focused={props.focused === "ov.accounts"} active={props.focused === "ov.accounts"} width={sideWidth()} height={accountsHeight()}>
      <Index each={accountLines()}>{(spans) => (
        <text wrapMode="none" flexShrink={0}><Index each={spans()}>{(span) => <S fg={span().fg} bold={span().bold}>{span().text}</S>}</Index></text>
      )}</Index>
    </SectionCard>
    </box>
  )

  // Totals: the range against the same days of the previous period.
  const daily = (spent: number) => formatWholeMoney(windows().days ? spent / windows().days : 0)
  const totalsCard = () => (
    <SectionCard title="Totals" titleRight={headings("Range", "Before")} titleRightFlush width={sideWidth()} height={totalsRows() + 2}>
      {stat("Spent", formatWholeMoney(flows().spent), before(formatWholeMoney(previousFlows().spent)), { value: covered() && previousFlows().spent > 0 ? spendChangeColor(flows().spent - previousFlows().spent) : ink.figure })}
      {stat("Income", formatWholeMoney(flows().income), before(formatWholeMoney(previousFlows().income)))}
      {stat("Net", signedWholeMoney(flows().net), before(signedWholeMoney(previousFlows().net)), { value: changeColor(flows().net) })}
      {stat("To savers", signedWholeMoney(flows().savedToSavers), before(signedWholeMoney(previousFlows().savedToSavers)), { value: changeColor(flows().savedToSavers) })}
      {stat("Savings rate", formatPct(flows().savingsRate), before(formatPct(previousFlows().savingsRate)))}
      {stat("Daily", daily(flows().spent), before(daily(previousFlows().spent)))}
      {stat("Transactions", String(flows().txnCount), before(String(previousFlows().txnCount)))}
      <Show when={budget()}>
        {(p: () => BudgetProgress) => (
          <>
            {stat("Budget", formatWholeMoney(p().budget.amount), `${Number.isFinite(p().usedPct) ? Math.round(p().usedPct) : "—"}% used`, {
              note: p().usedPct > 100 ? tone.bad : p().usedPct >= 80 ? tone.caution : tone.good,
            })}
            <Show when={p().remaining > 0}>{stat("  left", formatWholeMoney(p().remaining), `${formatWholeMoney(p().dailyAllowance)}/day`)}</Show>
          </>
        )}
      </Show>
    </SectionCard>
  )

  // The Range pane (the default; t switches to Totals and Categories):
  // Totals and Categories as one. The range as a track (its paydays, sends
  // to savers and today; what came in, what went to savers and what was
  // spent), what came in as a bar (spent by group, to savers, kept; the
  // earlier period's spending ticked), the savings rate, daily average and
  // transactions against before, then the categories with a Before column.
  const rangePay = createMemo(() => (rangePane() ? cyclePay(data.state.accounts, transactions(), bounds().start, bounds().end) : null))
  const rangeLines = createMemo((): Span[][] => {
    const pay = rangePay()
    if (!pay) return []
    const width = categoryWidth() - 5
    const f = flows(), b = previousFlows()
    const lines: Span[][] = []
    // The track: what came in and what went to savers are the range's
    // flows (as Totals counts them), so the bar and the figures agree.
    lines.push(...cycleTrack(width, bounds().start, addDays(bounds().end, 1), today(), { ...pay, pay: f.income, sent: f.savedToSavers, spent: f.spent }, tone.good, bounds().end))
    lines.push([])
    const bar = rangeBar(width, f.income, groups().map((g) => ({ amount: g.amount, color: g.color })), f.savedToSavers, f.net, covered() && b.spent > 0 ? b.spent : null)
    lines.push(bar.above, bar.bar, bar.below, [])
    // The ratios: label, before (a note) and the figure at the row's end.
    const ratio = (label: string, value: string, was: string | null, aside?: string): Span[] => {
      const note = aside ?? (covered() && was != null ? `before ${was}` : "")
      const gap = Math.max(1, width - label.length - note.length - Math.max(VALUE - 2, value.length))
      return [{ text: label, fg: ink.label }, { text: " ".repeat(gap) + note, fg: ink.note }, { text: value.padStart(Math.max(VALUE - 2, value.length)), fg: ink.strong, bold: true }]
    }
    lines.push(
      ratio("Savings rate", formatPct(f.savingsRate), formatPct(b.savingsRate)),
      ratio("Daily average", daily(f.spent), daily(b.spent)),
      ratio("Transactions", String(f.txnCount), String(b.txnCount)),
      // How long the net position lasts at the range's daily average.
      ...(position().netPosition != null && f.spent > 0 && windows().days > 0
        ? [ratio("Runway", `${Math.round(position().netPosition! / (f.spent / windows().days))} days`, null, `at ${daily(f.spent)}/day`)]
        : []),
      [],
    )
    // The categories' heading, its columns over theirs.
    const cols = `${"Spent".padStart(9)}${"%".padStart(5)}${"Before".padStart(BEFORE)}`
    lines.push([{ text: "Categories".padEnd(Math.max(10, width - 1 - cols.length)), fg: ink.heading, bold: true }, { text: cols, fg: ink.label }])
    return lines.map((l) => (l.length ? l : [{ text: " ", fg: ink.note }]))
  })
  const rangeTop = () => rangeLines().length
  // The earlier period's spending a category (and a group), for the
  // Before column: only where the history covers it.
  const beforeSpend = createMemo(() => {
    if (!rangePane() || !covered()) return null
    const list = computeCategorySpend(inScope(inPrevious()), data.state.categories)
    const by = new Map<string, number>()
    for (const c of list) by.set(`c${c.categoryId}`, (by.get(`c${c.categoryId}`) ?? 0) + c.amount)
    for (const g of groupCategorySpend(list, data.state.categories)) by.set(`g${g.categoryId}`, g.amount)
    return by
  })
  const beforeChange = (line: { categoryId: number | null; child: boolean; amount: number }): Span => {
    const by = beforeSpend()
    if (!by) return { text: "—".padStart(BEFORE), fg: ink.faint }
    const delta = line.amount - (by.get(`${line.child ? "c" : "g"}${line.categoryId}`) ?? 0)
    return { text: (Math.abs(delta) < 0.5 ? "·" : signedWholeMoney(delta)).padStart(BEFORE), fg: spendChangeColor(delta) }
  }

  // Accounts as a ledger, a line each: the label at the left, the value at
  // the row's end, a note or 30 days' change in the column before it.
  // Available and Net position (bold) open and close it; the savers
  // between, under their heading, set apart by blank lines.
  const ACCOUNT_VALUE = 11
  const ACCOUNT_CHANGE = 10
  const accountLines = createMemo((): Span[][] => {
    const width = stackWidth() - 1
    const row = (label: string, mid: string, value: string, look: { label?: string; mid?: string; value?: string; bold?: boolean } = {}): Span[] => {
      const midWidth = Math.max(ACCOUNT_CHANGE, mid.length + 1)
      return [
        { text: " ", fg: ink.note },
        { text: fit(label, Math.max(4, width - ACCOUNT_VALUE - midWidth)), fg: look.label ?? ink.label, bold: look.bold },
        { text: mid.padStart(midWidth), fg: look.mid ?? ink.note },
        { text: value.padStart(ACCOUNT_VALUE), fg: look.value ?? ink.figure, bold: look.bold },
      ]
    }
    const p = position()
    const lines: Span[][] = [row("Available", "", available() != null ? formatMoney(available()!) : "—", { label: ink.figure, value: ink.strong, bold: true })]
    if (p.pendingCount > 0 && available() != null) lines.push(row("Balance", `${formatWholeMoney(-p.pendingAmount)} pending · ${p.pendingCount}`, formatMoney(available()! - p.pendingAmount), { value: ink.label }))
    if (!rangePane()) lines.push(row("Runway", p.dailySpend != null ? `${formatWholeMoney(p.dailySpend)}/day` : "", p.runwayDays != null ? `${Math.round(p.runwayDays)} days` : "—"))
    if (!hasSavers()) {
      lines.push(row("30 day change", signedWholeMoney(change30()), "", { mid: changeColor(change30()) }))
      return lines
    }
    lines.push([])
    if (saversFull()) {
      lines.push(row("Savers", "30 days", "", { label: ink.heading, mid: ink.label, bold: true }))
      for (const saver of p.savers) lines.push(row(`  ${saver.name}`, signedWholeMoney(saverChange(saver.accountId)), formatWholeMoney(saver.balance), { mid: changeColor(saverChange(saver.accountId)), value: ink.label }))
      lines.push(row("  Total", signedWholeMoney(saversTotalChange()), formatWholeMoney(p.saversTotal), { mid: changeColor(saversTotalChange()) }))
    } else {
      lines.push(row("Savers", signedWholeMoney(saversTotalChange()), formatWholeMoney(p.saversTotal), { mid: changeColor(saversTotalChange()) }))
    }
    lines.push([])
    lines.push(row("Net position", signedWholeMoney(change30()), p.netPosition != null ? formatMoney(p.netPosition) : "—", { label: ink.figure, mid: changeColor(change30()), value: ink.strong, bold: true }))
    return lines.map((l) => (l.length ? l : [{ text: " ", fg: ink.note }]))
  })
  // Unfocused, the lines that fit (every group, then the largest
  // subcategories). Focused, every line, scrolled to keep the cursor in view,
  // with the cursor's row highlighted (enter opens it in Transactions).
  const categoriesFocused = () => props.focused === "ov.categories"
  // Spending in the range still to categorise (Go app's "Uncat N").
  // Spending and money in alike wait for a category.
  const uncategorised = createMemo(() => inPeriod().filter((t) => isUncategorised(t) && (isSpending(t) || isUnsortedIn(t))).length)
  /** Suggestions waiting, any period, as i will show them: in the
   * Transactions account selection. */
  const toReview = createMemo(() => data.accountScoped().filter((t) => data.state.suggestions[t.id]).length)
  // The Range pane's chevron: a group's open or closed (none without
  // subcategories); a subcategory's indent.
  const chevron = (line: { categoryId: number | null; child: boolean }) => {
    if (line.child) return "   "
    const g = groups().find((x) => x.categoryId === line.categoryId)
    return !g?.children.length || line.categoryId == null ? "   " : ui.state.overviewOpen.includes(line.categoryId) ? " ▾ " : " ▸ "
  }
  const categoryRows = createMemo(() => {
    const rows = Math.max(1, categoriesHeight() - 2 - rangeTop())
    // The Range pane: its groups closed until space opens them, as Budgets'.
    const open = openGroups(data.state.uiPrefs, ui.state)
    if (!categoriesFocused()) return (open ? overviewCategoryLines(range(), open).slice(0, rows) : fitCategoryLines(groups(), rows)).map((line) => ({ line, cursor: false }))
    const lines = overviewCategoryLines(range(), open)
    const cursor = Math.min(ui.state.overviewCategoryCursor, lines.length - 1)
    const top = centredTop(cursor, lines.length, rows)
    return lines.slice(top, top + rows).map((line, i) => ({ line, cursor: top + i === cursor }))
  })
  const categoriesCard = () => (
    <box ref={regionRef("ov.categories", "overview")} width={categoryWidth()} height={categoriesHeight()} flexShrink={0} onMouseDown={panePointer("ov.categories")}
      onMouseScroll={onPointer((s) => s === "bar" || s === "overview" || s === "overview.range", (event) => {
        if (event.scroll?.direction !== "up" && event.scroll?.direction !== "down") return
        ui.applyJump("ov.categories")
        moveOverviewCategory(ui, data, ui.state.overviewCategoryCursor + (event.scroll.direction === "down" ? 1 : -1) * event.scroll.delta)
      })}>
    <SectionCard title={rangePane() ? "Range" : "Categories"} titleSuffix={categoriesFocused() ? "· enter to open" : undefined} titleSuffixColor={ink.note} bottomSpans={uncategorised() || toReview() ? [
        ...(uncategorised() ? [{ text: `${uncategorised()} uncategorised`, fg: tone.caution }] : []),
        ...(toReview() ? [{ text: `${uncategorised() ? " · " : ""}${toReview()} to review (i)`, fg: tone.ai }] : []),
      ] : undefined} width={categoryWidth()} height={categoriesHeight()} focused={categoriesFocused()} active={categoriesFocused()}>
      <Index each={rangeLines()}>{(spans) => (
        <text wrapMode="none" flexShrink={0}><S>{" "}</S><Index each={spans()}>{(span) => <S fg={span().fg} bg={span().bg} bold={span().bold}>{span().text}</S>}</Index></text>
      )}</Index>
      <Show when={groups().length} fallback={<text fg={ink.note}>No spending in this period</text>}>
        {/* Index: a new range or cursor move updates rows in place. */}
        <Index each={categoryRows()}>
          {(row) => {
            const line = () => row().line
            const cursor = () => row().cursor
            const bg = () => cursor() ? theme.rowCursor : undefined
            return (
              <text wrapMode="none" bg={bg()} onMouseDown={onPointer((s) => s === "bar" || s === "overview" || s === "overview.range", () => {
                const lines = overviewCategoryLines(range(), openGroups(data.state.uiPrefs, ui.state))
                const index = lines.findIndex((l) => l.categoryId === line().categoryId && l.child === line().child)
                const open = categoriesFocused() && index === ui.state.overviewCategoryCursor
                ui.applyJump("ov.categories")
                moveOverviewCategory(ui, data, index)
                if (open) drillDown(ui, data, lines[index])
              })}>
                <Show when={rangePane()}><S fg={ink.note} bg={bg()}>{chevron(line())}</S></Show>
                <S fg={line().color} bg={bg()}>{line().child ? "  " : ""}{`${categoryMark(line().categoryId)} `}</S>
                <S fg={line().child && !cursor() ? ink.label : line().color} bg={bg()} bold={!line().child || cursor()}>{fit(line().label, -(line().child ? 4 : 2) - (rangePane() ? 3 : 0) + categoryNameWidth())}</S>
                <S fg={line().child ? ink.label : ink.figure} bg={bg()} bold={!line().child}>{formatWholeMoney(line().amount).padStart(9)}</S>
                <S fg={ink.note} bg={bg()}>{(line().pct != null ? `${Math.round(line().pct!)}%` : "").padStart(5)}</S>
                <Show when={rangePane()}><S fg={beforeChange(line()).fg} bg={bg()}>{beforeChange(line()).text}</S></Show>
              </text>
            )
          }}
        </Index>
      </Show>
    </SectionCard>
    </box>
  )

  // A component, not a function call in JSX: its card stays mounted while
  // the view changes (a remounted card has no measured width for a frame or
  // two, so its border picker and legend would blink out).
  // "first launch": once a launch, the charts draw in when first seen with
  // something to draw: as the data lands, or as the setup closes over
  // them, and not before the top chart has marks (a new user's first view
  // can be an empty Cycle: the draw-in would play on nothing). Latched:
  // the key fires once, and once its draw-in is over no view draws in
  // again this launch (a view mounted later, the Calendar or Savers, would
  // otherwise start its own each time it's switched to).
  const launchReveal = takeLaunchReveal()
  const [launchOver, setLaunchOver] = createSignal(!launchReveal)
  const revealMs = () => (launchOver() ? 0 : chartSpeedMs(data.state.uiPrefs.chartSpeed))
  // "always": again each time the tab comes into view (motion.showings),
  // and each time the Date Range changes under a view drawn from it.
  const seen = showings(() => shown() && !ui.state.welcome)
  const drawable = () => {
    const top = CHART_VIEWS[ui.state.chartViews[0]]?.view
    return (top != null && TABLE_VIEWS.has(top)) || hasMarks(topModel()?.rows ?? [])
  }
  const revealKey = createMemo<string | undefined>((was) => was ?? (data.state.ready && !ui.state.welcome && drawable() ? "launch" : undefined))
  createEffect(on(revealKey, (key) => {
    if (!key || launchOver()) return
    // The draw-in's clock starts on its first tick: a little over its length.
    const timer = setTimeout(() => setLaunchOver(true), revealMs() + 500)
    onCleanup(() => clearTimeout(timer))
  }))
  const ChartPane = (p: { pane: number; height: number }) => {
    const index = () => ui.state.chartViews[p.pane]!
    const view = () => CHART_VIEWS[index()] ?? CHART_VIEWS[0]
    const chart = () => models[p.pane]!()
    const section = CHART_SECTIONS[p.pane]!
    return (
      <box ref={regionRef(section, "overview")} width={paneWidth(p.pane)} height={p.height} flexShrink={0} onMouseDown={panePointer(section)}>
      <OverviewChartCard
        index={index()}
        model={chart()}
        calendar={calendar()}
        trends={trends()}
        merchants={merchants()}
        today={today()}
        width={paneWidth(p.pane)}
        height={p.height}
        focused={props.focused === section}
        baseline={baseline()}
        revealKey={data.state.uiPrefs.chartMotion === "off" ? undefined : data.state.uiPrefs.chartMotion === "always" ? (revealKey() ? `${view().view}:${view().ranged ? `${range().bounds.start}:${range().bounds.end}` : ""}:${seen()}` : undefined) : revealKey()}
        revealMs={data.state.uiPrefs.chartMotion === "always" ? chartSpeedMs(data.state.uiPrefs.chartSpeed) : revealMs()}
        curve={data.state.uiPrefs.chartCurve}
        labels={data.state.uiPrefs.chartLabels}
      />
      </box>
    )
  }

  // Approved narrow-layout deviation from the Go layout: the cards stack
  // in two columns under one chart, and a short terminal scrolls instead
  // of clipping them. Keys and focus order are unchanged.
  const NarrowColumn = () => {
    let column: ScrollBoxRenderable | undefined
    // Only a short terminal scrolls: Categories into view when it has focus,
    // else back to the top (the chart).
    const followFocus = () => {
      if (!shown()) return
      if (categoriesFocused()) column?.scrollChildIntoView("overview-narrow-cards")
      else column?.scrollTo(0)
    }
    createEffect(followFocus)
    onCleanup(() => { column = undefined })
    // Layout reaches the scrollbox before its children, so follow focus
    // when the cards row has its new place (a resize or a remount).
    return <scrollbox ref={(box: ScrollBoxRenderable) => { column = box }} width="100%" height={bodyHeight()} scrollY scrollX={false} focusable={false}
      verticalScrollbarOptions={{ visible: false }} contentOptions={{ flexDirection: "column" }}>
      <box id="overview-narrow-chart" width="100%" height={topChartHeight()} flexShrink={0}>
        <ChartPane pane={0} height={topChartHeight()} />
      </box>
      <box id="overview-narrow-cards" ref={(row: BoxRenderable) => { row.onSizeChange = followFocus }} width="100%" height={categoriesHeight()} flexDirection="row" gap={1} flexShrink={0}>
        <box width={sideWidth()} flexDirection="column">
          {accountsCard()}
          <Show when={!rangePane()}>{totalsCard()}</Show>
        </box>
        {categoriesCard()}
      </box>
    </scrollbox>
  }

  return (
    <box width="100%" height="100%" flexDirection="column" backgroundColor={theme.canvas}>
      <box ref={regionRef("ov.range", "overview")} width={rangeCardWidth()} height={3} flexShrink={0} onMouseDown={panePointer("ov.range")}>
      <SectionCard title="Date Range" titleSuffix={`· ${scope().label}`} titleSuffixColor={ink.label} focused={dateFocused()} height={3} width={rangeCardWidth()}>
        <box flexDirection="row" justifyContent="space-between" width="100%">
          {/* Each chip its own text: a click lands on the chip OpenTUI drew
              there, with no sums of label widths to keep in step. */}
          <box flexDirection="row" flexShrink={0}>
            <Show when={chipsFit().groups}><text wrapMode="none" fg={ink.heading}><b>{`${GROUP_NAMES.lookback} `}</b></text></Show>
            <For each={LOOKBACKS}>
              {(lb, i) => <><Show when={i() > 0 && chipsFit().gap}>{gap()}</Show>{chipText(lb, i(), () => ui.state.timeframe.family === "lookback" && ui.state.timeframe.lookback === lb)}</>}
            </For>
            <text wrapMode="none" fg={ink.rule}>{chipsFit().separator}</text>
            <Show when={chipsFit().groups}><text wrapMode="none" fg={ink.heading}><b>{`${GROUP_NAMES.period} `}</b></text></Show>
            <For each={PERIODS}>
              {(p, i) => <><Show when={i() > 0 && chipsFit().gap}>{gap()}</Show>{chipText(chipsFit().label(p), LOOKBACKS.length + i(), () => ui.state.timeframe.family === "period" && ui.state.timeframe.period === p)}</>}
            </For>
            <text wrapMode="none" fg={ink.rule}>{chipsFit().separator}</text>
            {chipText("Custom", CUSTOM_CHIP, () => ui.state.timeframe.family === "custom")}
          </box>
          {/* The dates, between the [ and ] that step them (a click on
              one steps too), after how far back the period is. */}
          <Show when={showTimeframe()}>
            <box flexDirection="row" flexShrink={0}>
              <Show when={offsetText()}>
                <text wrapMode="none">
                  <S fg={ink.note}>{`${offsetText()} · `}</S>
                  <S fg={tone.key} bold>{"0"}</S>
                  <S fg={ink.note}>{" now   "}</S>
                </text>
              </Show>
              <text wrapMode="none" onMouseDown={stepPointer(-1)}><S fg={tone.key} bold>{"["}</S></text>
              <text wrapMode="none" fg={tone.scope}>{` ${bounds().label} `}</text>
              <text wrapMode="none" onMouseDown={stepPointer(1)}><S fg={tone.key} bold>{"]"}</S></text>
            </box>
          </Show>
        </box>
      </SectionCard>
      </box>
      <Show
        when={wide()}
        fallback={<NarrowColumn />}
      >
        <box flexDirection="row" gap={1} width="100%" height={bodyHeight()}>
          <box flexDirection="row" gap={1} width={mainWidth()} height={bodyHeight()} flexShrink={0}>
            <box flexDirection="column" gap={1} justifyContent="space-between" width={paneWidth(0)} height={bodyHeight()}>
              <ChartPane pane={0} height={topChartHeight()} />
              <ChartPane pane={1} height={bottomChartHeight()} />
            </box>
            <Show when={grid()}>
              <box flexDirection="column" gap={1} justifyContent="space-between" width={paneWidth(2)} height={bodyHeight()}>
                <ChartPane pane={2} height={topChartHeight()} />
                <ChartPane pane={3} height={bottomChartHeight()} />
              </box>
            </Show>
          </box>
          <box flexDirection="column" flexGrow={1} flexBasis={0} minWidth={0} height={bodyHeight()} overflow="hidden">
            {accountsCard()}
            <Show when={!rangePane()}>{totalsCard()}</Show>
            {categoriesCard()}
          </box>
        </box>
      </Show>
      <Show when={ui.state.customEdit}>
        {(edit: () => NonNullable<typeof ui.state.customEdit>) => <CustomRangeDialog edit={edit()} />}
      </Show>
    </box>
  )
}

const PERIOD_UNIT: Record<string, string> = { cycle: "cycle", month: "month", qtr: "quarter", half: "half", fy: "FY", year: "year" }


/** What the Overview's chart pane draws from: the range's daily series and
 * rows, the accounts and the scope. Read lazily (getters): a view reads
 * only what it draws. The Overview's own; the setup's tour builds one
 * from demo rows (ui/welcome/Demos). */
export interface OverviewChartInput {
  series: { dates: string[]; values: number[] }
  today: string
  spending: Transaction[]
  budget?: number
  names: PeriodNames
  weekStart: WeekStart
  accounts: Account[]
  transactions: Transaction[]
  scopeIds: ReadonlySet<number>
  zeroAxis: boolean
  projection: ReadonlyArray<{ dateISO: string; value: number }>
}

/** A chart pane's plot rows: its height less the border (2), the x labels
 * and the x-axis line when it's drawn. */
export const chartRows = (height: number, baseline: boolean) => Math.max(1, height - (baseline ? 4 : 3))

/** Views drawn in place of a chart: the Calendar and the tables. */
export const TABLE_VIEWS: ReadonlySet<string> = new Set(["Calendar", "Merchants", "Trends"])

/** The model for `view` (null for the Calendar and the tables, which aren't
 * charts), `width` inside the card. The y-axis is as wide as its labels:
 * built once with `guess` as its width, again if the labels need another. */
export function overviewChartModel(view: string, input: OverviewChartInput, width: number, rows: number, guess = AXIS_GUESS): ChartModel | null {
  const build = (axis: number): ChartModel | null => {
    const w = Math.max(1, width - axis - CHART_RIGHT_PAD)
    if (view === "Daily" || view === "Cumulative" || view === "Weekly") return spendingChart(view, input.series, w, rows, input.today, input.spending, input.budget, input.names, input.weekStart)
    if (view === "Cash flow") return cashFlowChart(input.series.dates, w, rows, input.today, input.accounts, input.transactions, input.scopeIds, input.weekStart)
    if (TABLE_VIEWS.has(view)) return null
    return balancesChart(view as "Net position" | "Available" | "Savers", input.series.dates, w, rows, input.today, input.accounts, input.transactions, input.weekStart, input.zeroAxis, view === "Available" ? input.projection : [])
  }
  const first = build(guess)
  if (!first || first.ticks.size === 0) return first
  const axis = axisWidth(first.ticks)
  return axis === guess ? first : build(axis)
}

/** The Overview's chart pane: view `index` of CHART_VIEWS, titled by its
 * group, the views in its border; the Calendar and the tables drawn in
 * place of a chart. The Overview's two, and the tour's. */
export function OverviewChartCard(props: {
  index: number
  /** The views its picker offers (indexes into CHART_VIEWS): all of them
   * unless given (the Budgets tab's cycle panes: CYCLE_VIEWS). */
  views?: readonly number[]
  model: ChartModel | null
  calendar: Array<Array<CalendarDay | null>>
  trends: { groups: TrendGroup[]; rows: TrendRow[] }
  merchants: MerchantRow[]
  today: string
  width: number
  height: number
  focused?: boolean
  baseline?: boolean
  revealKey?: string
  revealMs?: number
  /** The draw-in's curve (CHART_CURVES). */
  curve?: string
  labels?: ChartLabelMode
}) {
  const view = () => CHART_VIEWS[props.index] ?? CHART_VIEWS[0]
  // The Calendar and the tables aren't charts (ChartBody draws those in):
  // their own draw-in, on the same key.
  const fallback = () => TABLE_VIEWS.has(view().view)
  const progress = useReveal(() => (fallback() ? props.revealKey : undefined), () => props.revealMs ?? 0, () => props.curve)
  // The days in date order, once per calendar, not per frame of the draw-in.
  const days = createMemo(() => props.calendar.flat().flatMap((d) => (d ? [d.dateISO] : [])).sort())
  const through = () => {
    if (progress() >= 1) return undefined
    return days()[Math.ceil(progress() * days().length) - 1] ?? ""
  }
  return (
    <ChartCard
      views={props.views ? props.views.map((i) => CHART_VIEWS[i]!) : CHART_VIEWS}
      current={props.views ? Math.max(0, props.views.indexOf(props.index)) : props.index}
      model={props.model}
      legend={view().view === "Trends" ? trendsLegend(props.trends.groups) : view().view === "Merchants" ? merchantsLegend(props.merchants) : calendarLegend(props.calendar, props.today)}
      fallback={view().view === "Trends" ? <TrendsView groups={props.trends.groups} rows={props.trends.rows} width={props.width - 4} height={props.height - 2} progress={progress()} />
        : view().view === "Merchants" ? <MerchantsView rows={props.merchants} width={props.width - 4} height={props.height - 2} progress={progress()} />
        : <CalendarView weeks={props.calendar} width={props.width - 4} rows={props.height - 2} today={props.today} through={through()} />}
      width={props.width}
      height={props.height}
      focused={props.focused}
      baseline={props.baseline}
      revealKey={props.revealKey}
      revealMs={props.revealMs}
      curve={props.curve}
      labels={props.labels}
    />
  )
}


