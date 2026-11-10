import type { BoxRenderable, ScrollBoxRenderable } from "@opentui/core"
import { Show, createEffect, createMemo, createSignal, on, onCleanup, type JSX } from "solid-js"
import { data } from "../../state/dataStore"
import { CHART_SECTIONS, CHART_VIEWS, chartPaneOf, ui, type SectionId } from "../../state/uiStore"
import { theme } from "../../theme"
import { AXIS_GUESS, axisWidth, type ChartModel } from "../charts/ChartBody"
import { chartSpeedMs, showings, takeLaunchReveal, useReveal } from "../charts/motion"
import { hasMarks } from "../charts/reveal"
import { tabColumns } from "../primitives/columns"
import { regionRef } from "../regions"
import { CustomRangeDialog } from "./CustomRangeDialog"

import { AccountsCard, createAccountsCard } from "./AccountsCard"
import { DateRangeCard, createDateChips } from "./DateRangeCard"
import { OverviewChartCard, TABLE_VIEWS, chartRows, overviewChartModel } from "./overviewCharts"
import { createOverviewBefore, createOverviewChartInput, createOverviewCounts, createOverviewPay, createOverviewPosition, createOverviewRange, createOverviewTables, type OverviewModel } from "./overviewModel"
import { BEFORE, RangePane, createCategoryRows, createRangeLines, panePointer } from "./RangePane"
export { OverviewChartCard, TABLE_VIEWS, chartRows, overviewChartModel, type OverviewChartInput } from "./overviewCharts"

const RANGE_SIDE_MAX = 56
const NARROW_CHART_MIN = 10
const MIN_CATEGORIES = 8
const NARROW_CATEGORIES = 5

function createOverviewLayout(input: OverviewModel, rangeTop: () => number) {
  const { dims, position } = input
  const columns = createMemo(() => tabColumns(dims().width, { max: RANGE_SIDE_MAX, share: 0.45, narrow: (width) => Math.floor((width - 1) / 2) }))
  const wide = () => columns().wide
  const textual = () => data.state.uiPrefs.rangeText === true
  const spendingView = () => data.state.uiPrefs.rangeView === "spending"
  const bodyHeight = () => Math.max(8, dims().height - 7)
  const sideWidth = () => columns().side
  const mainWidth = () => columns().main
  const grid = () => columns().grid
  const charts = () => (grid() ? 4 : wide() ? 2 : 1)
  const paneWidth = (pane: number) => (!grid() ? mainWidth() : pane < 2 ? columns().left : columns().right)
  createEffect(() => {
    const n = charts()
    if (ui.state.overviewCharts !== n) ui.setState({ overviewCharts: n })
    if (chartPaneOf(ui.state.focusedSection) >= n) ui.applyJump("ov.chart")
  })

  const hasSavers = () => position().savers.length > 0
  const saverRows = (full: boolean) => (!hasSavers() ? 1 : (full ? 2 + position().savers.length : 1) + 3)
  const accountRows = (full: boolean) => 1 + (position().pendingCount > 0 ? 1 : 0) + saverRows(full)
  const lowerHeight = (full: boolean) => (wide() ? accountRows(full) + 2 : Math.max(accountRows(full) + 2, rangeTop() + 2 + NARROW_CATEGORIES))
  const saversFull = () =>
    wide()
      ? bodyHeight() - lowerHeight(true) >= MIN_CATEGORIES + 2 + rangeTop()
      : bodyHeight() - lowerHeight(true) >= NARROW_CHART_MIN
  const categoriesHeight = () => Math.max(3, wide() ? bodyHeight() - lowerHeight(saversFull()) : lowerHeight(saversFull()))
  const topChartHeight = () => (wide() ? Math.floor((bodyHeight() - 1) / 2) : Math.max(NARROW_CHART_MIN, bodyHeight() - lowerHeight(saversFull())))
  const bottomChartHeight = () => topChartHeight()
  const stackWidth = () => sideWidth() - 4

  const categoryWidth = () => (wide() ? sideWidth() : dims().width - 1 - sideWidth())
  const categoryNameWidth = () => Math.max(8, categoryWidth() - 5 - 14 - BEFORE)

  const accountsHeight = () => (!wide() ? categoriesHeight() : accountRows(saversFull()) + 2)
  return { wide, textual, spendingView, bodyHeight, sideWidth, mainWidth, grid, charts, paneWidth, hasSavers, accountRows, saversFull, categoriesHeight, topChartHeight, bottomChartHeight, stackWidth, categoryWidth, categoryNameWidth, accountsHeight }
}

export type OverviewLayout = ReturnType<typeof createOverviewLayout>

function createChartModels(input: OverviewModel & OverviewLayout & ReturnType<typeof createOverviewChartInput>) {
  const { chartInput, paneWidth, charts, bottomChartHeight, topChartHeight } = input
  const baseline = () => data.state.uiPrefs.xAxis === true
  const axisWas = [AXIS_GUESS, AXIS_GUESS, AXIS_GUESS, AXIS_GUESS]
  const model = (slot: number, index: number, height: number): ChartModel | null => {
    const m = overviewChartModel((CHART_VIEWS[index] ?? CHART_VIEWS[0]).view, chartInput, paneWidth(slot) - 4, chartRows(height, baseline()), axisWas[slot])
    if (m && m.ticks.size) axisWas[slot] = axisWidth(m.ticks)
    return m
  }
  const paneModel = (slot: number) => {
    const view = createMemo(() => ui.state.chartViews[slot]!)
    return createMemo(() => (slot < charts() ? model(slot, view(), slot % 2 ? bottomChartHeight() : topChartHeight()) : null))
  }

  const models = [0, 1, 2, 3].map(paneModel)
  const topModel = models[0]!
  return { baseline, models, topModel }
}

function createLaunchReveal(input: OverviewModel & ReturnType<typeof createChartModels>) {
  const { shown, topModel } = input
  const launchReveal = takeLaunchReveal()
  const [launchOver, setLaunchOver] = createSignal(!launchReveal)
  const revealMs = () => (launchOver() ? 0 : chartSpeedMs(data.state.uiPrefs.chartSpeed))
  const seen = showings(() => shown() && !ui.state.welcome)
  const drawable = () => {
    const top = CHART_VIEWS[ui.state.chartViews[0]]?.view
    return (top != null && TABLE_VIEWS.has(top)) || hasMarks(topModel()?.rows ?? [])
  }
  const revealKey = createMemo<string | undefined>((was) => was ?? (data.state.ready && !ui.state.welcome && drawable() ? "launch" : undefined))
  createEffect(on(revealKey, (key) => {
    if (!key || launchOver()) return
    const timer = setTimeout(() => setLaunchOver(true), revealMs() + 500)
    onCleanup(() => clearTimeout(timer))
  }))
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

function NarrowColumn(input: OverviewBodyInput) {
  const { shown, categoriesFocused, bodyHeight, topChartHeight, categoriesHeight, sideWidth, ChartPane, accountsCard, categoriesCard } = input
  let column: ScrollBoxRenderable | undefined
  const followFocus = () => {
    if (!shown()) return
    if (categoriesFocused()) column?.scrollTo(column.scrollHeight)
    else if (input.focused() === "ov.accounts") column?.scrollChildIntoView("overview-narrow-cards")
    else column?.scrollTo(0)
  }
  createEffect(followFocus)
  onCleanup(() => { column = undefined })
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
  const rangeReveal = useReveal(() => motion.motionKey(`Range:${model.range().bounds.start}:${model.range().bounds.end}`), motion.motionMs, () => data.state.uiPrefs.chartCurve)
  const before = createOverviewBefore(model)
  const accounts = createAccountsCard({ ...model, ...layout, focused: () => props.focused })
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
