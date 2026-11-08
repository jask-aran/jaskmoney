import { createMemo } from "solid-js"
import type { WeekStart } from "../../domain/days"
import type { MerchantRow, TrendGroup, TrendRow } from "../../domain/periodTables"
import type { CalendarDay } from "../../domain/spending"
import type { Account, Transaction } from "../../domain/types"
import { CHART_VIEWS, cycleView } from "../../state/uiStore"
import { AXIS_GUESS, CHART_RIGHT_PAD, axisWidth, type ChartModel } from "../charts/ChartBody"
import { ChartCard, type ChartCardProps } from "../charts/ChartCard"
import { useReveal } from "../charts/motion"
import { CalendarView, calendarLegend } from "./CalendarView"
import { balancesChart, cashFlowChart, spendingChart, type PeriodNames } from "./periodCharts"
import { MerchantsView, TrendsView, merchantsLegend, trendsLegend } from "./TableViews"

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
export function OverviewChartCard(props: ChartCardProps & {
  index: number
  /** The views its picker offers (indexes into CHART_VIEWS): all of them
   * unless given (the Budgets tab's cycle panes: CYCLE_VIEWS). */
  views?: readonly number[]
  calendar: Array<Array<CalendarDay | null>>
  trends: { groups: TrendGroup[]; rows: TrendRow[] }
  merchants: MerchantRow[]
  today: string
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
      views={props.views ? props.views.map(cycleView) : CHART_VIEWS}
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

