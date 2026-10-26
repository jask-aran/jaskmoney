import { For, Show, createMemo } from "solid-js"
import { SectionCard } from "../primitives/SectionCard"
import { S } from "../primitives/S"
import { data } from "../../state/dataStore"
import { theme } from "../../theme"
import { computeCategorySpend, fitCategoryLines, formatMoney, formatWholeMoney, groupCategorySpend } from "../../domain/dashboard"
import { computeAccountStats } from "../../domain/accountStats"
import { accountRole } from "../../domain/types"
import type { Cycle } from "../../domain/budget"
import { fit } from "../text"
import { columnBars } from "../charts/bars"
import type { Run } from "../charts/lineChart"
import { categoryMark } from "../icons"

const LABEL = 10
const COL = 11
const TOP_OUTFLOWS = 3

/**
 * The Dashboard's fixed look at every spending account: balance and pending,
 * money in and out over 30 and 90 days, twelve months of in/out bars, the
 * current cycle's spending by category (groups, then their largest
 * subcategories as rows allow), and the largest outflows of the last 90 days.
 */
export function SpendingPane(props: { width: number; height: number; cycle: Cycle; today: string }) {
  const accounts = createMemo(() => data.state.accounts.filter((a) => accountRole(a) === "spending"))
  const stats = createMemo(() => computeAccountStats(accounts(), data.state.transactions, props.today))
  const inner = () => props.width - 4
  // In and Out share a scale so their bars compare.
  const monthlyMax = createMemo(() => Math.max(0, ...stats().monthly.flatMap((m) => [m.moneyIn, m.moneyOut])))
  const bars = (key: "moneyIn" | "moneyOut", ink: string) => columnBars(stats().monthly.map((m) => ({ value: m[key], ink })), inner() - 4, 2, monthlyMax()).rows
  const windows = () => stats().windows.filter((w) => w.days <= 90)
  const groups = createMemo(() => {
    const ids = new Set(accounts().map((a) => a.id))
    const rows = data.state.transactions.filter((t) => t.accountId != null && ids.has(t.accountId) && t.dateISO >= props.cycle.start && t.dateISO <= props.today)
    return groupCategorySpend(computeCategorySpend(rows, data.state.categories), data.state.categories)
  })
  const outflows = () => stats().topOutflows.slice(0, TOP_OUTFLOWS)
  // Rows other than the category list: border (2), balance + pending (2),
  // blank, header + windows, blank, label + 2 × 2 bar rows, blank, label,
  // blank, label + outflows.
  const fixed = () => 2 + 2 + 1 + 1 + windows().length + 1 + 1 + 4 + 1 + 1 + (outflows().length ? 1 + 1 + outflows().length : 0)
  const categoryLines = createMemo(() => fitCategoryLines(groups(), Math.max(1, props.height - fixed())))
  const row = (label: string, value: string, color: string = theme.text) => (
    <text wrapMode="none">
      <S fg={theme.subtext0}>{label.padEnd(LABEL)}</S>
      <S fg={color}>{value}</S>
    </text>
  )
  return (
    <SectionCard title="Spending" titleSuffix="· every spending account" titleSuffixColor={theme.subtext0} width={props.width} height={props.height}>
      {row("Balance", stats().balance != null ? formatMoney(stats().balance!) : "—")}
      {row("Pending", stats().held.count ? `${formatMoney(Math.abs(stats().held.amount))}, ${stats().held.count} txn` : "none", theme.overlay1)}
      <text> </text>
      <text wrapMode="none" fg={theme.overlay1}>{" ".repeat(LABEL) + "In".padStart(COL) + "Out".padStart(COL)}</text>
      <For each={windows()}>
        {(w) => (
          <text wrapMode="none">
            <S fg={theme.subtext0}>{`${w.days} days`.padEnd(LABEL)}</S>
            <S fg={theme.success}>{formatWholeMoney(w.moneyIn).padStart(COL)}</S>
            <S fg={theme.error}>{formatWholeMoney(w.moneyOut).padStart(COL)}</S>
          </text>
        )}
      </For>
      <text> </text>
      <text wrapMode="none" fg={theme.overlay1}>{"Monthly · 12 months"}</text>
      <For each={bars("moneyIn", theme.success)}>{(r, i) => <text wrapMode="none"><S fg={theme.overlay1}>{i() === 1 ? "In  " : "    "}</S><Runs runs={r} /></text>}</For>
      <For each={bars("moneyOut", theme.error)}>{(r, i) => <text wrapMode="none"><S fg={theme.overlay1}>{i() === 1 ? "Out " : "    "}</S><Runs runs={r} /></text>}</For>
      <text> </text>
      <text wrapMode="none" fg={theme.overlay1}>{"Categories · this cycle"}</text>
      <Show when={groups().length} fallback={<text fg={theme.overlay1}>No spending this cycle</text>}>
        <For each={categoryLines()}>
          {(line) => (
            <text wrapMode="none">
              <S fg={line.color}>{line.child ? "  " : ""}{`${categoryMark(line.categoryId)} `}</S>
              <S fg={line.child ? theme.subtext0 : line.color} bold={!line.child}>{fit(line.label, Math.max(6, inner() - 15 - (line.child ? 4 : 2)))}</S>
              <S fg={line.child ? theme.subtext0 : theme.text} bold={!line.child}>{formatWholeMoney(line.amount).padStart(9)}</S>
              <S fg={theme.overlay1}>{(line.pct != null ? `${Math.round(line.pct)}%` : "").padStart(5)}</S>
            </text>
          )}
        </For>
      </Show>
      <Show when={outflows().length}>
        <text> </text>
        <text wrapMode="none" fg={theme.overlay1}>{"Largest outflows · 90 days"}</text>
        <For each={outflows()}>
          {(o) => (
            <text wrapMode="none">
              <S fg={theme.text}>{fit(o.description, inner() - 12)}</S>
              <S fg={theme.error}>{formatWholeMoney(o.amount).padStart(12)}</S>
            </text>
          )}
        </For>
      </Show>
    </SectionCard>
  )
}

/** Chart runs whose inks are colours. */
function Runs(props: { runs: Run[] }) {
  return <For each={props.runs}>{(run) => <S fg={run.ink ?? undefined}>{run.text}</S>}</For>
}
