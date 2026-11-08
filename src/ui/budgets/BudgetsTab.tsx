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
  // Sizes: tab bar + gap (2) and status + footer (2) off the height. Wide,
  // the chart and the budgets share the left and the categories run down
  // the right; narrow, they stack.
  const body = () => Math.max(16, dims().height - 4)
  // The Overview's breakpoint and its columns; the Budgets pane takes the
  // side column (up to SIDE_MAX: Up's longest names fit), narrow the width.
  const columns = createMemo(() => tabColumns(dims().width, { max: SIDE_MAX, share: 0.4, narrow: (width) => width }))
  const wide = () => columns().wide
  const categoriesWidth = () => columns().side
  const mainWidth = () => columns().main
  // The layouts. Wide: the main column, then a side column with the
  // cycle's calendar over the Budgets pane. Two columns (split screen): the
  // budget pane on top of the main column and a cycle pane under it where
  // there's height for both; the calendar the budget pane's height, so
  // Budgets starts on the cycle pane's line. Three columns (full screen,
  // the main column fits two panes of GRID_PANE_MIN, columns.ts): the budget pane
  // across the top, two cycle panes under it. Narrow: one column, the
  // budget pane, the calendar on a tall terminal, the Budgets pane.
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
  // The Budgets pane: the side column's full height; narrow, under the budget pane.
  const categoriesHeight = () => (wide() ? body() : Math.max(5, body() - chartHeight()))
  // The panes the keys and jumps reach follow the layout; focus on one
  // that's gone goes back to the budgets.
  // The list is the first cycle pane's Categories view (the tab's home),
  // or without a cycle pane, the Budgets pane's under the plan.
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
  // Sizes as accessors: a component's body runs once, so a number read here
  // would keep its first value.
  const region = (id: SectionId, width: () => number, height: () => number, card: () => JSX.Element) => (
    <box ref={regionRef(id, "budgets")} width={width()} height={height()} flexShrink={0} onMouseDown={panePointer(id)}>{card()}</box>
  )
  const BudgetPane = () => region("bud.chart", chartWidth, chartHeight, () => <Chart />)
  // Keyed on its id: a ref is taken once, and the pane is the list's or
  // the plan's by the layout.
  const CategoriesCard = () => <Show when={sideId()} keyed>{(id: SectionId) => region(id, categoriesWidth, categoriesHeight, () => <Categories />)}</Show>
  // The first cycle pane: the list (Categories) or a chart.
  const FirstCyclePane = () => <Show when={listInPane()} fallback={<CyclePane pane={0} />}><CategoriesPane /></Show>
  return { BudgetPane, CategoriesCard, FirstCyclePane }
}

/** Its rows with two lines a weekday (each day's amount under its number). */
export const CALENDAR_TALL = 15

/** The Budgets pane's widest useful size: Up's longest names fit. */
const SIDE_MAX = 48

/** Fewest rows a Budgets chart pane gets before the cycle pane gives way. */
const CYCLE_PANE_MIN = 12

/** A click on a card or pane focuses it. */
export const panePointer = (id: SectionId) => onPointer((scope) => scope === "bar" || scope.startsWith("budgets"), () => ui.applyJump(id))

/**
 * The Budgets tab: how a budget is going, at a glance. A chart of the
 * budget at the cursor (this cycle against its pace and last cycle, or
 * cycle by cycle; h/l), under a line saying where it stands; the budgets
 * as bars against an even pace; and every category with its spending, its
 * budget, or that it's left out of the overall budget (x). Enter sets a
 * budget (a category's from its average: allocating down; the overall from
 * the category budgets' total: building up); c the cycle.
 */
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
