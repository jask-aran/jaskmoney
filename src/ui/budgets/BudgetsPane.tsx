import { Index, Show, createMemo } from "solid-js"
import { computeCategorySpend, formatWholeMoney, groupCategorySpend } from "../../domain/dashboard"
import { addDays, daysBetween } from "../../domain/days"
import { computePosition } from "../../domain/position"
import { data } from "../../state/dataStore"
import type { SectionId } from "../../state/uiStore"
import { fade, ink, theme, tone } from "../../theme"
import { flowOpening } from "../charts/flow"
import { chartSpeedMs, useReveal } from "../charts/motion"
import { revealLines, sweptIn, type TopLine } from "../charts/reveal"
import { CalendarView } from "../overview/CalendarView"
import { spendFlow } from "../overview/RangeGraphics"
import { ListRow } from "../primitives/ListRow"
import { S } from "../primitives/S"
import { SectionCard } from "../primitives/SectionCard"
import { fitSpans, type Span } from "../primitives/spans"
import { fit, shortDate } from "../text"
import { createBudgetCalendar, createBudgetInputs, createBudgetPlan, createBudgetProgress } from "./budgetsModel"
import { createBudgetLayout } from "./BudgetsTab"
import { createCategoryList, createCategoryRoom, createCategoryRows } from "./CategoryList"
import { cycleTrack, payBar, saversMeter } from "./PlanGraphics"

export function createPlanText(input: Pick<ReturnType<typeof createBudgetLayout>, "rowWidth" | "categoriesWidth"> & Pick<ReturnType<typeof createCategoryRows>, "NUM">) {
  const { rowWidth, categoriesWidth, NUM } = input
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
  return { blank, heading, note, ledger }
}

export function createPlanLines(input: Pick<ReturnType<typeof createBudgetLayout>, "rowWidth" | "categoriesWidth"> & Pick<ReturnType<typeof createBudgetPlan>, "planPay" | "toSavers" | "paid" | "income" | "targetParts"> & Pick<ReturnType<typeof createCategoryRows>, "overallBudget"> & Pick<ReturnType<typeof createBudgetProgress>, "split" | "totalProgress"> & Pick<ReturnType<typeof createBudgetInputs>, "cycle" | "today" | "view"> & Pick<ReturnType<typeof createPlanText>, "blank" | "heading" | "note">) {
  const { rowWidth, categoriesWidth, planPay, overallBudget, toSavers, split, totalProgress, paid, cycle, today, income, blank, heading, note, targetParts, view } = input
  // Under the tiles: Pay (your pay, what's spent and what remains of it,
  // and the pay as a bar: the category budgets, the rest of the target,
  // savers), Savers (the plan for them as a meter: what's gone, what's
  // still to send and what spending past the target has taken), then This
  // cycle as a track. Until pay or target is set, a caution tile says which keys set
  // them. A line with `bg` is filled to the row's end.
  const topLines = createMemo((): Array<TopLine> => {
    const width = rowWidth(categoriesWidth())
    const pay = planPay(), target = overallBudget()
    const out: Array<TopLine> = []
    const plan = toSavers()
    const total = split().total
    const spent = totalProgress().spent
    const p = paid()
    // The cycle's track first: its paydays, today and the sends, and under
    // it what came in, what's gone to savers and what's been spent.
    for (const [n, spans] of cycleTrack(width, cycle().start, addDays(cycle().end, 1), today(), { ...p, pay: income(), spent }, plan != null && plan > 0 ? tone.good : ink.figure, cycle().end).entries()) out.push({ spans, sweeps: n === 1 })
    out.push({ spans: blank, stays: true })
    // Savers is drawn once pay and target leave something for it.
    const planned = pay != null && !!target && plan != null && plan > 0
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
      // The pay's bar (the facts say the pay, and Next pay which key sets
      // it), each part's figure over it.
      // The rest of the target's spending: all of it less the categories' own.
      const restSpent = target ? Math.max(0, spent - targetParts().reduce((n, c) => n + c.spent, 0)) : 0
      const bar = payBar(width, pay, target ? total : 0, target ? targetParts() : [], restSpent)
      out.push({ spans: bar.above }, { spans: bar.bar, sweeps: true })
      if (planned) {
        // Savers: the bar's savers end opened out to the full width, the
        // plan as a meter. Spending past the target comes out of it.
        const short = Math.min(plan!, Math.max(0, spent - total))
        const meter = saversMeter(width, plan!, p.sent, short)
        out.push({ spans: flowOpening(width, bar.targetCells, width, [{ text: "savers plan ", fg: ink.note }, { text: formatWholeMoney(plan!), fg: ink.figure, bold: true }]) }, { spans: meter.bar, sweeps: true }, { spans: meter.labels })
      }
      for (const spans of bar.legend) out.push({ spans })
    }
    if (!planned) {
      out.push({ spans: blank, stays: true }, { spans: heading("Savers"), stays: true })
      if (pay == null) out.push({ spans: note("p: your pay, to see what goes to savers", tone.caution, "") })
      else if (!target) out.push({ spans: note("t: your spending target, to see what's saved", tone.caution, "") })
      else if (plan != null && plan < 0) out.push({ spans: note(`The target is ${formatWholeMoney(-plan)} more than your pay`, tone.caution, "") })
    }
    if (!p.pay && view().current) out.push({ spans: note("no pay found yet (the Salary category)", ink.note, "") })
    return out
  })
  return { topLines }
}

export function createPlanFlow(input: Pick<ReturnType<typeof createBudgetInputs>, "view" | "cycle" | "today" | "through" | "transactions" | "seen"> & Pick<ReturnType<typeof createBudgetPlan>, "expectedPay" | "flows" | "allSpending"> & Pick<ReturnType<typeof createPlanText>, "ledger"> & Pick<ReturnType<typeof createBudgetLayout>, "rowWidth" | "categoriesWidth"> & Pick<ReturnType<typeof createPlanLines>, "topLines">) {
  const { view, cycle, today, expectedPay, ledger, flows, allSpending, through, rowWidth, categoriesWidth, transactions, seen, topLines } = input
  // The next pay, under the calendar (this cycle only): when, and your usual
  // pay (what's expected; until set, which key sets it); the days till it.
  const nextPayLines = createMemo((): Span[][] => {
    if (!view().current) return []
    const next = addDays(cycle().end, 1)
    const days = Math.max(0, daysBetween(today(), next))
    const when = `${new Date(next + "T12:00:00Z").toLocaleDateString("en-AU", { weekday: "short", timeZone: "UTC" })} ${shortDate(next)}`
    const usual = expectedPay()
    const label = (text: string): Span => ({ text, fg: ink.label })
    return [
      usual != null
        ? ledger(label("Next pay"), { text: formatWholeMoney(usual), fg: ink.strong, bold: true }, [{ text: when, fg: ink.label }])
        : ledger(label("Next pay"), { text: when, fg: ink.strong, bold: true }, [{ text: "p sets your pay", fg: tone.caution }]),
      ledger(label("Days till pay"), { text: String(days), fg: ink.strong, bold: true }),
    ]
  })
  // Its lines and a blank line under them.
  const nextPayBlock = () => (nextPayLines().length ? nextPayLines().length + 1 : 0)
  // Over the categories, the cycle's flow so far, the Overview's Range
  // pane's (s, the same view): what came in, spent and net, opened out to
  // where the spending went or where the net went. Its figures are the
  // plan's: its net is what's left, its savers what's sent.
  const flowLines = createMemo((): Span[][] => {
    const f = flows()
    if (f.income < 0.5 && f.spent < 0.5) return []
    const rows = allSpending().filter((t) => t.dateISO >= cycle().start && t.dateISO <= through())
    return spendFlow(rowWidth(categoriesWidth()), {
      ...f, rows, bySpending: data.state.uiPrefs.rangeView === "spending",
      groups: groupCategorySpend(computeCategorySpend(rows, data.state.categories), data.state.categories),
      savers: [...computePosition(data.state.accounts, transactions(), today()).savers].sort((x, y) => y.balance - x.balance),
    })
  })
  const flowBlock = () => (flowLines().length ? flowLines().length + 1 : 0)
  // Drawing in, as Subscriptions does ("always": each time the tab shows
  // or the cycle changes, not as the cursor moves): the bars (each pay,
  // the cycle's track, the meter) sweep in from the left, and the lines
  // with them drop in, in order; the headings are there from the start.
  const planReveal = useReveal(
    () => (data.state.uiPrefs.chartMotion === "always" ? `${cycle().start}:${seen()}` : undefined),
    () => chartSpeedMs(data.state.uiPrefs.chartSpeed), () => data.state.uiPrefs.chartCurve)
  const shownTop = createMemo(() => revealLines(topLines(), planReveal(), rowWidth(categoriesWidth())))
  return { nextPayBlock, flowBlock, shownTop, nextPayLines, flowLines, planReveal }
}

export function createBudgetsPane(input: Pick<ReturnType<typeof createCategoryRoom>, "nothingSet" | "calendarRows" | "briefRows" | "briefRoom"> & Pick<ReturnType<typeof createBudgetInputs>, "view" | "elapsed" | "cycle" | "period" | "today"> & Pick<ReturnType<typeof createBudgetLayout>, "sideId" | "categoriesWidth" | "categoriesHeight" | "rowWidth" | "listInSide"> & Pick<ReturnType<typeof createPlanFlow>, "shownTop" | "nextPayLines" | "flowLines" | "planReveal"> & Pick<ReturnType<typeof createBudgetCalendar>, "calendarWeeks" | "calendarThrough" | "calendarSpans"> & Pick<ReturnType<typeof createCategoryRows>, "nameWidth" | "NUM" | "withAverage" | "rowSpans"> & Pick<ReturnType<typeof createCategoryList>, "CategoryList"> & { props: { focused: SectionId } }) {
  const { nothingSet, view, elapsed, cycle, period, sideId, categoriesWidth, categoriesHeight, shownTop, rowWidth, calendarRows, calendarWeeks, today, calendarThrough, calendarSpans, nextPayLines, flowLines, planReveal, listInSide, briefRows, briefRoom, nameWidth, NUM, withAverage, rowSpans, CategoryList, props } = input
  const Categories = () => (
    <SectionCard title="Budgets" titleSuffix={nothingSet() ? "· start here" : view().current ? `· day ${elapsed()} of ${cycle().days}` : `· ${period()} · ] later`}
      titleSuffixColor={nothingSet() || !view().current ? tone.caution : tone.scope} focused={props.focused === sideId()} width={categoriesWidth()} height={categoriesHeight()}>
      <Index each={shownTop()}>{(line) => (
        // Never shrunk: past the pane's height, lines clip rather than
        // overlap.
        <text wrapMode="none" flexShrink={0}>
          <S>{" "}</S>
          <Index each={line().spans}>{(span) => <S fg={span().fg} bg={span().bg ?? line().bg} bold={span().bold}>{span().text}</S>}</Index>
          <Show when={line().bg}><S bg={line().bg}>{" ".repeat(Math.max(0, rowWidth(categoriesWidth()) - line().spans.reduce((n, x) => n + x.text.length, 0)))}</S></Show>
        </text>
      )}</Index>
      <text wrapMode="none">{" "}</text>
      <Show when={calendarRows()}>
        <box paddingLeft={1} height={calendarRows()} flexShrink={0}>
          <CalendarView weeks={calendarWeeks()} width={rowWidth(categoriesWidth())} rows={calendarRows()} today={today()} through={calendarThrough()} markColor={tone.good} />
        </box>
        <text wrapMode="none" flexShrink={0}>
          <S>{" "}</S>
          <Index each={fitSpans(calendarSpans(), rowWidth(categoriesWidth()))}>{(span) => <S fg={span().fg} bold={span().bold}>{span().text}</S>}</Index>
        </text>
        <text wrapMode="none" flexShrink={0}>{" "}</text>
      </Show>
      <Index each={nextPayLines()}>{(spans) => (
        <text wrapMode="none" flexShrink={0}><S>{" "}</S><Index each={spans()}>{(span) => <S fg={span().fg} bold={span().bold}>{span().text}</S>}</Index></text>
      )}</Index>
      <Show when={nextPayLines().length}><text wrapMode="none" flexShrink={0}>{" "}</text></Show>
      <Index each={flowLines()}>{(spans) => (
        // Sweeping in with the plan's bars.
        <text wrapMode="none" flexShrink={0}><S>{" "}</S><Index each={sweptIn(spans(), planReveal(), rowWidth(categoriesWidth()))}>{(span) => <S fg={span().fg} bold={span().bold}>{span().text}</S>}</Index></text>
      )}</Index>
      <Show when={flowLines().length}><text wrapMode="none" flexShrink={0}>{" "}</text></Show>
      <Show when={listInSide()} fallback={
        <Show when={briefRows().length && briefRoom() > 1}>
          <text wrapMode="none">
            <S fg={ink.note}>{" "}</S>
            <S fg={ink.heading} bold>{fit("Categories", nameWidth(rowWidth(categoriesWidth())))}</S>
            <S fg={ink.label}>{"Spent".padStart(NUM)}{withAverage(rowWidth(categoriesWidth())) ? "Average".padStart(NUM) : ""}{"Budget".padStart(NUM)}</S>
          </text>
          <Index each={briefRows().slice(0, briefRoom())}>{(row) => <ListRow cursor={false} bg={theme.canvas} spans={rowSpans(row(), rowWidth(categoriesWidth()), true)} />}</Index>
        </Show>
      }><CategoryList heading="Categories" /></Show>
    </SectionCard>
  )
  return { Categories }
}
