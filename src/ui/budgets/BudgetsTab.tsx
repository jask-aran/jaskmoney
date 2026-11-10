import type { JSX } from "solid-js"
import { Show, createEffect, createMemo } from "solid-js"
import { onPointer } from "../../app/pointer"
import type { SectionId } from "../../state/uiStore"
import { BUDGET_PANES, CATEGORIES, ui } from "../../state/uiStore"
import { theme } from "../../theme"
import { tabColumns } from "../primitives/columns"
import { regionRef } from "../regions"
import { createBudgetChart, createBudgetChartModel, createCycleCharts } from "./BudgetChart"
import { createBudgetsPane, createPlanFlow, createPlanLines, createPlanText } from "./BudgetsPane"
import { createCategoryList, createCategoryRoom, createCategoryRows } from "./CategoryList"
import { createBudgetCalendar, createBudgetHistory, createBudgetInputs, createBudgetPlan, createBudgetProgress } from "./budgetsModel"

export function createBudgetLayout(input: Pick<ReturnType<typeof createBudgetInputs>, "dims"> & { props: { focused: SectionId } }) {
  const { dims, props } = input
  const body = () => Math.max(16, dims().height - 4)
  const columns = createMemo(() => tabColumns(dims().width, { max: SIDE_MAX, share: 0.4, narrow: (width) => width }))
  const wide = () => columns().wide
  const categoriesWidth = () => columns().side
  const mainWidth = () => columns().main
  const grid = () => columns().grid
  const halfLeft = () => columns().left
  const halfRight = () => columns().right
  const topQuarter = () => Math.floor(body() / 2)
  const bottomQuarter = () => body() - topQuarter()
  const splitTop = () => Math.max(CALENDAR_TALL, Math.floor(body() * 0.45))
  const cyclePanes = (): 0 | 1 | 2 => (grid() ? 2 : wide() && body() - splitTop() >= CYCLE_PANE_MIN ? 1 : 0)
  const chartHeight = () => (grid() ? topQuarter() : wide() ? (cyclePanes() ? splitTop() : body()) : Math.max(10, Math.floor(body() * 0.35)))
  const cyclePaneHeight = (_pane: number) => (grid() ? bottomQuarter() : body() - chartHeight())
  const chartWidth = () => mainWidth()
  const cyclePaneWidth = (pane: number) => (grid() ? (pane === 0 ? halfLeft() : halfRight()) : mainWidth())
  const categoriesHeight = () => (wide() ? body() : Math.max(5, body() - chartHeight()))
  const listInPane = () => cyclePanes() > 0 && ui.state.budgetCycleViews[0] === CATEGORIES
  const listInSide = () => cyclePanes() === 0
  const sideId = (): SectionId => (listInSide() ? "bud.categories" : "bud.plan")
  createEffect(() => {
    const n = cyclePanes()
    if (ui.state.budgetCyclePanes !== n) ui.setState({ budgetCyclePanes: n })
    const pane = BUDGET_PANES.indexOf(props.focused)
    const home = listInSide() ? "bud.categories" : "bud.plan"
    if (pane > n || (props.focused === "bud.categories" && !listInSide() && !listInPane()) || (props.focused === "bud.plan" && listInSide())) ui.setState({ focusedSection: home })
    else if (props.focused === "bud.cycle" && listInPane()) ui.setState({ focusedSection: "bud.categories" })
  })
  const rowWidth = (width: number) => width - 5

  return { chartHeight, chartWidth, listInSide, rowWidth, categoriesWidth, cyclePaneWidth, categoriesHeight, cyclePaneHeight, sideId, cyclePanes, listInPane, wide, grid, mainWidth, body, bottomQuarter }
}

function createBudgetRegions(input: Pick<ReturnType<typeof createBudgetLayout>, "chartWidth" | "chartHeight" | "sideId" | "categoriesWidth" | "categoriesHeight" | "listInPane"> & Pick<ReturnType<typeof createBudgetChart>, "Chart"> & Pick<ReturnType<typeof createBudgetsPane>, "Categories"> & Pick<ReturnType<typeof createCycleCharts>, "CyclePane"> & Pick<ReturnType<typeof createCategoryList>, "CategoriesPane">) {
  const { chartWidth, chartHeight, Chart, sideId, categoriesWidth, categoriesHeight, Categories, listInPane, CyclePane, CategoriesPane } = input
  const region = (id: SectionId, width: () => number, height: () => number, card: () => JSX.Element) => (
    <box ref={regionRef(id, "budgets")} width={width()} height={height()} flexShrink={0} onMouseDown={panePointer(id)}>{card()}</box>
  )
  const BudgetPane = () => region("bud.chart", chartWidth, chartHeight, () => <Chart />)
  const CategoriesCard = () => <Show when={sideId()} keyed>{(id: SectionId) => region(id, categoriesWidth, categoriesHeight, () => <Categories />)}</Show>
  const FirstCyclePane = () => <Show when={listInPane()} fallback={<CyclePane pane={0} />}><CategoriesPane /></Show>
  return { BudgetPane, CategoriesCard, FirstCyclePane }
}

export const CALENDAR_TALL = 15

const SIDE_MAX = 48

const CYCLE_PANE_MIN = 12

export const panePointer = (id: SectionId) => onPointer((scope) => scope === "bar" || scope.startsWith("budgets"), () => ui.applyJump(id))

export function BudgetsTab(props: { focused: SectionId }) {
  const { budgets, config, through, transactions, cycle, today, label, ALL, dims, view, seen, pace, elapsed, period } = createBudgetInputs()
  const { setup, categoryCursor, split, firstData, progress, ignored, totalProgress, lines } = createBudgetProgress({ budgets, config, through, transactions, cycle, today })
  const { subjectRows, subject, cycles, past, spent } = createBudgetHistory({ config, setup, categoryCursor, label, ALL, split, firstData, today, transactions, cycle, through })
  const { chartHeight, chartWidth, listInSide, rowWidth, categoriesWidth, cyclePaneWidth, categoriesHeight, cyclePaneHeight, sideId, cyclePanes, listInPane, wide, grid, mainWidth, body, bottomQuarter } = createBudgetLayout({ dims, props })
  const { model, baseline, chartView, subs, dueBeforePayday, payday } = createBudgetChartModel({ subjectRows, today, config, chartHeight, cycle, chartWidth, subject })
  const { planPay, toSavers, paid, income, targetParts, expectedPay, flows, allSpending, categoriesFocused, inCycle, spendingIds } = createBudgetPlan({ transactions, cycle, through, budgets, split, progress, props })
  const { NUM, overallBudget, nameWidth, withAverage, rowBudget, rowSpans } = createCategoryRows({ listInSide, rowWidth, categoriesWidth, cyclePaneWidth, ignored, budgets, label, progress, ALL, totalProgress, lines, split })
  const { blank, heading, note, ledger } = createPlanText({ rowWidth, categoriesWidth, NUM })
  const { topLines } = createPlanLines({ rowWidth, categoriesWidth, planPay, overallBudget, toSavers, split, totalProgress, paid, cycle, today, income, blank, heading, note, targetParts, view })
  const { nextPayBlock, flowBlock, shownTop, nextPayLines, flowLines, planReveal } = createPlanFlow({ view, cycle, today, expectedPay, ledger, flows, allSpending, through, rowWidth, categoriesWidth, transactions, seen, topLines })
  const { categoryLines, categoryTop, categoryRoom, nothingSet, calendarRows, briefRows, briefRoom } = createCategoryRoom({ categoriesHeight, topLines, nextPayBlock, flowBlock, listInSide, setup, cyclePaneHeight, lines, budgets, categoryCursor, view })
  const { Chart } = createBudgetChart({ subject, seen, model, chartWidth, chartHeight, baseline, chartView, cycles, subs, dueBeforePayday, today, payday, pace, props })
  const { CyclePane } = createCycleCharts({ cyclePanes, inCycle, cycle, today, allSpending, split, transactions, spendingIds, past, elapsed, through, cyclePaneWidth, cyclePaneHeight, baseline, seen, props })
  const { calendarWeeks, calendarThrough, calendarSpans } = createBudgetCalendar({ view, subs, today, cycle, subjectRows, subject, spent, seen })
  const { CategoryList, CategoriesPane } = createCategoryList({ categoryLines, nameWidth, NUM, withAverage, categoryTop, categoryRoom, categoriesFocused, categoryCursor, rowBudget, cycle, rowSpans, cyclePaneWidth, cyclePaneHeight })
  const { Categories } = createBudgetsPane({ nothingSet, view, elapsed, cycle, period, sideId, categoriesWidth, categoriesHeight, shownTop, rowWidth, calendarRows, calendarWeeks, today, calendarThrough, calendarSpans, nextPayLines, flowLines, planReveal, listInSide, briefRows, briefRoom, nameWidth, NUM, withAverage, rowSpans, CategoryList, props })
  const { BudgetPane, CategoriesCard, FirstCyclePane } = createBudgetRegions({ chartWidth, chartHeight, Chart, sideId, categoriesWidth, categoriesHeight, Categories, listInPane, CyclePane, CategoriesPane })
  return (
    <box width="100%" height="100%" flexDirection={wide() ? "row" : "column"} gap={wide() ? 1 : 0} backgroundColor={theme.canvas}>
      <Show when={wide()} fallback={<><BudgetPane /><CategoriesCard /></>}>
        <Show when={grid()} fallback={
          <box flexDirection="column" width={mainWidth()} height={body()}>
            <BudgetPane />
            <Show when={cyclePanes() > 0}><FirstCyclePane /></Show>
          </box>
        }>
          <box flexDirection="column" width={mainWidth()} height={body()}>
            <BudgetPane />
            <box flexDirection="row" gap={1} width={mainWidth()} height={bottomQuarter()} flexShrink={0}>
              <FirstCyclePane />
              <CyclePane pane={1} />
            </box>
          </box>
        </Show>
        <CategoriesCard />
      </Show>
    </box>
  )
}
