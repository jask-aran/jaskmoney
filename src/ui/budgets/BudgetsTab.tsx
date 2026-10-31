import { Index, Show, createMemo } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { budgetCounts, budgetIgnoredIds, budgetIn, budgetProgress, cycleFor, cycleSpending, pastCycles, type Budget, type BudgetScope, type Cycle } from "../../domain/budget"
import { allocation, budgetCategoryLines, budgetListRows, type BudgetLine } from "../../domain/budgetLines"
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
import { fit } from "../text"
import { ListRow, centredTop } from "../primitives/ListRow"
import { SectionCard } from "../primitives/SectionCard"
import { S } from "../primitives/S"
import { fitSpans, type Span } from "../primitives/spans"
import { AXIS_GUESS, ChartBody, axisWidth, type ChartModel } from "../charts/ChartBody"
import { INKS } from "../overview/periodCharts"
import { cycleLines, cycleLinesLegend, cycleProjection, cyclesChart, thisCycleChart, type CycleSpent } from "./budgetCharts"

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

/** The view picker in the chart's top border, the current one bright. */
const VIEWS = ["This cycle", "Cycles"] as const

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
  const dims = useTerminalDimensions()
  const shown = () => ui.state.activeTab === "budgets"
  // Hidden, the tab keeps what it last showed rather than recompute.
  const live = <T,>(fn: () => T): (() => T) => createMemo<T | undefined>((was) => (shown() || was === undefined ? fn() : was)) as () => T

  const today = () => appToday()
  const config = () => data.cycle()
  const cycle = live(() => cycleFor(config(), today()))
  const elapsed = () => daysBetween(cycle().start, today()) + 1
  const pace = () => elapsed() / cycle().days
  // A category's budget by the category's own name: the list shows its group.
  const label = (budget: Budget) => {
    const scope = budget.scope
    return scope.kind === "category" ? data.state.categories.find((c) => c.id === scope.categoryId)?.name ?? "(removed category)" : budgetLabel(budget, data.state.accounts, data.state.categories)
  }

  const rows = () => budgetListRows(data.state.budgets, data.state.categories)
  const budgetCursor = () => Math.min(ui.state.budgetCursor, rows().length - 1)
  const progress = live(() => new Map(budgetProgress(data.state.budgets, config(), today(), data.state.accounts, data.state.categories, data.transactions()).map((p) => [p.budget.id, p])))
  const split = live(() => allocation(data.state.budgets, data.state.categories))
  const lines = live(() => budgetCategoryLines(config(), today(), data.state.accounts, data.state.categories, data.state.budgets, data.transactions()))
  const categoryCursor = () => Math.min(ui.state.budgetCategoryCursor, Math.max(0, lines().length - 1))
  const ignored = live(() => budgetIgnoredIds(data.state.categories))
  const ignoredNames = () => data.state.categories.filter((c) => c.budgetIgnored).map((c) => c.name)
  const firstData = live(() => data.transactions().reduce((first, t) => (t.dateISO < first ? t.dateISO : first), today()))

  // What the chart follows: the row at the focused card's cursor.
  const subject = (): { title: string; scope: BudgetScope | null; counts: (row: Transaction) => boolean; amount: number | null } => {
    const of = (scope: BudgetScope) => budgetCounts(scope, data.state.categories)
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
    return row.budget ? { title: label(row.budget), scope: row.budget.scope, counts: of(row.budget.scope), amount: row.budget.amount } : { title: "Overall spending", scope: { kind: "overall" }, counts: of({ kind: "overall" }), amount: null }
  }
  const spending = (c: Cycle, through: string) => cycleSpending(c, through, data.state.accounts, data.transactions()).filter(subject().counts)
  const daily = (c: Cycle, through: string) => ({ cycle: c, daily: dailySpendSeries(spending(c, through), c.start, c.end).values })
  // Cycles the history covers as well as this one (historyCovers, as the
  // Overview compares periods): a gap, or a few stray old rows, isn't a
  // cycle of spending nothing.
  const past = live(() => {
    const now = { start: cycle().start, end: today() }
    return pastCycles(config(), today(), HISTORY).filter((c) => c.end >= firstData() && historyCovers(data.transactions(), c, now))
  })
  const nowDays = live(() => daily(cycle(), today()))
  const spent = () => nowDays().daily.reduce((a, b) => a + b, 0)
  // Every cycle newest first, this one too, each with the budget in force
  // then (this one's is today's).
  const cycles = live((): CycleSpent[] => {
    const scope = subject().scope
    return [
      { cycle: cycle(), spent: spent(), budget: subject().amount },
      ...past().map((c) => ({ cycle: c, spent: daily(c, c.end).daily.reduce((a, b) => a + b, 0), budget: scope ? budgetIn(data.state.budgetHistory, scope, c.start) : null })),
    ]
  })
  const history = () => cycles().slice(1)

  // Sizes: tab bar + gap (2) and status + footer (2) off the height. Wide,
  // the chart and the budgets share the left and the categories run down
  // the right; narrow, they stack.
  const body = () => Math.max(16, dims().height - 4)
  const wide = () => dims().width >= 130
  const categoriesWidth = () => (wide() ? Math.min(62, Math.max(52, Math.floor(dims().width * 0.38))) : dims().width)
  const mainWidth = () => (wide() ? dims().width - 1 - categoriesWidth() : dims().width)
  const summary = (): Span[] => {
    const spans: Span[] = []
    const { allocated, overall } = split()
    if (allocated > 0) {
      spans.push({ text: `Categories ${formatWholeMoney(allocated)}`, fg: ink.label })
      if (overall != null) spans.push({ text: ` of ${formatWholeMoney(overall)} · ${allocated > overall ? `${formatWholeMoney(allocated - overall)} over-allocated` : `${formatWholeMoney(overall - allocated)} unallocated`}`, fg: allocated > overall ? tone.caution : ink.label })
    }
    const names = ignoredNames()
    if (names.length) spans.push({ text: `${spans.length ? " · " : ""}Leaving out ${names.join(", ")}`, fg: ink.note })
    return spans
  }
  const budgetsHeight = () => Math.min(rows().length, Math.max(1, Math.floor(body() * 0.3))) + 2 + (summary().length ? 1 : 0)
  // The chart and the cycle lines share what the budgets leave: half each.
  const chartHeight = () => (wide() ? Math.ceil((body() - budgetsHeight()) / 2) : Math.max(10, Math.floor(body() * 0.3)))
  const linesHeight = () => (wide() ? body() - budgetsHeight() - chartHeight() : Math.max(5, Math.floor(body() * 0.2)))
  const categoriesHeight = () => (wide() ? body() : Math.max(5, body() - chartHeight() - linesHeight() - budgetsHeight()))
  const rowWidth = (width: number) => width - 5

  // The chart, built once with a guessed axis width, again if the labels
  // need another.
  const baseline = () => data.state.uiPrefs.xAxis === true
  let axisWas = AXIS_GUESS
  const model = live((): ChartModel => {
    // Border (2), the line over the chart, the x-axis line (a setting) and the x labels.
    const height = Math.max(3, chartHeight() - (baseline() ? 5 : 4))
    const build = (axis: number): ChartModel => {
      const width = Math.max(1, mainWidth() - 4 - axis)
      if (ui.state.budgetChart === 1) return cyclesChart(cycles().slice(0, Math.max(2, Math.floor(width / 5))).reverse(), width, height)
      const last = past()[0]
      return thisCycleChart(nowDays(), last ? daily(last, last.end) : null, subject().amount, width, height, today(), data.state.weekStart)
    }
    let built = build(axisWas)
    const axis = axisWidth(built.ticks)
    if (axis !== axisWas) { axisWas = axis; built = build(axis) }
    return built
  })

  // Where the subject stands: what's spent and of what, what's left or
  // over and against an even pace; without a budget, against its average.
  const headline = (): Span[] => {
    const s = subject()
    const now = spent()
    const strong = (text: string, fg: string): Span => ({ text, fg, bold: true })
    const avg = history().length ? history().reduce((a, h) => a + h.spent, 0) / history().length : null
    if (s.amount == null) {
      return [strong(formatWholeMoney(now), ink.strong), { text: " this cycle", fg: ink.label }, ...(avg != null ? [{ text: `   ${formatWholeMoney(avg)} a cycle on average · no budget`, fg: ink.note }] : [{ text: "   no budget", fg: ink.note }])]
    }
    const vsPace = now - s.amount * pace()
    const left = s.amount - now
    const daysLeft = cycle().days - elapsed() + 1
    const projected = cycleProjection(now, elapsed(), cycle().days)
    return [
      strong(formatWholeMoney(now), ink.strong),
      { text: ` of ${formatWholeMoney(s.amount)}   `, fg: ink.label },
      left < 0 ? strong(`${formatWholeMoney(-left)} over`, tone.bad) : strong(`${formatWholeMoney(left)} left`, tone.good),
      ...(left > 0 ? [{ text: ` · ${formatWholeMoney(left / daysLeft)}/day`, fg: ink.label }] : []),
      { text: `   ${Math.abs(vsPace) < 1 ? "on pace" : `${formatWholeMoney(Math.abs(vsPace))} ${vsPace > 0 ? "ahead of" : "under"} pace`}`, fg: vsPace > 0 ? tone.caution : ink.note },
      ...(projected ? [{ text: "   heading for ", fg: ink.label }, { text: formatWholeMoney(projected), fg: projected > s.amount ? tone.bad : tone.good }] : []),
    ]
  }
  const viewPicker = (): Span[] => VIEWS.flatMap((v, i) => [
    ...(i ? [{ text: "  ", fg: ink.note }] : []),
    { text: v, fg: i === ui.state.budgetChart ? tone.key : ink.faint, bold: i === ui.state.budgetChart },
  ])

  // One budget in the Budgets card: its bar against an even pace, spent of
  // budget, what's left (a day) or over.
  const listFocused = () => props.focused === "bud.list"
  const categoriesFocused = () => props.focused === "bud.categories"
  const LABEL = () => Math.min(22, Math.max(18, ...rows().map((r) => (r.budget ? label(r.budget).length + 2 : 18))))
  const BAR = () => Math.max(10, Math.min(48, rowWidth(mainWidth()) - LABEL() - 40))
  const budgetSpans = (budget: Budget): Span[] => {
    const p = progress().get(budget.id)
    if (!p) return []
    const used = budget.amount > 0 ? p.spent / budget.amount : p.spent > 0 ? 2 : 0
    return [
      ...bar(BAR(), used, pace()),
      { text: `  ${formatWholeMoney(p.spent).padStart(7)} of ${formatWholeMoney(budget.amount).padEnd(7)}  `, fg: ink.label },
      p.remaining < 0 ? { text: `${formatWholeMoney(-p.remaining)} over`, fg: tone.bad } : { text: `${formatWholeMoney(p.remaining)} left · ${formatWholeMoney(p.dailyAllowance)}/day`, fg: tone.good },
    ]
  }
  const budgetRoom = () => budgetsHeight() - 2 - (summary().length ? 1 : 0)
  const budgetTop = () => centredTop(budgetCursor(), rows().length, budgetRoom())

  // Categories: a quiet list to set budgets from. Name, this cycle, the
  // average, and its budget or that it's left out.
  const NUM = 9
  const nameWidth = () => rowWidth(categoriesWidth()) - 2 - NUM * 3
  const lineSpans = (line: BudgetLine): Span[] => {
    const out = line.categoryId !== null && ignored().has(line.categoryId)
    const name = line.child ? ink.label : ink.figure
    return [
      { text: `${line.child ? "  " : ""}${line.categoryId === null ? "?" : categoryMark(line.categoryId)} `, fg: out ? ink.faint : line.color ?? ink.note },
      { text: fit(line.name, nameWidth() - (line.child ? 4 : 2)), fg: out ? ink.note : name, bold: !line.child },
      { text: formatWholeMoney(line.now).padStart(NUM), fg: out ? ink.note : line.budget && line.now > line.budget.amount ? tone.bad : name },
      { text: formatWholeMoney(line.average).padStart(NUM), fg: ink.note },
      line.budget ? { text: formatWholeMoney(line.budget.amount).padStart(NUM), fg: ink.figure }
        : out ? { text: "left out".padStart(NUM), fg: ink.faint }
        : { text: "".padStart(NUM), fg: ink.faint },
    ]
  }
  const categoryRoom = () => Math.max(1, categoriesHeight() - 3)
  const categoryTop = () => centredTop(categoryCursor(), lines().length, categoryRoom())

  const Chart = () => (
    <SectionCard
      title={subject().title}
      titleSuffix={`· day ${elapsed()} of ${cycle().days}`}
      titleSuffixColor={tone.scope}
      titleRight={viewPicker()}
      bottomSpans={model().legend}
      width={mainWidth()}
      height={chartHeight()}
    >
      <text wrapMode="none">
        <Index each={fitSpans(headline(), mainWidth() - 4)}>{(span) => <S fg={span().fg} bold={span().bold}>{span().text}</S>}</Index>
      </text>
      <ChartBody model={model()} inks={INKS} baseline={baseline()} />
    </SectionCard>
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
    <SectionCard title="Budgets" focused={listFocused()} width={mainWidth()} height={budgetsHeight()}>
      <Index each={rows().slice(budgetTop(), budgetTop() + budgetRoom())}>{(row, i) => {
        const at = () => listFocused() && budgetTop() + i === budgetCursor()
        const spans = (): Span[] => {
          const r = row()
          if (r.budget) return [{ text: fit(label(r.budget), LABEL()), fg: ink.figure, bold: true }, ...budgetSpans(r.budget)]
          const total = split().allocated
          return [{ text: fit("Overall spending", LABEL()), fg: ink.figure, bold: true }, { text: `not set: enter sets one${total ? ` (your category budgets total ${formatWholeMoney(total)})` : ""}`, fg: ink.note }]
        }
        return <ListRow cursor={at()} bg={theme.canvas} armed={armedFor(ui.state.armed, "budget", row().budget?.id ?? -1)} spans={spans()} />
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
          <S fg={ink.label}>{"Spent".padStart(NUM)}{"Average".padStart(NUM)}{"Budget".padStart(NUM)}</S>
        </text>
        <Index each={lines().slice(categoryTop(), categoryTop() + categoryRoom())}>{(line, i) => (
          <ListRow cursor={categoriesFocused() && categoryTop() + i === categoryCursor()} bg={theme.canvas} armed={line().budget ? armedFor(ui.state.armed, "budget", line().budget!.id) : undefined} spans={lineSpans(line())} />
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
