import { useTerminalDimensions } from "@opentui/solid"
import { createMemo } from "solid-js"
import { allocation, budgetProgress, cycleFor, cycleSpending, progressOf } from "../../domain/budget"
import { computeCategorySpend, dailySpendSeries, groupCategorySpend } from "../../domain/dashboard"
import { addDays, appToday } from "../../domain/days"
import { isSpending, isUncategorised, isUnsortedIn } from "../../domain/moneyRules"
import { cyclePay } from "../../domain/payday"
import { merchantRows, trendRows } from "../../domain/periodTables"
import { computePeriodFlows, computePosition, historyCovers, projectAvailable, usualDailySpend } from "../../domain/position"
import { spendingCalendar } from "../../domain/spending"
import { subscriptions, upcomingCharges } from "../../domain/subscriptions"
import { comparisonWindows, filterByTimeframe } from "../../domain/timeframe"
import { accountRole, type Transaction } from "../../domain/types"
import { data } from "../../state/dataStore"
import { overviewRange } from "../../state/overviewRange"
import { CHART_VIEWS, ui } from "../../state/uiStore"
import { type PeriodNames } from "./periodCharts"

import type { OverviewChartInput } from "./overviewCharts"

export function createOverviewRange() {
  const shown = () => ui.state.activeTab === "overview"
  const held = <T,>(fn: () => T): (() => T) => createMemo<T | undefined>((was) => (shown() || was === undefined ? fn() : was)) as () => T
  const terminal = useTerminalDimensions()
  const dims = held(() => terminal())
  const transactions = held(() => data.transactions())
  const shownOn = held(() => appToday())
  const today = () => (shownOn(), appToday())
  const cycleConfig = held(() => data.cycle())
  const rangeAccounts = held(() => data.state.accounts)
  const rangeSelection = held(() => data.state.accountSelection)
  const rangeCategories = held(() => data.state.categories)
  const range = createMemo(() => overviewRange({ state: { accounts: rangeAccounts(), accountSelection: rangeSelection(), categories: rangeCategories() }, transactions, cycle: cycleConfig }, ui.state))
  const clock = () => range().clock
  const bounds = () => range().bounds
  const scope = () => range().scope
  const scopeIds = () => range().scopeIds
  const windows = createMemo(() => comparisonWindows(bounds().start, bounds().end, today()))
  const previous = () => windows().previous
  const spending = () => range().spending
  const inPeriod = () => range().inPeriod
  const inPrevious = createMemo(() => {
    const { start, end } = previous()
    return transactions().filter((t) => t.dateISO >= start && t.dateISO <= end)
  })
  const flows = createMemo(() => computePeriodFlows(data.state.accounts, filterByTimeframe(transactions(), ui.state.timeframe, clock(), cycleConfig()), scopeIds()))
  const previousFlows = createMemo(() => computePeriodFlows(data.state.accounts, inPrevious(), scopeIds()))
  const covered = createMemo(() => windows().days === 0 || historyCovers(transactions(), previous(), { start: bounds().start, end: addDays(bounds().start, windows().days - 1) }))
  const groups = () => range().groups
  return { shown, dims, transactions, today, cycleConfig, range, clock, bounds, scope, scopeIds, windows, previous, spending, inPeriod, inPrevious, flows, previousFlows, covered, groups }
}

export function createOverviewTables(input: ReturnType<typeof createOverviewRange>) {
  const { inPeriod, bounds, today, scopeIds, covered, inPrevious, cycleConfig } = input
  const shownViews = () => ui.state.chartViews.slice(0, ui.state.overviewCharts)
  const calendarShown = () => shownViews().some((i) => CHART_VIEWS[i]?.view === "Calendar")
  const calendar = createMemo(() => (calendarShown() ? spendingCalendar(inPeriod(), bounds().start, bounds().end, data.state.weekStart) : []))
  const inScope = (rows: Transaction[]) => {
    const ids = scopeIds()
    return rows.filter((t) => t.accountId != null && ids.has(t.accountId))
  }
  const shows = (view: string) => shownViews().some((i) => CHART_VIEWS[i]?.view === view)
  const trends = createMemo(() => (shows("Trends") ? trendRows(inPeriod(), data.state.categories, bounds().start, bounds().end, today(), data.state.weekStart) : { groups: [], rows: [] }))
  const merchants = createMemo(() => (shows("Merchants") ? merchantRows(inPeriod(), covered() ? inScope(inPrevious()) : null) : []))
  const series = createMemo(() => dailySpendSeries(inPeriod(), bounds().start, bounds().end))
  const payday = () => addDays(cycleFor(cycleConfig(), today()).end, 1)

  return { shownViews, calendar, inScope, trends, merchants, series, payday }
}

export function createOverviewPosition(input: ReturnType<typeof createOverviewRange> & ReturnType<typeof createOverviewTables>) {
  const { today, transactions, shownViews, payday, bounds, inScope, scopeIds, cycleConfig } = input
  const position = createMemo(() => computePosition(data.state.accounts, transactions(), today()))
  const saverChanges = createMemo(() => {
    const now = today(), since = addDays(now, -30)
    return computePeriodFlows(data.state.accounts, transactions().filter((t) => t.dateISO > since && t.dateISO <= now)).saverChanges
  })
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

  const periodNames = (): PeriodNames => {
    const tf = ui.state.timeframe
    if (tf.family !== "period") return { current: "Range", previous: "Before" }
    const unit = PERIOD_UNIT[tf.period]
    return { current: `This ${unit}`, previous: `Last ${unit}` }
  }

  return { position, saverChanges, projection, change30, budget, periodNames }
}

export function createOverviewChartInput(input: OverviewModel) {
  const { series, today, spending, budget, periodNames, transactions, scopeIds, projection } = input
  const chartInput: OverviewChartInput = {
    get series() { return series() }, get today() { return today() }, get spending() { return spending() },
    get budget() { return budget()?.budget.amount }, get names() { return periodNames() }, get weekStart() { return data.state.weekStart },
    get accounts() { return data.state.accounts }, get transactions() { return transactions() }, get scopeIds() { return scopeIds() },
    get zeroAxis() { return data.state.uiPrefs.zeroAxis === true }, get projection() { return projection() },
  }
  return { chartInput }
}

export function createOverviewBefore(input: OverviewModel) {
  const { covered, inScope, inPrevious } = input
  const beforeSpend = createMemo(() => {
    if (!covered()) return null
    const list = computeCategorySpend(inScope(inPrevious()), data.state.categories)
    const by = new Map<string, number>()
    for (const c of list) by.set(`c${c.categoryId}`, (by.get(`c${c.categoryId}`) ?? 0) + c.amount)
    for (const g of groupCategorySpend(list, data.state.categories)) by.set(`g${g.categoryId}`, g.amount)
    return by
  })
  return { beforeSpend }
}

export function createOverviewCounts(input: OverviewModel) {
  const { inPeriod } = input
  const uncategorised = createMemo(() => inPeriod().filter((t) => isUncategorised(t) && (isSpending(t) || isUnsortedIn(t))).length)
  const toReview = createMemo(() => data.accountScoped().filter((t) => data.state.suggestions[t.id]).length)
  return { uncategorised, toReview }
}

export function createOverviewPay(input: OverviewModel) {
  const { transactions, bounds } = input
  const rangePay = createMemo(() => cyclePay(data.state.accounts, transactions(), bounds().start, bounds().end))
  return { rangePay }
}

export type OverviewModel = ReturnType<typeof createOverviewRange> & ReturnType<typeof createOverviewTables> & ReturnType<typeof createOverviewPosition>

const PERIOD_UNIT: Record<string, string> = { cycle: "cycle", month: "month", qtr: "quarter", half: "half", fy: "FY", year: "year" }

