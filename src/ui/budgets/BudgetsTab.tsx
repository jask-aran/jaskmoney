import { Index, Show, createMemo } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { allocation, budgetCounts, budgetCountsThen, budgetIgnoredIds, budgetIn, budgetProgress, cycleSpending, pastCycles, progressOf, totalBudgetIn, type Budget, type BudgetProgress, type BudgetSubject, type Cycle } from "../../domain/budget"
import { budgetArmId, budgetCategoryLines, budgetListRows, budgetView, type BudgetLine } from "../../domain/budgetLines"
import { budgetLabel } from "../../domain/budgetScopes"
import { dailySpendSeries, formatWholeMoney } from "../../domain/dashboard"
import { appToday, daysBetween } from "../../domain/days"
import { historyCovers } from "../../domain/position"
import type { Transaction } from "../../domain/types"
import type { SectionId } from "../../state/uiStore"
import { ui } from "../../state/uiStore"
import { data } from "../../state/dataStore"
import { armedFor } from "../../state/armed"
import { ink, theme, tone } from "../../theme"
import { categoryMark } from "../icons"
import { fit, shortDate } from "../text"
import { ListRow, centredTop } from "../primitives/ListRow"
import { SectionCard } from "../primitives/SectionCard"
import { S } from "../primitives/S"
import { fitSpans, type Span } from "../primitives/spans"
import { AXIS_GUESS, axisWidth, type ChartModel } from "../charts/ChartBody"
import { WIDE } from "../overview/OverviewTab"
import { cycleLines, cycleLinesLegend, type CycleSpent } from "./budgetCharts"
import { ChartCard } from "../charts/ChartCard"
import { spendingChart } from "../overview/periodCharts"
import { BUDGET_VIEWS } from "../../state/uiStore"

/** Cycles before this one the chart and the cycle lines can show, at most. */
const HISTORY = 36

/**
 * A bar in `width` cells for `fill` (0–1 of the width), coloured by how
 * it's going (green, yellow ahead of pace, red over budget), with a mark at
 * `mark` (0–1): where spending would be by today at an even pace. Over
 * budget, the bar is scaled to what was spent: green up to the budget's
 * mark, red past it.
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
    const cell = i === at ? { text: i < filled ? "▌" : "│", fg: ink.figure }
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
  const view = createMemo(() => budgetView(config(), today(), ui.state.budgetOffset, data.state.budgetHistory, data.state.budgets))
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

  const rows = () => budgetListRows(budgets(), data.state.categories)
  const budgetCursor = () => Math.min(ui.state.budgetCursor, rows().length - 1)
  const progress = createMemo(() => new Map(budgetProgress(budgets(), config(), through(), data.state.accounts, data.state.categories, transactions()).map((p) => [p.budget.id, p])))
  const split = createMemo(() => allocation(budgets(), data.state.categories))
  // The budgets together against what they count between them.
  const totalProgress = createMemo(() => {
    const counts = budgetCounts({ kind: "total" }, data.state.categories, budgets())
    const spentOnBudgets = cycleSpending(cycle(), through(), data.state.accounts, transactions()).filter(counts).reduce((sum, t) => sum - t.amount, 0)
    return progressOf({ id: -1, scope: { kind: "overall" }, amount: split().total }, spentOnBudgets, cycle(), through())
  })
  const lines = createMemo(() => budgetCategoryLines(config(), through(), data.state.accounts, data.state.categories, budgets(), transactions()))
  const categoryCursor = () => Math.min(ui.state.budgetCategoryCursor, Math.max(0, lines().length - 1))
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
  const spending = (c: Cycle, through: string) => cycleSpending(c, through, data.state.accounts, transactions()).filter(subject().counts)
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
  const summary = (): Span[] => {
    const spans: Span[] = []
    const { allocated, overall } = split()
    if (allocated > 0) spans.push({ text: `Categories ${formatWholeMoney(allocated)} + everything else ${overall == null ? "(not set)" : formatWholeMoney(overall)}`, fg: ink.label })
    const names = ignoredNames()
    if (names.length) spans.push({ text: `${spans.length ? " · " : ""}Not budgeted: ${names.join(", ")}`, fg: ink.note })
    return spans
  }
  const budgetsHeight = () => Math.min(rows().length, Math.max(1, Math.floor(body() * 0.3))) + 2 + (summary().length ? 1 : 0)
  // The chart and the cycle lines share what the budgets leave: half each.
  const chartHeight = () => (wide() ? Math.ceil((body() - budgetsHeight()) / 2) : Math.max(10, Math.floor(body() * 0.3)))
  const linesHeight = () => (wide() ? body() - budgetsHeight() - chartHeight() : Math.max(5, Math.floor(body() * 0.2)))
  const categoriesHeight = () => (wide() ? body() : Math.max(5, body() - chartHeight() - linesHeight() - budgetsHeight()))
  const rowWidth = (width: number) => width - 5

  // The chart: the Overview's spending view over the cycle shown, for what
  // the subject counts, with its budget; built once with a guessed axis
  // width, again if the labels need another.
  const baseline = () => data.state.uiPrefs.xAxis === true
  const subjectRows = createMemo(() => cycleSpending({ start: firstData(), end: today(), days: 0 }, today(), data.state.accounts, transactions()).filter(subject().counts))
  let axisWas = AXIS_GUESS
  const model = createMemo((): ChartModel => {
    // Border (2), the x-axis line (a setting) and the x labels.
    const height = Math.max(3, chartHeight() - (baseline() ? 4 : 3))
    const series = dailySpendSeries(subjectRows(), cycle().start, cycle().end)
    const view = (BUDGET_VIEWS[ui.state.budgetChart] ?? BUDGET_VIEWS[0]!).view as "Cumulative" | "Daily" | "Weekly"
    const build = (axis: number) => spendingChart(view, series, Math.max(1, mainWidth() - 4 - axis), height, today(), subjectRows(), subject().amount ?? undefined, { current: "This cycle", previous: "Last cycle" }, data.state.weekStart)
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
  const tight = () => rowWidth(mainWidth()) - LABEL() - 45 < 10
  const BAR = () => Math.max(tight() ? 4 : 6, Math.min(48, rowWidth(mainWidth()) - LABEL() - (tight() ? 36 : 45)))
  const budgetSpans = (p: BudgetProgress | undefined): Span[] => {
    if (!p) return []
    const budget = p.budget
    const used = budget.amount > 0 ? p.spent / budget.amount : p.spent > 0 ? 2 : 0
    const verdict = p.remaining < 0 ? { text: `${formatWholeMoney(-p.remaining)} over`, fg: tone.bad } : { text: `${formatWholeMoney(p.remaining)} left · ${formatWholeMoney(p.dailyAllowance)}/day`, fg: tone.good }
    // Narrow, the figures drop their alignment, and then go, before what's
    // left or over does.
    const figures = { text: tight() ? ` ${formatWholeMoney(p.spent)} of ${formatWholeMoney(budget.amount)} ` : `  ${formatWholeMoney(p.spent).padStart(7)} of ${formatWholeMoney(budget.amount).padEnd(7)}  `, fg: ink.label }
    const room = rowWidth(mainWidth()) - LABEL() - BAR()
    return [...bar(BAR(), used, pace()), ...(figures.text.length + verdict.text.length <= room ? [figures] : [{ text: " ", fg: ink.label }]), verdict]
  }
  const budgetRoom = () => budgetsHeight() - 2 - (summary().length ? 1 : 0)
  const budgetTop = () => centredTop(budgetCursor(), rows().length, budgetRoom())

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
  const categoryTop = () => centredTop(categoryCursor(), lines().length, categoryRoom())

  const Chart = () => (
    <ChartCard title={subject().title} views={BUDGET_VIEWS} current={ui.state.budgetChart} model={model()} width={mainWidth()} height={chartHeight()} baseline={baseline()} />
  )
  const Lines = () => (
    <SectionCard title="Each cycle" titleSuffix={`· ${subject().title}`} titleSuffixColor={ink.label} bottomSpans={cycleLinesLegend(cycles())} width={mainWidth()} height={linesHeight()}>
      <Index each={cycleLines(cycles().slice(0, Math.max(1, linesHeight() - 2)), rowWidth(mainWidth()), pace(), today())}>{(spans) => (
        <text wrapMode="none">
          <S fg={ink.note}>{" "}</S>
          <Index each={spans()}>{(span) => <S fg={span().fg} bold={span().bold}>{span().text}</S>}</Index>
        </text>
      )}</Index>
    </SectionCard>
  )
  const Budgets = () => (
    <SectionCard title="Budgets" titleSuffix={view().current ? `· day ${elapsed()} of ${cycle().days}` : `· ${period()} · ] later`} titleSuffixColor={view().current ? tone.scope : tone.caution} focused={listFocused()} width={mainWidth()} height={budgetsHeight()}>
      <Index each={rows().slice(budgetTop(), budgetTop() + budgetRoom())}>{(row, i) => {
        const at = () => listFocused() && budgetTop() + i === budgetCursor()
        const spans = (): Span[] => {
          const r = row()
          if (r.kind === "total") return fitSpans([{ text: fit(TOTAL, LABEL()), fg: ink.strong, bold: true }, ...budgetSpans(totalProgress())], rowWidth(mainWidth()))
          if (r.budget) return fitSpans([{ text: fit(label(r.budget), LABEL()), fg: ink.figure, bold: true }, ...budgetSpans(progress().get(r.budget.id))], rowWidth(mainWidth()))
          return fitSpans([{ text: fit(overallName(), LABEL()), fg: ink.figure, bold: true }, { text: `not set: enter sets one${hasCategoryBudgets() ? " for the rest" : ""}`, fg: ink.note }], rowWidth(mainWidth()))
        }
        return <ListRow cursor={at()} bg={theme.canvas} armed={row().budget ? armedFor(ui.state.armed, "budget", budgetArmId(row().budget!, cycle().start)) : undefined} spans={spans()} />
      }}</Index>
      <Show when={summary().length}>
        <text wrapMode="none">
          <S fg={ink.note}>{" "}</S>
          <Index each={fitSpans(summary(), rowWidth(mainWidth()))}>{(span) => <S fg={span().fg}>{span().text}</S>}</Index>
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

  return (
    <box width="100%" height="100%" flexDirection={wide() ? "row" : "column"} gap={wide() ? 1 : 0} backgroundColor={theme.canvas}>
      <Show when={wide()} fallback={<><Chart /><Lines /><Budgets /><Categories /></>}>
        <box flexDirection="column" width={mainWidth()} height={body()}>
          <Chart />
          <Lines />
          <Budgets />
        </box>
        <Categories />
      </Show>
    </box>
  )
}
