import { For, Index, Show, createEffect, createMemo, onCleanup } from "solid-js"
import type { BoxRenderable, ScrollBoxRenderable } from "@opentui/core"
import { categoryMark, viewMark } from "../icons"
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
import { ink, theme, tone } from "../../theme"
import { dailySpendSeries, fitCategoryLines, formatMoney, formatPct, formatWholeMoney, signedWholeMoney } from "../../domain/dashboard"
import { computePeriodFlows, computePosition } from "../../domain/position"
import { budgetProgress, cycleFor, type BudgetProgress } from "../../domain/budget"
import { spendingCalendar } from "../../domain/spending"
import { accountRole } from "../../domain/types"
import { addDays, appNow, appToday } from "../../domain/days"
import { isSpending, isUncategorised, isUnsortedIn } from "../../domain/moneyRules"
import { chipLayout } from "./rangeChips"
import { CUSTOM_CHIP, LOOKBACKS, PERIODS, comparisonWindows, filterByTimeframe, offsetLabel, periodOffset } from "../../domain/timeframe"
import { count, fit, shortDate } from "../text"
import { StyledLine, type StyledSpan } from "../primitives/StyledLine"
import { monthlyTotal, subscriptions, type Subscription } from "../../domain/subscriptions"
import { allCategoryLines, overviewRange } from "../../state/overviewRange"
import { AXIS_GUESS, ChartBody, axisWidth, type ChartModel } from "../charts/ChartBody"
import { INKS, balancesChart, cashFlowChart, spendingChart, type PeriodNames } from "./periodCharts"
import { UP_LOGO_WIDTH } from "../primitives/UpLogo"
import { CalendarView, calendarLegend } from "./CalendarView"


/** At or above this width the cards take a right-hand column beside the
 * two charts; below it one chart spans the tab with the cards under it. */
const WIDE = 90
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
  const dims = useTerminalDimensions()
  const today = () => appToday()
  const cycleConfig = () => data.cycle()
  // The range, scope and category spending, shared with the tab's keys.
  // Hidden (another tab shown, the tab kept mounted), the costly results
  // keep their last values and stop following the data; showing the tab
  // brings them up to date once.
  const shown = () => ui.state.activeTab === "overview"
  const live = <T,>(fn: () => T): (() => T) => createMemo<T | undefined>((was) => (shown() || was === undefined ? fn() : was)) as () => T
  const range = createMemo(() => overviewRange(data, ui.state))
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
  const inPrevious = createMemo(() => data.transactions().filter((t) => t.dateISO >= previous().start && t.dateISO <= previous().end))
  // Flows see every tracked account (money moved to savers), narrowed to the
  // scope for spending and income.
  const flows = live(() => computePeriodFlows(data.state.accounts, filterByTimeframe(data.transactions(), ui.state.timeframe, clock(), cycleConfig()), scopeIds()))
  const previousFlows = live(() => computePeriodFlows(data.state.accounts, inPrevious(), scopeIds()))
  const groups = () => range().groups
  const calendar = live(() => spendingCalendar(inPeriod(), bounds().start, bounds().end, data.state.weekStart))
  // Regular payments now, from the scope's whole history (no range).
  // Built only while a pane shows it.
  const subsShown = () => ui.state.chartViews.some((i) => CHART_VIEWS[i]?.view === "Subscriptions")
  const subs = live(() => subsShown() ? subscriptions(data.transactions().filter((t) => t.accountId != null && scopeIds().has(t.accountId)), today()) : [])
  const series = createMemo(() => dailySpendSeries(inPeriod(), bounds().start, bounds().end))

  // Accounts: point-in-time figures, whatever the range.
  const position = live(() => computePosition(data.state.accounts, data.transactions(), today()))
  const saverChanges = createMemo(() => {
    const since = addDays(today(), -30)
    return computePeriodFlows(data.state.accounts, data.transactions().filter((t) => t.dateISO > since && t.dateISO <= today())).saverChanges
  })
  const change30 = () => {
    const h = position().history
    return h.length >= 31 ? h[h.length - 1]!.value - h[h.length - 31]!.value : 0
  }
  // The budget for the spending in scope applies while the range is the
  // current cycle: the overall budget when the scope is every spending
  // account, else the one selected account's own budget.
  const budget = createMemo(() => {
    const ids = [...scopeIds()]
    const all = data.state.accounts.filter((a) => accountRole(a) === "spending").every((a) => scopeIds().has(a.id))
    const match = data.state.budgets.find((b) => (all ? b.scope.kind === "overall" : b.scope.kind === "account" && ids.length === 1 && b.scope.accountId === ids[0]))
    const current = cycleFor(cycleConfig(), today())
    if (!match || bounds().start !== current.start || bounds().end !== current.end) return null
    return budgetProgress([match], cycleConfig(), today(), data.state.accounts, data.state.categories, data.transactions())[0] ?? null
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
    if (charts === 1 && ui.state.focusedSection === "ov.chart2") ui.setState({ focusedSection: "ov.chart" })
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
  // Wide: the two charts split the column with a blank line between them.
  const topChartHeight = () => (wide() ? Math.ceil((bodyHeight() - 1) / 2) : Math.max(NARROW_CHART_MIN, bodyHeight() - lowerHeight(saversFull())))
  const bottomChartHeight = () => bodyHeight() - 1 - topChartHeight()
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
  const model = (slot: 0 | 1, index: number, height: number): ChartModel | null => {
    const v = (CHART_VIEWS[index] ?? CHART_VIEWS[0]).view
    // Border (2), the x-axis line (a setting) and the x labels.
    const rows = Math.max(1, height - (baseline() ? 4 : 3))
    const build = (axis: number): ChartModel | null => {
      const width = Math.max(1, mainWidth() - 4 - axis)
      if (v === "Daily" || v === "Cumulative" || v === "Weekly") return spendingChart(v, series(), width, rows, today(), spending(), budget()?.budget.amount, periodNames(), data.state.weekStart)
      if (v === "Cash flow") return cashFlowChart(series().dates, width, rows, today(), data.state.accounts, data.transactions(), scopeIds(), data.state.weekStart)
      if (v === "Calendar" || v === "Subscriptions") return null
      return balancesChart(v, series().dates, width, rows, today(), data.state.accounts, data.transactions(), data.state.weekStart, data.state.uiPrefs.zeroAxis === true)
    }
    const guess = axisWas[slot]
    const first = build(guess)
    if (!first || first.ticks.size === 0) return first
    axisWas[slot] = axisWidth(first.ticks)
    return axisWas[slot] === guess ? first : build(axisWas[slot])
  }
  // Each chart follows its own view: switching one leaves the other alone.
  const topView = createMemo(() => ui.state.chartViews[0])
  const bottomView = createMemo(() => ui.state.chartViews[1])
  const topModel = live(() => model(0, topView(), topChartHeight()))
  const bottomModel = live(() => (wide() ? model(1, bottomView(), bottomChartHeight()) : null))

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
  const accountsCard = () => (
    <SectionCard title="Accounts" width={sideWidth()} height={accountRows(saversFull()) + 2}>
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
  )

  // Totals: the range against the same days of the previous period.
  const daily = (spent: number) => formatWholeMoney(windows().days ? spent / windows().days : 0)
  const totalsCard = () => (
    <SectionCard title="Totals" titleRight={headings("Range", "Before")} titleRightFlush width={sideWidth()} height={totalsRows() + 2}>
      {stat("Spent", formatWholeMoney(flows().spent), formatWholeMoney(previousFlows().spent), { value: previousFlows().spent > 0 ? spendChangeColor(flows().spent - previousFlows().spent) : ink.figure })}
      {stat("Income", formatWholeMoney(flows().income), formatWholeMoney(previousFlows().income))}
      {stat("Net", signedWholeMoney(flows().net), signedWholeMoney(previousFlows().net), { value: changeColor(flows().net) })}
      {stat("To savers", signedWholeMoney(flows().savedToSavers), signedWholeMoney(previousFlows().savedToSavers), { value: changeColor(flows().savedToSavers) })}
      {stat("Savings rate", formatPct(flows().savingsRate), formatPct(previousFlows().savingsRate))}
      {stat("Daily", daily(flows().spent), daily(previousFlows().spent))}
      {stat("Transactions", String(flows().txnCount), String(previousFlows().txnCount))}
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
    <SectionCard title="Categories" titleSuffix={categoriesFocused() ? "· enter to open" : undefined} titleSuffixColor={ink.note} bottomSpans={uncategorised() || toReview() ? [
        ...(uncategorised() ? [{ text: `${uncategorised()} uncategorised`, fg: tone.caution }] : []),
        ...(toReview() ? [{ text: `${uncategorised() ? " · " : ""}${toReview()} to review (i)`, fg: tone.ai }] : []),
      ] : undefined} width={categoryWidth()} height={categoriesHeight()} focused={categoriesFocused()}>
      <Show when={groups().length} fallback={<text fg={ink.note}>No spending in this period</text>}>
        {/* Index: a new range or cursor move updates rows in place. */}
        <Index each={categoryRows()}>
          {(row) => {
            const line = () => row().line
            const cursor = () => row().cursor
            const bg = () => cursor() ? theme.rowCursor : undefined
            return (
              <text wrapMode="none" bg={bg()}>
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
  )

  // A component, not a function call in JSX: its card stays mounted while
  // the view changes (a remounted card has no measured width for a frame or
  // two, so its border picker and legend would blink out).
  const ChartPane = (p: { pane: 0 | 1; height: number }) => {
    const index = () => ui.state.chartViews[p.pane]
    const view = () => CHART_VIEWS[index()] ?? CHART_VIEWS[0]
    const chart = () => (p.pane === 0 ? topModel() : bottomModel())
    return (
      <SectionCard
        title={view().group}
        titleSuffix={view().group === view().view ? undefined : `· ${view().view}`}
        titleSuffixColor={ink.label}
        titleRight={viewPicker(index())}
        bottomSpans={chart()?.legend ?? (view().view === "Subscriptions" ? subscriptionsLegend(subs()) : calendarLegend(calendar(), today()))}
        width={mainWidth()}
        height={p.height}
        focused={props.focused === (p.pane === 0 ? "ov.chart" : "ov.chart2")}
      >
        <Show when={chart()} fallback={view().view === "Subscriptions"
          ? <SubscriptionsView list={subs()} width={mainWidth() - 4} rows={p.height - 2} today={today()} />
          : <CalendarView weeks={calendar()} width={mainWidth() - 4} rows={p.height - 2} today={today()} />}>
          {(m: () => ChartModel) => <ChartBody model={m()} inks={INKS} baseline={baseline()} />}
        </Show>
      </SectionCard>
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
      <SectionCard title="Date Range" titleSuffix={`· ${scope().label}`} titleSuffixColor={ink.label} focused={dateFocused()} height={3} width={rangeCardWidth()}>
        <box flexDirection="row" justifyContent="space-between" width="100%">
          <text fg={ink.label} wrapMode="none">
            <For each={LOOKBACKS}>
              {(lb, i) => <>{i() > 0 ? chipsFit().gap : ""}{chip(lb, i(), () => ui.state.timeframe.family === "lookback" && ui.state.timeframe.lookback === lb)}</>}
            </For>
            <S fg={ink.rule}>{chipsFit().separator}</S>
            <For each={PERIODS}>
              {(p, i) => <>{i() > 0 ? chipsFit().gap : ""}{chip(chipsFit().label(p), LOOKBACKS.length + i(), () => ui.state.timeframe.family === "period" && ui.state.timeframe.period === p)}</>}
            </For>
            <S fg={ink.rule}>{chipsFit().separator}</S>
            {chip("Custom", CUSTOM_CHIP, () => ui.state.timeframe.family === "custom")}
          </text>
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
      <Show
        when={wide()}
        fallback={<NarrowColumn />}
      >
        <box flexDirection="row" gap={1} width="100%" height={bodyHeight()}>
          <box flexDirection="column" gap={1} width={mainWidth()} height={bodyHeight()}>
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
            <text fg={edit().error ? tone.bad : ink.note} wrapMode="none">{edit().error || "YYYY-MM-DD, both days included"}</text>
          </Modal>
        )}
      </Show>
    </box>
  )
}

/** The chart pane's views in h/l order as icons (dots when icons are off),
 * the current one bright; a space between groups. */
function viewPicker(current: number): Span[] {
  return CHART_VIEWS.flatMap((v, i) => [
    ...(i > 0 ? [{ text: CHART_VIEWS[i - 1]!.group !== v.group ? "  " : " ", fg: ink.note }] : []),
    { text: viewMark(v.view, i === current), fg: i === current ? tone.key : ink.faint, bold: i === current },
  ])
}

const PERIOD_UNIT: Record<string, string> = { cycle: "cycle", month: "month", qtr: "quarter", half: "half", fy: "FY", year: "year" }


/** The Subscriptions view's legend: how many, what they cost a month, and
 * what changed. */
function subscriptionsLegend(list: Subscription[]): Span[] {
  const active = list.filter((s) => !s.stopped)
  const changed = active.filter((s) => s.change).length
  const stopped = list.length - active.length
  return [
    { text: `${active.length} active · ${formatWholeMoney(monthlyTotal(list))} a month`, fg: ink.label },
    ...(changed ? [{ text: ` · ${count(changed, "price change")}`, fg: tone.caution }] : []),
    ...(stopped ? [{ text: ` · ${stopped} stopped`, fg: ink.note }] : []),
  ]
}

const SUB_COLUMNS = { every: 12, charge: 10, month: 10, next: 11, change: 24 }

/** Regular payments, one a line: what, how often, the latest charge, a
 * month's worth, the next charge, and a price change. Stopped ones dimmed
 * after the rest; more than fit end in "… N more". */
function SubscriptionsView(props: { list: Subscription[]; width: number; rows: number; today: string }) {
  const showChange = () => props.width >= 70
  const nameWidth = () => Math.max(10, props.width - SUB_COLUMNS.every - SUB_COLUMNS.charge - SUB_COLUMNS.month - SUB_COLUMNS.next - (showChange() ? SUB_COLUMNS.change : 0))
  const room = () => Math.max(0, props.rows - 1)
  const shown = createMemo(() => props.list.length > room() ? props.list.slice(0, Math.max(0, room() - 1)) : props.list)
  const more = () => props.list.length - shown().length
  const line = (s: Subscription): StyledSpan[] => {
    const dim = s.stopped
    const due = s.stopped ? "stopped" : s.next < props.today ? "due" : shortDate(s.next)
    return [
      { text: fit(s.name, nameWidth()), fg: dim ? ink.note : ink.figure },
      { text: s.cadence.padStart(SUB_COLUMNS.every), fg: ink.note },
      { text: formatMoney(s.amount).padStart(SUB_COLUMNS.charge), fg: dim ? ink.note : ink.figure },
      { text: formatMoney(s.monthly).padStart(SUB_COLUMNS.month), fg: dim ? ink.note : ink.label },
      { text: due.padStart(SUB_COLUMNS.next), fg: s.stopped ? ink.note : s.next < props.today ? tone.caution : ink.label },
      ...(showChange() && s.change ? [{
        text: `  ${s.change.to > s.change.from ? "▲" : "▼"} from ${formatMoney(s.change.from)} ${shortDate(s.change.since)}`.slice(0, SUB_COLUMNS.change),
        fg: s.change.to > s.change.from ? tone.caution : tone.good,
      }] : []),
    ]
  }
  return (
    <Show when={props.list.length} fallback={<text fg={ink.note}>No regular payments found</text>}>
      <StyledLine spans={[
        { text: "Payment".padEnd(nameWidth()), fg: ink.label, bold: true },
        { text: "Every".padStart(SUB_COLUMNS.every), fg: ink.label, bold: true },
        { text: "Charge".padStart(SUB_COLUMNS.charge), fg: ink.label, bold: true },
        { text: "A month".padStart(SUB_COLUMNS.month), fg: ink.label, bold: true },
        { text: "Next".padStart(SUB_COLUMNS.next), fg: ink.label, bold: true },
        ...(showChange() ? [{ text: "  Change", fg: ink.label, bold: true }] : []),
      ]} />
      <Index each={shown()}>{(s) => <StyledLine spans={line(s())} />}</Index>
      <Show when={more() > 0}><text fg={ink.note}>{`… ${more()} more`}</text></Show>
    </Show>
  )
}

