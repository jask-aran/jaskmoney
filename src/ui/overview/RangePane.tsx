import { Index, Show, createMemo } from "solid-js"
import { drillDown, moveOverviewCategory } from "../../app/keys"
import { onPointer } from "../../app/pointer"
import { fitCategoryLines, formatPct, formatWholeMoney, signedWholeMoney } from "../../domain/dashboard"
import { addDays } from "../../domain/days"
import { data } from "../../state/dataStore"
import { openGroups, overviewCategoryLines } from "../../state/overviewRange"
import { ui, type SectionId } from "../../state/uiStore"
import { ink, theme, tone } from "../../theme"
import { cycleTrack } from "../budgets/PlanGraphics"
import { changeColor, spendChangeColor } from "../colors"
import { categoryMark } from "../icons"
import { centredTop } from "../primitives/ListRow"
import { S } from "../primitives/S"
import { SectionCard } from "../primitives/SectionCard"
import type { Span } from "../primitives/spans"
import { regionRef } from "../regions"
import { fit } from "../text"
import { spendFlow } from "./RangeGraphics"

import type { OverviewModel, createOverviewBefore, createOverviewCounts, createOverviewPay } from "./overviewModel"
import type { OverviewLayout } from "./OverviewTab"

type RangeInput = OverviewModel & OverviewLayout & ReturnType<typeof createOverviewPay>
/** The Range pane's Before column: a category's change on before. */
export const BEFORE = 8
/** The Range pane's ratios' value column. */
const VALUE = 11

function rangeText(input: RangeInput, width: number, f: ReturnType<OverviewModel["flows"]>, b: ReturnType<OverviewModel["previousFlows"]>, heading: () => Span[]) {
  const { covered, position, windows, budget } = input
  const before = (text: string) => (covered() ? text : "—")
  // The range's daily average spending.
  const daily = (spent: number) => formatWholeMoney(windows().days ? spent / windows().days : 0)
  const lines: Span[][] = []
  // As text (t): the totals against before, line by line, the range's
  // figure under Spent and before's under Before; then the categories.
  const RANGE = 9, WAS = 5 + BEFORE
  const line = (label: string, value: string, was: string, look: { value?: string; was?: string; label?: string; bold?: boolean } = {}): Span[] => [
    { text: fit(label, Math.max(4, width - 1 - RANGE - WAS)).padEnd(Math.max(4, width - 1 - RANGE - WAS)), fg: look.label ?? ink.label, bold: look.bold },
    { text: value.padStart(RANGE), fg: look.value ?? ink.figure, bold: look.bold },
    { text: was.padStart(WAS), fg: look.was ?? ink.note },
  ]
  lines.push(
    line("Totals", "Range", "Before", { label: ink.heading, value: ink.label, was: ink.label, bold: true }),
    line("Spent", formatWholeMoney(f.spent), before(formatWholeMoney(b.spent)), { value: covered() && b.spent > 0 ? spendChangeColor(f.spent - b.spent) : ink.figure }),
    line("Income", formatWholeMoney(f.income), before(formatWholeMoney(b.income))),
    line("Net", signedWholeMoney(f.net), before(signedWholeMoney(b.net)), { value: changeColor(f.net) }),
    line("To savers", signedWholeMoney(f.savedToSavers), before(signedWholeMoney(b.savedToSavers)), { value: changeColor(f.savedToSavers) }),
    line("Savings rate", formatPct(f.savingsRate), before(formatPct(b.savingsRate))),
    line("Daily", daily(f.spent), before(daily(b.spent))),
    line("Transactions", String(f.txnCount), before(String(b.txnCount))),
  )
  // How long the net position lasts at the range's daily average.
  if (position().netPosition != null && f.spent > 0 && windows().days > 0) lines.push(line("Runway", `${Math.round(position().netPosition! / (f.spent / windows().days))} days`, `at ${daily(f.spent)}/day`))
  const p = budget()
  if (p) {
    lines.push(line("Budget", formatWholeMoney(p.budget.amount), `${Number.isFinite(p.usedPct) ? Math.round(p.usedPct) : "—"}% used`, { was: p.usedPct > 100 ? tone.bad : p.usedPct >= 80 ? tone.caution : tone.good }))
    if (p.remaining > 0) lines.push(line("  left", formatWholeMoney(p.remaining), `${formatWholeMoney(p.dailyAllowance)}/day`))
  }
  lines.push([], heading())
  return lines
}

function rangeBars(input: RangeInput, width: number, f: ReturnType<OverviewModel["flows"]>, b: ReturnType<OverviewModel["previousFlows"]>, pay: ReturnType<RangeInput["rangePay"]>, heading: () => Span[]) {
  const { covered, position, windows, bounds, today, inPeriod, groups, spendingView } = input
  // The range's daily average spending.
  const daily = (spent: number) => formatWholeMoney(windows().days ? spent / windows().days : 0)
  const lines: Span[][] = []
  // The ratios first: label, before (a note) and the figure at the
  // row's end.
  const ratio = (label: string, value: string, was: string | null, aside?: string): Span[] => {
    const note = aside ?? (covered() && was != null ? `before ${was}` : "")
    const gap = Math.max(1, width - label.length - note.length - Math.max(VALUE - 2, value.length))
    return [{ text: label, fg: ink.label }, { text: " ".repeat(gap) + note, fg: ink.note }, { text: value.padStart(Math.max(VALUE - 2, value.length)), fg: ink.strong, bold: true }]
  }
  lines.push(
    ratio("Daily average", daily(f.spent), daily(b.spent)),
    ratio("Transactions", String(f.txnCount), String(b.txnCount)),
    // How long the net position lasts at the range's daily average.
    ...(position().netPosition != null && f.spent > 0 && windows().days > 0
      ? [ratio("Runway", `${Math.round(position().netPosition! / (f.spent / windows().days))} days`, null, `at ${daily(f.spent)}/day`)]
      : []),
    [],
  )
  // The track: what came in and what went to savers are the range's
  // flows (as the text's totals count them). What's spent is the bar's, under it.
  lines.push(...cycleTrack(width, bounds().start, addDays(bounds().end, 1), today(), { ...pay, pay: f.income, sent: f.savedToSavers, spent: 0 }, tone.good, bounds().end))
  lines.push([])
  // Where the spending or the net went (s): the Budgets pane's flow too.
  lines.push(...spendFlow(width, {
    ...f, rows: inPeriod(), groups: groups(), bySpending: spendingView(),
    savers: [...position().savers].sort((x, y) => y.balance - x.balance),
  }))
  lines.push([], heading())
  return lines
}

export function createRangeLines(input: RangeInput) {
  const { rangePay, categoryWidth, flows, previousFlows, textual } = input
  // The Range pane: the range's totals and categories as one, as bars (t:
  // as text). The ratios, the range as a track (its paydays, sends
  // to savers and today; what came in, what went to savers and what was
  // spent), what came in as a bar (spent, net) opened out to where the net
  // went (each saver, kept) or, with s, where the spending went (its
  // category groups), then the categories with a Before column.
  const rangeLines = createMemo((): Span[][] => {
    const pay = rangePay()
    const width = categoryWidth() - 5
    const f = flows(), b = previousFlows()
    // The categories' heading, its columns over theirs: under the bars, or
    // the text.
    const cols = `${"Spent".padStart(9)}${"%".padStart(5)}${"Before".padStart(BEFORE)}`
    const heading = (): Span[] => [{ text: "Categories".padEnd(Math.max(10, width - 1 - cols.length)), fg: ink.heading, bold: true }, { text: cols, fg: ink.label }]
    const lines = textual() ? rangeText(input, width, f, b, heading) : rangeBars(input, width, f, b, pay, heading)
    return lines.map((l) => (l.length ? l : [{ text: " ", fg: ink.note }]))
  })
  const rangeTop = () => rangeLines().length
  return { rangeLines, rangeTop }
}

type CategoryInput = OverviewModel & OverviewLayout & ReturnType<typeof createRangeLines> & ReturnType<typeof createOverviewCounts> & ReturnType<typeof createOverviewBefore> & { categoriesFocused: () => boolean }

export function createCategoryRows(input: CategoryInput) {
  const { textual, groups, categoriesHeight, rangeTop, categoriesFocused, range, beforeSpend } = input
  const beforeChange = (line: { categoryId: number | null; child: boolean; amount: number }): Span => {
    const by = beforeSpend()
    if (!by) return { text: "—".padStart(BEFORE), fg: ink.faint }
    const delta = line.amount - (by.get(`${line.child ? "c" : "g"}${line.categoryId}`) ?? 0)
    return { text: (Math.abs(delta) < 0.5 ? "·" : signedWholeMoney(delta)).padStart(BEFORE), fg: spendChangeColor(delta) }
  }

  // The Range pane's chevron: a group's open or closed (none without
  // subcategories); a subcategory's indent.
  const chevron = (line: { categoryId: number | null; child: boolean }) => {
    // As text, every group is open: no chevrons, only the space that
    // lines the marks up under the heading.
    if (textual()) return " "
    if (line.child) return "   "
    const g = groups().find((x) => x.categoryId === line.categoryId)
    return !g?.children.length || line.categoryId == null ? "   " : ui.state.overviewOpen.includes(line.categoryId) ? " ▾ " : " ▸ "
  }
  const categoryRows = createMemo(() => {
    const rows = Math.max(1, categoriesHeight() - 2 - rangeTop())
    // As bars, its groups closed until space opens them, as Budgets'; as
    // text, every line (unfocused, the largest subcategories that fit).
    const open = openGroups(data.state.uiPrefs, ui.state)
    if (!categoriesFocused()) return (open ? overviewCategoryLines(range(), open).slice(0, rows) : fitCategoryLines(groups(), rows)).map((line) => ({ line, cursor: false }))
    const lines = overviewCategoryLines(range(), open)
    const cursor = Math.min(ui.state.overviewCategoryCursor, lines.length - 1)
    const top = centredTop(cursor, lines.length, rows)
    return lines.slice(top, top + rows).map((line, i) => ({ line, cursor: top + i === cursor }))
  })
  return { beforeChange, chevron, categoryRows }
}

export function RangePane(input: CategoryInput & ReturnType<typeof createCategoryRows>) {
  const { categoryWidth, categoriesHeight, categoriesFocused, uncategorised, toReview, rangeLines, groups, range, textual, categoryNameWidth } = input
  const { beforeChange, chevron, categoryRows } = input
  return (
    <box ref={regionRef("ov.categories", "overview")} width={categoryWidth()} height={categoriesHeight()} flexShrink={0} onMouseDown={panePointer("ov.categories")}
      onMouseScroll={onPointer((s) => s === "bar" || s === "overview" || s === "overview.range", (event) => {
        if (event.scroll?.direction !== "up" && event.scroll?.direction !== "down") return
        ui.applyJump("ov.categories")
        moveOverviewCategory(ui, data, ui.state.overviewCategoryCursor + (event.scroll.direction === "down" ? 1 : -1) * event.scroll.delta)
      })}>
    <SectionCard title="Range" titleSuffix={categoriesFocused() ? "· enter to open" : undefined} titleSuffixColor={ink.note} bottomSpans={uncategorised() || toReview() ? [
        ...(uncategorised() ? [{ text: `${uncategorised()} uncategorised`, fg: tone.caution }] : []),
        ...(toReview() ? [{ text: `${uncategorised() ? " · " : ""}${toReview()} to review (i)`, fg: tone.ai }] : []),
      ] : undefined} width={categoryWidth()} height={categoriesHeight()} focused={categoriesFocused()} active={categoriesFocused()}>
      <Index each={rangeLines()}>{(spans) => (
        <text wrapMode="none" flexShrink={0}><S>{" "}</S><Index each={spans()}>{(span) => <S fg={span().fg} bg={span().bg} bold={span().bold}>{span().text}</S>}</Index></text>
      )}</Index>
      <Show when={groups().length} fallback={<text fg={ink.note}>No spending in this period</text>}>
        {/* Index: a new range or cursor move updates rows in place. */}
        <Index each={categoryRows()}>
          {(row) => {
            const line = () => row().line
            const cursor = () => row().cursor
            const bg = () => cursor() ? theme.rowCursor : undefined
            return (
              <text wrapMode="none" bg={bg()} onMouseDown={onPointer((s) => s === "bar" || s === "overview" || s === "overview.range", () => {
                const lines = overviewCategoryLines(range(), openGroups(data.state.uiPrefs, ui.state))
                const index = lines.findIndex((l) => l.categoryId === line().categoryId && l.child === line().child)
                const open = categoriesFocused() && index === ui.state.overviewCategoryCursor
                ui.applyJump("ov.categories")
                moveOverviewCategory(ui, data, index)
                if (open) drillDown(ui, data, lines[index])
              })}>
                <S fg={ink.note} bg={bg()}>{chevron(line())}</S>
                <S fg={line().color} bg={bg()}>{line().child ? "  " : ""}{`${categoryMark(line().categoryId)} `}</S>
                <S fg={line().child && !cursor() ? ink.label : line().color} bg={bg()} bold={!line().child || cursor()}>{fit(line().label, -(line().child ? 4 : 2) - (textual() ? 1 : 3) + categoryNameWidth())}</S>
                <S fg={line().child ? ink.label : ink.figure} bg={bg()} bold={!line().child}>{formatWholeMoney(line().amount).padStart(9)}</S>
                <S fg={ink.note} bg={bg()}>{(line().pct != null ? `${Math.round(line().pct!)}%` : "").padStart(5)}</S>
                <S fg={beforeChange(line()).fg} bg={bg()}>{beforeChange(line()).text}</S>
              </text>
            )
          }}
        </Index>
      </Show>
    </SectionCard>
    </box>
  )
}

export const panePointer = (id: SectionId) => onPointer((s) => s === "bar" || s === "overview" || s === "overview.range", () => ui.applyJump(id))
