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

export const chartRows = (height: number, baseline: boolean) => Math.max(1, height - (baseline ? 4 : 3))

export const TABLE_VIEWS: ReadonlySet<string> = new Set(["Calendar", "Merchants", "Trends"])

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

export function OverviewChartCard(props: ChartCardProps & {
  index: number
  views?: readonly number[]
  calendar: Array<Array<CalendarDay | null>>
  trends: { groups: TrendGroup[]; rows: TrendRow[] }
  merchants: MerchantRow[]
  today: string
}) {
  const view = () => CHART_VIEWS[props.index] ?? CHART_VIEWS[0]
  const fallback = () => TABLE_VIEWS.has(view().view)
  const progress = useReveal(() => (fallback() ? props.revealKey : undefined), () => props.revealMs ?? 0, () => props.curve)
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

