/**
 * The Overview (the TUI's OverviewTab): the Date Range (lookbacks, periods,
 * Custom, ‹ › to step, the spending scope), two chart panes over it, each
 * with its own view (Spending, Cash flow, Balances, Calendar,
 * Subscriptions), and beside them (under them on a phone) Accounts
 * (balances now, whatever the range), Totals (the range against the same
 * days of the period before, with the budget when the range is this
 * cycle) and Categories (a line opens Transactions filtered to it).
 * Figures come from the same domain functions as the TUI's, so the two
 * read the same. Hidden, the costly figures keep their last values.
 */
import { For, Show, createEffect, createMemo, createSignal, untrack, type JSX } from "solid-js"
import "./overview.css"
import { accountRole } from "../../domain/types"
import { allocation, budgetProgress, cycleFor, cycleSpending, progressOf, type BudgetProgress } from "../../domain/budget"
import { dailySpendSeries, formatMoney, formatPct, formatWholeMoney, signedWholeMoney, type CategoryLine } from "../../domain/dashboard"
import { addDays, appNow, appToday } from "../../domain/days"
import { drillFilter } from "../../domain/drill"
import { isSpending, isUncategorised, isUnsortedIn } from "../../domain/moneyRules"
import { computePeriodFlows, computePosition, historyCovers, projectAvailable, usualDailySpend } from "../../domain/position"
import { spendingCalendar } from "../../domain/spending"
import { subscriptions, upcomingCharges } from "../../domain/subscriptions"
import {
  CUSTOM_CHIP, LOOKBACKS, PERIODS, PERIOD_LABEL, activeChipIndex, applyChip, comparisonWindows, customRange, defaultTimeframe,
  filterByTimeframe, offsetLabel, periodOffset, stepCustom, stepPeriod, timeframeBounds, timeframeNow, type TimeframeState,
} from "../../domain/timeframe"
import { count } from "../../domain/words"
import { allCategoryLines, overviewRange } from "../../state/overviewRange"
import type { CycleConfig } from "../../domain/budget"
import { Chart, Legend, type ChartModel, type LegendItem } from "../charts"
import { compact, data, kept, now, say, setTab, tab, useKeys } from "../store"
import { ArrowLeftRight, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, Landmark, Repeat, Wallet } from "lucide-solid"
import { BottomSheet, Chips, PageHeader, Section } from "../kit"
import { Button, GroupHeading, Input, Segmented } from "../v2"
import { catColor } from "../theme"
import { balancesChart, cashFlowChart, changeCls, spendChangeCls, spendingChart, type PeriodNames } from "./overview/periodCharts"
import { CalendarView, calendarLegend } from "./overview/CalendarView"
import { SubscriptionsView, subscriptionsLegend } from "./overview/Subscriptions"

/** The chart panes' views, in order, each with its group (the TUI's CHART_VIEWS). */
export const CHART_VIEWS = [
  { view: "Cumulative", group: "Spending" },
  { view: "Daily", group: "Spending" },
  { view: "Weekly", group: "Spending" },
  { view: "Cash flow", group: "Cash flow" },
  { view: "Net position", group: "Balances" },
  { view: "Available", group: "Balances" },
  { view: "Savers", group: "Balances" },
  { view: "Calendar", group: "Calendar" },
  { view: "Subscriptions", group: "Subscriptions" },
] as const
export type ChartView = (typeof CHART_VIEWS)[number]["view"]
/** The Budgets tab's: the Overview's spending ones. */
export const BUDGET_VIEWS = CHART_VIEWS.filter((v) => v.group === "Spending")

const PERIOD_UNIT: Record<string, string> = { cycle: "cycle", month: "month", qtr: "quarter", half: "half", fy: "FY", year: "year" }

/** A range kept from an earlier visit: periods reopen on today's instance;
 * a custom range survives (uiPrefs.restoreUiPrefs). */
function restoreTimeframe(saved: TimeframeState | null, cycle: CycleConfig): TimeframeState {
  const nowDate = appNow()
  let tf = defaultTimeframe(nowDate, cycle)
  if (!saved) return tf
  const range = saved.custom ? customRange(saved.custom.start, saved.custom.end) : null
  const custom = typeof range === "string" ? null : range
  tf = { ...tf, ...saved, custom }
  if (saved.family === "custom" && !custom) tf = { ...tf, family: "period" }
  return applyChip(tf, activeChipIndex(tf), nowDate, cycle)
}

/** Each chart group's mark in the switch (the TUI picks views by icon too). */
const GROUP_ICON: Record<string, () => JSX.Element> = {
  Spending: () => <Wallet />, "Cash flow": () => <ArrowLeftRight />, Balances: () => <Landmark />, Calendar: () => <CalendarDays />, Subscriptions: () => <Repeat />,
}

/**
 * A chart pane: its heading (the view's group, and the view), the views
 * as switches (the group, then its views when it has several), the chart
 * (or a view that isn't one: the calendar), its legend.
 */
export function ChartPane(props: {
  views: ReadonlyArray<{ view: string; group: string }>
  current: number
  onView: (index: number) => void
  title?: string
  build?: (width: number, height: number) => ChartModel
  onPick?: (index: number) => void
  legend?: LegendItem[]
  children?: JSX.Element
  class?: string
}) {
  const view = () => props.views[props.current] ?? props.views[0]!
  const title = () => props.title ?? view().group
  const groups = createMemo(() => [...new Set(props.views.map((v) => v.group))])
  const inGroup = createMemo(() => props.views.map((v, i) => ({ ...v, i })).filter((v) => v.group === view().group))
  // A group remembers the view it last showed.
  const last = new Map<string, number>()
  const chooseGroup = (group: string) => {
    last.set(view().group, props.current)
    props.onView(last.get(group) ?? props.views.findIndex((v) => v.group === group))
  }
  return (
    <section class={`chart-pane ${props.class ?? ""}`} data-views={inGroup().length > 1 ? "" : undefined}>
      <header class="chart-head">
        <GroupHeading>{title()}<Show when={title() !== view().view}><span>{view().view}</span></Show></GroupHeading>
        <div class="chart-switches">
          <Show when={inGroup().length > 1}>
            <Chips class="view-seg" label="View" options={inGroup().map((v) => ({ value: v.i, label: v.view }))} value={props.current} onChange={props.onView} />
          </Show>
          <Show when={groups().length > 1}>
            <span class="group-seg">
              <Segmented size="sm" icons label="Chart" value={view().group} onChange={chooseGroup}
                options={groups().map((g) => ({ value: g, label: g, icon: GROUP_ICON[g]?.() }))} />
            </span>
          </Show>
        </div>
      </header>
      <Show when={props.build} fallback={<div class="pane-fill">{props.children}<Legend items={props.legend ?? []} /></div>}>
        <Chart build={props.build!} onPick={props.onPick} />
      </Show>
    </section>
  )
}

export function Overview() {
  const shown = () => tab() === "overview"
  // Hidden (another tab), the costly figures keep their last values.
  const live = <T,>(fn: () => T): (() => T) => createMemo<T | undefined>((was) => (shown() || was === undefined ? fn() : was)) as () => T
  const today = createMemo(() => { now(); return appToday() })
  const cycleConfig = () => data.cycle()

  // The range and the views, kept in this browser.
  const [savedTf, keepTf] = kept<TimeframeState | null>("overview.timeframe", null)
  const [timeframe, setTimeframeSignal] = createSignal<TimeframeState>(untrack(() => restoreTimeframe(savedTf(), cycleConfig())))
  const setTimeframe = (tf: TimeframeState) => { setTimeframeSignal(tf); keepTf(tf) }
  const [views, setViews] = kept<[number, number]>("overview.charts", [0, 4])
  const setView = (pane: 0 | 1, index: number) => { const v: [number, number] = [...views()]; v[pane] = index; setViews(v) }
  const viewName = (pane: 0 | 1) => (CHART_VIEWS[views()[pane]] ?? CHART_VIEWS[0]).view

  const range = live(() => { today(); return overviewRange(data, { timeframe: timeframe() }) })
  const bounds = () => range().bounds
  const scope = () => range().scope
  const scopeIds = () => range().scopeIds
  const windows = createMemo(() => comparisonWindows(bounds().start, bounds().end, today()))
  const previous = () => windows().previous
  const inPrevious = live(() => data.transactions().filter((t) => t.dateISO >= previous().start && t.dateISO <= previous().end))
  // Flows see every tracked account (money moved to savers), narrowed to
  // the scope for spending and income.
  const flows = live(() => computePeriodFlows(data.state.accounts, filterByTimeframe(data.transactions(), timeframe(), range().clock, cycleConfig()), scopeIds()))
  const previousFlows = live(() => computePeriodFlows(data.state.accounts, inPrevious(), scopeIds()))
  const covered = live(() => windows().days === 0 || historyCovers(data.transactions(), previous(), { start: bounds().start, end: addDays(bounds().start, windows().days - 1) }))
  const before = (text: string) => (covered() ? text : "—")
  const series = live(() => dailySpendSeries(range().inPeriod, bounds().start, bounds().end))
  const calendar = live(() => spendingCalendar(range().inPeriod, bounds().start, bounds().end, data.state.weekStart))
  const payday = () => addDays(cycleFor(cycleConfig(), today()).end, 1)
  const scopedRows = live(() => data.transactions().filter((t) => t.accountId != null && scopeIds().has(t.accountId)))
  // Regular payments now, from the scope's whole history; built only while a pane shows them.
  const subsShown = () => views().some((i) => CHART_VIEWS[i]?.view === "Subscriptions")
  const subs = live(() => (subsShown() ? subscriptions(scopedRows(), today()) : []))
  const dueBeforePayday = () => upcomingCharges(subs(), today(), addDays(payday(), -1)).reduce((sum, c) => sum + c.amount, 0)

  // Accounts: point-in-time figures, whatever the range.
  const position = live(() => computePosition(data.state.accounts, data.transactions(), today()))
  const saverChanges = live(() => {
    const since = addDays(today(), -30)
    return computePeriodFlows(data.state.accounts, data.transactions().filter((t) => t.dateISO > since && t.dateISO <= today())).saverChanges
  })
  // Where Available is headed, up to the day before the next payday (or the
  // range's end): built only while a pane shows Available.
  const availableShown = () => views().some((i) => CHART_VIEWS[i]?.view === "Available")
  const projection = live(() => {
    const p = position()
    if (!availableShown() || p.spendingBalance == null || p.dailySpend == null) return []
    const until = [addDays(payday(), -1), bounds().end].sort()[0]!
    if (until <= today()) return []
    const regular = subscriptions(scopedRows(), today(), { people: true })
    const usual = usualDailySpend(data.state.accounts, data.transactions(), today(), new Set(regular.flatMap((s) => s.chargeIds)))
    return projectAvailable(p.spendingBalance, today(), until, usual, upcomingCharges(regular, today(), until))
  })
  const change30 = () => {
    const h = position().history
    return h.length >= 31 ? h[h.length - 1]!.value - h[h.length - 31]!.value : 0
  }
  // The budget for the spending in scope, while the range is this cycle:
  // every budget added up against all spending (all spending accounts), or
  // the one selected account's own.
  const budget = live((): BudgetProgress | null => {
    const ids = [...scopeIds()]
    const all = data.state.accounts.filter((a) => accountRole(a) === "spending").every((a) => scopeIds().has(a.id))
    const current = cycleFor(cycleConfig(), today())
    if (bounds().start !== current.start || bounds().end !== current.end) return null
    if (all) {
      const total = allocation(data.state.budgets, data.state.categories)
      if (total.overall == null && !total.allocated) return null
      const spent = cycleSpending(current, today(), data.state.accounts, data.transactions()).reduce((sum, t) => sum - t.amount, 0)
      return progressOf({ id: -1, scope: { kind: "overall" }, amount: total.total }, spent, current, today())
    }
    const match = data.state.budgets.find((b) => b.scope.kind === "account" && ids.length === 1 && b.scope.accountId === ids[0])
    return match ? budgetProgress([match], cycleConfig(), today(), data.state.accounts, data.state.categories, data.transactions())[0] ?? null : null
  })
  const periodNames = (): PeriodNames => {
    const tf = timeframe()
    if (tf.family !== "period") return { current: "Range", previous: "Before" }
    const unit = PERIOD_UNIT[tf.period]
    return { current: `This ${unit}`, previous: `Last ${unit}` }
  }

  // A pane's chart: its model for the plot's size.
  const builder = (pane: 0 | 1) => (width: number, height: number): ChartModel => {
    const v = viewName(pane)
    if (v === "Daily" || v === "Cumulative" || v === "Weekly") return spendingChart(v, series(), width, height, today(), range().spending, budget()?.budget.amount, periodNames(), data.state.weekStart)
    if (v === "Cash flow") return cashFlowChart(series().dates, width, today(), data.state.accounts, data.transactions(), scopeIds(), data.state.weekStart)
    return balancesChart(v as "Net position" | "Available" | "Savers", series().dates, width, height, today(), data.state.accounts, data.transactions(), data.state.weekStart, data.state.uiPrefs.zeroAxis === true, v === "Available" ? projection() : [])
  }
  // Clicking a day or a week of spending opens its rows in Transactions.
  const pick = (pane: 0 | 1) => (index: number) => {
    const v = viewName(pane)
    const dates = series().dates
    if (v === "Daily" && dates[index] && dates[index]! <= today()) drill(undefined, { start: dates[index]!, end: dates[index]! })
  }

  // Drill-down (the TUI's enter): Transactions filtered to the range's
  // spending in scope, a category line's, or a day's.
  const drill = (line?: CategoryLine, span?: { start: string; end: string }) => {
    const r = range()
    const query = drillFilter({
      start: span?.start ?? r.bounds.start,
      end: span?.end ?? r.bounds.end,
      accounts: r.scope.accounts.map((a) => a.name),
      category: line ? { id: line.categoryId, name: line.label } : undefined,
      categories: data.state.categories,
    })
    if (data.state.accountSelection === "savers") data.setAccountSelection("all")
    const result = data.commitFilter(query)
    if (!result.ok) { say(result.err, true); return }
    setTab("transactions")
    const n = data.scopedTransactions().length
    say(`${line?.label ?? "Spending"} · ${span ? (span.start === span.end ? span.start : `${span.start} – ${span.end}`) : r.bounds.label} · ${count(n, "transaction")}`)
  }

  // Date Range.
  const steppable = () => timeframe().family !== "lookback"
  const offsetText = createMemo(() => { today(); return offsetLabel(timeframe().period, periodOffset(timeframe(), appNow(), cycleConfig())) })
  const [customOpen, setCustomOpen] = createSignal(false)
  const chooseChip = (index: number) => {
    if (index === CUSTOM_CHIP) {
      if (timeframe().custom && timeframe().family !== "custom") { setTimeframe(applyChip(timeframe(), index, appNow(), cycleConfig())); return }
      setCustomOpen(true)
      return
    }
    setTimeframe(applyChip(timeframe(), index, appNow(), cycleConfig()))
    setCustomOpen(false)
  }
  const step = (delta: number) => {
    const tf = timeframe()
    if (tf.family === "period") {
      const next = stepPeriod(tf, delta, cycleConfig())
      setTimeframe(next)
      say(`${PERIOD_LABEL[next.period]} · ${timeframeBounds(next, appNow(), cycleConfig()).label}`)
    } else if (tf.family === "custom") {
      const next = stepCustom(tf, delta)
      setTimeframe(next)
      say(`Custom · ${timeframeBounds(next, appNow(), cycleConfig()).label}`)
    } else say(`${tf.lookback} always ends today · [ ] step Cycle, Month… and Custom ranges`)
  }
  const toNow = () => {
    const tf = timeframeNow(timeframe(), appNow(), cycleConfig())
    setTimeframe(tf)
    say(`Now · ${timeframeBounds(tf, appNow(), cycleConfig()).label}`)
  }
  // Which spending account the period covers: all, or one of them (the TUI's a).
  const scopeChoices = createMemo(() => {
    const spending = data.state.accounts.filter((a) => accountRole(a) === "spending")
    return spending.length > 1 ? [{ value: "all" as const, label: "All spending" }, ...spending.map((a) => ({ value: a.id, label: a.name }))] : []
  })
  const scopeValue = () => (typeof data.state.accountSelection === "number" ? data.state.accountSelection : "all")
  // A phone chooses the spending account from the header's pill.
  const [scopeOpen, setScopeOpen] = createSignal(false)
  const setScope = (value: "all" | number) => {
    data.setAccountSelection(value)
    say(`Overview · ${scope().label}`)
  }

  // On a phone the range switch scrolls: keep its choice in view.
  createEffect(() => {
    activeChipIndex(timeframe())
    if (shown()) queueMicrotask(() => document.querySelector('.ov-range .range-seg [aria-checked="true"]')?.scrollIntoView({ inline: "center", block: "nearest" }))
  })

  useKeys((event) => {
    if (!shown()) return false
    if (event.key === "[" || event.key === "]") { step(event.key === "[" ? -1 : 1); return true }
    if (event.key === "0") { toNow(); return true }
    if (event.key === "a" && scopeChoices().length) {
      const choices = scopeChoices().map((c) => c.value)
      setScope(choices[(choices.indexOf(scopeValue()) + 1) % choices.length]!)
      return true
    }
    return false
  })

  // Accounts.
  const available = () => position().spendingBalance
  const saverChange = (accountId: number) => saverChanges().find((c) => c.accountId === accountId)?.change ?? 0
  const saversTotalChange = () => saverChanges().reduce((sum, c) => sum + c.change, 0)

  // Categories: every line, groups then their subcategories.
  const lines = live(() => allCategoryLines(range()))
  const uncategorised = live(() => range().inPeriod.filter((t) => isUncategorised(t) && (isSpending(t) || isUnsortedIn(t))).length)
  const toReview = live(() => data.accountScoped().filter((t) => data.state.suggestions[t.id]).length)
  const openUncategorised = () => { data.setUncategorisedOnly(true); setTab("transactions") }

  const pane = (p: 0 | 1) => (
    <ChartPane views={CHART_VIEWS} current={views()[p]} onView={(i) => setView(p, i)}
      build={["Calendar", "Subscriptions"].includes(viewName(p)) ? undefined : builder(p)}
      onPick={pick(p)}
      legend={viewName(p) === "Subscriptions" ? subscriptionsLegend(subs(), dueBeforePayday()) : calendarLegend(calendar(), today(), data.state.weekStart)}>
      <Show when={viewName(p) === "Subscriptions"} fallback={<CalendarView weeks={calendar()} today={today()} weekStart={data.state.weekStart} onPick={(iso) => drill(undefined, { start: iso, end: iso })} />}>
        <SubscriptionsView list={subs()} today={today()} payday={payday()} categories={data.state.categories} />
      </Show>
    </ChartPane>
  )

  // The range's controls: the dates (‹ › step them) and how far from now.
  const rangeActions = () => (
    <div class="range-dates">
      <Show when={offsetText()}>
        <span class="note small">{offsetText()} · </span>
        <Button variant="ghost" size="sm" onClick={toNow} title="Back to the current one (0)">Now</Button>
      </Show>
      <Button variant="ghost" size="icon-sm" disabled={!steppable()} onClick={() => step(-1)} aria-label="Earlier" title="Earlier ([)"><ChevronLeft /></Button>
      <span class="scope range-label">{bounds().label}</span>
      <Button variant="ghost" size="icon-sm" disabled={!steppable()} onClick={() => step(1)} aria-label="Later" title="Later (])"><ChevronRight /></Button>
    </div>
  )

  // A phone's range: earlier and later either side of the dates, how far from now under them, Now (or a custom
  // range's Dates…) at the end; every control a finger's size.
  const phoneStepper = () => (
    <div class="ov-stepper">
      <Button variant="ghost" size="icon" class="step" disabled={!steppable()} onClick={() => step(-1)} aria-label="Earlier"><ChevronLeft /></Button>
      <div class="mid">
        <span class="scope range-label">{bounds().label}</span>
        <Show when={offsetText() || scopeChoices().length}>
          <span class="note small">
            {offsetText()}
            <Show when={scopeChoices().length}>
              <button type="button" class="ov-scope" onClick={() => setScopeOpen(true)}>{offsetText() ? "· " : ""}{scope().label}<ChevronDown /></button>
            </Show>
          </span>
        </Show>
      </div>
      <Button variant="ghost" size="icon" class="step" disabled={!steppable()} onClick={() => step(1)} aria-label="Later"><ChevronRight /></Button>
      <Show when={timeframe().family === "custom"} fallback={
        <Show when={offsetText()}><Button variant="secondary" size="sm" class="now" onClick={toNow}>Now</Button></Show>
      }>
        <Button variant="secondary" size="sm" class="now" onClick={() => setCustomOpen(true)}>Dates…</Button>
      </Show>
    </div>
  )
  const customForm = () => (
    <CustomRange start={timeframe().custom?.start ?? bounds().start} end={timeframe().custom?.end ?? bounds().end}
      onApply={(r) => { setTimeframe({ ...timeframe(), family: "custom", custom: r }); setCustomOpen(false) }}
      onCancel={() => setCustomOpen(false)} />
  )

  return (
    <>
      <PageHeader title="Overview" place={scope().label} actions={rangeActions()} phone={phoneStepper()} />
      <div class="ov">
        <div class="ov-range">
          <Chips class="range-seg" label="Range" options={[...LOOKBACKS, ...PERIODS.map((p) => PERIOD_LABEL[p]), "Custom"].map((label, i) => ({ value: i, label }))}
            value={activeChipIndex(timeframe())} onChange={chooseChip} />
          <Show when={!compact()}>
            <Show when={timeframe().family === "custom" || customOpen()}>
              <Button variant="ghost" size="sm" onClick={() => setCustomOpen(!customOpen())}>{customOpen() ? "Close" : "Dates…"}</Button>
            </Show>
            <Show when={scopeChoices().length}><Chips label="Spending account" options={scopeChoices()} value={scopeValue()} onChange={setScope} /></Show>
          </Show>
        </div>
        <Show when={customOpen()}>
          <Show when={compact()} fallback={customForm()}>
            <BottomSheet label="Custom range" head={<span class="jm-drawer-title">Custom range</span>} onClose={() => setCustomOpen(false)}>{customForm()}</BottomSheet>
          </Show>
        </Show>
        <Show when={compact() && scopeOpen()}>
          <BottomSheet label="Spending account" head={<span class="jm-drawer-title">Spending account</span>} onClose={() => setScopeOpen(false)}>
            <div class="ov-choices" role="radiogroup" aria-label="Spending account">
              <For each={scopeChoices()}>{(c) => (
                <button type="button" role="radio" class="ov-choice" aria-checked={scopeValue() === c.value} onClick={() => { setScope(c.value); setScopeOpen(false) }}>
                  <span class="grow ellipsis">{c.label}</span><Show when={scopeValue() === c.value}><Check /></Show>
                </button>
              )}</For>
            </div>
          </BottomSheet>
        </Show>

        <div class="ov-body">
          <div class="ov-charts">
            {pane(0)}
            {pane(1)}
          </div>

          <div class="ov-side">
            <Section title="Accounts">
              <div class="stats">
                <span class="k figure strong-label hero">Available</span><span class="v strong hero">{available() != null ? formatMoney(available()!) : "—"}</span><span class="n" />
                <Show when={position().pendingCount > 0 && available() != null}>
                  <span class="k">Balance</span><span class="v label">{formatMoney(available()! - position().pendingAmount)}</span><span class="n" />
                  <span class="n wide">{formatWholeMoney(-position().pendingAmount)} pending · {position().pendingCount} txn</span>
                </Show>
                <span class="k">Runway</span><span class="v">{position().runwayDays != null ? `${Math.round(position().runwayDays!)} days` : "—"}</span>
                <span class="n">{position().dailySpend != null ? `${formatWholeMoney(position().dailySpend!)}/day` : ""}</span>
                <span class="k">30 day change</span><span class={`v ${changeCls(change30())}`}>{signedWholeMoney(change30())}</span><span class="n" />
                <Show when={position().savers.length > 0}>
                  <span class="sub">Savers</span><span class="n head">30 days</span>
                  <For each={position().savers}>{(saver) => (
                    <>
                      <span class="k indent" title={saver.name}><span class="ellipsis">{saver.name}</span></span>
                      <span class="v label">{formatWholeMoney(saver.balance)}</span>
                      <span class={`n ${changeCls(saverChange(saver.accountId))}`}>{signedWholeMoney(saverChange(saver.accountId))}</span>
                    </>
                  )}</For>
                  <span class="k indent">Total</span><span class="v">{formatWholeMoney(position().saversTotal)}</span>
                  <span class={`n ${changeCls(saversTotalChange())}`}>{signedWholeMoney(saversTotalChange())}</span>
                  <span class="k figure strong-label">Net position</span><span class="v strong">{position().netPosition != null ? formatMoney(position().netPosition!) : "—"}</span><span class="n" />
                </Show>
              </div>
            </Section>

            <Section title="Totals" aside={<span class="totals-head"><span>Range</span><span title={`The same days of the period before: ${previous().start} – ${previous().end}`}>Before</span></span>}>
              <div class="stats">
                <span class="k">Spent</span>
                <span class={`v ${covered() && previousFlows().spent > 0 ? spendChangeCls(flows().spent - previousFlows().spent) : ""}`}>{formatWholeMoney(flows().spent)}</span>
                <span class="n">{before(formatWholeMoney(previousFlows().spent))}</span>
                <span class="k">Income</span><span class="v">{formatWholeMoney(flows().income)}</span><span class="n">{before(formatWholeMoney(previousFlows().income))}</span>
                <span class="k">Net</span><span class={`v ${changeCls(flows().net)}`}>{signedWholeMoney(flows().net)}</span><span class="n">{before(signedWholeMoney(previousFlows().net))}</span>
                <span class="k">To savers</span><span class={`v ${changeCls(flows().savedToSavers)}`}>{signedWholeMoney(flows().savedToSavers)}</span><span class="n">{before(signedWholeMoney(previousFlows().savedToSavers))}</span>
                <span class="k">Savings rate</span><span class="v">{formatPct(flows().savingsRate)}</span><span class="n">{before(formatPct(previousFlows().savingsRate))}</span>
                <span class="k">Daily</span><span class="v">{formatWholeMoney(windows().days ? flows().spent / windows().days : 0)}</span><span class="n">{before(formatWholeMoney(windows().days ? previousFlows().spent / windows().days : 0))}</span>
                <span class="k">Transactions</span><span class="v">{String(flows().txnCount)}</span><span class="n">{before(String(previousFlows().txnCount))}</span>
                <Show when={budget()}>{(p) => (
                  <>
                    <span class="k">Budget</span><span class="v">{formatWholeMoney(p().budget.amount)}</span>
                    <span class={`n ${p().usedPct > 100 ? "bad" : p().usedPct >= 80 ? "caution" : "good"}`}>{Number.isFinite(p().usedPct) ? Math.round(p().usedPct) : "—"}% used</span>
                    <Show when={p().remaining > 0}>
                      <span class="k indent">left</span><span class="v">{formatWholeMoney(p().remaining)}</span><span class="n">{formatWholeMoney(p().dailyAllowance)}/day</span>
                    </Show>
                  </>
                )}</Show>
              </div>
            </Section>

            <Section title="Categories" class="ov-categories">
              <Show when={lines().length} fallback={<p class="note small">No spending in this period</p>}>
                <div class="cat-lines">
                  <For each={lines()}>{(line) => (
                    <button type="button" class="cat-line" classList={{ child: line.child }} onClick={() => drill(line)} title={`Open ${line.label} in Transactions`}>
                      <span class="name"><span class="dot" style={{ background: catColor(line.color) }} /><span class="ellipsis">{line.label}</span></span>
                      <span class="amt money">{formatWholeMoney(line.amount)}</span>
                      <span class="pct">{line.pct != null ? `${Math.round(line.pct)}%` : ""}</span>
                      <Show when={!line.child && line.pct != null}><span class="share" style={{ width: `${Math.max(0.5, line.pct!)}%`, background: catColor(line.color) }} /></Show>
                    </button>
                  )}</For>
                </div>
              </Show>
              <Show when={uncategorised() || toReview()}>
                <p class="cat-foot small">
                  <Show when={uncategorised()}><button type="button" class="link caution" onClick={openUncategorised}>{uncategorised()} uncategorised</button></Show>
                  <Show when={uncategorised() && toReview()}><span class="note"> · </span></Show>
                  <Show when={toReview()}><button type="button" class="link ai" onClick={openUncategorised}>{toReview()} to review</button></Show>
                </p>
              </Show>
            </Section>
          </div>
        </div>
      </div>
    </>
  )
}

/** Custom range: two dates, both days included (the TUI's Custom range dialog). */
function CustomRange(props: { start: string; end: string; onApply: (range: { start: string; end: string }) => void; onCancel: () => void }) {
  const [start, setStart] = createSignal(props.start)
  const [end, setEnd] = createSignal(props.end)
  const [error, setError] = createSignal("")
  const apply = () => {
    const r = customRange(start(), end())
    if (typeof r === "string") { setError(r); return }
    props.onApply(r)
  }
  return (
    <form class="custom-range" onSubmit={(e) => { e.preventDefault(); apply() }} onKeyDown={(e) => { if (e.key === "Escape") props.onCancel() }}>
      <label><span class="label small">Start</span><Input type="date" value={start()} onInput={(e) => setStart(e.currentTarget.value)} /></label>
      <label><span class="label small">End</span><Input type="date" value={end()} onInput={(e) => setEnd(e.currentTarget.value)} /></label>
      <Button type="submit" size="sm">Apply</Button>
      <Button type="button" variant="ghost" size="sm" onClick={props.onCancel}>Cancel</Button>
      <span class={`small ${error() ? "bad" : "note"}`}>{error() || "Both days included"}</span>
    </form>
  )
}
