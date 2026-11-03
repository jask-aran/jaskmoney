/**
 * Budgets (the TUI's BudgetsTab): how a budget is going, at a glance. The
 * chart is the Overview's spending views over the cycle shown, for the
 * budget chosen (a row of either list), with its budget; Each cycle sets
 * the cycles before against the budgets they had; the Budgets list has each
 * budget's bar against an even pace; Categories every category with its
 * spending, average and budget, or that it's left out of the overall
 * budget. [ ] step the cycle (back to the first with data); an amount is
 * set or changed in place, from the cycle shown, as the TUI's editor does;
 * removing one takes a second press. Each cycle is judged by the budgets
 * it had (budgetCountsThen).
 */
import { For, Show, createMemo, createSignal, onCleanup } from "solid-js"
import { ChevronLeft, ChevronRight, Eye, EyeOff, Pencil, Trash2 } from "lucide-solid"
import "./budgets.css"
import { allocation, measuredBudgetIn, budgetCounts, budgetCountsThen, budgetIgnoredIds, budgetProgress, cycleAt, cycleSpending, pastCycles, progressOf, totalBudgetIn, type Budget, type BudgetProgress, type BudgetScope, type BudgetSubject, type Cycle } from "../../domain/budget"
import { budgetArmId, budgetCategoryLines, budgetListRows, budgetView, type BudgetLine } from "../../domain/budgetLines"
import { budgetLabel } from "../../domain/budgetScopes"
import { dailySpendSeries, formatWholeMoney } from "../../domain/dashboard"
import { MONTHS, appToday, daysBetween } from "../../domain/days"
import { historyCovers } from "../../domain/position"
import type { Transaction } from "../../domain/types"
import { shortDate } from "../../ui/text"
import { INKS, Legend, type LegendItem } from "../charts"
import { BottomSheet, PageHeader, Section } from "../kit"
import { compact, data, fail, kept, now, run, say, tab, useKeys } from "../store"
import { catColor, ink, tone } from "../theme"
import { Button, DashMore, Input, Meter } from "../v2"
import { BUDGET_VIEWS, ChartPane } from "./Overview"
import { spendingChart } from "./overview/periodCharts"

/** Cycles before this one the chart and the cycle lines can show, at most. */
const HISTORY = 36
/** Cycle lines shown before "Show more". */
const LINES = 6
const TOTAL = "Total budgeted"

/** A cycle's spending and the budget in force in it (null: none). */
interface CycleSpent { cycle: Cycle; spent: number; budget: number | null }

/** What the chart and Each cycle follow: a row of either list. */
type Pick = { list: "budgets"; key: string } | { list: "categories"; id: number | null }

export function Budgets() {
  const shown = () => tab() === "budgets"
  const live = <T,>(fn: () => T): (() => T) => createMemo<T | undefined>((was) => (shown() || was === undefined ? fn() : was)) as () => T
  const today = createMemo(() => { now(); return appToday() })
  const config = () => data.cycle()

  // The cycle shown ([ and ] step it), the day it's shown up to (today, or
  // its last day once over) and the budgets in force in it.
  const [offset, setOffset] = createSignal(0)
  const view = live(() => budgetView(config(), today(), offset(), data.state.budgetHistory, data.state.budgets))
  const cycle = () => view().cycle
  const through = () => view().through
  const budgets = () => view().budgets
  const elapsed = () => daysBetween(cycle().start, through()) + 1
  const period = () => `${shortDate(cycle().start)} – ${shortDate(cycle().end)}${cycle().end.slice(0, 4) === today().slice(0, 4) ? "" : ` ${cycle().end.slice(0, 4)}`}`
  const pace = () => elapsed() / cycle().days
  const hasCategoryBudgets = () => budgets().some((b) => b.scope.kind === "category")
  const overallName = () => (hasCategoryBudgets() ? "Everything else" : "Overall spending")
  const label = (budget: Budget) => {
    const scope = budget.scope
    if (scope.kind === "overall") return overallName()
    return scope.kind === "category" ? data.state.categories.find((c) => c.id === scope.categoryId)?.name ?? "(removed category)" : budgetLabel(budget, data.state.accounts, data.state.categories)
  }

  const rows = live(() => budgetListRows(budgets(), data.state.categories))
  const progress = live(() => new Map(budgetProgress(budgets(), config(), through(), data.state.accounts, data.state.categories, data.transactions()).map((p) => [p.budget.id, p])))
  const split = live(() => allocation(budgets(), data.state.categories))
  // The budgets together against what they count between them.
  const totalProgress = live(() => {
    const counts = budgetCounts({ kind: "total" }, data.state.categories, budgets())
    const spentOnBudgets = cycleSpending(cycle(), through(), data.state.accounts, data.transactions()).filter(counts).reduce((sum, t) => sum - t.amount, 0)
    return progressOf({ id: -1, scope: { kind: "overall" }, amount: split().total }, spentOnBudgets, cycle(), through())
  })
  const lines = live(() => budgetCategoryLines(config(), through(), data.state.accounts, data.state.categories, budgets(), data.transactions()))
  const ignored = live(() => budgetIgnoredIds(data.state.categories))
  const ignoredNames = () => data.state.categories.filter((c) => c.budgetIgnored).map((c) => c.name)
  const firstData = live(() => data.transactions().reduce((first, t) => (t.dateISO < first ? t.dateISO : first), today()))

  // What the chart follows: the row chosen, else the first budget row.
  const [picked, setPicked] = createSignal<Pick | null>(null)
  const rowKey = (row: ReturnType<typeof budgetListRows>[number]) => (row.kind === "total" ? "total" : row.kind === "overall" ? "overall" : budgetArmId(row.budget, ""))
  const subject = live((): { title: string; scope: BudgetSubject | null; counts: (row: Transaction) => boolean; amount: number | null; line?: BudgetLine } => {
    const of = (scope: BudgetSubject) => budgetCountsThen(scope, data.state.categories, data.state.budgetHistory, data.state.budgets, config())
    const p = picked()
    if (p?.list === "categories") {
      const line = lines().find((l) => l.categoryId === p.id)
      if (line) {
        const id = line.categoryId
        return id === null
          ? { title: "Uncategorised", scope: null, counts: (row) => row.categoryId === null, amount: null, line }
          : { title: line.name, scope: { kind: "category", categoryId: id }, counts: of({ kind: "category", categoryId: id }), amount: line.budget?.amount ?? null, line }
      }
    }
    const row = rows().find((r) => p?.list === "budgets" && rowKey(r) === p.key) ?? rows()[0]!
    if (row.kind === "total") return { title: TOTAL, scope: { kind: "total" }, counts: of({ kind: "total" }), amount: split().total }
    return row.budget ? { title: label(row.budget), scope: row.budget.scope, counts: of(row.budget.scope), amount: row.budget.amount } : { title: overallName(), scope: { kind: "overall" }, counts: of({ kind: "overall" }), amount: null }
  })
  const isPicked = (p: Pick) => {
    const q = picked()
    if (!q) return p.list === "budgets" && rows()[0] && p.key === rowKey(rows()[0]!)
    return q.list === p.list && (q.list === "budgets" ? q.key === (p as { key: string }).key : q.id === (p as { id: number | null }).id)
  }
  const spending = (c: Cycle, until: string) => cycleSpending(c, until, data.state.accounts, data.transactions()).filter(subject().counts)
  const spentIn = (c: Cycle, until: string) => dailySpendSeries(spending(c, until), c.start, c.end).values.reduce((a, b) => a + b, 0)
  // Cycles the history covers as well as this one: a gap, or a few stray
  // old rows, isn't a cycle of spending nothing.
  const past = live(() => {
    const nowSpan = { start: cycle().start, end: through() }
    return pastCycles(config(), through(), HISTORY).filter((c) => c.end >= firstData() && historyCovers(data.transactions(), c, nowSpan))
  })
  const cycles = live((): CycleSpent[] => {
    const scope = subject().scope
    return [
      { cycle: cycle(), spent: spentIn(cycle(), through()), budget: subject().amount },
      ...past().map((c) => ({
        cycle: c,
        spent: spentIn(c, c.end),
        budget: !scope ? null : scope.kind === "total" ? totalBudgetIn(data.state.budgetHistory, data.state.budgets, data.state.categories, c.start) : measuredBudgetIn(data.state.budgetHistory, data.state.budgets, data.state.categories, scope, c.start),
      })),
    ]
  })

  // The chart: the Overview's spending view over the cycle shown, for what
  // the subject counts, with its budget.
  const [chartView, setChartView] = kept("budgets.chart", 0)
  const subjectRows = live(() => cycleSpending({ start: firstData(), end: today(), days: 0 }, today(), data.state.accounts, data.transactions()).filter(subject().counts))
  const build = (width: number, height: number) => {
    const series = dailySpendSeries(subjectRows(), cycle().start, cycle().end)
    const v = (BUDGET_VIEWS[chartView()] ?? BUDGET_VIEWS[0]!).view as "Cumulative" | "Daily" | "Weekly"
    return spendingChart(v, series, width, height, today(), subjectRows(), subject().amount ?? undefined, { current: "This cycle", previous: "Last cycle" }, data.state.weekStart)
  }

  // Cycle stepping: up to this one, back to the first with data.
  const step = (back: boolean) => {
    const next = offset() + (back ? -1 : 1)
    if (next > 0) { say("This is the current cycle"); return }
    if (back && cycleAt(config(), today(), next).end < firstData()) { say("No cycles before this one have data", true); return }
    setOffset(next)
  }

  // Setting, changing and removing a budget, from the cycle shown.
  // What's being set (scope, name: a phone's sheet says which) and the amount typed so far.
  const [editing, setEditing] = createSignal<{ key: string; draft: string; scope: BudgetScope; name: string } | null>(null)
  // An existing budget opens on its amount; a new one on its average, rounded (the TUI's openBudgetEditor).
  const startEdit = (key: string, amount: number | null, existing: boolean, scope: BudgetScope, name: string) =>
    setEditing({ key, scope, name, draft: existing && amount != null ? String(amount) : amount != null && amount > 0 ? String(Math.round(amount)) : "" })
  /** Set or change a category's budget (from its average when new). */
  const editCategory = (line: BudgetLine) => {
    if (line.categoryId === null) { say("Uncategorised can't have a budget: categorise its rows first", true); return }
    startEdit(`cat:${line.categoryId}`, line.budget?.amount ?? (line.average || line.now), !!line.budget, { kind: "category", categoryId: line.categoryId }, line.name)
  }
  const save = (scope: BudgetScope) => {
    const draft = editing()?.draft ?? ""
    const amount = Number(draft.replace(/[$,\s]/g, ""))
    if (!draft.trim() || !Number.isFinite(amount)) { say("enter the budget amount", true); return }
    setEditing(null)
    void run(data.setBudget(scope, amount, cycle().start), () => "Saved")
  }
  const [armed, setArmed] = createSignal<string | null>(null)
  let disarm: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(disarm))
  const remove = (budget: Budget, name: string) => {
    const id = budgetArmId(budget, cycle().start)
    const what = `the ${name} budget${view().current ? "" : ` from ${shortDate(cycle().start)}`}`
    if (armed() !== id) {
      setArmed(id)
      say(`Remove ${what}? Press again to remove`)
      clearTimeout(disarm)
      disarm = setTimeout(() => setArmed(null), 4000)
      return
    }
    setArmed(null)
    void run(data.removeBudget(budget.scope, cycle().start), () => `Deleted ${what}`)
  }
  // Leaving a category out of the overall budget (the TUI's x).
  const toggleLeftOut = (line: BudgetLine) => {
    const category = data.state.categories.find((c) => c.id === line.categoryId)
    if (!category) { say("Uncategorised always counts: categorise its rows first", true); return }
    const group = category.parentId == null ? undefined : data.state.categories.find((c) => c.id === category.parentId)
    if (group?.budgetIgnored) { say(`Left out with ${group.name}: x on ${group.name} brings it back`, true); return }
    // What it was before: the store's row already says what it is after.
    const { name, budgetIgnored: wasOut } = category
    void data.setCategoryBudgetIgnored(category.id, !wasOut).then(
      () => say(wasOut ? `${name} counts toward the overall budget again` : `${name} left out of the overall budget`),
      fail,
    )
  }

  useKeys((event) => {
    if (!shown()) return false
    if (event.key === "[" || event.key === "]") { step(event.key === "["); return true }
    if (event.key === "x") { const line = subject().line; if (line) toggleLeftOut(line); else say("Choose a category first: x leaves it out", true); return true }
    return false
  })

  const summary = () => {
    const { allocated, overall, rest } = split()
    return [
      ...(allocated > 0 ? [overall == null ? `Categories ${formatWholeMoney(allocated)} · no overall budget to carve them from`
        : rest! >= 0 ? `Categories ${formatWholeMoney(allocated)} of ${formatWholeMoney(overall)} · everything else ${formatWholeMoney(rest!)}`
        : `Categories ${formatWholeMoney(allocated)}: ${formatWholeMoney(-rest!)} more than your ${formatWholeMoney(overall)}`] : []),
      ...(ignoredNames().length ? [`Not budgeted: ${ignoredNames().join(", ")}`] : []),
    ]
  }

  const header = () => (
    <div class="range-dates">
      <Show when={!view().current}>
        <span class="note small">{-offset()} {-offset() === 1 ? "cycle" : "cycles"} back · </span>
        <Button variant="ghost" size="sm" onClick={() => setOffset(0)}>Now</Button>
      </Show>
      <Button variant="ghost" size="icon-sm" onClick={() => step(true)} aria-label="Earlier cycle" title="Earlier cycle ([)"><ChevronLeft /></Button>
      <span class="scope range-label">{period()}</span>
      <Button variant="ghost" size="icon-sm" disabled={view().current} onClick={() => step(false)} aria-label="Later cycle" title="Later cycle (])"><ChevronRight /></Button>
    </div>
  )

  // A phone's cycle: earlier and later either side of its dates, how far back under them, Now at the end.
  const phoneStepper = () => (
    <div class="ov-stepper">
      <Button variant="ghost" size="icon" class="step" onClick={() => step(true)} aria-label="Earlier cycle"><ChevronLeft /></Button>
      <div class="mid">
        <span class="scope range-label">{period()}</span>
        <Show when={!view().current}><span class="note small">{-offset()} {-offset() === 1 ? "cycle" : "cycles"} back</span></Show>
      </div>
      <Button variant="ghost" size="icon" class="step" disabled={view().current} onClick={() => step(false)} aria-label="Later cycle"><ChevronRight /></Button>
      <Show when={!view().current}><Button variant="secondary" size="sm" class="now" onClick={() => setOffset(0)}>Now</Button></Show>
    </div>
  )

  const AmountEdit = (props: { scope: BudgetScope }) => (
    <form class="bud-edit" onSubmit={(e) => { e.preventDefault(); save(props.scope) }} onKeyDown={(e) => { if (e.key === "Escape") setEditing(null) }}>
      <Input ref={(el: HTMLInputElement) => queueMicrotask(() => { el.focus(); el.select() })} inputmode="decimal" placeholder="Amount" value={editing()?.draft ?? ""}
        onInput={(e) => setEditing({ ...editing()!, draft: e.currentTarget.value })} />
      <Button type="submit" size="sm">Set</Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(null)}>Cancel</Button>
    </form>
  )

  return (
    <>
      <PageHeader title="Budgets" place={view().current ? `day ${elapsed()} of ${cycle().days}` : "past cycle"} actions={header()} phone={phoneStepper()} />
      <div class="bud">
        <div class="bud-main">
          <ChartPane class="bud-chart" views={BUDGET_VIEWS} current={chartView()} onView={setChartView} title={subject().title} build={build} />

          <Section title="Each cycle" aside={<span class="label small">{subject().title}</span>}>
            <CycleLines cycles={cycles()} pace={pace()} today={today()} />
          </Section>

          <Section title="Budgets" aside={<span class={view().current ? "scope small" : "caution small"}>{view().current ? `day ${elapsed()} of ${cycle().days}` : `${period()} · ] later`}</span>}>
            <div class="bud-list">
              <For each={rows()}>{(row) => {
                const key = rowKey(row)
                const p = (): BudgetProgress | undefined => (row.kind === "total" ? totalProgress() : row.budget ? progress().get(row.budget.id) : undefined)
                const name = () => (row.kind === "total" ? TOTAL : row.budget ? label(row.budget) : overallName())
                const scope = (): BudgetScope => (row.kind === "total" || !row.budget ? { kind: "overall" } : row.budget.scope)
                return (
                  <div class="bud-row" data-current={isPicked({ list: "budgets", key }) ? "" : undefined} classList={{ total: row.kind === "total" }}
                    onClick={() => setPicked({ list: "budgets", key })}>
                    <span class="name">{name()}</span>
                    <Show when={!compact() && editing()?.key === key} fallback={
                      <Show when={p()} fallback={<span class="note small unset">not set{hasCategoryBudgets() ? " for the rest" : ""}</span>}>
                        {(pr) => <BudgetBar p={pr()} pace={pace()} />}
                      </Show>
                    }>
                      <AmountEdit scope={scope()} />
                    </Show>
                    <span class="acts" onClick={(e) => e.stopPropagation()}>
                      <Show when={row.kind !== "total"}>
                        <Button variant="ghost" size="icon-xs" aria-label={row.budget ? "Change the amount" : "Set a budget"} title={row.budget ? "Change the amount (from this cycle)" : "Set a budget"}
                          onClick={() => startEdit(key, row.budget?.amount ?? null, !!row.budget, scope(), name())}><Pencil /></Button>
                      </Show>
                      <Show when={row.budget}>
                        <Button variant="ghost" size="icon-xs" aria-label="Remove" title={armed() === budgetArmId(row.budget!, cycle().start) ? "Press again to remove" : "Remove (press twice)"}
                          classList={{ armed: armed() === budgetArmId(row.budget!, cycle().start) }} onClick={() => remove(row.budget!, label(row.budget!))}><Trash2 /></Button>
                      </Show>
                    </span>
                  </div>
                )
              }}</For>
            </div>
            <Show when={summary().length}>
              <p class="bud-summary small"><span class="label">{summary()[0]}</span><Show when={summary()[1]}><span class="note"> · {summary()[1]}</span></Show></p>
            </Show>
          </Section>
        </div>

        <div class="bud-side">
          <Section title="Categories" aside={<span class="cat-head"><span>Spent</span><span class="avg">Average</span><span>Budget</span></span>}>
            <Show when={lines().length} fallback={<p class="note small">No spending yet.</p>}>
              <div class="bud-cats">
                <For each={lines()}>{(line) => {
                  const out = () => line.categoryId !== null && ignored().has(line.categoryId)
                  const key = `cat:${line.categoryId}`
                  return (
                    <div class="bud-cat" classList={{ child: line.child, out: out() }} data-current={isPicked({ list: "categories", id: line.categoryId }) ? "" : undefined}
                      onClick={() => setPicked({ list: "categories", id: line.categoryId })}>
                      <span class="name"><span class="dot" style={{ background: out() ? "transparent" : catColor(line.color), "box-shadow": out() ? `inset 0 0 0 1px ${ink.faint}` : undefined }} /><span class="ellipsis">{line.name}</span></span>
                      <span class={`num ${!out() && line.budget && line.now > line.budget.amount ? "bad" : ""}`}>{formatWholeMoney(line.now)}</span>
                      <span class="num avg note">{formatWholeMoney(line.average)}</span>
                      <Show when={!compact() && editing()?.key === key} fallback={
                        <span class="num budget" onClick={(e) => { e.stopPropagation(); editCategory(line) }}
                          title={line.categoryId === null ? "" : line.budget ? "Change its budget" : "Set a budget (from its average)"}>
                          {line.budget ? formatWholeMoney(line.budget.amount) : out() ? <span class="faint">left out</span> : <span class="faint set">set</span>}
                        </span>
                      }>
                        <span class="edit-cell" onClick={(e) => e.stopPropagation()}><AmountEdit scope={{ kind: "category", categoryId: line.categoryId! }} /></span>
                      </Show>
                      <span class="acts" onClick={(e) => e.stopPropagation()}>
                        {/* A phone has no budget cell to press: its own button, named, as the others are there. */}
                        <Show when={compact() && line.categoryId !== null}>
                          <Button variant="ghost" size="icon-xs" class="act-set" onClick={() => editCategory(line)}><Pencil /><span class="act-name">{line.budget ? "Change budget" : "Set budget"}</span></Button>
                        </Show>
                        <Show when={line.categoryId !== null}>
                          <Button variant="ghost" size="icon-xs" aria-label={out() ? "Count it" : "Leave out"} title={out() ? "Count it toward the overall budget again (x)" : "Leave it out of the overall budget (x)"}
                            onClick={() => toggleLeftOut(line)}>{out() ? <Eye /> : <EyeOff />}<span class="act-name">{out() ? "Count it" : "Leave out"}</span></Button>
                        </Show>
                        <Show when={line.budget}>
                          <Button variant="ghost" size="icon-xs" aria-label="Remove budget" title={armed() === budgetArmId(line.budget!, cycle().start) ? "Press again to remove" : "Remove its budget (press twice)"}
                            classList={{ armed: armed() === budgetArmId(line.budget!, cycle().start) }} onClick={() => remove(line.budget!, line.name)}><Trash2 /><span class="act-name">{armed() === budgetArmId(line.budget!, cycle().start) ? "Press again" : "Remove"}</span></Button>
                        </Show>
                      </span>
                    </div>
                  )
                }}</For>
              </div>
            </Show>
          </Section>
        </div>
      </div>
      <Show when={compact() && editing()}>{(e) => (
        <BottomSheet label={`Budget for ${e().name}`} onClose={() => setEditing(null)}
          head={<div class="bud-sheet-head"><span class="jm-drawer-title">{e().name}</span><span class="note small">{view().current ? "From this cycle" : `From the cycle ${period()}`}</span></div>}>
          <AmountEdit scope={e().scope} />
        </BottomSheet>
      )}</Show>
    </>
  )
}

/**
 * A budget's bar against an even pace (the TUI's bar): filled by what's
 * spent (green, yellow ahead of pace, red over), the pace marked; over
 * budget, the bar is what was spent, green up to the budget and red past
 * it. Then spent of budget, and what's left (a day) or over.
 */
function BudgetBar(props: { p: BudgetProgress; pace: number }) {
  const used = () => (props.p.budget.amount > 0 ? props.p.spent / props.p.budget.amount : props.p.spent > 0 ? 2 : 0)
  const over = () => used() > 1
  const parts = () => {
    const u = used()
    if (u > 1) return [{ value: 1, colour: tone.good }, { value: u - 1, colour: tone.bad }]
    const fill = u > props.pace ? tone.caution : tone.good
    return [...(u > 0 ? [{ value: u, colour: fill }] : []), ...(u < 1 ? [{ value: 1 - u, colour: "transparent" }] : [])]
  }
  const mark = () => (over() ? 100 / used() : props.pace * 100)
  return (
    <>
      <span class="bar"><Meter parts={parts()} mark={{ at: mark(), label: over() ? "budget" : "even pace by today", quiet: true }} /></span>
      <span class="fig label">{formatWholeMoney(props.p.spent)} <span class="note">of</span> {formatWholeMoney(props.p.budget.amount)}</span>
      <span class={`verdict ${props.p.remaining < 0 ? "bad" : "good"}`}>
        {props.p.remaining < 0 ? `${formatWholeMoney(-props.p.remaining)} over` : `${formatWholeMoney(props.p.remaining)} left · ${formatWholeMoney(props.p.dailyAllowance)}/day`}
      </span>
    </>
  )
}

/**
 * The cycles newest first, a line each (the TUI's cycleLines): its dates,
 * what was spent, a bar on one scale for them all (green up to the cycle's
 * budget and red past it, the budget marked; this cycle's coloured by its
 * pace, the even pace marked; without a budget, plain spending), and how far
 * under or over.
 */
function CycleLines(props: { cycles: CycleSpent[]; pace: number; today: string }) {
  const [all, setAll] = createSignal(false)
  const scale = createMemo(() => Math.max(1, ...props.cycles.map((c) => Math.max(c.spent, c.budget ?? 0))))
  const day = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`
  const dates = (c: CycleSpent) => `${day(c.cycle.start)} – ${day(c.cycle.end)}${c.cycle.end.slice(0, 4) === props.today.slice(0, 4) ? "" : ` ${c.cycle.end.slice(2, 4)}`}`
  const pct = (v: number) => `${(v / scale()) * 100}%`
  const shown = () => (all() ? props.cycles : props.cycles.slice(0, LINES))
  const legend = (): LegendItem[] => {
    const before = props.cycles.slice(1)
    const budgeted = before.filter((c) => c.budget != null)
    const over = budgeted.filter((c) => c.spent > c.budget!).length
    const avg = before.length ? before.reduce((sum, c) => sum + c.spent, 0) / before.length : null
    return [
      ...(budgeted.length ? [{ parts: [{ text: `over in ${over} of ${budgeted.length}`, cls: "note" }] }] : []),
      ...(avg != null ? [{ parts: [{ text: "avg ", cls: "note" }, { text: formatWholeMoney(avg), cls: "figure" }] }] : []),
      ...(props.cycles.some((c) => c.budget != null) ? [{ mark: { kind: "bar" as const, color: ink.figure }, parts: [{ text: "budget", cls: "note" }] }, { mark: { kind: "bar" as const, color: ink.note }, parts: [{ text: "even pace by now", cls: "note" }] }] : []),
    ]
  }
  return (
    <>
      <div class="cyc-lines">
        <For each={shown()}>{(c, i) => {
          const now = () => i() === 0
          const fillTo = () => Math.max(0, c.budget == null ? c.spent : Math.min(c.spent, c.budget))
          const fill = () => (c.budget == null ? INKS.spend! : now() && c.spent > c.budget * props.pace ? tone.caution : tone.good)
          return (
            <div class="cyc" classList={{ now: now() }}>
              <span class="dates">{dates(c)}</span>
              <span class="spent">{formatWholeMoney(c.spent)}</span>
              <span class="track">
                <span class="fill" style={{ width: pct(fillTo()), background: fill() }} />
                <Show when={c.budget != null && c.spent > c.budget}><span class="fill" style={{ left: pct(c.budget!), width: pct(c.spent - c.budget!), background: tone.bad }} /></Show>
                <Show when={c.budget != null}><i class="mark budget" style={{ left: pct(c.budget!) }} title={`Budget ${formatWholeMoney(c.budget!)}`} /></Show>
                <Show when={now() && c.budget != null && c.spent < c.budget * props.pace}><i class="mark pace" style={{ left: pct(c.budget! * props.pace) }} title="Even pace by now" /></Show>
              </span>
              <span class={`verdict ${c.budget == null ? "" : c.spent > c.budget ? "bad" : "good"}`}>
                {c.budget == null ? "" : c.spent > c.budget ? `${formatWholeMoney(c.spent - c.budget)} over` : `${formatWholeMoney(c.budget - c.spent)} under`}
              </span>
            </div>
          )
        }}</For>
      </div>
      <Show when={!all() && props.cycles.length > LINES}><DashMore count={props.cycles.length - LINES} onClick={() => setAll(true)}>Show earlier cycles</DashMore></Show>
      <Legend items={legend()} />
    </>
  )
}
