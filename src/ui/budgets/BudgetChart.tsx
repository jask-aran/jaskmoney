import { Index, createMemo } from "solid-js"
import { cycleFor } from "../../domain/budget"
import { dailySpendSeries } from "../../domain/dashboard"
import { addDays } from "../../domain/days"
import { merchantRows, trendRows } from "../../domain/periodTables"
import { spendingCalendar } from "../../domain/spending"
import { subscriptions, upcomingCharges } from "../../domain/subscriptions"
import { data } from "../../state/dataStore"
import type { SectionId } from "../../state/uiStore"
import { BUDGET_PANES, BUDGET_VIEWS, CATEGORIES, CHART_VIEWS, cycleView, cycleViewsFor, ui } from "../../state/uiStore"
import { AXIS_GUESS, CHART_RIGHT_PAD, axisWidth, type ChartModel } from "../charts/ChartBody"
import { ChartCard } from "../charts/ChartCard"
import { chartSpeedMs, useReveal } from "../charts/motion"
import { SubscriptionsView, subscriptionsLegend } from "../charts/SubscriptionsView"
import { OverviewChartCard, chartRows, overviewChartModel, type OverviewChartInput } from "../overview/OverviewTab"
import { spendingChart } from "../overview/periodCharts"
import { S } from "../primitives/S"
import { regionRef } from "../regions"
import { cycleLines, cycleLinesLegend } from "./budgetCharts"
import { createBudgetHistory, createBudgetInputs, createBudgetPlan, createBudgetProgress } from "./budgetsModel"
import { createBudgetLayout, panePointer } from "./BudgetsTab"

export function createBudgetChartModel(input: Pick<ReturnType<typeof createBudgetHistory>, "subjectRows" | "subject"> & Pick<ReturnType<typeof createBudgetInputs>, "today" | "config" | "cycle"> & Pick<ReturnType<typeof createBudgetLayout>, "chartHeight" | "chartWidth">) {
  const { subjectRows, today, config, chartHeight, cycle, chartWidth, subject } = input
  // The chart: the Overview's spending view over the cycle shown, for what
  // the subject counts, with its budget; built once with a guessed axis
  // width, again if the labels need another.
  const baseline = () => data.state.uiPrefs.xAxis === true
  const chartView = () => (BUDGET_VIEWS[ui.state.budgetChart] ?? BUDGET_VIEWS[0]!).view
  // Subscriptions: the regular payments among the rows the budget counts
  // (its fixed costs), what's due before payday, drawn in place of a chart.
  const subs = createMemo(() => subscriptions(subjectRows(), today()))
  const payday = () => addDays(cycleFor(config(), today()).end, 1)
  const dueBeforePayday = () => upcomingCharges(subs(), today(), addDays(payday(), -1)).reduce((sum, c) => sum + c.amount, 0)
  let axisWas = AXIS_GUESS
  const model = createMemo((): ChartModel | null => {
    if (chartView() === "Subscriptions" || chartView() === "Each cycle") return null
    // Border (2), the x-axis line (a setting) and the x labels.
    const height = Math.max(3, chartHeight() - (baseline() ? 4 : 3))
    const series = dailySpendSeries(subjectRows(), cycle().start, cycle().end)
    const view = chartView() as "Cumulative" | "Daily" | "Weekly"
    const build = (axis: number) => spendingChart(view, series, Math.max(1, chartWidth() - 4 - axis - CHART_RIGHT_PAD), height, today(), subjectRows(), subject().amount ?? undefined, { current: "This cycle", previous: "Last cycle" }, data.state.weekStart)
    let built = build(axisWas)
    const axis = axisWidth(built.ticks)
    if (axis !== axisWas) { axisWas = axis; built = build(axis) }
    return built
  })
  return { model, baseline, chartView, subs, dueBeforePayday, payday }
}

export function createBudgetChart(input: Pick<ReturnType<typeof createBudgetHistory>, "subject" | "cycles"> & Pick<ReturnType<typeof createBudgetInputs>, "seen" | "today" | "pace"> & Pick<ReturnType<typeof createBudgetChartModel>, "model" | "baseline" | "chartView" | "subs" | "dueBeforePayday" | "payday"> & Pick<ReturnType<typeof createBudgetLayout>, "chartWidth" | "chartHeight"> & { props: { focused: SectionId } }) {
  const { subject, seen, model, chartWidth, chartHeight, baseline, chartView, cycles, subs, dueBeforePayday, today, payday, pace, props } = input
  // The budget pane's key while it draws in ("always"): each view, budget
  // and showing. Its views that aren't charts (Subscriptions, Each cycle)
  // draw in on it too, as the Overview's table views do.
  const chartKey = () => (data.state.uiPrefs.chartMotion === "always" ? `${(BUDGET_VIEWS[ui.state.budgetChart] ?? BUDGET_VIEWS[0]!).view}:${subject().title}:${seen()}` : undefined)
  const tableReveal = useReveal(() => (model() ? undefined : chartKey()), () => chartSpeedMs(data.state.uiPrefs.chartSpeed), () => data.state.uiPrefs.chartCurve)
  const Chart = () => (
    <ChartCard scope={subject().title} views={BUDGET_VIEWS} current={ui.state.budgetChart} model={model()} width={chartWidth()} height={chartHeight()} baseline={baseline()}
      focused={props.focused === "bud.chart"}
      legend={chartView() === "Each cycle" ? (cycles().length ? cycleLinesLegend(cycles()) : undefined) : subscriptionsLegend(subs(), dueBeforePayday())}
      fallback={chartView() === "Each cycle" ? <EachCycle /> : <SubscriptionsView list={subs()} width={chartWidth() - 4} rows={chartHeight() - 2} today={today()} payday={payday()} progress={tableReveal()} />}
      revealKey={chartKey()}
      revealMs={data.state.uiPrefs.chartMotion === "always" ? chartSpeedMs(data.state.uiPrefs.chartSpeed) : undefined}
      curve={data.state.uiPrefs.chartCurve}
      labels={data.state.uiPrefs.chartLabels} />
  )
  // Each cycle: the subject cycle by cycle, newest first, each against the
  // budget then, as many as fit.
  // Drawing in, its rows drop in newest first, each bar sweeping in.
  const EachCycle = () => {
    const shown = () => cycles().slice(0, Math.max(1, chartHeight() - 2))
    const rowsIn = () => Math.ceil(Math.min(1, tableReveal() / 0.6) * shown().length)
    return (
      <Index each={cycleLines(shown(), chartWidth() - 4, pace(), today())}>{(spans, i) => (
        <text wrapMode="none">
          <Index each={i < rowsIn() ? spans() : []}>{(span) => <S fg={span().fg} bold={span().bold}>{span().text}</S>}</Index>
        </text>
      )}</Index>
    )
  }
  return { Chart }
}

export function createCycleCharts(input: Pick<ReturnType<typeof createBudgetLayout>, "cyclePanes" | "cyclePaneWidth" | "cyclePaneHeight"> & Pick<ReturnType<typeof createBudgetPlan>, "inCycle" | "allSpending" | "spendingIds"> & Pick<ReturnType<typeof createBudgetInputs>, "cycle" | "today" | "transactions" | "elapsed" | "through" | "seen"> & Pick<ReturnType<typeof createBudgetProgress>, "split"> & Pick<ReturnType<typeof createBudgetHistory>, "past"> & Pick<ReturnType<typeof createBudgetChartModel>, "baseline"> & { props: { focused: SectionId } }) {
  const { cyclePanes, inCycle, cycle, today, allSpending, split, transactions, spendingIds, past, elapsed, through, cyclePaneWidth, cyclePaneHeight, baseline, seen, props } = input
  // The cycle panes: the Overview's views (CYCLE_VIEWS: not the spending
  // ones, the budget pane's, nor the calendar) over the cycle shown, for every
  // spending account (the Overview's "All spending"), with the total
  // budgeted on the spending charts; Merchants against the same days of
  // the cycle before, when the history covers it.

  const cycleViews = () => ui.state.budgetCycleViews.slice(0, cyclePanes()).map((i) => cycleView(i).view)
  const cycleShows = (view: string) => (cycleViews() as readonly string[]).includes(view)
  const cycleSeries = createMemo(() => dailySpendSeries(inCycle(), cycle().start, cycle().end))
  const cycleInput: OverviewChartInput = {
    get series() { return cycleSeries() }, get today() { return today() }, get spending() { return allSpending() },
    get budget() { return split().total || undefined }, names: { current: "This cycle", previous: "Last cycle" }, get weekStart() { return data.state.weekStart },
    get accounts() { return data.state.accounts }, get transactions() { return transactions() }, get scopeIds() { return spendingIds() },
    get zeroAxis() { return data.state.uiPrefs.zeroAxis === true }, projection: [],
  }
  const cycleCalendar = createMemo(() => (cycleShows("Calendar") ? spendingCalendar(inCycle(), cycle().start, cycle().end, data.state.weekStart) : []))
  const cycleTrends = createMemo(() => (cycleShows("Trends") ? trendRows(inCycle(), data.state.categories, cycle().start, cycle().end, today(), data.state.weekStart) : { groups: [], rows: [] }))
  const cycleMerchants = createMemo(() => {
    if (!cycleShows("Merchants")) return []
    const before = past()[0]
    const until = before ? addDays(before.start, elapsed() - 1) : ""
    return merchantRows(inCycle().filter((t) => t.dateISO <= through()), before ? allSpending().filter((t) => t.dateISO >= before.start && t.dateISO <= until) : null)
  })
  const cycleAxis = [AXIS_GUESS, AXIS_GUESS]
  const cycleModel = (pane: number) => createMemo(() => {
    if (pane >= cyclePanes() || ui.state.budgetCycleViews[pane] === CATEGORIES) return null
    const m = overviewChartModel((CHART_VIEWS[ui.state.budgetCycleViews[pane]!] ?? CHART_VIEWS[0]).view, cycleInput, cyclePaneWidth(pane) - 4, chartRows(cyclePaneHeight(pane), baseline()), cycleAxis[pane])
    if (m && m.ticks.size) cycleAxis[pane] = axisWidth(m.ticks)
    return m
  })
  const cycleModels = [cycleModel(0), cycleModel(1)]
  const CyclePane = (p: { pane: number }) => {
    const section = BUDGET_PANES[p.pane + 1]!
    const index = () => ui.state.budgetCycleViews[p.pane]!
    return (
      <box ref={regionRef(section, "budgets")} width={cyclePaneWidth(p.pane)} height={cyclePaneHeight(p.pane)} flexShrink={0} onMouseDown={panePointer(section)}>
        <OverviewChartCard index={index()} views={cycleViewsFor(p.pane)} model={cycleModels[p.pane]!()} calendar={cycleCalendar()} trends={cycleTrends()} merchants={cycleMerchants()} today={today()}
          width={cyclePaneWidth(p.pane)} height={cyclePaneHeight(p.pane)} focused={props.focused === section} baseline={baseline()}
          revealKey={data.state.uiPrefs.chartMotion === "always" ? `${(CHART_VIEWS[index()] ?? CHART_VIEWS[0]).view}:${cycle().start}:${seen()}` : undefined}
          revealMs={data.state.uiPrefs.chartMotion === "always" ? chartSpeedMs(data.state.uiPrefs.chartSpeed) : undefined}
          curve={data.state.uiPrefs.chartCurve} labels={data.state.uiPrefs.chartLabels} />
      </box>
    )
  }
  return { CyclePane }
}
