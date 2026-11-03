import { Index, Show, createEffect, createMemo } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { allocation, cycleFor, budgetCounts, budgetCountsThen, budgetIgnoredIds, budgetIn, budgetProgress, cycleSpending, pastCycles, progressOf, totalBudgetIn, type Budget, type BudgetProgress, type BudgetSubject, type Cycle } from "../../domain/budget"
import { budgetArmId, budgetListRows, type BudgetLine } from "../../domain/budgetLines"
import { sharedBudgetView, sharedCategoryLines } from "../../state/budgetViews"
import { budgetLabel } from "../../domain/budgetScopes"
import { dailySpendSeries, formatWholeMoney } from "../../domain/dashboard"
import { addDays, appToday, daysBetween } from "../../domain/days"
import { historyCovers } from "../../domain/position"
import type { Transaction } from "../../domain/types"
import type { SectionId } from "../../state/uiStore"
import { ui } from "../../state/uiStore"
import { data } from "../../state/dataStore"
import { armedFor } from "../../state/armed"
import { ink, theme, tone } from "../../theme"
import { categoryMark } from "../icons"
import { count, fit, shortDate } from "../text"
import { ListRow, centredTop } from "../primitives/ListRow"
import { SectionCard } from "../primitives/SectionCard"
import { S } from "../primitives/S"
import { fitSpans, type Span } from "../primitives/spans"
import { AXIS_GUESS, CHART_RIGHT_PAD, axisWidth, type ChartModel } from "../charts/ChartBody"
import { cycleLines, cycleLinesLegend, type CycleSpent } from "./budgetCharts"
import { chartSpeedMs, showings } from "../charts/motion"
import { ChartCard } from "../charts/ChartCard"
import { spendingChart } from "../overview/periodCharts"
import { BUDGET_PANES, BUDGET_VIEWS, CHART_VIEWS } from "../../state/uiStore"
import { GRID_PANE_MIN, OverviewChartCard, WIDE, chartRows, overviewChartModel, type OverviewChartInput } from "../overview/OverviewTab"
import { CalendarView, calendarLegend } from "../overview/CalendarView"
import { spendingCalendar } from "../../domain/spending"
import { merchantRows, trendRows } from "../../domain/periodTables"
import { accountRole } from "../../domain/types"
import { regionRef } from "../regions"
import { onPointer } from "../../app/pointer"
import type { JSX } from "solid-js"
import { SubscriptionsView, subscriptionsLegend } from "../charts/SubscriptionsView"
import { subscriptions, upcomingCharges } from "../../domain/subscriptions"

/** Cycles before this one the chart and the cycle lines can show, at most. */
const HISTORY = 36

/**
 * A bar in `width` cells for `fill` (0–1 of the width), coloured by how
 * it's going (green, yellow ahead of pace, red over budget), with a mark at
 * `mark` (0–1): where spending would be by today at an even pace. Over
 * budget, the bar is scaled to what was spent: green up to the budget,
 * red past it (the change of colour marks it).
 */
function bar(width: number, used: number, pace: number): Span[] {
  const over = used > 1
  const fill = over ? 1 : Math.max(0, used)
  const mark = over ? 1 / used : pace
  const filled = Math.round(fill * width)
  const at = Math.min(width - 1, Math.round(mark * width))
  const fg = over ? tone.bad : used > pace ? tone.caution : tone.good
  const spans: Span[] = []
  for (let i = 0; i < width; i++) {
    const cell = i === at && !over ? { text: i < filled ? "▌" : "│", fg: ink.figure }
      : i < filled ? { text: "█", fg: over && i < at ? tone.good : fg }
      : { text: "─", fg: ink.rule }
    const last = spans[spans.length - 1]
    if (last && last.fg === cell.fg) last.text += cell.text
    else spans.push(cell)
  }
  return spans
}


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
  const shown = () => ui.state.activeTab === "budgets"
  // "always": the chart draws in again each time the tab comes into view.
  const seen = showings(shown)
  // Hidden, the tab keeps what it last showed rather than recompute: its
  // inputs hold their last values, and showing it passes on only those that
  // changed meanwhile, so a tab whose data didn't change wakes nothing.
  const held = <T,>(fn: () => T): (() => T) => createMemo<T | undefined>((was) => (shown() || was === undefined ? fn() : was)) as () => T
  const terminal = useTerminalDimensions()
  const dims = held(() => terminal())
  const transactions = held(() => data.transactions())

  // The clock isn't reactive: read fresh as before, and showing the tab on
  // a new day brings its results up to date.
  const shownOn = held(() => appToday())
  const today = () => (shownOn(), appToday())
  const config = held(() => data.cycle())
  // The cycle shown ([ and ] step it), the day it's shown up to (today, or
  // its last day once over) and the budgets in force in it.
  const view = createMemo(() => sharedBudgetView(config(), today(), ui.state.budgetOffset, data.state.budgetHistory, data.state.budgets))
  const cycle = () => view().cycle
  const through = () => view().through
  const budgets = () => view().budgets
  const elapsed = () => daysBetween(cycle().start, through()) + 1
  // A past cycle's dates, the year where it isn't this one's.
  const period = () => `${shortDate(cycle().start)} – ${shortDate(cycle().end)}${cycle().end.slice(0, 4) === today().slice(0, 4) ? "" : ` ${cycle().end.slice(0, 4)}`}`
  const pace = () => elapsed() / cycle().days
  // The overall budget is everything else once categories have their own;
  // a category's budget goes by the category's own name (the list shows
  // its group).
  const hasCategoryBudgets = () => budgets().some((b) => b.scope.kind === "category")
  const overallName = () => (hasCategoryBudgets() ? "Everything else" : "Overall spending")
  const label = (budget: Budget) => {
    const scope = budget.scope
    if (scope.kind === "overall") return overallName()
    return scope.kind === "category" ? data.state.categories.find((c) => c.id === scope.categoryId)?.name ?? "(removed category)" : budgetLabel(budget, data.state.accounts, data.state.categories)
  }
  const TOTAL = "Total budgeted"

  const rows = createMemo(() => budgetListRows(budgets(), data.state.categories))
  const budgetCursor = createMemo(() => Math.min(ui.state.budgetCursor, rows().length - 1))
  const progress = createMemo(() => new Map(budgetProgress(budgets(), config(), through(), data.state.accounts, data.state.categories, transactions()).map((p) => [p.budget.id, p])))
  const split = createMemo(() => allocation(budgets(), data.state.categories))
  // The budgets together against what they count between them.
  const totalProgress = createMemo(() => {
    const counts = budgetCounts({ kind: "total" }, data.state.categories, budgets())
    const spentOnBudgets = cycleSpending(cycle(), through(), data.state.accounts, transactions()).filter(counts).reduce((sum, t) => sum - t.amount, 0)
    return progressOf({ id: -1, scope: { kind: "overall" }, amount: split().total }, spentOnBudgets, cycle(), through())
  })
  const lines = createMemo(() => sharedCategoryLines(config(), through(), data.state.accounts, data.state.categories, budgets(), transactions()))
  const categoryCursor = createMemo(() => Math.min(ui.state.budgetCategoryCursor, Math.max(0, lines().length - 1)))
  const ignored = createMemo(() => budgetIgnoredIds(data.state.categories))
  const ignoredNames = () => data.state.categories.filter((c) => c.budgetIgnored).map((c) => c.name)
  const firstData = createMemo(() => transactions().reduce((first, t) => (t.dateISO < first ? t.dateISO : first), today()))

  // What the chart follows: the row at the focused card's cursor.
  // Its rows are judged by the budgets of their own cycle (budgetCountsThen):
  // rent is everything else only in cycles it had no budget.
  const subject = createMemo((): { title: string; scope: BudgetSubject | null; counts: (row: Transaction) => boolean; amount: number | null } => {
    const of = (scope: BudgetSubject) => budgetCountsThen(scope, data.state.categories, data.state.budgetHistory, data.state.budgets, config())
    if (props.focused === "bud.categories") {
      const line = lines()[categoryCursor()]
      if (line) {
        const id = line.categoryId
        return id === null
          ? { title: "Uncategorised", scope: null, counts: (row) => row.categoryId === null, amount: null }
          : { title: line.name, scope: { kind: "category", categoryId: id }, counts: of({ kind: "category", categoryId: id }), amount: line.budget?.amount ?? null }
      }
    }
    const row = rows()[budgetCursor()]!
    if (row.kind === "total") return { title: TOTAL, scope: { kind: "total" }, counts: of({ kind: "total" }), amount: split().total }
    return row.budget ? { title: label(row.budget), scope: row.budget.scope, counts: of(row.budget.scope), amount: row.budget.amount } : { title: overallName(), scope: { kind: "overall" }, counts: of({ kind: "overall" }), amount: null }
  })
  // Every spending row to today, then the subject's: moving the cursor
  // redoes only the second, and each cycle takes its days from it rather
  // than going through the whole history again.
  const spendingRows = createMemo(() => cycleSpending({ start: firstData(), end: today(), days: 0 }, today(), data.state.accounts, transactions()))
  const subjectRows = createMemo(() => spendingRows().filter(subject().counts))
  const spending = (c: Cycle, through: string) => subjectRows().filter((t) => t.dateISO >= c.start && t.dateISO <= through)
  const daily = (c: Cycle, through: string) => ({ cycle: c, daily: dailySpendSeries(spending(c, through), c.start, c.end).values })
  // Cycles the history covers as well as this one (historyCovers, as the
  // Overview compares periods): a gap, or a few stray old rows, isn't a
  // cycle of spending nothing.
  const past = createMemo(() => {
    const now = { start: cycle().start, end: through() }
    return pastCycles(config(), through(), HISTORY).filter((c) => c.end >= firstData() && historyCovers(transactions(), c, now))
  })
  const nowDays = createMemo(() => daily(cycle(), through()))
  const spent = () => nowDays().daily.reduce((a, b) => a + b, 0)
  // The cycle shown and those before it, newest first, each with the
  // budget in force then.
  const cycles = createMemo((): CycleSpent[] => {
    const scope = subject().scope
    return [
      { cycle: cycle(), spent: spent(), budget: subject().amount },
      ...past().map((c) => ({
        cycle: c,
        spent: daily(c, c.end).daily.reduce((a, b) => a + b, 0),
        budget: !scope ? null : scope.kind === "total" ? totalBudgetIn(data.state.budgetHistory, data.state.budgets, data.state.categories, c.start) : budgetIn(data.state.budgetHistory, scope, c.start),
      })),
    ]
  })

  // Sizes: tab bar + gap (2) and status + footer (2) off the height. Wide,
  // the chart and the budgets share the left and the categories run down
  // the right; narrow, they stack.
  const body = () => Math.max(16, dims().height - 4)
  // The Overview's breakpoint; the categories take a column of about the
  // Overview's side column, wider on a wide terminal.
  const wide = () => dims().width >= WIDE
  const categoriesWidth = () => (wide() ? Math.min(62, Math.max(40, Math.floor((dims().width - 1) * 0.4))) : dims().width)
  const mainWidth = () => (wide() ? dims().width - 1 - categoriesWidth() : dims().width)
  const summary = createMemo((): Span[] => {
    const spans: Span[] = []
    const { allocated, overall } = split()
    if (allocated > 0) spans.push({ text: `Categories ${formatWholeMoney(allocated)} + everything else ${overall == null ? "(not set)" : formatWholeMoney(overall)}`, fg: ink.label })
    const names = ignoredNames()
    if (names.length) spans.push({ text: `${spans.length ? " · " : ""}Not budgeted: ${names.join(", ")}`, fg: ink.note })
    return spans
  })
  // The layouts. Wide: the main column, then a side column with the cycle's
  // calendar over the categories. In the main column, split screen: the
  // budget pane, a cycle pane under it when there's height for both, and
  // the budgets beside each cycle along the bottom. Full screen (the main
  // column fits two panes of GRID_PANE_MIN): a 2×2 grid, the budget pane
  // and a cycle pane on top, a second cycle pane and the budgets over each
  // cycle below. Narrow: one column, the budget pane alone.
  const grid = () => wide() && mainWidth() >= 2 * GRID_PANE_MIN + 1
  const halfLeft = () => Math.ceil((mainWidth() - 1) / 2)
  const halfRight = () => Math.floor((mainWidth() - 1) / 2)
  const topQuarter = () => Math.floor(body() / 2)
  const bottomQuarter = () => body() - topQuarter()
  // Each budget takes two lines (hung) when they all fit in the room the
  // layout gives the budgets, else one; past that, the list scrolls.
  const summaryLines = () => (summary().length ? 1 : 0)
  const budgetsRoom = () => (grid() ? bottomQuarter() - 5 : wide() ? Math.floor(body() * 0.45) : Math.floor(body() * 0.4))
  const hung = () => rows().length * 2 + 2 + summaryLines() <= budgetsRoom()
  const budgetRoom = () => (hung() ? rows().length : Math.min(rows().length, Math.max(1, (wide() ? budgetsRoom() : Math.floor(body() * 0.3)) - 2 - summaryLines())))
  const budgetsNatural = () => budgetRoom() * (hung() ? 2 : 1) + 2 + summaryLines()
  // Split screen, the budgets and each cycle share the bottom row when
  // each gets SIDE_BY_SIDE_MIN columns, as tall as the taller of them wants
  // (each cycle up to the budgets' room); narrower, each cycle goes under
  // the budgets.
  const sideBySide = () => wide() && !grid() && halfLeft() >= SIDE_BY_SIDE_MIN
  const bottomRow = () => Math.max(budgetsNatural(), Math.min(cycles().length + 2, budgetsRoom()))
  const linesStacked = () => Math.min(cycles().length + 2, Math.max(4, Math.floor((body() - budgetsNatural()) / 3)))
  const bottomBlock = () => (sideBySide() ? bottomRow() : budgetsNatural() + linesStacked())
  const budgetsHeight = () => (sideBySide() ? bottomRow() : budgetsNatural())
  const linesHeight = () => (grid() ? bottomQuarter() - budgetsNatural() : sideBySide() ? bottomRow() : wide() ? linesStacked() : Math.min(cycles().length + 2, Math.max(5, Math.floor(body() * 0.2))))
  // The charts take the rest: the budget pane, and a cycle pane under it
  // when both get CYCLE_PANE_MIN rows.
  const chartArea = () => body() - bottomBlock()
  const cyclePanes = (): 0 | 1 | 2 => (grid() ? 2 : wide() && chartArea() >= 2 * CYCLE_PANE_MIN ? 1 : 0)
  const chartHeight = () => (grid() ? topQuarter() : wide() ? (cyclePanes() ? Math.ceil(chartArea() / 2) : chartArea()) : Math.max(10, Math.floor(body() * 0.3)))
  const cyclePaneHeight = (pane: number) => (grid() ? (pane === 0 ? topQuarter() : bottomQuarter()) : chartArea() - chartHeight())
  const budgetsWidth = () => (grid() ? halfRight() : sideBySide() ? halfLeft() : mainWidth())
  const linesWidth = () => (grid() || sideBySide() ? halfRight() : mainWidth())
  const chartWidth = () => (grid() ? halfLeft() : mainWidth())
  const cyclePaneWidth = (pane: number) => (grid() ? (pane === 0 ? halfRight() : halfLeft()) : mainWidth())
  // The cycle's calendar: a band of two lines a weekday where the tab has
  // the height, else one; narrow, only on a tall terminal.
  const calendarHeight = () => (wide() ? (body() >= 17 + 10 ? 17 : 10) : body() >= 40 ? 10 : 0)
  const categoriesHeight = () => (wide() ? body() - calendarHeight() : Math.max(5, body() - chartHeight() - linesHeight() - budgetsHeight() - calendarHeight()))
  // The panes the keys and jumps reach follow the layout; focus on one
  // that's gone goes back to the budgets.
  createEffect(() => {
    const n = cyclePanes()
    if (ui.state.budgetCyclePanes !== n) ui.setState({ budgetCyclePanes: n })
    const pane = BUDGET_PANES.indexOf(props.focused)
    if (pane > n) ui.setState({ focusedSection: "bud.list" })
  })
  const rowWidth = (width: number) => width - 5

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
    if (chartView() === "Subscriptions") return null
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

  // One budget in the Budgets card: its bar against an even pace, spent of
  // budget, what's left (a day) or over.
  const listFocused = () => props.focused === "bud.list"
  const categoriesFocused = () => props.focused === "bud.categories"
  const LABEL = () => Math.min(22, Math.max(18, ...rows().map((r) => (r.budget ? label(r.budget).length + 2 : r.kind === "total" ? TOTAL.length + 2 : 18))))
  const tight = () => rowWidth(budgetsWidth()) - LABEL() - 45 < 10
  const BAR = () => Math.max(tight() ? 4 : 6, Math.min(48, rowWidth(budgetsWidth()) - LABEL() - (tight() ? 36 : 45)))
  const budgetSpans = (p: BudgetProgress | undefined): Span[] => {
    if (!p) return []
    const budget = p.budget
    const used = budget.amount > 0 ? p.spent / budget.amount : p.spent > 0 ? 2 : 0
    const verdict = p.remaining < 0 ? { text: `${formatWholeMoney(-p.remaining)} over`, fg: tone.bad } : { text: `${formatWholeMoney(p.remaining)} left · ${formatWholeMoney(p.dailyAllowance)}/day`, fg: tone.good }
    // Narrow, the figures drop their alignment, and then go, before what's
    // left or over does.
    const figures = { text: tight() ? ` ${formatWholeMoney(p.spent)} of ${formatWholeMoney(budget.amount)} ` : `  ${formatWholeMoney(p.spent).padStart(7)} of ${formatWholeMoney(budget.amount).padEnd(7)}  `, fg: ink.label }
    const room = rowWidth(budgetsWidth()) - LABEL() - BAR()
    return [...bar(BAR(), used, pace()), ...(figures.text.length + verdict.text.length <= room ? [figures] : [{ text: " ", fg: ink.label }]), verdict]
  }
  // A budget on two lines: its name and spent of budget hung from the bar's
  // left end (╭), what's left a day or over from its right (╮), and the bar
  // the row's width under them. A budget not set says how to set one over a
  // faint rule. No wash marks the cursor here: its name and corners take the
  // focus colour.
  const hungSpans = (name: Span, p: BudgetProgress | undefined, unset: string, cursor: boolean): [Span[], Span[]] => {
    const width = rowWidth(budgetsWidth())
    const corner = (text: string): Span => ({ text, fg: cursor ? tone.focus : ink.note, bold: cursor })
    if (cursor) name = { ...name, fg: tone.focus }
    const line = (left: Span[], right: Span[]): Span[] => {
      const used = [...left, ...right].reduce((n, span) => n + span.text.length, 0)
      return fitSpans([...left, { text: " ".repeat(Math.max(1, width - used)), fg: ink.note }, ...right], width)
    }
    if (!p) return [line([corner("╭ "), name, { text: `  ${unset}`, fg: ink.note }], [corner(" ╮")]), [{ text: "─".repeat(width), fg: ink.rule }]]
    const budget = p.budget
    const used = budget.amount > 0 ? p.spent / budget.amount : p.spent > 0 ? 2 : 0
    const verdict = p.remaining < 0 ? { text: `${formatWholeMoney(-p.remaining)} over`, fg: tone.bad } : { text: `${formatWholeMoney(p.remaining)} left · ${formatWholeMoney(p.dailyAllowance)}/day`, fg: tone.good }
    return [
      line([corner("╭ "), name, { text: `  ${formatWholeMoney(p.spent)} of ${formatWholeMoney(budget.amount)}`, fg: ink.label }], [verdict, corner(" ╮")]),
      bar(width, used, pace()),
    ]
  }
  const budgetTop = createMemo(() => centredTop(budgetCursor(), rows().length, budgetRoom()))

  // Categories: a quiet list to set budgets from. Name, this cycle, the
  // average, and its budget or that it's left out.
  // The average goes where it would leave names too short.
  const NUM = 9
  const withAverage = () => rowWidth(categoriesWidth()) - 2 - NUM * 3 >= 12
  const nameWidth = () => rowWidth(categoriesWidth()) - 2 - NUM * (withAverage() ? 3 : 2)
  const lineSpans = (line: BudgetLine): Span[] => {
    const out = line.categoryId !== null && ignored().has(line.categoryId)
    const name = line.child ? ink.label : ink.figure
    return [
      { text: `${line.child ? "  " : ""}${line.categoryId === null ? "?" : categoryMark(line.categoryId)} `, fg: out ? ink.faint : line.color ?? ink.note },
      { text: fit(line.name, nameWidth() - (line.child ? 4 : 2)), fg: out ? ink.note : name, bold: !line.child },
      { text: formatWholeMoney(line.now).padStart(NUM), fg: out ? ink.note : line.budget && line.now > line.budget.amount ? tone.bad : name },
      ...(withAverage() ? [{ text: formatWholeMoney(line.average).padStart(NUM), fg: ink.note }] : []),
      line.budget ? { text: formatWholeMoney(line.budget.amount).padStart(NUM), fg: ink.figure }
        : out ? { text: "left out".padStart(NUM), fg: ink.faint }
        : { text: "".padStart(NUM), fg: ink.faint },
    ]
  }
  const categoryRoom = () => Math.max(1, categoriesHeight() - 3)
  const categoryTop = createMemo(() => centredTop(categoryCursor(), lines().length, categoryRoom()))

  const Chart = () => (
    <ChartCard title={subject().title} views={BUDGET_VIEWS} current={ui.state.budgetChart} model={model()} width={chartWidth()} height={chartHeight()} baseline={baseline()}
      legend={subscriptionsLegend(subs(), dueBeforePayday())}
      fallback={<SubscriptionsView list={subs()} width={chartWidth() - 4} rows={chartHeight() - 2} today={today()} payday={payday()} />}
      revealKey={data.state.uiPrefs.chartMotion === "always" ? `${(BUDGET_VIEWS[ui.state.budgetChart] ?? BUDGET_VIEWS[0]!).view}:${subject().title}:${seen()}` : undefined}
      revealMs={data.state.uiPrefs.chartMotion === "always" ? chartSpeedMs(data.state.uiPrefs.chartSpeed) : undefined}
      curve={data.state.uiPrefs.chartCurve}
      labels={data.state.uiPrefs.chartLabels} />
  )
  const Lines = () => (
    <SectionCard title="Each cycle" titleSuffix={`· ${subject().title}`} titleSuffixColor={ink.label} bottomSpans={cycleLinesLegend(cycles())} width={linesWidth()} height={linesHeight()}>
      <Index each={cycleLines(cycles().slice(0, Math.max(1, linesHeight() - 2)), rowWidth(linesWidth()), pace(), today())}>{(spans) => (
        <text wrapMode="none">
          <S fg={ink.note}>{" "}</S>
          <Index each={spans()}>{(span) => <S fg={span().fg} bold={span().bold}>{span().text}</S>}</Index>
        </text>
      )}</Index>
    </SectionCard>
  )
  const Budgets = () => (
    <SectionCard title="Budgets" titleSuffix={view().current ? `· day ${elapsed()} of ${cycle().days}` : `· ${period()} · ] later`} titleSuffixColor={view().current ? tone.scope : tone.caution} focused={listFocused()} width={budgetsWidth()} height={budgetsHeight()}>
      <Index each={rows().slice(budgetTop(), budgetTop() + budgetRoom())}>{(row, i) => {
        const at = () => listFocused() && budgetTop() + i === budgetCursor()
        const armed = () => (row().budget ? armedFor(ui.state.armed, "budget", budgetArmId(row().budget!, cycle().start)) : undefined)
        const twoLines = (): [Span[], Span[]] => {
          const r = row()
          if (r.kind === "total") return hungSpans({ text: TOTAL, fg: ink.strong, bold: true }, totalProgress(), "", at())
          if (r.budget) return hungSpans({ text: label(r.budget), fg: ink.figure, bold: true }, progress().get(r.budget.id), "", at())
          return hungSpans({ text: overallName(), fg: ink.figure, bold: true }, undefined, `not set: enter sets one${hasCategoryBudgets() ? " for the rest" : ""}`, at())
        }
        const spans = (): Span[] => {
          const r = row()
          if (r.kind === "total") return fitSpans([{ text: fit(TOTAL, LABEL()), fg: ink.strong, bold: true }, ...budgetSpans(totalProgress())], rowWidth(budgetsWidth()))
          if (r.budget) return fitSpans([{ text: fit(label(r.budget), LABEL()), fg: ink.figure, bold: true }, ...budgetSpans(progress().get(r.budget.id))], rowWidth(budgetsWidth()))
          return fitSpans([{ text: fit(overallName(), LABEL()), fg: ink.figure, bold: true }, { text: `not set: enter sets one${hasCategoryBudgets() ? " for the rest" : ""}`, fg: ink.note }], rowWidth(budgetsWidth()))
        }
        return (
          <Show when={hung()} fallback={<ListRow cursor={at()} bg={theme.canvas} armed={armed()} spans={spans()} />}>
            <ListRow cursor={false} bg={theme.canvas} armed={armed()} spans={twoLines()[0]} />
            <ListRow cursor={false} bg={theme.canvas} spans={twoLines()[1]} />
          </Show>
        )
      }}</Index>
      <Show when={summary().length}>
        <text wrapMode="none">
          <S fg={ink.note}>{" "}</S>
          <Index each={fitSpans(summary(), rowWidth(budgetsWidth()))}>{(span) => <S fg={span().fg}>{span().text}</S>}</Index>
        </text>
      </Show>
    </SectionCard>
  )
  const Categories = () => (
    <SectionCard title="Categories" titleSuffix={categoriesFocused() ? "· enter budget · x leave out" : undefined} titleSuffixColor={ink.note} focused={categoriesFocused()} width={categoriesWidth()} height={categoriesHeight()}>
      <Show when={lines().length} fallback={<text fg={ink.note}>No spending yet.</text>}>
        <text wrapMode="none">
          <S fg={ink.note}>{` ${fit("", nameWidth())}`}</S>
          <S fg={ink.label}>{"Spent".padStart(NUM)}{withAverage() ? "Average".padStart(NUM) : ""}{"Budget".padStart(NUM)}</S>
        </text>
        <Index each={lines().slice(categoryTop(), categoryTop() + categoryRoom())}>{(line, i) => (
          <ListRow cursor={categoriesFocused() && categoryTop() + i === categoryCursor()} bg={theme.canvas} armed={line().budget ? armedFor(ui.state.armed, "budget", budgetArmId(line().budget!, cycle().start)) : undefined} spans={lineSpans(line())} />
        )}</Index>
      </Show>
    </SectionCard>
  )

  // The cycle panes: the Overview's views over the cycle shown, for every
  // spending account (the Overview's "All spending"), with the total
  // budgeted on the spending charts; Merchants against the same days of
  // the cycle before, when the history covers it.
  const spendingIds = createMemo(() => new Set(data.state.accounts.filter((a) => accountRole(a) === "spending").map((a) => a.id)))
  const allSpending = createMemo(() => transactions().filter((t) => t.accountId != null && spendingIds().has(t.accountId)))
  const inCycle = createMemo(() => allSpending().filter((t) => t.dateISO >= cycle().start && t.dateISO <= cycle().end))
  const cycleViews = () => ui.state.budgetCycleViews.slice(0, cyclePanes()).map((i) => (CHART_VIEWS[i] ?? CHART_VIEWS[0]).view)
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
    if (pane >= cyclePanes()) return null
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
        <OverviewChartCard index={index()} model={cycleModels[p.pane]!()} calendar={cycleCalendar()} trends={cycleTrends()} merchants={cycleMerchants()} today={today()}
          width={cyclePaneWidth(p.pane)} height={cyclePaneHeight(p.pane)} focused={props.focused === section} baseline={baseline()}
          revealKey={data.state.uiPrefs.chartMotion === "always" ? `${(CHART_VIEWS[index()] ?? CHART_VIEWS[0]).view}:${cycle().start}:${seen()}` : undefined}
          revealMs={data.state.uiPrefs.chartMotion === "always" ? chartSpeedMs(data.state.uiPrefs.chartSpeed) : undefined}
          curve={data.state.uiPrefs.chartCurve} labels={data.state.uiPrefs.chartLabels} />
      </box>
    )
  }

  // The cycle's calendar, always there: the budget at the cursor's spending
  // each day so far, and on the days to come, its regular payments due
  // (expected charges, in caution). Its legend: what's expected by the
  // cycle's end, and what of the budget that leaves.
  const expectedCharges = createMemo(() => (view().current ? upcomingCharges(subs(), addDays(today(), 1), cycle().end) : []))
  const calendarWeeks = createMemo(() => {
    const weeks = spendingCalendar(subjectRows().filter((t) => t.dateISO >= cycle().start && t.dateISO <= cycle().end), cycle().start, cycle().end, data.state.weekStart)
    const due = new Map<string, number>()
    for (const c of expectedCharges()) due.set(c.dateISO, (due.get(c.dateISO) ?? 0) + c.amount)
    return weeks.map((week) => week.map((d) => (d && due.has(d.dateISO) ? { ...d, expected: due.get(d.dateISO)! } : d)))
  })
  const calendarSpans = (): Span[] => {
    const expected = expectedCharges().reduce((n, c) => n + c.amount, 0)
    if (!expected) return calendarLegend(calendarWeeks(), today())
    const amount = subject().amount
    const free = amount == null ? null : amount - spent() - expected
    return [
      { text: "■ ", fg: tone.caution },
      { text: `${count(expectedCharges().length, "charge")} · ${formatWholeMoney(expected)} expected by ${shortDate(cycle().end)}`, fg: ink.label },
      ...(free == null ? [] : [{ text: free >= 0 ? ` · ${formatWholeMoney(free)} free after them` : ` · ${formatWholeMoney(-free)} over after them`, fg: free >= 0 ? tone.good : tone.bad }]),
    ]
  }
  const CycleCalendar = () => (
    <SectionCard title="Calendar" titleSuffix={`· ${subject().title}`} titleSuffixColor={ink.label} bottomSpans={calendarSpans()} width={categoriesWidth()} height={calendarHeight()}>
      <CalendarView weeks={calendarWeeks()} width={categoriesWidth() - 4} rows={calendarHeight() - 2} today={today()} />
    </SectionCard>
  )

  /** A click on a card or pane focuses it. */
  const panePointer = (id: SectionId) => onPointer((scope) => scope === "bar" || scope.startsWith("budgets"), () => ui.applyJump(id))
  // Sizes as accessors: a component's body runs once, so a number read here
  // would keep its first value.
  const region = (id: SectionId, width: () => number, height: () => number, card: () => JSX.Element) => (
    <box ref={regionRef(id, "budgets")} width={width()} height={height()} flexShrink={0} onMouseDown={panePointer(id)}>{card()}</box>
  )
  const BudgetPane = () => region("bud.chart", chartWidth, chartHeight, () => <Chart />)
  const BudgetsCard = () => region("bud.list", budgetsWidth, budgetsHeight, () => <Budgets />)
  const CategoriesCard = () => region("bud.categories", categoriesWidth, categoriesHeight, () => <Categories />)

  return (
    <box width="100%" height="100%" flexDirection={wide() ? "row" : "column"} gap={wide() ? 1 : 0} backgroundColor={theme.canvas}>
      <Show when={wide()} fallback={<><BudgetsCard /><BudgetPane /><Lines /><Show when={calendarHeight()}><CycleCalendar /></Show><CategoriesCard /></>}>
        <Show when={grid()} fallback={
          <box flexDirection="column" width={mainWidth()} height={body()}>
            <BudgetPane />
            <Show when={cyclePanes() > 0}><CyclePane pane={0} /></Show>
            <box flexDirection={sideBySide() ? "row" : "column"} gap={sideBySide() ? 1 : 0} width={mainWidth()} height={bottomBlock()} flexShrink={0}>
              <BudgetsCard />
              <Lines />
            </box>
          </box>
        }>
          <box flexDirection="column" width={mainWidth()} height={body()}>
            <box flexDirection="row" gap={1} width={mainWidth()} height={topQuarter()} flexShrink={0}>
              <BudgetPane />
              <CyclePane pane={0} />
            </box>
            <box flexDirection="row" gap={1} width={mainWidth()} height={bottomQuarter()} flexShrink={0}>
              <CyclePane pane={1} />
              <box flexDirection="column" width={halfRight()} height={bottomQuarter()}>
                <BudgetsCard />
                <Lines />
              </box>
            </box>
          </box>
        </Show>
        <box flexDirection="column" width={categoriesWidth()} height={body()}>
          <CycleCalendar />
          <CategoriesCard />
        </box>
      </Show>
    </box>
  )
}

/** Fewest rows a Budgets chart pane gets before the cycle pane gives way. */
const CYCLE_PANE_MIN = 12
/** Budgets and each cycle sit side by side when each gets this many columns. */
const SIDE_BY_SIDE_MIN = 56
