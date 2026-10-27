import { For, Index, Show, createMemo } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { budgetProgress, cycleFor, cycleSpending, describeCycle, pastCycles, spendByGroup, type Budget, type Cycle } from "../../domain/budget"
import { budgetLabel } from "../../domain/budgetScopes"
import { formatWholeMoney } from "../../domain/dashboard"
import { MONTHS, appToday, daysBetween } from "../../domain/days"
import type { SectionId } from "../../state/uiStore"
import { ui } from "../../state/uiStore"
import { data } from "../../state/dataStore"
import { armedFor } from "../../state/armed"
import { theme } from "../../theme"
import { categoryMark } from "../icons"
import { fit } from "../text"
import { ListRow } from "../primitives/ListRow"
import { SectionCard } from "../primitives/SectionCard"
import { S } from "../primitives/S"
import { muted, type Span } from "../primitives/spans"

/** Past cycles shown under a budget, and how many make a category's average. */
const HISTORY = 6
const AVERAGE_OVER = 3

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

/**
 * The Budgets tab: this cycle's budgets (the cycle first; enter edits, a
 * adds, del twice deletes), the past cycles of the budget under the cursor,
 * and this cycle's spending by category against its recent average.
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
  const progress = live(() => budgetProgress(data.state.budgets, config(), today(), data.state.accounts, data.state.categories, data.transactions()))
  const label = (budget: Budget) => budgetLabel(budget, data.state.accounts, data.state.categories)

  // The budget whose past the second card shows: the one under the cursor,
  // else the first (on the cycle row).
  const selected = () => data.state.budgets[Math.max(0, ui.state.budgetCursor - 1)] ?? null
  const firstData = live(() => data.transactions().reduce((first, t) => (t.dateISO < first ? t.dateISO : first), today()))
  const past = live(() => pastCycles(config(), today(), HISTORY).filter((c) => c.end >= firstData()))
  const history = live(() => {
    const budget = selected()
    return past().map((c) => ({
      cycle: c,
      spent: budget
        ? budgetProgress([budget], config(), c.end, data.state.accounts, data.state.categories, data.transactions())[0]!.spent
        : cycleSpending(c, c.end, data.state.accounts, data.transactions()).reduce((sum, t) => sum - t.amount, 0),
    }))
  })

  // This cycle by category against the average of the cycles before: each
  // group, then (room allowing) the categories in it.
  interface Line { id: number | null; name: string; color: string; now: number; average: number; budget?: number; child: boolean }
  const lines = live(() => {
    const byId = (rows: ReturnType<typeof data.transactions>) => {
      const spend = new Map<number | null, number>()
      for (const t of rows) spend.set(t.categoryId, (spend.get(t.categoryId) ?? 0) - t.amount)
      return spend
    }
    const nowRows = cycleSpending(cycle(), today(), data.state.accounts, data.transactions())
    const beforeRows = past().slice(0, AVERAGE_OVER).map((c) => cycleSpending(c, c.end, data.state.accounts, data.transactions()))
    const groupNow = spendByGroup(nowRows, data.state.categories)
    const groupBefore = beforeRows.map((rows) => spendByGroup(rows, data.state.categories))
    const catNow = byId(nowRows)
    const catBefore = beforeRows.map(byId)
    const budgets = new Map(data.state.budgets.flatMap((b) => (b.scope.kind === "category" ? [[b.scope.categoryId, b.amount] as const] : [])))
    const average = (maps: Map<number | null, number>[], id: number | null) => (maps.length ? maps.reduce((sum, m) => sum + (m.get(id) ?? 0), 0) / maps.length : 0)
    const category = (id: number | null) => (id === null ? undefined : data.state.categories.find((c) => c.id === id))
    const line = (id: number | null, now: number, avg: number, child: boolean): Line => ({
      id, child, now, average: avg, budget: id === null ? undefined : budgets.get(id),
      name: id === null ? "Uncategorised" : category(id)?.name ?? "(removed)",
      color: category(id)?.color ?? theme.overlay1,
    })
    const ids = new Set([...groupNow.keys(), ...groupBefore.flatMap((m) => [...m.keys()])])
    const groups = [...ids].map((id) => line(id, groupNow.get(id) ?? 0, average(groupBefore, id), false))
      .filter((g) => g.now >= 0.5 || g.average >= 0.5).sort((a, b) => b.now - a.now || b.average - a.average)
    return groups.map((g) => ({
      group: g,
      children: g.id === null ? [] : data.state.categories.filter((c) => c.parentId === g.id)
        .map((c) => line(c.id, catNow.get(c.id) ?? 0, average(catBefore, c.id), true))
        .filter((c) => c.now >= 0.5 || c.average >= 0.5).sort((a, b) => b.now - a.now || b.average - a.average),
    }))
  })
  const shownLines = () => {
    const room = Math.max(0, groupsHeight() - 2)
    const all = lines().flatMap((g) => [g.group, ...g.children])
    return all.length <= room ? all : lines().map((g) => g.group).slice(0, room)
  }

  // Sizes: tab bar + gap (2) and status + footer (2) off the height; rows
  // lose border and padding (4) and the cursor marker (2).
  const body = () => Math.max(10, dims().height - 4)
  const rowWidth = (width: number) => width - 6
  const budgetsHeight = () => Math.max(1, data.state.budgets.length) + 3
  const split = () => dims().width >= 110
  const lowerHeight = () => body() - budgetsHeight()
  const historyWidth = () => (split() ? Math.floor((dims().width - 1) * 0.45) : dims().width)
  const groupsWidth = () => (split() ? dims().width - 1 - historyWidth() : dims().width)
  const historyHeight = () => (split() ? lowerHeight() : Math.min(lowerHeight() - 5, history().length + 3))
  const groupsHeight = () => (split() ? lowerHeight() : lowerHeight() - historyHeight())

  const focused = () => props.focused === "bud.list"
  const LABEL = () => Math.min(28, Math.max(12, ...data.state.budgets.map((b) => label(b).length + 2)))
  const BAR = () => Math.max(10, Math.min(40, rowWidth(dims().width) - LABEL() - 44))

  return (
    <box width="100%" height="100%" flexDirection="column" backgroundColor={theme.canvas}>
      <SectionCard title="Budgets" titleSuffix={`· ${rangeLabel(cycle())} · day ${elapsed()} of ${cycle().days}`} titleSuffixColor={theme.subtext0} focused={focused()} height={budgetsHeight()}>
        <ListRow cursor={focused() && ui.state.budgetCursor === 0} bg={theme.canvas} spans={[
          { text: fit("Cycle", LABEL()), fg: theme.subtext0 },
          { text: describeCycle(config()), fg: theme.text },
        ]} />
        <Show when={progress().length} fallback={<text fg={theme.overlay1}>{"  No budgets yet: a adds one (overall, an account or a category)."}</text>}>
          <For each={progress()}>{(p, i) => {
            const used = () => (p.budget.amount > 0 ? p.spent / p.budget.amount : p.spent > 0 ? 2 : 0)
            const over = () => p.remaining < 0
            const status = (): Span => over()
              ? { text: `${formatWholeMoney(-p.remaining)} over`, fg: theme.error }
              : { text: `${formatWholeMoney(p.remaining)} left · ${formatWholeMoney(p.dailyAllowance)}/day`, fg: used() > pace() ? theme.warning : theme.success }
            return <ListRow cursor={focused() && ui.state.budgetCursor === i() + 1} bg={theme.canvas} armed={armedFor(ui.state.armed, "budget", p.budget.id)} spans={[
              { text: fit(label(p.budget), LABEL()), fg: theme.text, bold: true },
              ...bar(BAR(), used(), pace(), used() > 1 ? "over" : used() > pace() ? "ahead" : "ok"),
              { text: `  ${formatWholeMoney(p.spent).padStart(7)} of ${formatWholeMoney(p.budget.amount).padEnd(7)}  `, fg: theme.subtext1 },
              status(),
            ]} />
          }}</For>
        </Show>
      </SectionCard>
      <box flexDirection={split() ? "row" : "column"} gap={split() ? 1 : 0} width="100%" height={lowerHeight()}>
        <SectionCard title="Past cycles" titleSuffix={`· ${selected() ? label(selected()!) : "all spending"}`} titleSuffixColor={theme.subtext0} width={historyWidth()} height={historyHeight()}>
          <Show when={history().length} fallback={<text fg={theme.overlay1}>No earlier cycles yet.</text>}>
            <Index each={history()}>{(h) => {
              // Bars share one scale (the biggest cycle, or the budget), the
              // budget marked on them.
              const amount = () => selected()?.amount ?? 0
              const used = () => (amount() > 0 ? h().spent / amount() : 0)
              const scale = () => Math.max(amount(), ...history().map((x) => x.spent), 1)
              const width = () => Math.max(6, rowWidth(historyWidth()) - 17 - 9 - 12)
              return <text wrapMode="none">
                <S fg={theme.subtext0}>{fit(rangeLabel(h().cycle), 17)}</S>
                <S fg={theme.text}>{formatWholeMoney(h().spent).padStart(8)} </S>
                <Show when={amount() > 0} fallback={<S fg={theme.overlay1}>{""}</S>}>
                  <Index each={bar(width(), h().spent / scale(), amount() / scale(), used() > 1 ? "over" : "ok", true)}>{(span) => <S fg={span().fg}>{span().text}</S>}</Index>
                  <S fg={used() > 1 ? theme.error : theme.overlay1}>{(used() > 1 ? ` +${formatWholeMoney(h().spent - amount())}` : ` ${Math.round(used() * 100)}%`).padStart(11)}</S>
                </Show>
              </text>
            }}</Index>
            <text wrapMode="none">
              <S fg={theme.subtext1} bold>{fit("Average", 17)}</S>
              <S fg={theme.text} bold>{formatWholeMoney(history().reduce((sum, h) => sum + h.spent, 0) / history().length).padStart(8)}</S>
            </text>
          </Show>
        </SectionCard>
        <SectionCard title="This cycle by category" titleRight={[muted("This cycle"), muted("  Average"), muted("   Budget")]} titleRightFlush width={groupsWidth()} height={groupsHeight()}>
          <Show when={lines().length} fallback={<text fg={theme.overlay1}>No spending yet.</text>}>
            <For each={shownLines()}>{(g) => (
              <text wrapMode="none">
                <S fg={g.color}>{`${g.child ? "  " : ""}${g.id === null ? "?" : categoryMark(g.id)} `}</S>
                <S fg={g.child ? theme.subtext1 : theme.text} bold={!g.child}>{fit(g.name, Math.max(8, groupsWidth() - 4 - 2 - 30 - (g.child ? 2 : 0)))}</S>
                <S fg={g.budget != null && g.now > g.budget ? theme.error : theme.text}>{formatWholeMoney(g.now).padStart(10)}</S>
                <S fg={theme.overlay1}>{formatWholeMoney(g.average).padStart(10)}</S>
                <S fg={theme.subtext0}>{(g.budget != null ? formatWholeMoney(g.budget) : "—").padStart(10)}</S>
              </text>
            )}</For>
          </Show>
        </SectionCard>
      </box>
    </box>
  )
}
