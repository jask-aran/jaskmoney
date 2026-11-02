import { regionRef } from "../regions"
import { onPointer } from "../../app/pointer"
import { drillDown, handleOverviewRange, moveOverviewCategory } from "../../app/keys"
import { keyEvent } from "../../app/keyEvent"
import { For, Index, Show, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js"
import { hasMarks } from "../charts/reveal"
import type { BoxRenderable, ScrollBoxRenderable } from "@opentui/core"
import { categoryMark } from "../icons"
import { useTerminalDimensions } from "@opentui/solid"
import { SectionCard } from "../primitives/SectionCard"
import { Modal } from "../primitives/Modal"
import { TextInput } from "../primitives/TextInput"
import { chipLook } from "../primitives/chip"
import { centredTop } from "../primitives/ListRow"
import { changeColor, spendChangeColor } from "../colors"
import type { Span } from "../primitives/spans"
import { S } from "../primitives/S"
import { CHART_VIEWS, ui, type SectionId } from "../../state/uiStore"
import { data } from "../../state/dataStore"
import { categoryColor, ink, theme, tone } from "../../theme"
import { dailySpendSeries, fitCategoryLines, formatMoney, formatPct, formatWholeMoney, signedWholeMoney } from "../../domain/dashboard"
import { computePeriodFlows, computePosition, historyCovers, projectAvailable, usualDailySpend } from "../../domain/position"
import { allocation, budgetProgress, cycleFor, cycleSpending, progressOf, type BudgetProgress } from "../../domain/budget"
import { spendingCalendar, type CalendarDay } from "../../domain/spending"
import { accountRole, type Account, type Transaction } from "../../domain/types"
import { addDays, appNow, appToday, daysBetween, type WeekStart } from "../../domain/days"
import { isSpending, isUncategorised, isUnsortedIn } from "../../domain/moneyRules"
import { chipLayout } from "./rangeChips"
import { CUSTOM_CHIP, LOOKBACKS, PERIODS, comparisonWindows, filterByTimeframe, offsetLabel, periodOffset } from "../../domain/timeframe"
import { count, fit, shortDate, shortMoney, truncate } from "../text"
import { StyledLine, type StyledSpan } from "../primitives/StyledLine"
import { monthlyTotal, subscriptions, upcomingCharges, type Subscription } from "../../domain/subscriptions"
import { allCategoryLines, overviewRange } from "../../state/overviewRange"
import { AXIS_GUESS, CHART_RIGHT_PAD, axisWidth, type ChartModel } from "../charts/ChartBody"
import { ChartCard } from "../charts/ChartCard"
import { chartSpeedMs, showings, takeLaunchReveal, useReveal, type ChartLabelMode } from "../charts/motion"
import { balancesChart, cashFlowChart, spendingChart, type PeriodNames } from "./periodCharts"
import { UP_LOGO_WIDTH } from "../primitives/UpLogo"
import { CalendarView, calendarLegend } from "./CalendarView"


/** At or above this width the cards take a right-hand column beside the
 * two charts; below it one chart spans the tab with the cards under it. */
export const WIDE = 90
/** The categories column's widest useful size: Up's longest names fit. */
const SIDE_MAX = 48
/** The side stack's narrowest: Accounts' and Totals' labels still fit. */
const SIDE_MIN = 40
/** Narrow: the chart's fewest rows before the column scrolls. */
const NARROW_CHART_MIN = 10
/** Stack columns: value and note widths; the label takes the rest. */
const VALUE = 11
const NOTE = 12
/** Savers fold to their subtotal before Categories drop under this many rows. */
const MIN_CATEGORIES = 8

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
  const range = createMemo(() => overviewRange({ state: data.state, transactions, cycle: cycleConfig }, ui.state))
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
  // Built only while a pane shows it.
  const calendarShown = () => ui.state.chartViews.some((i) => CHART_VIEWS[i]?.view === "Calendar")
  const calendar = createMemo(() => (calendarShown() ? spendingCalendar(inPeriod(), bounds().start, bounds().end, data.state.weekStart) : []))
  const inScope = (rows: Transaction[]) => {
    const ids = scopeIds()
    return rows.filter((t) => t.accountId != null && ids.has(t.accountId))
  }
  // Regular payments now, from the scope's whole history (no range).
  // Built only while a pane shows it.
  const subsShown = () => ui.state.chartViews.some((i) => CHART_VIEWS[i]?.view === "Subscriptions")
  const subs = createMemo(() => subsShown() ? subscriptions(inScope(transactions()), today()) : [])
  const series = createMemo(() => dailySpendSeries(inPeriod(), bounds().start, bounds().end))
  // The next payday: the day after the current cycle ends.
  const payday = () => addDays(cycleFor(cycleConfig(), today()).end, 1)
  const dueBeforePayday = () => upcomingCharges(subs(), today(), addDays(payday(), -1)).reduce((sum, c) => sum + c.amount, 0)

  // Accounts: point-in-time figures, whatever the range.
  const position = createMemo(() => computePosition(data.state.accounts, transactions(), today()))
  const saverChanges = createMemo(() => {
    const now = today(), since = addDays(now, -30)
    return computePeriodFlows(data.state.accounts, transactions().filter((t) => t.dateISO > since && t.dateISO <= now)).saverChanges
  })
  // Where Available is headed, up to the day before the next payday (or
  // the range's end): built only while a pane shows Available.
  const availableShown = () => ui.state.chartViews.some((i) => CHART_VIEWS[i]?.view === "Available")
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
  const bodyHeight = () => Math.max(8, dims().height - 7)
  const sideWidth = () => (wide() ? Math.max(SIDE_MIN, Math.min(SIDE_MAX, Math.floor((dims().width - 1) * 0.4))) : Math.floor((dims().width - 1) / 2))
  const mainWidth = () => (wide() ? dims().width - 1 - sideWidth() : dims().width)
  // The keys act on the charts on screen: with one, the bottom chart's keys
  // and focus move to it.
  createEffect(() => {
    const charts = wide() ? 2 : 1
    if (ui.state.overviewCharts !== charts) ui.setState({ overviewCharts: charts })
    if (charts === 1 && ui.state.focusedSection === "ov.chart2") ui.applyJump("ov.chart")
  })

  // The stacks: label, value (VALUE) and a note or comparison (NOTE).
  // Accounts: available, the balance with what's pending, runway and the
  // 30 day change; then, with savers, a heading, each saver and their
  // subtotal (folded: the subtotal alone), and the net position.
  const hasSavers = () => position().savers.length > 0
  const saverRows = (full: boolean) => (!hasSavers() ? 0 : full ? 2 + position().savers.length : 1) + (hasSavers() ? 1 : 0)
  const accountRows = (full: boolean) => 3 + (position().pendingCount > 0 ? 1 : 0) + saverRows(full)
  // Column headings sit in the top border, so no row of their own.
  const totalsRows = () => 7 + (budget() ? (budget()!.remaining > 0 ? 2 : 1) : 0)
  // Narrow: the stack beside Categories, and so the height of both.
  const lowerHeight = (full: boolean) => accountRows(full) + 2 + totalsRows() + 2
  // Savers fold to their total when Categories (wide) or the chart (narrow)
  // would get too small.
  const saversFull = () =>
    wide()
      ? bodyHeight() - lowerHeight(true) >= MIN_CATEGORIES + 2
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
  const axisWas: [number, number] = [AXIS_GUESS, AXIS_GUESS]
  // What the charts draw from, read lazily: a view reads only its own.
  const chartInput: OverviewChartInput = {
    get series() { return series() }, get today() { return today() }, get spending() { return spending() },
    get budget() { return budget()?.budget.amount }, get names() { return periodNames() }, get weekStart() { return data.state.weekStart },
    get accounts() { return data.state.accounts }, get transactions() { return transactions() }, get scopeIds() { return scopeIds() },
    get zeroAxis() { return data.state.uiPrefs.zeroAxis === true }, get projection() { return projection() },
  }
  const model = (slot: 0 | 1, index: number, height: number): ChartModel | null => {
    const m = overviewChartModel((CHART_VIEWS[index] ?? CHART_VIEWS[0]).view, chartInput, mainWidth() - 4, chartRows(height, baseline()), axisWas[slot])
    if (m && m.ticks.size) axisWas[slot] = axisWidth(m.ticks)
    return m
  }
  // Each chart follows its own view: switching one leaves the other alone.
  const topView = createMemo(() => ui.state.chartViews[0])
  const bottomView = createMemo(() => ui.state.chartViews[1])
  const topModel = createMemo(() => model(0, topView(), topChartHeight()))
  const bottomModel = createMemo(() => (wide() ? model(1, bottomView(), bottomChartHeight()) : null))

  // Category lines: name, then amount (9) and share (5).
  const categoryWidth = () => (wide() ? sideWidth() : dims().width - 1 - sideWidth())
  const categoryNameWidth = () => Math.max(8, categoryWidth() - 5 - 14)

  // The dates on the right: arrows when [ ] can step them, and how far the
  // range is from the current period (with 0 to come back).
  const steppable = () => ui.state.timeframe.family !== "lookback"
  const offsetText = createMemo(() => offsetLabel(ui.state.timeframe.period, periodOffset(ui.state.timeframe, appNow(), cycleConfig())))
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
  const pendingNote = () => `${formatWholeMoney(-position().pendingAmount)} · ${position().pendingCount} txn`
  const saverChange = (accountId: number) => saverChanges().find((c) => c.accountId === accountId)?.change ?? 0
  const saversTotalChange = () => saverChanges().reduce((sum, c) => sum + c.change, 0)
  const panePointer = (id: SectionId) => onPointer((s) => s === "bar" || s === "overview" || s === "overview.range", () => ui.applyJump(id))
  const accountsCard = () => (
    <box ref={regionRef("ov.accounts", "overview")} width={sideWidth()} height={accountRows(saversFull()) + 2} flexShrink={0} onMouseDown={panePointer("ov.accounts")}>
    <SectionCard title="Accounts" focused={props.focused === "ov.accounts"} active={props.focused === "ov.accounts"} width={sideWidth()} height={accountRows(saversFull()) + 2}>
      {stat("Available", available() != null ? formatMoney(available()!) : "—", "", { label: ink.figure, value: ink.strong, bold: true })}
      <Show when={position().pendingCount > 0 && available() != null}>
        {stat("Balance", formatMoney(available()! - position().pendingAmount), pendingNote(), { value: ink.label })}
      </Show>
      {stat("Runway", position().runwayDays != null ? `${Math.round(position().runwayDays!)} days` : "—", position().dailySpend != null ? `${formatWholeMoney(position().dailySpend!)}/day` : "")}
      {stat("30 day change", signedWholeMoney(change30()), "", { value: changeColor(change30()) })}
      <Show when={hasSavers()}>
        <Show
          when={saversFull()}
          fallback={stat("Savers", formatWholeMoney(position().saversTotal), signedWholeMoney(saversTotalChange()), { note: changeColor(saversTotalChange()) })}
        >
          {stat("Savers", "", "30 days", { label: ink.heading, note: ink.label, bold: true })}
          <For each={position().savers}>
            {(saver) => stat(`  ${saver.name}`, formatWholeMoney(saver.balance), signedWholeMoney(saverChange(saver.accountId)), { value: ink.label, note: changeColor(saverChange(saver.accountId)) })}
          </For>
          {stat("  Total", formatWholeMoney(position().saversTotal), signedWholeMoney(saversTotalChange()), { note: changeColor(saversTotalChange()) })}
        </Show>
        {stat("Net position", position().netPosition != null ? formatMoney(position().netPosition!) : "—", "", { label: ink.figure, value: ink.strong, bold: true })}
      </Show>
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
  const categoryRows = createMemo(() => {
    const rows = categoriesHeight() - 2
    if (!categoriesFocused()) return fitCategoryLines(groups(), rows).map((line) => ({ line, cursor: false }))
    const lines = allCategoryLines(range())
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
    <SectionCard title="Categories" titleSuffix={categoriesFocused() ? "· enter to open" : undefined} titleSuffixColor={ink.note} bottomSpans={uncategorised() || toReview() ? [
        ...(uncategorised() ? [{ text: `${uncategorised()} uncategorised`, fg: tone.caution }] : []),
        ...(toReview() ? [{ text: `${uncategorised() ? " · " : ""}${toReview()} to review (i)`, fg: tone.ai }] : []),
      ] : undefined} width={categoryWidth()} height={categoriesHeight()} focused={categoriesFocused()} active={categoriesFocused()}>
      <Show when={groups().length} fallback={<text fg={ink.note}>No spending in this period</text>}>
        {/* Index: a new range or cursor move updates rows in place. */}
        <Index each={categoryRows()}>
          {(row) => {
            const line = () => row().line
            const cursor = () => row().cursor
            const bg = () => cursor() ? theme.rowCursor : undefined
            return (
              <text wrapMode="none" bg={bg()} onMouseDown={onPointer((s) => s === "bar" || s === "overview" || s === "overview.range", () => {
                const lines = allCategoryLines(range())
                const index = lines.findIndex((l) => l.categoryId === line().categoryId && l.child === line().child)
                const open = categoriesFocused() && index === ui.state.overviewCategoryCursor
                ui.applyJump("ov.categories")
                moveOverviewCategory(ui, data, index)
                if (open) drillDown(ui, data, lines[index])
              })}>
                <S fg={line().color} bg={bg()}>{line().child ? "  " : ""}{`${categoryMark(line().categoryId)} `}</S>
                <S fg={line().child && !cursor() ? ink.label : line().color} bg={bg()} bold={!line().child || cursor()}>{fit(line().label, -(line().child ? 4 : 2) + categoryNameWidth())}</S>
                <S fg={line().child ? ink.label : ink.figure} bg={bg()} bold={!line().child}>{formatWholeMoney(line().amount).padStart(9)}</S>
                <S fg={ink.note} bg={bg()}>{(line().pct != null ? `${Math.round(line().pct!)}%` : "").padStart(5)}</S>
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
  // "always": again each time the tab comes into view (motion.showings).
  const seen = showings(() => shown() && !ui.state.welcome)
  const drawable = () => {
    const top = CHART_VIEWS[ui.state.chartViews[0]]?.view
    return top === "Calendar" || top === "Subscriptions" || hasMarks(topModel()?.rows ?? [])
  }
  const revealKey = createMemo<string | undefined>((was) => was ?? (data.state.ready && !ui.state.welcome && drawable() ? "launch" : undefined))
  createEffect(on(revealKey, (key) => {
    if (!key || launchOver()) return
    // The draw-in's clock starts on its first tick: a little over its length.
    const timer = setTimeout(() => setLaunchOver(true), revealMs() + 500)
    onCleanup(() => clearTimeout(timer))
  }))
  const ChartPane = (p: { pane: 0 | 1; height: number }) => {
    const index = () => ui.state.chartViews[p.pane]
    const view = () => CHART_VIEWS[index()] ?? CHART_VIEWS[0]
    const chart = () => (p.pane === 0 ? topModel() : bottomModel())
    return (
      <box ref={regionRef(p.pane === 0 ? "ov.chart" : "ov.chart2", "overview")} width={mainWidth()} height={p.height} flexShrink={0} onMouseDown={panePointer(p.pane === 0 ? "ov.chart" : "ov.chart2")}>
      <OverviewChartCard
        index={index()}
        model={chart()}
        calendar={calendar()}
        subs={subs()}
        today={today()}
        payday={payday()}
        dueBeforePayday={dueBeforePayday()}
        width={mainWidth()}
        height={p.height}
        focused={props.focused === (p.pane === 0 ? "ov.chart" : "ov.chart2")}
        baseline={baseline()}
        revealKey={data.state.uiPrefs.chartMotion === "off" ? undefined : data.state.uiPrefs.chartMotion === "always" ? (revealKey() ? `${view().view}:${seen()}` : undefined) : revealKey()}
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
          {totalsCard()}
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
            <For each={LOOKBACKS}>
              {(lb, i) => <><Show when={i() > 0 && chipsFit().gap}>{gap()}</Show>{chipText(lb, i(), () => ui.state.timeframe.family === "lookback" && ui.state.timeframe.lookback === lb)}</>}
            </For>
            <text wrapMode="none" fg={ink.rule}>{chipsFit().separator}</text>
            <For each={PERIODS}>
              {(p, i) => <><Show when={i() > 0 && chipsFit().gap}>{gap()}</Show>{chipText(chipsFit().label(p), LOOKBACKS.length + i(), () => ui.state.timeframe.family === "period" && ui.state.timeframe.period === p)}</>}
            </For>
            <text wrapMode="none" fg={ink.rule}>{chipsFit().separator}</text>
            {chipText("Custom", CUSTOM_CHIP, () => ui.state.timeframe.family === "custom")}
          </box>
          <Show when={showTimeframe()}>
            <text flexShrink={0} wrapMode="none">
              <Show when={offsetText()}>
                <S fg={ink.note}>{`${offsetText()} · `}</S>
                <S fg={tone.key} bold>{"0"}</S>
                <S fg={ink.note}>{" now   "}</S>
              </Show>
              <S fg={steppable() ? ink.note : theme.canvas}>{"‹ "}</S>
              <S fg={tone.scope}>{bounds().label}</S>
              <S fg={steppable() ? ink.note : theme.canvas}>{" ›"}</S>
            </text>
          </Show>
        </box>
      </SectionCard>
      </box>
      <Show
        when={wide()}
        fallback={<NarrowColumn />}
      >
        <box flexDirection="row" gap={1} width="100%" height={bodyHeight()}>
          <box flexDirection="column" gap={1} justifyContent="space-between" width={mainWidth()} height={bodyHeight()}>
            <ChartPane pane={0} height={topChartHeight()} />
            <ChartPane pane={1} height={bottomChartHeight()} />
          </box>
          <box flexDirection="column" flexGrow={1} flexBasis={0} minWidth={0} height={bodyHeight()} overflow="hidden">
            {accountsCard()}
            {totalsCard()}
            {categoriesCard()}
          </box>
        </box>
      </Show>
      <Show when={ui.state.customEdit}>
        {(edit: () => NonNullable<typeof ui.state.customEdit>) => (
          <Modal title="Custom range" width={40} hints="tab field · enter apply · esc cancel">
            <text wrapMode="none">
              <S fg={edit().field === 0 ? ink.figure : ink.label} bold={edit().field === 0}>{"Start  "}</S>
              <TextInput field={edit().start} focused={edit().field === 0} />
            </text>
            <text wrapMode="none">
              <S fg={edit().field === 1 ? ink.figure : ink.label} bold={edit().field === 1}>{"End    "}</S>
              <TextInput field={edit().end} focused={edit().field === 1} />
            </text>
            <text fg={edit().error ? tone.bad : ink.note} wrapMode="none">{edit().error || "18, 18/11 or 18/11/2025 · both days included"}</text>
          </Modal>
        )}
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

/** The model for `view` (null for Calendar and Subscriptions, which aren't
 * charts), `width` inside the card. The y-axis is as wide as its labels:
 * built once with `guess` as its width, again if the labels need another. */
export function overviewChartModel(view: string, input: OverviewChartInput, width: number, rows: number, guess = AXIS_GUESS): ChartModel | null {
  const build = (axis: number): ChartModel | null => {
    const w = Math.max(1, width - axis - CHART_RIGHT_PAD)
    if (view === "Daily" || view === "Cumulative" || view === "Weekly") return spendingChart(view, input.series, w, rows, input.today, input.spending, input.budget, input.names, input.weekStart)
    if (view === "Cash flow") return cashFlowChart(input.series.dates, w, rows, input.today, input.accounts, input.transactions, input.scopeIds, input.weekStart)
    if (view === "Calendar" || view === "Subscriptions") return null
    return balancesChart(view as "Net position" | "Available" | "Savers", input.series.dates, w, rows, input.today, input.accounts, input.transactions, input.weekStart, input.zeroAxis, view === "Available" ? input.projection : [])
  }
  const first = build(guess)
  if (!first || first.ticks.size === 0) return first
  const axis = axisWidth(first.ticks)
  return axis === guess ? first : build(axis)
}

/** The Overview's chart pane: view `index` of CHART_VIEWS, titled by its
 * group, the views in its border; Calendar and Subscriptions drawn in
 * place of a chart. The Overview's two, and the tour's. */
export function OverviewChartCard(props: {
  index: number
  model: ChartModel | null
  calendar: Array<Array<CalendarDay | null>>
  subs: Subscription[]
  today: string
  payday: string
  dueBeforePayday: number
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
  // Calendar and Subscriptions aren't charts (ChartBody draws those in):
  // their own draw-in, on the same key.
  const fallback = () => view().view === "Calendar" || view().view === "Subscriptions"
  const progress = useReveal(() => (fallback() ? props.revealKey : undefined), () => props.revealMs ?? 0, () => props.curve)
  // The days in date order, once per calendar, not per frame of the draw-in.
  const days = createMemo(() => props.calendar.flat().flatMap((d) => (d ? [d.dateISO] : [])).sort())
  const through = () => {
    if (progress() >= 1) return undefined
    return days()[Math.ceil(progress() * days().length) - 1] ?? ""
  }
  return (
    <ChartCard
      title={view().group}
      views={CHART_VIEWS}
      current={props.index}
      model={props.model}
      legend={view().view === "Subscriptions" ? subscriptionsLegend(props.subs, props.dueBeforePayday) : calendarLegend(props.calendar, props.today)}
      fallback={view().view === "Subscriptions"
        ? <SubscriptionsView list={props.subs} width={props.width - 4} rows={props.height - 2} today={props.today} payday={props.payday} progress={progress()} />
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

/** The Subscriptions view's legend: how many, what they cost a month and
 * a year, what's due before payday, and what changed. */
function subscriptionsLegend(list: Subscription[], dueBeforePayday: number): Span[] {
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
/** Days the strip under the table looks ahead. */
const SUB_AHEAD = 30
/** A charge this many days off (or fewer) wants a look. */
const SUB_SOON = 3

/** Regular payments, one a line: its category's mark, what, how often, the
 * latest charge, a month's worth, the next charge (soon ones in caution),
 * and a price change. Stopped ones dimmed after the rest; more than fit end
 * in "… N more". Under the table, where there's room, the next 30 days as
 * a strip: a mark on each day a payment is due, its name under it where it
 * fits, and payday. */
function SubscriptionsView(props: { list: Subscription[]; width: number; rows: number; today: string; payday: string; progress?: number }) {
  // Drawing in (progress 0–1): the rows drop in, then the strip sweeps
  // from today to the month ahead.
  const p = () => props.progress ?? 1
  const rowsIn = () => Math.ceil(Math.min(1, p() / 0.5) * shown().length)
  const stripEdge = () => Math.min(1, Math.max(0, (p() - 0.35) / 0.65)) * props.width
  const showChange = () => props.width >= 80
  const nameWidth = () => Math.max(10, props.width - 2 - SUB_COLUMNS.every - SUB_COLUMNS.charge - SUB_COLUMNS.month - SUB_COLUMNS.next - (showChange() ? SUB_COLUMNS.change : 0))
  // The strip takes a blank line and three of its own, when the table
  // leaves them.
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
  // The strip: days 0 to SUB_AHEAD spread over the width.
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
      // The full name where it fits, then shorter, then the amount alone.
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

