import type { BoxRenderable, ScrollBoxRenderable } from "@opentui/core"
import { Show, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js"
import { data } from "../../state/dataStore"
import { CHART_SECTIONS, CHART_VIEWS, chartPaneOf, ui, type SectionId } from "../../state/uiStore"
import { theme } from "../../theme"
import { AXIS_GUESS, axisWidth, type ChartModel } from "../charts/ChartBody"
import { chartSpeedMs, showings, takeLaunchReveal, useReveal } from "../charts/motion"
import { hasMarks } from "../charts/reveal"
import { tabColumns } from "../primitives/columns"
import { regionRef } from "../regions"
import { CustomRangeDialog } from "./CustomRangeDialog"

import type { JSX } from "solid-js"
import { AccountsCard, createAccountsCard } from "./AccountsCard"
import { DateRangeCard, createDateChips } from "./DateRangeCard"
import { OverviewChartCard, TABLE_VIEWS, chartRows, overviewChartModel } from "./overviewCharts"
import { createOverviewBefore, createOverviewChartInput, createOverviewCounts, createOverviewPay, createOverviewPosition, createOverviewRange, createOverviewTables, type OverviewModel } from "./overviewModel"
import { BEFORE, RangePane, createCategoryRows, createRangeLines, panePointer } from "./RangePane"
export { OverviewChartCard, TABLE_VIEWS, chartRows, overviewChartModel, type OverviewChartInput } from "./overviewCharts"

/** The Overview's side column's widest: the Range pane's Before column and
 * the names both fit. */
const RANGE_SIDE_MAX = 56
/** Narrow: the chart's fewest rows before the column scrolls. */
const NARROW_CHART_MIN = 10
/** Savers fold to their subtotal before Categories drop under this many rows. */
const MIN_CATEGORIES = 8
/** Narrow: the Range pane's fewest category rows under its top. */
const NARROW_CATEGORIES = 5

function createOverviewLayout(input: OverviewModel, rangeTop: () => number) {
  const { dims, position } = input
  // Fixed rows: tab bar + gap (2), status + footer (2), Date Range (3).
  // Wide: two chart panes share the left column; the right column (SIDE_MIN
  // to RANGE_SIDE_MAX wide) stacks Accounts over the Range pane. Narrow:
  // the top chart across the tab takes what the cards leave; under it
  // Accounts beside the Range pane, the two columns one height.
  // When even the smallest chart doesn't fit, the column scrolls.
  // Wide: the side column beside the charts (wider than Budgets': the
  // Range pane's Before column and the names both fit); narrow, Accounts
  // beside the Range pane, half the width each.
  const columns = createMemo(() => tabColumns(dims().width, { max: RANGE_SIDE_MAX, share: 0.45, narrow: (width) => Math.floor((width - 1) / 2) }))
  const wide = () => columns().wide
  // The Range pane as its bars (the default) or, after t, as text.
  const textual = () => data.state.uiPrefs.rangeText === true
  // The Range pane shows where the spending went (s), or where the net went.
  const spendingView = () => data.state.uiPrefs.rangeView === "spending"
  const bodyHeight = () => Math.max(8, dims().height - 7)
  const sideWidth = () => columns().side
  const mainWidth = () => columns().main
  // Wide and wide enough: the charts in a 2×2 grid, two columns of panes.
  const grid = () => columns().grid
  const charts = () => (grid() ? 4 : wide() ? 2 : 1)
  /** A chart pane's width: the chart column, or half of it in the grid. */
  const paneWidth = (pane: number) => (!grid() ? mainWidth() : pane < 2 ? columns().left : columns().right)
  // The keys act on the charts on screen: focus on one that's gone moves
  // to the top one.
  createEffect(() => {
    const n = charts()
    if (ui.state.overviewCharts !== n) ui.setState({ overviewCharts: n })
    if (chartPaneOf(ui.state.focusedSection) >= n) ui.applyJump("ov.chart")
  })

  // Accounts: available, the balance with what's pending and the 30 day
  // change; then, with savers, a heading, each saver and their
  // subtotal (folded: the subtotal alone), and the net position.
  const hasSavers = () => position().savers.length > 0
  // With savers: a blank line, the heading, each saver and their total
  // (folded: one line), a blank line and the net position. Without: the
  // 30 day change.
  const saverRows = (full: boolean) => (!hasSavers() ? 1 : (full ? 2 + position().savers.length : 1) + 3)
  // Runway is the Range pane's.
  const accountRows = (full: boolean) => 1 + (position().pendingCount > 0 ? 1 : 0) + saverRows(full)
  // Narrow: Accounts beside the Range pane, the two one height: the Range
  // pane's top and a few categories, or Accounts where that's taller.
  // Wide, Accounts over the Range pane.
  const lowerHeight = (full: boolean) => (wide() ? accountRows(full) + 2 : Math.max(accountRows(full) + 2, rangeTop() + 2 + NARROW_CATEGORIES))
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

  // Category lines: name, then amount (9) and share (5).
  const categoryWidth = () => (wide() ? sideWidth() : dims().width - 1 - sideWidth())
  const categoryNameWidth = () => Math.max(8, categoryWidth() - 5 - 14 - BEFORE)

  // Narrow beside the Range pane, Accounts is its height: the two end on one row.
  const accountsHeight = () => (!wide() ? categoriesHeight() : accountRows(saversFull()) + 2)
  return { wide, textual, spendingView, bodyHeight, sideWidth, mainWidth, grid, charts, paneWidth, hasSavers, accountRows, saversFull, categoriesHeight, topChartHeight, bottomChartHeight, stackWidth, categoryWidth, categoryNameWidth, accountsHeight }
}

export type OverviewLayout = ReturnType<typeof createOverviewLayout>

function createChartModels(input: OverviewModel & OverviewLayout & ReturnType<typeof createOverviewChartInput>) {
  const { chartInput, paneWidth, charts, bottomChartHeight, topChartHeight } = input
  // Chart panes: border + padding (4) across; border (2), the x-axis line
  // (Settings › Database b, default off) and the x labels down. The view
  // picker and the legend sit in the borders.
  const baseline = () => data.state.uiPrefs.xAxis === true
  // The y-axis is as wide as its labels: build once with a guessed width,
  // then again if the labels need a different one.
  // The axis width each chart had last: the first guess next time, so a
  // chart is usually built once, not twice.
  const axisWas = [AXIS_GUESS, AXIS_GUESS, AXIS_GUESS, AXIS_GUESS]
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

  // The chart panes' models, after the Range pane's lines: narrow, their
  // height is what the Range pane leaves.
  const models = [0, 1, 2, 3].map(paneModel)
  const topModel = models[0]!
  return { baseline, models, topModel }
}

function createLaunchReveal(input: OverviewModel & ReturnType<typeof createChartModels>) {
  const { shown, topModel } = input
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
  // A pane's key and time under the global setting: "off", none; "always",
  // `view`'s own (with the showing); "first launch", the latched one.
  const motionKey = (view: string) => {
    const mode = data.state.uiPrefs.chartMotion
    return mode === "off" ? undefined : mode === "always" ? (revealKey() ? `${view}:${seen()}` : undefined) : revealKey()
  }
  const motionMs = () => (data.state.uiPrefs.chartMotion === "always" ? chartSpeedMs(data.state.uiPrefs.chartSpeed) : revealMs())
  return { motionKey, motionMs }
}

function createChartPane(input: OverviewModel & OverviewLayout & ReturnType<typeof createChartModels> & ReturnType<typeof createLaunchReveal> & { focused: () => SectionId }) {
  const { models, paneWidth, calendar, trends, merchants, today, baseline, range, motionKey, motionMs } = input
  return (p: { pane: number; height: number }) => {
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
        focused={input.focused() === section}
        baseline={baseline()}
        revealKey={motionKey(`${view().view}:${view().ranged ? `${range().bounds.start}:${range().bounds.end}` : ""}`)}
        revealMs={motionMs()}
        curve={data.state.uiPrefs.chartCurve}
        labels={data.state.uiPrefs.chartLabels}
      />
      </box>
    )
  }
}

// Approved narrow-layout deviation from the Go layout: the cards stack
// in two columns under one chart, and a short terminal scrolls instead
// of clipping them. Keys and focus order are unchanged.
function NarrowColumn(input: OverviewBodyInput) {
  const { shown, categoriesFocused, bodyHeight, topChartHeight, categoriesHeight, sideWidth, ChartPane, accountsCard, categoriesCard } = input
  let column: ScrollBoxRenderable | undefined
  // Only a short terminal scrolls: the Range pane's categories (its
  // last rows, the column's) into view when it has focus, Accounts' rows
  // when it has, else back to the top (the chart).
  const followFocus = () => {
    if (!shown()) return
    if (categoriesFocused()) column?.scrollTo(column.scrollHeight)
    // Accounts: its rows, at the cards' top.
    else if (input.focused() === "ov.accounts") column?.scrollChildIntoView("overview-narrow-cards")
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
      </box>
      {categoriesCard()}
    </box>
  </scrollbox>
}

type OverviewBodyInput = OverviewModel & OverviewLayout & {
  focused: () => SectionId
  categoriesFocused: () => boolean
  ChartPane: ReturnType<typeof createChartPane>
  accountsCard: () => JSX.Element
  categoriesCard: () => JSX.Element
}

function OverviewBody(input: OverviewBodyInput) {
  const { wide, bodyHeight, mainWidth, paneWidth, topChartHeight, bottomChartHeight, grid, ChartPane, accountsCard, categoriesCard } = input
  return <Show when={wide()} fallback={<NarrowColumn {...input} />}>
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
              {categoriesCard()}
          </box>
        </box>
  </Show>
}

/**
 * The overview: the Date Range (opens on the current budget cycle), two chart
 * panes cycling through spending, cash flow, balance and calendar views (h/l
 * the top or focused pane, H/L the bottom), and a column of stacks: Accounts
 * (balances now, with no range) and the Range pane (the range against the
 * same days of the previous period, as bars or text, and its categories). Spending figures cover the selected spending account
 * (see spendingScope); internal transfers and not-spending categories are
 * excluded.
 */
export function OverviewTab(props: { focused: SectionId }) {
  const rangeModel = createOverviewRange()
  const tables = createOverviewTables(rangeModel)
  const position = createOverviewPosition({ ...rangeModel, ...tables })
  const model = { ...rangeModel, ...tables, ...position }
  const layout = createOverviewLayout(model, () => rangeLines.rangeTop())
  const chartInput = createOverviewChartInput(model)
  const date = createDateChips({ ...model, focused: () => props.focused })
  const pay = createOverviewPay(model)
  const rangeLines = createRangeLines({ ...model, ...layout, ...pay })
  const charts = createChartModels({ ...model, ...layout, ...chartInput })
  const motion = createLaunchReveal({ ...model, ...charts })
  // The Range pane draws in as the charts do: each new Date Range ("always").
  const rangeReveal = useReveal(() => motion.motionKey(`Range:${model.range().bounds.start}:${model.range().bounds.end}`), motion.motionMs, () => data.state.uiPrefs.chartCurve)
  const before = createOverviewBefore(model)
  const accounts = createAccountsCard({ ...model, ...layout, focused: () => props.focused })
  // Unfocused, the lines that fit (every group, then the largest
  // subcategories). Focused, every line, scrolled to keep the cursor in view,
  // with the cursor's row highlighted (enter opens it in Transactions).
  const categoriesFocused = () => props.focused === "ov.categories"
  const counts = createOverviewCounts(model)
  const cards = { ...model, ...layout, focused: () => props.focused }
  const categories = { ...cards, ...rangeLines, ...counts, ...before, categoriesFocused, reveal: rangeReveal }
  const categoryRows = createCategoryRows(categories)
  const accountsCard = () => <AccountsCard {...cards} {...accounts} />
  const categoriesCard = () => <RangePane {...categories} {...categoryRows} />
  const ChartPane = createChartPane({ ...model, ...layout, ...charts, ...motion, focused: () => props.focused })
  return (
    <box width="100%" height="100%" flexDirection="column" backgroundColor={theme.canvas}>
      <DateRangeCard {...model} {...date} focused={() => props.focused} />
      <OverviewBody {...model} {...layout} focused={() => props.focused} categoriesFocused={categoriesFocused} ChartPane={ChartPane} accountsCard={accountsCard} categoriesCard={categoriesCard} />
      <Show when={ui.state.customEdit}>
        {(edit: () => NonNullable<typeof ui.state.customEdit>) => <CustomRangeDialog edit={edit()} />}
      </Show>
    </box>
  )
}
