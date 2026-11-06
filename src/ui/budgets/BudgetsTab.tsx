import { Index, Show, createEffect, createMemo } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { allocation, measuredBudgetIn, cycleFor, budgetCounts, budgetCountsThen, budgetIgnoredIds, budgetProgress, cycleSpending, pastCycles, progressOf, totalBudgetIn, type Budget, type BudgetSubject, type Cycle } from "../../domain/budget"
import { budgetArmId, budgetSetupRows, overallAverage, type SetupRow } from "../../domain/budgetLines"
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
import { categoryColor, fade, ink, theme, tone } from "../../theme"
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
import { GRID_PANE_MIN, OverviewChartCard, sideColumnWidth, WIDE, chartRows, overviewChartModel, type OverviewChartInput } from "../overview/OverviewTab"
import { CalendarView, calendarLegend } from "../overview/CalendarView"
import { spendingCalendar } from "../../domain/spending"
import { merchantRows, trendRows } from "../../domain/periodTables"
import { accountRole } from "../../domain/types"
import { regionRef } from "../regions"
import { onPointer } from "../../app/pointer"
import type { JSX } from "solid-js"
import { SubscriptionsView, subscriptionsLegend } from "../charts/SubscriptionsView"
import { subscriptions, upcomingCharges } from "../../domain/subscriptions"
import { cyclePay } from "../../domain/payday"
import { PaydayTiles, TILE_HEIGHT, cycleTrack, payBar, saversMeter, type PayPart } from "./PlanGraphics"

/** Cycles before this one the chart and the cycle lines can show, at most. */
const HISTORY = 36

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
  const ALL = "All spending"

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
  // The Budgets pane's rows: All spending (against the target), the
  // account budgets, then the categories, groups closed unless opened
  // (space); your pay has a key (p), not a row.
  const setup = createMemo(() => budgetSetupRows(lines(), new Set(ui.state.budgetSetupOpen), budgets()))
  const categoryCursor = createMemo(() => Math.min(ui.state.budgetCategoryCursor, Math.max(0, setup().length - 1)))
  const firstData = createMemo(() => transactions().reduce((first, t) => (t.dateISO < first ? t.dateISO : first), today()))

  // What the charts follow: the Budgets pane's row at its cursor (All
  // spending to start), wherever the focus is. Its rows are judged by the
  // budgets of their own cycle (budgetCountsThen): rent is everything else
  // only in cycles it had no budget.
  const subject = createMemo((): { title: string; scope: BudgetSubject | null; counts: (row: Transaction) => boolean; amount: number | null } => {
    const of = (scope: BudgetSubject) => budgetCountsThen(scope, data.state.categories, data.state.budgetHistory, data.state.budgets, config())
    const at = setup()[categoryCursor()]
    if (at?.kind === "line") {
      const line = at.line, id = line.categoryId
      return id === null
        ? { title: "Uncategorised", scope: null, counts: (row) => row.categoryId === null, amount: null }
        : { title: line.name, scope: { kind: "category", categoryId: id }, counts: of({ kind: "category", categoryId: id }), amount: line.budget?.amount ?? null }
    }
    if (at?.kind === "account") return { title: label(at.budget), scope: at.budget.scope, counts: of(at.budget.scope), amount: at.budget.amount }
    return { title: ALL, scope: { kind: "total" }, counts: of({ kind: "total" }), amount: split().total || null }
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
        budget: !scope ? null : scope.kind === "total" ? totalBudgetIn(data.state.budgetHistory, data.state.budgets, data.state.categories, c.start) : measuredBudgetIn(data.state.budgetHistory, data.state.budgets, data.state.categories, scope, c.start),
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
  // The Overview's side column width.
  const categoriesWidth = () => (wide() ? sideColumnWidth(dims().width) : dims().width)
  const mainWidth = () => (wide() ? dims().width - 1 - categoriesWidth() : dims().width)
  // The layouts. Wide: the main column, then a side column with the
  // cycle's calendar over the Budgets pane. Two columns (split screen): the
  // budget pane on top of the main column and a cycle pane under it where
  // there's height for both; the calendar the budget pane's height, so
  // Budgets starts on the cycle pane's line. Three columns (full screen,
  // the main column fits two panes of GRID_PANE_MIN): the budget pane
  // across the top, two cycle panes under it. Narrow: one column, the
  // budget pane, the calendar on a tall terminal, the Budgets pane.
  const grid = () => wide() && mainWidth() >= 2 * GRID_PANE_MIN + 1
  const halfLeft = () => Math.ceil((mainWidth() - 1) / 2)
  const halfRight = () => Math.floor((mainWidth() - 1) / 2)
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
  createEffect(() => {
    const n = cyclePanes()
    if (ui.state.budgetCyclePanes !== n) ui.setState({ budgetCyclePanes: n })
    const pane = BUDGET_PANES.indexOf(props.focused)
    if (pane > n) ui.setState({ focusedSection: "bud.categories" })
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
    if (chartView() === "Subscriptions" || chartView() === "Each cycle") return null
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

  const categoriesFocused = () => props.focused === "bud.categories"

  const spendingIds = createMemo(() => new Set(data.state.accounts.filter((a) => accountRole(a) === "spending").map((a) => a.id)))
  const allSpending = createMemo(() => transactions().filter((t) => t.accountId != null && spendingIds().has(t.accountId)))
  const inCycle = createMemo(() => allSpending().filter((t) => t.dateISO >= cycle().start && t.dateISO <= cycle().end))
  // The plan, as you give it: your pay each payday and your spending (the
  // overall budget). Pay less spending goes to savers; that's what to set
  // Up's pay splitting to send. Nothing is judged without it.
  const expectedPay = () => data.state.uiPrefs.expectedPay || null
  const spendingPlan = () => (budgets().length ? split().total : null)
  const toSavers = () => (expectedPay() != null && spendingPlan() != null ? expectedPay()! - spendingPlan()! : null)
  // This cycle's pay as it happened: all of it, and what's gone to savers.
  const paid = createMemo(() => cyclePay(data.state.accounts, transactions(), cycle().start, through()))
  // The parts of the target: the category budgets not inside a group with one.
  const targetParts = createMemo((): PayPart[] => {
    const onCategory = new Set(budgets().flatMap((b) => (b.scope.kind === "category" ? [b.scope.categoryId] : [])))
    return budgets().flatMap((b): PayPart[] => {
      if (b.scope.kind !== "category") return []
      const c = data.state.categories.find((x) => x.id === (b.scope as { categoryId: number }).categoryId)
      if (c?.parentId != null && onCategory.has(c.parentId)) return []
      return [{ name: c?.name ?? "?", amount: b.amount, color: categoryColor(c?.color), spent: progress().get(b.id)?.spent ?? 0 }]
    })
  })
  // Budgets: where budgets are set. The overall budget first (until
  // set, a nudge in caution: enter sets it from its average), then each
  // category: name, this cycle, the average, and its budget or that it's
  // left out; a closed group says how many budgets it holds. The average
  // goes where it would leave names too short.
  const NUM = 9
  const withAverage = () => rowWidth(categoriesWidth()) - NUM * 3 >= 14
  const nameWidth = () => rowWidth(categoriesWidth()) - NUM * (withAverage() ? 3 : 2)
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
  const overallBudget = () => budgets().find((b) => b.scope.kind === "overall") ?? null
  // All spending: the table's total, against the overall spending target
  // (or with none, the category budgets added up); an account's budget.
  const figureRow = (name: string, nameFg: string, spentNow: number, average: number | null, budget: number | null): Span[] => [
    { text: "  ", fg: ink.note },
    { text: fit(name, nameWidth() - 2), fg: nameFg, bold: true },
    { text: formatWholeMoney(spentNow).padStart(NUM), fg: budget != null && spentNow > budget ? tone.bad : nameFg },
    ...(withAverage() ? [{ text: (average == null ? "" : formatWholeMoney(average)).padStart(NUM), fg: ink.note }] : []),
    { text: (budget == null ? "" : formatWholeMoney(budget)).padStart(NUM), fg: ink.figure },
  ]
  const rowSpans = (row: SetupRow): Span[] => {
    if (row.kind === "line") return lineSpans(row)
    if (row.kind === "account") return figureRow(label(row.budget), ink.figure, progress().get(row.budget.id)?.spent ?? 0, null, row.budget.amount)
    return figureRow(ALL, ink.strong, totalProgress().spent, overallAverage(lines(), ignored()), split().total || null)
  }
  const rowBudget = (row: SetupRow) => (row.kind === "line" ? row.line.budget : row.kind === "account" ? row.budget : overallBudget())
  // The pane's top, on the table's grid: headings and rows from the left,
  // notes two in, figures at the row's end; the pictures the row's width.
  const heading = (text: string, figure = ""): Span[] => {
    const width = rowWidth(categoriesWidth())
    return fitSpans([{ text: fit(text, Math.max(1, width - NUM)), fg: ink.heading, bold: true }, { text: figure.padStart(NUM), fg: ink.figure, bold: true }], width)
  }
  const note = (text: string, fg: string = ink.note, inset = "  "): Span[] => fitSpans([{ text: `${inset}${text}`, fg }], rowWidth(categoriesWidth()))
  const blank: Span[] = [{ text: " ", fg: ink.note }]
  // A ledger line: its label from the left; a note, then its figure in the
  // figures' column, at the row's end.
  const ledger = (label: Span, figure: Span, before: Span[] = []): Span[] => {
    const width = rowWidth(categoriesWidth())
    const end = [...before, ...(before.length ? [{ text: " ", fg: ink.note }] : []), { ...figure, text: figure.text.padStart(NUM) }]
    const w = end.reduce((n, x) => n + x.text.length, 0)
    return fitSpans([{ ...label, text: fit(label.text, Math.max(1, width - w)) }, ...end], width)
  }
  // A heading with a note at the row's end.
  const headed = (text: string, after: Span[]): Span[] => {
    const width = rowWidth(categoriesWidth()), w = after.reduce((n, x) => n + x.text.length, 0)
    return fitSpans([{ text: fit(text, Math.max(1, width - w)), fg: ink.heading, bold: true }, ...after], width)
  }
  // Under the tiles: Pay (your pay, what's spent and what remains of it,
  // and the pay as a bar: the category budgets, the rest of the target,
  // savers), Savers (the plan for them as a meter: what's gone, what's
  // still to send and what spending past the target has taken), then This
  // cycle as a track. Until pay or target is set, a caution tile says which keys set
  // them. A line with `bg` is filled to the row's end.
  const topLines = createMemo((): Array<TopLine> => {
    const width = rowWidth(categoriesWidth())
    const pay = expectedPay(), target = overallBudget()
    const out: Array<TopLine> = []
    const payLabel: Span = { text: "Pay", fg: ink.heading, bold: true }
    const plan = toSavers()
    const total = split().total
    const spent = totalProgress().spent
    if (pay == null && !target) {
      out.push({ spans: heading("Pay"), stays: true })
      const fill = fade(tone.caution, 0.8)
      out.push(
        { spans: blank, bg: fill },
        { spans: note("Set your pay and your spending target", tone.caution, " "), bg: fill },
        { spans: [{ text: " p", fg: tone.key, bold: true }, { text: " your pay  ", fg: ink.label }, { text: "t", fg: tone.key, bold: true }, { text: " your spending target", fg: ink.label }], bg: fill },
        { spans: blank, bg: fill },
      )
    } else {
      // Pay; what's spent and what's left are on its bar, just under it.
      out.push({ spans: pay != null
        ? ledger(payLabel, { text: formatWholeMoney(pay), fg: ink.figure, bold: true }, [{ text: "usual pay", fg: ink.note }])
        : ledger(payLabel, { text: "", fg: ink.note }, [{ text: "p sets your pay", fg: tone.caution }]), stays: true })
      // The rest of the target's spending: all of it less the categories' own.
      const restSpent = target ? Math.max(0, spent - targetParts().reduce((n, c) => n + c.spent, 0)) : 0
      for (const spans of payBar(width, pay, target ? total : 0, target ? targetParts() : [], restSpent)) out.push({ spans, sweeps: spans.some((x) => x.text.includes("█")) })
    }
    out.push({ spans: blank, stays: true }, { spans: plan != null && plan > 0 ? headed("Savers", [{ text: "plan ", fg: ink.note }, { text: formatWholeMoney(plan), fg: ink.figure, bold: true }]) : heading("Savers"), stays: true })
    const p = paid()
    if (pay == null) out.push({ spans: note("p: your pay, to see what goes to savers", tone.caution, "") })
    else if (!target) out.push({ spans: note("t: your spending target, to see what's saved", tone.caution, "") })
    else if (plan != null && plan < 0) out.push({ spans: note(`The target is ${formatWholeMoney(-plan)} more than your pay`, tone.caution, "") })
    else if (plan != null && plan > 0) {
      // Spending past the target comes out of the plan; what's left of it,
      // less what's gone, is still to send.
      const short = Math.min(plan, Math.max(0, spent - total))
      const toSend = Math.max(0, plan - short - p.sent)
      for (const spans of saversMeter(width, p.sent, toSend, short)) out.push({ spans, sweeps: spans.some((x) => x.text.includes("█")) })
    }
    if (!p.pay && view().current) out.push({ spans: note("no pay found yet (the Salary category)", ink.note, "") })
    out.push({ spans: blank, stays: true }, { spans: heading("This cycle"), stays: true })
    for (const [n, spans] of cycleTrack(width, cycle().start, addDays(cycle().end, 1), today(), p, plan != null && plan > 0 ? tone.good : ink.figure).entries()) out.push({ spans, sweeps: n === 1 })
    return out
  })
  // Drawing in, as Subscriptions does ("always": each time the tab shows
  // or the cycle changes, not as the cursor moves): the bars (each pay,
  // the cycle's track, the meter) sweep in from the left, and the lines
  // with them drop in, in order; the headings are there from the start.
  const planReveal = useReveal(
    () => (data.state.uiPrefs.chartMotion === "always" ? `${cycle().start}:${seen()}` : undefined),
    () => chartSpeedMs(data.state.uiPrefs.chartSpeed), () => data.state.uiPrefs.chartCurve)
  const shownTop = createMemo((): TopLine[] => {
    const p = planReveal(), lines = topLines()
    if (p >= 1) return lines
    const width = rowWidth(categoriesWidth())
    const edge = Math.round(Math.min(1, p / 0.7) * width)
    return lines.map((line, i) => {
      if (line.stays) return line
      if (line.sweeps) return { ...line, spans: sweptTo(line.spans, edge) }
      return p >= 0.3 + 0.6 * (i / lines.length) ? line : { ...line, spans: [{ text: " ", fg: ink.note }] }
    })
  })
  // The payday tiles, this cycle only (a past one has no next payday to
  // count to), and a blank line under them.
  const tiles = () => view().current
  const tilesHeight = () => (tiles() ? TILE_HEIGHT + 1 : 0)
  // The top (the plan, this cycle), a blank line and the Categories
  // heading stay put; the categories scroll under them.
  // The cycle's calendar, in the pane between This cycle and the table,
  // compact: two lines a weekday (15 rows) where the pane has room for it
  // and a few table rows, else one (8), else none.
  const calendarRows = () => {
    const room = categoriesHeight() - 4 - tilesHeight() - topLines().length - 3 - Math.min(setup().length, BUDGETS_ROWS_MIN)
    return room >= CALENDAR_TALL ? CALENDAR_TALL : room >= CALENDAR_MIN ? CALENDAR_MIN : 0
  }
  // Its heading, the days, its legend and a blank line.
  const calendarBlock = () => (calendarRows() ? calendarRows() + 3 : 0)
  const categoryRoom = () => Math.max(1, categoriesHeight() - 4 - tilesHeight() - topLines().length - calendarBlock())
  const categoryLines = setup
  const categoryTop = createMemo(() => centredTop(categoryCursor(), categoryLines().length, categoryRoom()))
  // Nothing budgeted yet: the pane says to start here.
  const nothingSet = () => view().current && budgets().length === 0 && !data.state.uiPrefs.expectedPay

  // The budget pane's key while it draws in ("always"): each view, budget
  // and showing. Its views that aren't charts (Subscriptions, Each cycle)
  // draw in on it too, as the Overview's table views do.
  const chartKey = () => (data.state.uiPrefs.chartMotion === "always" ? `${(BUDGET_VIEWS[ui.state.budgetChart] ?? BUDGET_VIEWS[0]!).view}:${subject().title}:${seen()}` : undefined)
  const tableReveal = useReveal(() => (model() ? undefined : chartKey()), () => chartSpeedMs(data.state.uiPrefs.chartSpeed), () => data.state.uiPrefs.chartCurve)
  const Chart = () => (
    <ChartCard scope={subject().title} views={BUDGET_VIEWS} current={ui.state.budgetChart} model={model()} width={chartWidth()} height={chartHeight()} baseline={baseline()}
      focused={props.focused === "bud.chart"}
      legend={chartView() === "Each cycle" ? (cycles().length ? cycleLinesLegend(cycles()) : undefined) : subscriptionsLegend(subs(), dueBeforePayday())}
      fallback={chartView() === "Each cycle" ? <EachCycle /> : <SubscriptionsView list={subs()} width={chartWidth() - 4} rows={chartHeight() - 2} today={today()} payday={payday()} progress={tableReveal()} />}
      revealKey={chartKey()}
      revealMs={data.state.uiPrefs.chartMotion === "always" ? chartSpeedMs(data.state.uiPrefs.chartSpeed) : undefined}
      curve={data.state.uiPrefs.chartCurve}
      labels={data.state.uiPrefs.chartLabels} />
  )
  // Each cycle: the subject cycle by cycle, newest first, each against the
  // budget then, as many as fit.
  // Drawing in, its rows drop in newest first, each bar sweeping in.
  const EachCycle = () => {
    const shown = () => cycles().slice(0, Math.max(1, chartHeight() - 2))
    const rowsIn = () => Math.ceil(Math.min(1, tableReveal() / 0.6) * shown().length)
    return (
      <Index each={cycleLines(shown(), chartWidth() - 4, pace(), today())}>{(spans, i) => (
        <text wrapMode="none">
          <Index each={i < rowsIn() ? spans() : []}>{(span) => <S fg={span().fg} bold={span().bold}>{span().text}</S>}</Index>
        </text>
      )}</Index>
    )
  }
  const Categories = () => (
    <SectionCard title="Budgets" titleSuffix={nothingSet() ? "· start here" : view().current ? `· day ${elapsed()} of ${cycle().days}` : `· ${period()} · ] later`}
      titleSuffixColor={nothingSet() || !view().current ? tone.caution : tone.scope} focused={categoriesFocused()} width={categoriesWidth()} height={categoriesHeight()}>
      <Show when={tiles()}>
        <box paddingLeft={1} height={TILE_HEIGHT} flexShrink={0}><PaydayTiles width={rowWidth(categoriesWidth())} next={addDays(cycle().end, 1)} today={today()}
          perDay={overallBudget() ? { remaining: totalProgress().remaining, daily: totalProgress().dailyAllowance } : null} /></box>
        <text wrapMode="none">{" "}</text>
      </Show>
      <Index each={shownTop()}>{(line) => (
        // Never shrunk: past the pane's height, lines clip rather than
        // overlap.
        <text wrapMode="none" flexShrink={0}>
          <S>{" "}</S>
          <Index each={line().spans}>{(span) => <S fg={span().fg} bg={line().bg} bold={span().bold}>{span().text}</S>}</Index>
          <Show when={line().bg}><S bg={line().bg}>{" ".repeat(Math.max(0, rowWidth(categoriesWidth()) - line().spans.reduce((n, x) => n + x.text.length, 0)))}</S></Show>
        </text>
      )}</Index>
      <text wrapMode="none">{" "}</text>
      <Show when={calendarRows()}>
        <text wrapMode="none" flexShrink={0}><S>{" "}</S><S fg={ink.heading} bold>{"Spending calendar"}</S></text>
        <box paddingLeft={1} height={calendarRows()} flexShrink={0}>
          <CalendarView weeks={calendarWeeks()} width={rowWidth(categoriesWidth())} rows={calendarRows()} today={today()} through={calendarThrough()} markColor={tone.good} />
        </box>
        <text wrapMode="none" flexShrink={0}>
          <S>{" "}</S>
          <Index each={fitSpans(calendarSpans(), rowWidth(categoriesWidth()))}>{(span) => <S fg={span().fg} bold={span().bold}>{span().text}</S>}</Index>
        </text>
        <text wrapMode="none" flexShrink={0}>{" "}</text>
      </Show>
      <Show when={categoryLines().length} fallback={<text fg={ink.note}>{" No spending yet."}</text>}>
        <text wrapMode="none">
          <S fg={ink.note}>{" "}</S>
          <S fg={ink.heading} bold>{fit("Categories", nameWidth())}</S>
          <S fg={ink.label}>{"Spent".padStart(NUM)}{withAverage() ? "Average".padStart(NUM) : ""}{"Budget".padStart(NUM)}</S>
        </text>
        <Index each={categoryLines().slice(categoryTop(), categoryTop() + categoryRoom())}>{(row, i) => (
          <ListRow cursor={categoriesFocused() && categoryTop() + i === categoryCursor()} bg={theme.canvas} armed={rowBudget(row()) ? armedFor(ui.state.armed, "budget", budgetArmId(rowBudget(row())!, cycle().start)) : undefined} spans={rowSpans(row())} />
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
  // The grid runs on a day, to the next cycle's payday, marked "pay".
  const calendarWeeks = createMemo(() => {
    const nextPayday = addDays(cycle().end, 1)
    const weeks = spendingCalendar(subjectRows().filter((t) => t.dateISO >= cycle().start && t.dateISO <= cycle().end), cycle().start, cycle().end, data.state.weekStart, { through: nextPayday })
    const due = new Map<string, number>()
    for (const c of expectedCharges()) due.set(c.dateISO, (due.get(c.dateISO) ?? 0) + c.amount)
    return weeks.map((week) => week.map((d) => {
      if (!d) return d
      if (d.dateISO === nextPayday) return { ...d, mark: "pay" }
      return due.has(d.dateISO) ? { ...d, expected: due.get(d.dateISO)! } : d
    }))
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


  /** A click on a card or pane focuses it. */
  const panePointer = (id: SectionId) => onPointer((scope) => scope === "bar" || scope.startsWith("budgets"), () => ui.applyJump(id))
  // Sizes as accessors: a component's body runs once, so a number read here
  // would keep its first value.
  const region = (id: SectionId, width: () => number, height: () => number, card: () => JSX.Element) => (
    <box ref={regionRef(id, "budgets")} width={width()} height={height()} flexShrink={0} onMouseDown={panePointer(id)}>{card()}</box>
  )
  const BudgetPane = () => region("bud.chart", chartWidth, chartHeight, () => <Chart />)
  const CategoriesCard = () => region("bud.categories", categoriesWidth, categoriesHeight, () => <Categories />)

  return (
    <box width="100%" height="100%" flexDirection={wide() ? "row" : "column"} gap={wide() ? 1 : 0} backgroundColor={theme.canvas}>
      <Show when={wide()} fallback={<><BudgetPane /><CategoriesCard /></>}>
        <Show when={grid()} fallback={
          <box flexDirection="column" width={mainWidth()} height={body()}>
            <BudgetPane />
            <Show when={cyclePanes() > 0}><CyclePane pane={0} /></Show>
          </box>
        }>
          <box flexDirection="column" width={mainWidth()} height={body()}>
            <BudgetPane />
            <box flexDirection="row" gap={1} width={mainWidth()} height={bottomQuarter()} flexShrink={0}>
              <CyclePane pane={0} />
              <CyclePane pane={1} />
            </box>
          </box>
        </Show>
        <CategoriesCard />
      </Show>
    </box>
  )
}

/** The cycle calendar's rows with a line a weekday (and the months). */
const CALENDAR_MIN = 8
/** Its rows with two lines a weekday (each day's amount under its number). */
const CALENDAR_TALL = 15

/** The Budgets pane's fewest table rows before the calendar gives way. */
const BUDGETS_ROWS_MIN = 5

/** Fewest rows a Budgets chart pane gets before the cycle pane gives way. */
const CYCLE_PANE_MIN = 12

/** A line of the Budgets pane's top: `stays` while it draws in (headings),
 * `sweeps` in from the left (bars), or drops in; `bg` fills it to the row's
 * end. */
interface TopLine { spans: Span[]; bg?: string; sweeps?: boolean; stays?: boolean }

/** `spans` cut at `edge` cells, the rest blank: a bar sweeping in. */
function sweptTo(spans: Span[], edge: number): Span[] {
  const out: Span[] = []
  let left = edge, width = 0
  for (const span of spans) {
    width += span.text.length
    if (left <= 0) continue
    out.push(span.text.length <= left ? span : { ...span, text: span.text.slice(0, left) })
    left -= span.text.length
  }
  const shown = out.reduce((n, x) => n + x.text.length, 0)
  return [...out, { text: " ".repeat(Math.max(0, width - shown)), fg: ink.note }]
}
