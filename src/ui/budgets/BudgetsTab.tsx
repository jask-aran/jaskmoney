import { Index, Show, createMemo } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { budgetProgress, cycleFor, cycleSpending, describeCycle, pastCycles, type Budget, type BudgetScope, type Cycle } from "../../domain/budget"
import { allocation, budgetCategoryLines, budgetListRows, type BudgetLine } from "../../domain/budgetLines"
import { budgetLabel } from "../../domain/budgetScopes"
import { formatWholeMoney } from "../../domain/dashboard"
import { MONTHS, addDays, appToday, daysBetween } from "../../domain/days"
import type { SectionId } from "../../state/uiStore"
import { ui } from "../../state/uiStore"
import { data } from "../../state/dataStore"
import { armedFor } from "../../state/armed"
import { theme } from "../../theme"
import { categoryMark } from "../icons"
import { fit } from "../text"
import { ListRow, centredTop } from "../primitives/ListRow"
import { SectionCard } from "../primitives/SectionCard"
import { S } from "../primitives/S"
import type { Span } from "../primitives/spans"

/** Past cycles shown for the budget at the cursor. */
const HISTORY = 6

/** "14 Sep – 13 Oct". */
function rangeLabel(cycle: Cycle): string {
  const day = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`
  return `${day(cycle.start)} – ${day(cycle.end)}`
}

/**
 * A bar in `width` cells for `fill` (0–1 of the width), coloured by how
 * it's going (green, yellow ahead of pace, red over budget), with a mark at
 * `mark` (0–1): where spending would be by today at an even pace, or
 * (`markIsBudget`) the budget on a bar scaled past it, red beyond it.
 */
function bar(width: number, fill: number, mark: number | null, tone: "ok" | "ahead" | "over", markIsBudget = false): Span[] {
  const filled = Math.round(Math.min(1, Math.max(0, fill)) * width)
  const at = mark == null ? -1 : Math.min(width - 1, Math.round(mark * width))
  const fg = tone === "over" ? theme.error : tone === "ahead" ? theme.warning : theme.success
  const spans: Span[] = []
  for (let i = 0; i < width; i++) {
    const cell = i === at ? { text: i < filled ? "▌" : "│", fg: theme.text }
      : i < filled ? { text: "█", fg: markIsBudget && tone === "over" && i < at ? theme.success : fg }
      : { text: "─", fg: theme.surface2 }
    const last = spans[spans.length - 1]
    if (last && last.fg === cell.fg) last.text += cell.text
    else spans.push(cell)
  }
  return spans
}

/** "$119 over" / "$881 left" for a budget, and its colour. */
function leftText(amount: number, spent: number): Span {
  return spent > amount ? { text: `${formatWholeMoney(spent - amount)} over`, fg: theme.error } : { text: `${formatWholeMoney(amount - spent)} left`, fg: theme.success }
}

/**
 * The Budgets tab, the one place to set budgets and see how they're going:
 * the cycle, the overall budget (against an even pace and last cycle by the
 * same day) and how much of it the category budgets take, account budgets;
 * every group and category with its budget, this cycle, last cycle and the
 * average (enter sets a budget, from the average: allocating down; the
 * overall can start from their total: building up); and the past cycles of
 * whatever the cursor is on.
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
  const label = (budget: Budget) => budgetLabel(budget, data.state.accounts, data.state.categories)
  const spentIn = (scope: BudgetScope, throughISO: string) =>
    budgetProgress([{ id: -1, scope, amount: 0 }], config(), throughISO, data.state.accounts, data.state.categories, data.transactions())[0]!.spent

  // Top card: the cycle, overall (set or not), account budgets.
  const rows = () => budgetListRows(data.state.budgets)
  const progress = live(() => new Map(budgetProgress(data.state.budgets, config(), today(), data.state.accounts, data.state.categories, data.transactions()).map((p) => [p.budget.id, p])))
  const overallNow = live(() => spentIn({ kind: "overall" }, today()))
  const firstData = live(() => data.transactions().reduce((first, t) => (t.dateISO < first ? t.dateISO : first), today()))
  const past = live(() => pastCycles(config(), today(), HISTORY).filter((c) => c.end >= firstData()))
  // Last cycle by the same day of it.
  const lastByNow = live(() => {
    const before = past()[0]
    if (!before) return null
    const through = addDays(before.start, elapsed() - 1)
    return spentIn({ kind: "overall" }, through < before.end ? through : before.end)
  })
  const split = live(() => allocation(data.state.budgets, data.state.categories))

  // Categories card.
  const lines = live(() => budgetCategoryLines(config(), today(), data.state.accounts, data.state.categories, data.state.budgets, data.transactions()))
  const categoryCursor = () => Math.min(ui.state.budgetCategoryCursor, Math.max(0, lines().length - 1))

  // What the past-cycles card follows: the row at the focused card's cursor.
  const subject = (): { title: string; scope: BudgetScope | null; amount: number | null } => {
    if (props.focused === "bud.categories") {
      const line = lines()[categoryCursor()]
      if (line) return { title: line.name, scope: line.categoryId === null ? null : { kind: "category", categoryId: line.categoryId }, amount: line.budget?.amount ?? null }
    }
    const row = rows()[Math.min(ui.state.budgetCursor, rows().length - 1)]
    if (row?.kind === "account") return { title: label(row.budget), scope: row.budget.scope, amount: row.budget.amount }
    const overall = data.state.budgets.find((b) => b.scope.kind === "overall")
    return { title: "Overall spending", scope: { kind: "overall" }, amount: overall?.amount ?? null }
  }
  const history = live(() => {
    const s = subject()
    return past().map((c) => ({
      cycle: c,
      spent: s.scope ? spentIn(s.scope, c.end) : cycleSpending(c, c.end, data.state.accounts, data.transactions()).filter((t) => t.categoryId === null).reduce((sum, t) => sum - t.amount, 0),
    }))
  })

  // Sizes: tab bar + gap (2) and status + footer (2) off the height; rows
  // lose border and padding (4) and the inset (1).
  const body = () => Math.max(12, dims().height - 4)
  const rowWidth = (width: number) => width - 5
  const topHeight = () => rows().length + 3
  const wide = () => dims().width >= 130
  const lowerHeight = () => body() - topHeight()
  const historyWidth = () => (wide() ? Math.min(64, Math.floor((dims().width - 1) * 0.4)) : dims().width)
  const categoriesWidth = () => (wide() ? dims().width - 1 - historyWidth() : dims().width)
  const historyHeight = () => (wide() ? lowerHeight() : Math.min(HISTORY + 4, Math.max(5, lowerHeight() - 10)))
  const categoriesHeight = () => (wide() ? lowerHeight() : lowerHeight() - historyHeight())

  const listFocused = () => props.focused === "bud.list"
  const categoriesFocused = () => props.focused === "bud.categories"
  const LABEL = () => Math.min(26, Math.max(18, ...rows().flatMap((r) => (r.kind === "account" ? [label(r.budget).length + 2] : []))))
  const BAR = () => Math.max(10, Math.min(30, rowWidth(dims().width) - LABEL() - 66))

  // One budget row in the top card: bar, spent of amount, left or over
  // (and per day), and against an even pace when it fits whole (the bar's
  // mark still shows pace).
  const budgetSpans = (budget: Budget): Span[] => {
    const p = progress().get(budget.id)
    if (!p) return []
    const used = budget.amount > 0 ? p.spent / budget.amount : p.spent > 0 ? 2 : 0
    const vsPace = p.spent - budget.amount * pace()
    const spans: Span[] = [
      ...bar(BAR(), used, pace(), used > 1 ? "over" : used > pace() ? "ahead" : "ok"),
      { text: `  ${formatWholeMoney(p.spent).padStart(7)} of ${formatWholeMoney(budget.amount).padEnd(7)}  `, fg: theme.subtext1 },
      p.remaining < 0 ? { text: fit(`${formatWholeMoney(-p.remaining)} over`, 24), fg: theme.error } : { text: fit(`${formatWholeMoney(p.remaining)} left · ${formatWholeMoney(p.dailyAllowance)}/day`, 24), fg: theme.success },
    ]
    const paceText = `  ${Math.abs(vsPace) < 1 ? "on pace" : `${formatWholeMoney(Math.abs(vsPace))} ${vsPace > 0 ? "over" : "under"} pace`}`
    const room = rowWidth(dims().width) - LABEL()
    if (spans.reduce((n, span) => n + span.text.length, 0) + paceText.length <= room) spans.push({ text: paceText, fg: vsPace > 0 ? theme.warning : theme.overlay1 })
    return spans
  }

  // Categories columns: numbers after the name, as many as fit (the name
  // keeps at least 20); the first ones in `priority` win.
  const columns = createMemo(() => {
    const room = rowWidth(categoriesWidth()) - 2
    const all = [
      { key: "now", title: "This cycle", width: 11 },
      { key: "budget", title: "Budget", width: 9 },
      { key: "left", title: "", width: 12 },
      { key: "bar", title: "", width: 12 },
      { key: "last", title: "Last", width: 9 },
      { key: "avg", title: "Average", width: 9 },
    ] as const
    const priority = ["now", "budget", "left", "avg", "last", "bar"]
    const picked = new Set<string>()
    let used = 0
    for (const key of priority) {
      const column = all.find((c) => c.key === key)!
      if (room - used - column.width >= 20) { picked.add(key); used += column.width }
    }
    return { list: all.filter((c) => picked.has(c.key)), name: room - used }
  })
  const cell = (line: BudgetLine, key: string): Span[] => {
    const right = (text: string, width: number, fg: string): Span[] => [{ text: text.padStart(width), fg }]
    const budget = line.budget
    switch (key) {
      case "now": return right(formatWholeMoney(line.now), 11, budget && line.now > budget.amount ? theme.error : theme.text)
      case "budget": return right(budget ? formatWholeMoney(budget.amount) : "—", 9, budget ? theme.subtext1 : theme.overlay0)
      case "left": return budget ? right(leftText(budget.amount, line.now).text, 12, leftText(budget.amount, line.now).fg) : right("", 12, theme.text)
      case "bar": {
        if (!budget) return right("", 12, theme.text)
        const used = budget.amount > 0 ? line.now / budget.amount : 1
        return [{ text: "  ", fg: theme.text }, ...bar(10, used, pace(), used > 1 ? "over" : used > pace() ? "ahead" : "ok")]
      }
      case "last": return right(line.last == null ? "—" : formatWholeMoney(line.last), 9, theme.overlay1)
      default: return right(formatWholeMoney(line.average), 9, theme.overlay1)
    }
  }
  const lineSpans = (line: BudgetLine): Span[] => [
    { text: `${line.child ? "  " : ""}${line.categoryId === null ? "?" : categoryMark(line.categoryId)} `, fg: line.color ?? theme.overlay1 },
    { text: fit(line.name, columns().name - (line.child ? 4 : 2)), fg: line.child ? theme.subtext1 : theme.text, bold: !line.child },
    ...columns().list.flatMap((c) => cell(line, c.key)),
  ]
  const room = () => Math.max(1, categoriesHeight() - 3)
  const top = () => centredTop(categoryCursor(), lines().length, room())
  const windowLines = () => lines().slice(top(), top() + room())

  return (
    <box width="100%" height="100%" flexDirection="column" backgroundColor={theme.canvas}>
      <SectionCard title="Budgets" titleSuffix={`· ${rangeLabel(cycle())} · day ${elapsed()} of ${cycle().days}`} titleSuffixColor={theme.subtext0} focused={listFocused()} height={topHeight()}>
        <Index each={rows()}>{(row, i) => {
          const at = () => listFocused() && ui.state.budgetCursor === i
          const spans = (): Span[] => {
            const r = row()
            if (r.kind === "cycle") return [{ text: fit("Cycle", LABEL()), fg: theme.subtext0 }, { text: describeCycle(config()), fg: theme.text }]
            if (r.kind === "account") return [{ text: fit(label(r.budget), LABEL()), fg: theme.text, bold: true }, ...budgetSpans(r.budget)]
            const name: Span = { text: fit("Overall spending", LABEL()), fg: theme.text, bold: true }
            if (r.budget) return [name, ...budgetSpans(r.budget)]
            const total = split().allocated
            return [name, { text: `${formatWholeMoney(overallNow())} so far · not set: enter sets one${total ? ` (your category budgets total ${formatWholeMoney(total)})` : ""}`, fg: theme.overlay1 }]
          }
          const armedId = () => { const r = row(); return r.kind === "cycle" ? -1 : r.budget?.id ?? -1 }
          return <ListRow cursor={at()} bg={theme.canvas} armed={armedFor(ui.state.armed, "budget", armedId())} spans={spans()} />
        }}</Index>
        {/* How the category budgets add up, and last cycle by the same day. */}
        <text wrapMode="none">
          <S fg={theme.overlay1}>{` ${fit("", LABEL())}`}</S>
          <Show when={split().allocated > 0} fallback={<S fg={theme.overlay1}>{"No category budgets yet (l)"}</S>}>
            <S fg={theme.subtext0}>{`Categories ${formatWholeMoney(split().allocated)}`}</S>
            <Show when={split().overall != null}>
              <S fg={split().allocated > split().overall! ? theme.error : theme.subtext0}>{` of ${formatWholeMoney(split().overall!)} · ${split().allocated > split().overall! ? `${formatWholeMoney(split().allocated - split().overall!)} over-allocated` : `${formatWholeMoney(split().overall! - split().allocated)} unallocated`}`}</S>
            </Show>
          </Show>
          <Show when={lastByNow() != null}>
            <S fg={theme.overlay1}>{` · last cycle ${formatWholeMoney(lastByNow()!)} by now`}</S>
            <S fg={overallNow() > lastByNow()! ? theme.warning : theme.success}>{lastByNow()! > 0 ? ` (${overallNow() >= lastByNow()! ? "+" : "−"}${Math.round(Math.abs(overallNow() / lastByNow()! - 1) * 100)}%)` : ""}</S>
          </Show>
        </text>
      </SectionCard>
      <box flexDirection={wide() ? "row" : "column"} gap={wide() ? 1 : 0} width="100%" height={lowerHeight()}>
        <SectionCard title="Categories" titleSuffix={categoriesFocused() ? "· enter sets a budget" : undefined} titleSuffixColor={theme.overlay1} focused={categoriesFocused()} width={categoriesWidth()} height={categoriesHeight()}>
          <Show when={lines().length} fallback={<text fg={theme.overlay1}>No spending yet.</text>}>
            <text wrapMode="none">
              <S fg={theme.overlay1}>{` ${fit("", columns().name)}`}</S>
              <Index each={columns().list}>{(c) => <S fg={theme.overlay1}>{c().title.padStart(c().width)}</S>}</Index>
            </text>
            <Index each={windowLines()}>{(line, i) => (
              <ListRow cursor={categoriesFocused() && top() + i === categoryCursor()} bg={theme.canvas} armed={line().budget ? armedFor(ui.state.armed, "budget", line().budget!.id) : undefined} spans={lineSpans(line())} />
            )}</Index>
          </Show>
        </SectionCard>
        <SectionCard title="Past cycles" titleSuffix={`· ${subject().title}`} titleSuffixColor={theme.subtext0} width={historyWidth()} height={historyHeight()}>
          <Show when={history().length} fallback={<text fg={theme.overlay1}>No earlier cycles yet.</text>}>
            <Index each={history().slice(0, Math.max(1, historyHeight() - 3))}>{(h) => {
              // One scale for every cycle (the biggest, or the budget), the
              // budget marked.
              const amount = () => subject().amount ?? 0
              const scale = () => Math.max(amount(), ...history().map((x) => x.spent), 1)
              const width = () => Math.max(6, rowWidth(historyWidth()) - 17 - 9 - 13)
              return <text wrapMode="none">
                <S fg={theme.subtext0}>{` ${fit(rangeLabel(h().cycle), 16)}`}</S>
                <S fg={theme.text}>{formatWholeMoney(h().spent).padStart(8)} </S>
                <Index each={bar(width(), h().spent / scale(), amount() > 0 ? amount() / scale() : null, amount() > 0 && h().spent > amount() ? "over" : "ok", true)}>{(span) => <S fg={span().fg}>{span().text}</S>}</Index>
                <Show when={amount() > 0}>
                  <S fg={h().spent > amount() ? theme.error : theme.success}>{` ${leftText(amount(), h().spent).text.replace(" left", " under")}`.padStart(13)}</S>
                </Show>
              </text>
            }}</Index>
            <text wrapMode="none">
              <S fg={theme.subtext1} bold>{` ${fit("Average", 16)}`}</S>
              <S fg={theme.text} bold>{formatWholeMoney(history().reduce((sum, h) => sum + h.spent, 0) / history().length).padStart(8)}</S>
              <Show when={(subject().amount ?? 0) > 0}>
                <S fg={theme.overlay1}>{`   over in ${history().filter((h) => h.spent > subject().amount!).length} of ${history().length}`}</S>
              </Show>
            </text>
          </Show>
        </SectionCard>
      </box>
    </box>
  )
}
