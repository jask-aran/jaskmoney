import { useTerminalDimensions } from "@opentui/solid"
import { createMemo } from "solid-js"
import { allocation, budgetCounts, budgetCountsThen, budgetIgnoredIds, budgetProgress, cycleSpending, measuredBudgetIn, pastCycles, progressOf, totalBudgetIn, type Budget, type BudgetSubject, type Cycle } from "../../domain/budget"
import { budgetSetupRows } from "../../domain/budgetLines"
import { budgetLabel } from "../../domain/budgetScopes"
import { dailySpendSeries, formatWholeMoney } from "../../domain/dashboard"
import { addDays, appToday, daysBetween } from "../../domain/days"
import { cyclePay } from "../../domain/payday"
import { computePeriodFlows, historyCovers } from "../../domain/position"
import { spendingCalendar } from "../../domain/spending"
import { upcomingCharges } from "../../domain/subscriptions"
import type { Transaction } from "../../domain/types"
import { accountRole } from "../../domain/types"
import { sharedBudgetView, sharedCategoryLines } from "../../state/budgetViews"
import { data } from "../../state/dataStore"
import type { SectionId } from "../../state/uiStore"
import { ui } from "../../state/uiStore"
import { categoryColor, ink, tone } from "../../theme"
import { chartSpeedMs, showings, useReveal } from "../charts/motion"
import { calendarLegend } from "../overview/CalendarView"
import { type Span } from "../primitives/spans"
import { count, shortDate } from "../text"
import { createBudgetChartModel } from "./BudgetChart"
import { type CycleSpent } from "./budgetCharts"
import { type PayPart } from "./PlanGraphics"

export function createBudgetInputs() {
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
  return { budgets, config, through, transactions, cycle, today, label, ALL, dims, view, seen, pace, elapsed, period }
}

export function createBudgetProgress(input: Pick<ReturnType<typeof createBudgetInputs>, "budgets" | "config" | "through" | "transactions" | "cycle" | "today">) {
  const { budgets, config, through, transactions, cycle, today } = input

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
  return { setup, categoryCursor, split, firstData, progress, ignored, totalProgress, lines }
}

export function createBudgetHistory(input: Pick<ReturnType<typeof createBudgetInputs>, "config" | "label" | "ALL" | "today" | "transactions" | "cycle" | "through"> & Pick<ReturnType<typeof createBudgetProgress>, "setup" | "categoryCursor" | "split" | "firstData">) {
  const { config, setup, categoryCursor, label, ALL, split, firstData, today, transactions, cycle, through } = input

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

  return { subjectRows, subject, cycles, past, spent }
}

export function createBudgetPlan(input: Pick<ReturnType<typeof createBudgetInputs>, "transactions" | "cycle" | "through" | "budgets"> & Pick<ReturnType<typeof createBudgetProgress>, "split" | "progress"> & { props: { focused: SectionId } }) {
  const { transactions, cycle, through, budgets, split, progress, props } = input
  const categoriesFocused = () => props.focused === "bud.categories"

  const spendingIds = createMemo(() => new Set(data.state.accounts.filter((a) => accountRole(a) === "spending").map((a) => a.id)))
  const allSpending = createMemo(() => transactions().filter((t) => t.accountId != null && spendingIds().has(t.accountId)))
  const inCycle = createMemo(() => allSpending().filter((t) => t.dateISO >= cycle().start && t.dateISO <= cycle().end))
  // The plan: what came in this cycle and your spending (the overall
  // budget); the rest goes to savers. What came in is all income (pay and
  // interest: the Overview's "in", so what's left here is its net), or
  // until pay has, your usual pay (what you expect each payday). Nothing is
  // judged without them.
  const expectedPay = () => data.state.uiPrefs.expectedPay || null
  const flows = createMemo(() => computePeriodFlows(data.state.accounts, transactions().filter((t) => t.dateISO >= cycle().start && t.dateISO <= through())))
  const income = () => flows().income
  const planPay = () => (paid().pay > 0 ? income() : expectedPay())
  const spendingPlan = () => (budgets().length ? split().total : null)
  const toSavers = () => (planPay() != null && spendingPlan() != null ? planPay()! - spendingPlan()! : null)
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
  return { planPay, toSavers, paid, income, targetParts, expectedPay, flows, allSpending, categoriesFocused, inCycle, spendingIds }
}

export function createBudgetCalendar(input: Pick<ReturnType<typeof createBudgetInputs>, "view" | "today" | "cycle" | "seen"> & Pick<ReturnType<typeof createBudgetChartModel>, "subs"> & Pick<ReturnType<typeof createBudgetHistory>, "subjectRows" | "subject" | "spent">) {
  const { view, subs, today, cycle, subjectRows, subject, spent, seen } = input
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

  return { calendarWeeks, calendarThrough, calendarSpans }
}

/** Cycles before this one the chart and the cycle lines can show, at most. */
const HISTORY = 36
