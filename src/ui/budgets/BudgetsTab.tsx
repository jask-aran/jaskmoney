import { Index, Show, createEffect, createMemo } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { allocation, cycleFor, budgetCounts, budgetCountsThen, budgetIgnoredIds, budgetIn, budgetProgress, cycleSpending, pastCycles, progressOf, totalBudgetIn, type Budget, type BudgetProgress, type BudgetSubject, type Cycle } from "../../domain/budget"
import { budgetArmId, budgetListRows, budgetSetupRows, type SetupRow } from "../../domain/budgetLines"
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
import { chartSpeedMs, showings, useReveal } from "../charts/motion"
import { ChartCard } from "../charts/ChartCard"
import { spendingChart } from "../overview/periodCharts"
import { BUDGET_PANES, BUDGET_VIEWS, CHART_VIEWS, CYCLE_VIEWS } from "../../state/uiStore"
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
import { paydayResults, topUpForecast } from "../../domain/topUp"
import { computePosition, projectAvailable, usualDailySpend } from "../../domain/position"

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
  const ignored = createMemo(() => budgetIgnoredIds(data.state.categories))
  // The Set budgets pane: the overall budget, then the categories, groups
  // closed unless opened (space).
  const setup = createMemo(() => budgetSetupRows(lines(), budgets(), new Set(ui.state.budgetSetupOpen), ignored()))
  const categoryCursor = createMemo(() => Math.min(ui.state.budgetCategoryCursor, Math.max(0, setup().length - 1)))
  const ignoredNames = () => data.state.categories.filter((c) => c.budgetIgnored).map((c) => c.name)
  const firstData = createMemo(() => transactions().reduce((first, t) => (t.dateISO < first ? t.dateISO : first), today()))

  // What the chart follows: the row at the focused card's cursor.
  // Its rows are judged by the budgets of their own cycle (budgetCountsThen):
  // rent is everything else only in cycles it had no budget.
  const subject = createMemo((): { title: string; scope: BudgetSubject | null; counts: (row: Transaction) => boolean; amount: number | null } => {
    const of = (scope: BudgetSubject) => budgetCountsThen(scope, data.state.categories, data.state.budgetHistory, data.state.budgets, config())
    if (props.focused === "bud.categories") {
      const at = setup()[categoryCursor()]
      if (at?.kind === "overall") return { title: overallName(), scope: { kind: "overall" }, counts: of({ kind: "overall" }), amount: at.budget?.amount ?? null }
      const line = at?.kind === "line" ? at.line : undefined
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
  // calendar over the categories. Two columns (split screen): Progress on
  // top of the main column, then the budget pane, and a cycle pane under it
  // when there's height for both. Three columns (full screen, the main
  // column fits two panes of GRID_PANE_MIN): a 2×2 grid, Progress and the
  // budget pane on top, two cycle panes below. Narrow: one column, the
  // budget pane alone.
  const grid = () => wide() && mainWidth() >= 2 * GRID_PANE_MIN + 1
  const halfLeft = () => Math.ceil((mainWidth() - 1) / 2)
  const halfRight = () => Math.floor((mainWidth() - 1) / 2)
  const topQuarter = () => Math.floor(body() / 2)
  const bottomQuarter = () => body() - topQuarter()
  // Progress: the budgets (each two lines, hung, when they all fit in the
  // room the layout gives them, else one; past that the list scrolls),
  // then a blank line, the Each cycle heading and a line a cycle.
  const summaryLines = () => (summary().length ? 1 : 0)
  const progressRoom = () => (grid() ? topQuarter() : wide() ? Math.floor(body() * 0.45) : Math.floor(body() * 0.4))
  const hung = () => rows().length * 2 + 2 + summaryLines() <= progressRoom() - 4
  const budgetRoom = () => (hung() ? rows().length : Math.min(rows().length, Math.max(1, Math.floor(progressRoom() * 0.6) - 2 - summaryLines())))
  const budgetLines = () => budgetRoom() * (hung() ? 2 : 1) + summaryLines()
  // The cycles fill a grid quarter; elsewhere as many as there are, up to
  // what the room leaves (at least two).
  const cycleRoom = () => (grid() ? progressRoom() - 2 - budgetLines() - 2 : Math.min(cycles().length, Math.max(2, progressRoom() - 2 - budgetLines() - 2)))
  const progressHeight = () => (grid() ? topQuarter() : 2 + budgetLines() + (cycles().length ? 2 + cycleRoom() : 0))
  // The charts take the rest: the budget pane, and a cycle pane under it
  // when both get CYCLE_PANE_MIN rows.
  const chartArea = () => body() - progressHeight()
  const cyclePanes = (): 0 | 1 | 2 => (grid() ? 2 : wide() && chartArea() >= 2 * CYCLE_PANE_MIN ? 1 : 0)
  const chartHeight = () => (grid() ? topQuarter() : wide() ? (cyclePanes() ? Math.ceil(chartArea() / 2) : chartArea()) : Math.max(10, Math.floor(body() * 0.3)))
  const cyclePaneHeight = (_pane: number) => (grid() ? bottomQuarter() : chartArea() - chartHeight())
  const progressWidth = () => (grid() ? halfLeft() : mainWidth())
  const chartWidth = () => (grid() ? halfRight() : mainWidth())
  const cyclePaneWidth = (pane: number) => (grid() ? (pane === 0 ? halfLeft() : halfRight()) : mainWidth())
  // The cycle's calendar: a band of two lines a weekday where the tab has
  // the height, else one; narrow, only on a tall terminal.
  const calendarHeight = () => (wide() ? (body() >= 17 + 10 ? 17 : 10) : body() >= 40 ? 10 : 0)
  const categoriesHeight = () => (wide() ? body() - calendarHeight() : Math.max(5, body() - chartHeight() - progressHeight() - calendarHeight()))
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
  const tight = () => rowWidth(progressWidth()) - LABEL() - 45 < 10
  const BAR = () => Math.max(tight() ? 4 : 6, Math.min(48, rowWidth(progressWidth()) - LABEL() - (tight() ? 36 : 45)))
  const budgetSpans = (p: BudgetProgress | undefined): Span[] => {
    if (!p) return []
    const budget = p.budget
    const used = budget.amount > 0 ? p.spent / budget.amount : p.spent > 0 ? 2 : 0
    const verdict = p.remaining < 0 ? { text: `${formatWholeMoney(-p.remaining)} over`, fg: tone.bad } : { text: `${formatWholeMoney(p.remaining)} left · ${formatWholeMoney(p.dailyAllowance)}/day`, fg: tone.good }
    // Narrow, the figures drop their alignment, and then go, before what's
    // left or over does.
    const figures = { text: tight() ? ` ${formatWholeMoney(p.spent)} of ${formatWholeMoney(budget.amount)} ` : `  ${formatWholeMoney(p.spent).padStart(7)} of ${formatWholeMoney(budget.amount).padEnd(7)}  `, fg: ink.label }
    const room = rowWidth(progressWidth()) - LABEL() - BAR()
    return [...bar(BAR(), used, pace()), ...(figures.text.length + verdict.text.length <= room ? [figures] : [{ text: " ", fg: ink.label }]), verdict]
  }
  // A budget on two lines: its name and spent of budget hung from the bar's
  // left end (╭), what's left a day or over from its right (╮), and the bar
  // the row's width under them. A budget not set says how to set one over a
  // faint rule. No wash marks the cursor here: its name and corners take the
  // focus colour.
  const hungSpans = (name: Span, p: BudgetProgress | undefined, unset: string, cursor: boolean): [Span[], Span[]] => {
    const width = rowWidth(progressWidth())
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

  const spendingIds = createMemo(() => new Set(data.state.accounts.filter((a) => accountRole(a) === "spending").map((a) => a.id)))
  const allSpending = createMemo(() => transactions().filter((t) => t.accountId != null && spendingIds().has(t.accountId)))
  const inCycle = createMemo(() => allSpending().filter((t) => t.dateISO >= cycle().start && t.dateISO <= cycle().end))
  // The cycle's payday: Spending is topped up to the budgets' total and the
  // rest of the pay goes to savers; and, this cycle, the next payday at
  // this pace (projectAvailable, as the Overview's Available looks ahead).
  const target = () => split().total
  const paydayResult = createMemo(() => {
    const days = (config().paydays ?? []).filter((d) => d >= addDays(cycle().start, -3) && d <= through())
    const day = days.at(-1)
    return day ? paydayResults(data.state.accounts, transactions(), [day], target())[0]! : null
  })
  const forecast = createMemo(() => {
    const last = paydayResult()
    if (!view().current || !last || last.pay <= 0 || target() <= 0) return null
    const balance = computePosition(data.state.accounts, transactions(), today()).spendingBalance
    if (balance == null) return null
    const regular = subscriptions(allSpending(), today(), { people: true })
    const usual = usualDailySpend(data.state.accounts, transactions(), today(), new Set(regular.flatMap((s) => s.chargeIds)))
    const projected = projectAvailable(balance, today(), cycle().end, usual, upcomingCharges(regular, today(), cycle().end))
    return topUpForecast(projected.at(-1)?.value ?? balance, target(), last.pay)
  })
  // The payday, in the Budgets pane: what came in, what was kept to top
  // up Spending to the budgets' total, what went to savers against what
  // should have; and, this cycle, the next payday at this pace.
  const paydayLines = createMemo((): Span[][] => {
    const p = paydayResult(), width = rowWidth(categoriesWidth())
    const stat = (label: string, value: string, fg: string = ink.figure, bold = false): Span[] =>
      fitSpans([{ text: fit(label, Math.max(1, width - value.length - 2)), fg: bold ? ink.figure : ink.label, bold }, { text: `${value}  `, fg }], width)
    if (!p || p.pay <= 0) return [fitSpans([{ text: "  No pay this cycle (the Salary category)", fg: ink.note }], width)]
    const lines = [stat(`  Payday ${shortDate(p.dateISO)}`, `${formatWholeMoney(p.pay)} in`, ink.figure, true)]
    if (target() > 0) {
      lines.push(stat(`    kept, topping up to ${formatWholeMoney(target())}`, formatWholeMoney(p.keep), ink.label))
      lines.push(p.sent >= p.due - 1
        ? stat("    to savers", `${formatWholeMoney(p.sent)} ✓`, tone.good)
        : stat("    to savers", `${formatWholeMoney(p.sent)} of ${formatWholeMoney(p.due)}`, tone.caution))
    } else lines.push(stat("    to savers", formatWholeMoney(p.sent), ink.label))
    const f = forecast()
    if (f) {
      lines.push(stat(`  Next payday ${shortDate(addDays(cycle().end, 1))}`, "at this pace", ink.note, true))
      lines.push(stat("    Spending ends near", formatWholeMoney(f.end), f.end < 0 ? tone.bad : ink.figure))
      lines.push(stat("    keep", formatWholeMoney(f.keep), ink.label))
      lines.push(stat("    send about", formatWholeMoney(f.send), tone.good))
    }
    return lines
  })
  // Budgets: where budgets are set. The overall budget first (until
  // set, a nudge in caution: enter sets it from its average), then each
  // category: name, this cycle, the average, and its budget or that it's
  // left out; a closed group says how many budgets it holds. The average
  // goes where it would leave names too short.
  const NUM = 9
  const withAverage = () => rowWidth(categoriesWidth()) - 2 - NUM * 3 >= 12
  const nameWidth = () => rowWidth(categoriesWidth()) - 2 - NUM * (withAverage() ? 3 : 2)
  const lineSpans = (row: Extract<SetupRow, { kind: "line" }>): Span[] => {
    const line = row.line
    const out = line.categoryId !== null && ignored().has(line.categoryId)
    const name = line.child ? ink.label : ink.figure
    const chevron = row.open === null ? "  " : row.open ? "▾ " : "▸ "
    return [
      { text: line.child ? "    " : chevron, fg: ink.note },
      { text: `${line.categoryId === null ? "?" : categoryMark(line.categoryId)} `, fg: out ? ink.faint : line.color ?? ink.note },
      { text: fit(line.name, nameWidth() - (line.child ? 6 : 4)), fg: out ? ink.note : name, bold: !line.child },
      { text: formatWholeMoney(line.now).padStart(NUM), fg: out ? ink.note : line.budget && line.now > line.budget.amount ? tone.bad : name },
      ...(withAverage() ? [{ text: formatWholeMoney(line.average).padStart(NUM), fg: ink.note }] : []),
      line.budget ? { text: formatWholeMoney(line.budget.amount).padStart(NUM), fg: ink.figure }
        : out ? { text: "left out".padStart(NUM), fg: ink.faint }
        : row.open === false && row.budgeted ? { text: `${row.budgeted} set`.padStart(NUM), fg: ink.note }
        : { text: "".padStart(NUM), fg: ink.faint },
    ]
  }
  // The overall budget: its name and amount on one line; unset, "not set"
  // in caution with the nudge on a line under it.
  const overallLines = (row: Extract<SetupRow, { kind: "overall" }>): Span[][] => {
    const width = rowWidth(categoriesWidth())
    if (!row.budget) {
      const nudge = row.average >= 1 ? `enter sets it from your ${formatWholeMoney(row.average)} average` : "enter sets it"
      return [
        fitSpans([{ text: fit(`  ${row.name}`, width - 7), fg: ink.figure, bold: true }, { text: "not set", fg: tone.caution }], width),
        fitSpans([{ text: `  ${nudge}`, fg: tone.caution }], width),
      ]
    }
    // Set: the name takes the row (not the categories' name column), the
    // budget at its end, under Budget.
    const amount = formatWholeMoney(row.budget.amount).padStart(NUM)
    return [fitSpans([
      { text: fit(`  ${row.name}`, width - amount.length - 2), fg: ink.figure, bold: true },
      { text: amount + "  ", fg: ink.figure, bold: true },
    ], width)]
  }
  // The overall row (two lines unset), a blank line and the headings stay
  // put; the categories scroll under them.
  const overallRow = () => setup()[0] as Extract<SetupRow, { kind: "overall" }>
  const overallHeight = () => (overallRow().budget ? 1 : 2)
  const categoryRoom = () => Math.max(1, categoriesHeight() - 4 - overallHeight() - (paydayLines().length ? paydayLines().length + 1 : 0))
  const categoryLines = createMemo(() => setup().slice(1) as Array<Extract<SetupRow, { kind: "line" }>>)
  const categoryTop = createMemo(() => centredTop(Math.max(0, categoryCursor() - 1), categoryLines().length, categoryRoom()))
  // Nothing budgeted yet: the pane says to start here.
  const nothingSet = () => view().current && budgets().length === 0

  const Chart = () => (
    <ChartCard scope={subject().title} views={BUDGET_VIEWS} current={ui.state.budgetChart} model={model()} width={chartWidth()} height={chartHeight()} baseline={baseline()}
      legend={subscriptionsLegend(subs(), dueBeforePayday())}
      fallback={<SubscriptionsView list={subs()} width={chartWidth() - 4} rows={chartHeight() - 2} today={today()} payday={payday()} />}
      revealKey={data.state.uiPrefs.chartMotion === "always" ? `${(BUDGET_VIEWS[ui.state.budgetChart] ?? BUDGET_VIEWS[0]!).view}:${subject().title}:${seen()}` : undefined}
      revealMs={data.state.uiPrefs.chartMotion === "always" ? chartSpeedMs(data.state.uiPrefs.chartSpeed) : undefined}
      curve={data.state.uiPrefs.chartCurve}
      labels={data.state.uiPrefs.chartLabels} />
  )
  // Progress: where each budget stands this cycle, then (a blank line
  // apart) the budget at the cursor cycle by cycle; Each cycle's legend in
  // the bottom border.
  const Progress = () => (
    <SectionCard title="Progress" titleSuffix={view().current ? `· day ${elapsed()} of ${cycle().days}` : `· ${period()} · ] later`} titleSuffixColor={view().current ? tone.scope : tone.caution} focused={listFocused()} width={progressWidth()} height={progressHeight()}
      bottomSpans={cycles().length ? cycleLinesLegend(cycles()) : undefined}>
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
          if (r.kind === "total") return fitSpans([{ text: fit(TOTAL, LABEL()), fg: ink.strong, bold: true }, ...budgetSpans(totalProgress())], rowWidth(progressWidth()))
          if (r.budget) return fitSpans([{ text: fit(label(r.budget), LABEL()), fg: ink.figure, bold: true }, ...budgetSpans(progress().get(r.budget.id))], rowWidth(progressWidth()))
          return fitSpans([{ text: fit(overallName(), LABEL()), fg: ink.figure, bold: true }, { text: `not set: enter sets one${hasCategoryBudgets() ? " for the rest" : ""}`, fg: ink.note }], rowWidth(progressWidth()))
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
          <Index each={fitSpans(summary(), rowWidth(progressWidth()))}>{(span) => <S fg={span().fg}>{span().text}</S>}</Index>
        </text>
      </Show>
      <Show when={cycles().length}>
        <text wrapMode="none">{" "}</text>
        <text wrapMode="none">
          <S fg={ink.heading} bold>{" Each cycle"}</S>
          <S fg={ink.label}>{` · ${subject().title}`}</S>
        </text>
        <Index each={cycleLines(cycles().slice(0, Math.max(1, cycleRoom())), rowWidth(progressWidth()), pace(), today())}>{(spans) => (
          <text wrapMode="none">
            <S fg={ink.note}>{" "}</S>
            <Index each={spans()}>{(span) => <S fg={span().fg} bold={span().bold}>{span().text}</S>}</Index>
          </text>
        )}</Index>
      </Show>
    </SectionCard>
  )
  const Categories = () => (
    <SectionCard title="Budgets" titleSuffix={nothingSet() ? "· start here" : categoriesFocused() ? "· enter set · space open" : undefined}
      titleSuffixColor={nothingSet() ? tone.caution : ink.note} focused={categoriesFocused()} width={categoriesWidth()} height={categoriesHeight()}>
      <Show when={paydayLines().length}>
        <Index each={paydayLines()}>{(spans) => <ListRow cursor={false} bg={theme.canvas} spans={spans()} />}</Index>
        <text wrapMode="none">{" "}</text>
      </Show>
      {(() => {
        const overall = overallRow
        return <Index each={overallLines(overall())}>{(spans, i) => (
          <ListRow cursor={categoriesFocused() && categoryCursor() === 0} bg={theme.canvas} armed={i === 0 && overall().budget ? armedFor(ui.state.armed, "budget", budgetArmId(overall().budget!, cycle().start)) : undefined} spans={spans()} />
        )}</Index>
      })()}
      <text wrapMode="none">{" "}</text>
      <Show when={categoryLines().length} fallback={<text fg={ink.note}>{" No spending yet."}</text>}>
        <text wrapMode="none">
          <S fg={ink.note}>{` ${fit("", nameWidth())}`}</S>
          <S fg={ink.label}>{"Spent".padStart(NUM)}{withAverage() ? "Average".padStart(NUM) : ""}{"Budget".padStart(NUM)}</S>
        </text>
        <Index each={categoryLines().slice(categoryTop(), categoryTop() + categoryRoom())}>{(row, i) => (
          <ListRow cursor={categoriesFocused() && categoryTop() + i + 1 === categoryCursor()} bg={theme.canvas} armed={row().line.budget ? armedFor(ui.state.armed, "budget", budgetArmId(row().line.budget!, cycle().start)) : undefined} spans={lineSpans(row())} />
        )}</Index>
      </Show>
    </SectionCard>
  )

  // The cycle panes: the Overview's views (CYCLE_VIEWS: not the spending
  // ones, the budget pane's, nor the calendar) over the cycle shown, for every
  // spending account (the Overview's "All spending"), with the total
  // budgeted on the spending charts; Merchants against the same days of
  // the cycle before, when the history covers it.



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
        <OverviewChartCard index={index()} views={CYCLE_VIEWS} model={cycleModels[p.pane]!()} calendar={cycleCalendar()} trends={cycleTrends()} merchants={cycleMerchants()} today={today()}
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
  // Permanent, but it draws in as the charts do ("always": each time the
  // tab comes into view, the cycle or the budget changes): its days tile in
  // in date order.
  const calendarReveal = useReveal(
    () => (data.state.uiPrefs.chartMotion === "always" ? `${cycle().start}:${subject().title}:${seen()}` : undefined),
    () => chartSpeedMs(data.state.uiPrefs.chartSpeed), () => data.state.uiPrefs.chartCurve)
  const calendarDays = createMemo(() => calendarWeeks().flat().flatMap((d) => (d ? [d.dateISO] : [])).sort())
  const calendarThrough = () => (calendarReveal() >= 1 ? undefined : calendarDays()[Math.ceil(calendarReveal() * calendarDays().length) - 1] ?? "")
  const CycleCalendar = () => (
    <SectionCard title="Spending calendar" titleSuffix={`· ${subject().title}`} titleSuffixColor={ink.label} bottomSpans={calendarSpans()} width={categoriesWidth()} height={calendarHeight()}>
      <CalendarView weeks={calendarWeeks()} width={categoriesWidth() - 4} rows={calendarHeight() - 2} today={today()} through={calendarThrough()} />
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
  const ProgressCard = () => region("bud.list", progressWidth, progressHeight, () => <Progress />)
  const CategoriesCard = () => region("bud.categories", categoriesWidth, categoriesHeight, () => <Categories />)

  return (
    <box width="100%" height="100%" flexDirection={wide() ? "row" : "column"} gap={wide() ? 1 : 0} backgroundColor={theme.canvas}>
      <Show when={wide()} fallback={<><ProgressCard /><BudgetPane /><Show when={calendarHeight()}><CycleCalendar /></Show><CategoriesCard /></>}>
        <Show when={grid()} fallback={
          <box flexDirection="column" width={mainWidth()} height={body()}>
            <ProgressCard />
            <BudgetPane />
            <Show when={cyclePanes() > 0}><CyclePane pane={0} /></Show>
          </box>
        }>
          <box flexDirection="column" width={mainWidth()} height={body()}>
            <box flexDirection="row" gap={1} width={mainWidth()} height={topQuarter()} flexShrink={0}>
              <ProgressCard />
              <BudgetPane />
            </box>
            <box flexDirection="row" gap={1} width={mainWidth()} height={bottomQuarter()} flexShrink={0}>
              <CyclePane pane={0} />
              <CyclePane pane={1} />
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
