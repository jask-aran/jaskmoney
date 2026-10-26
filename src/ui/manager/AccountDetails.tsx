import { For, Show, createMemo } from "solid-js"
import { SectionCard } from "../primitives/SectionCard"
import { S } from "../primitives/S"
import { data } from "../../state/dataStore"
import { theme } from "../../theme"
import { formatMoney } from "../../domain/dashboard"
import { computeAccountStats } from "../../domain/accountStats"
import { selectedAccounts, selectionLabel } from "../../domain/accountTree"
import { fit, shortMoney } from "../text"
import { toISODate } from "../../domain/timeframe"
import { columnBars } from "../charts/bars"
import { lineChart, type Run } from "../charts/lineChart"

/** Inner width of the sidebar cards (SIDEBAR_WIDTH − border − padding). */
const WIDTH = 32
const LABEL = 10
const COL = 11

/** Statistics for the Manager's selected account(s), under the account list. */
export function AccountDetails() {
  const accounts = createMemo(() => selectedAccounts(data.state.accounts, data.state.accountSelection))
  const stats = createMemo(() => computeAccountStats(accounts(), data.state.transactions, toISODate(new Date())))
  // In and Out share a scale so their bars compare.
  const monthlyMax = createMemo(() => Math.max(0, ...stats().monthly.flatMap((m) => [m.moneyIn, m.moneyOut])))
  const monthsIn = createMemo(() => columnBars(stats().monthly.map((m) => ({ value: m.moneyIn, ink: theme.success })), WIDTH - 4, 2, monthlyMax()).rows)
  const monthsOut = createMemo(() => columnBars(stats().monthly.map((m) => ({ value: m.moneyOut, ink: theme.error })), WIDTH - 4, 2, monthlyMax()).rows)
  const balance = createMemo(() => {
    const values = stats().history.map((h) => h.value)
    const min = Math.min(...values), max = Math.max(...values)
    return { rows: lineChart({ series: [{ values, ink: theme.lavender }], length: values.length, width: WIDTH, height: 3, min, max }), min, max }
  })
  const row = (label: string, value: string, color: string = theme.text) => (
    <text wrapMode="none">
      <S fg={theme.subtext0}>{label.padEnd(LABEL)}</S>
      <S fg={color}>{value}</S>
    </text>
  )

  return (
    <SectionCard title={selectionLabel(data.state.accounts, data.state.accountSelection)} flexGrow={1}>
      <Show when={accounts().length} fallback={<text fg={theme.overlay1}>No accounts</text>}>
        {row("Balance", stats().balance != null ? formatMoney(stats().balance!) : "—")}
        <Show when={stats().held.count > 0}>
          {row("Pending", `${formatMoney(Math.abs(stats().held.amount))}, ${stats().held.count} txn`, theme.overlay1)}
        </Show>
        <text> </text>
        <text wrapMode="none" fg={theme.overlay1}>{" ".repeat(LABEL) + "In".padStart(COL) + "Out".padStart(COL)}</text>
        <For each={stats().windows}>
          {(w) => (
            <text wrapMode="none">
              <S fg={theme.subtext0}>{(w.days === 365 ? "1 year" : `${w.days} days`).padEnd(LABEL)}</S>
              <S fg={theme.success}>{formatMoney(w.moneyIn).padStart(COL)}</S>
              <S fg={theme.error}>{formatMoney(w.moneyOut).padStart(COL)}</S>
            </text>
          )}
        </For>
        <text> </text>
        <text wrapMode="none" fg={theme.overlay1}>{"Monthly · 12 months"}</text>
        <For each={monthsIn()}>{(r, i) => <text wrapMode="none"><S fg={theme.overlay1}>{i() === monthsIn().length - 1 ? "In  " : "    "}</S><Runs runs={r} /></text>}</For>
        <For each={monthsOut()}>{(r, i) => <text wrapMode="none"><S fg={theme.overlay1}>{i() === monthsOut().length - 1 ? "Out " : "    "}</S><Runs runs={r} /></text>}</For>
        <Show when={stats().history.length}>
          <text> </text>
          <text wrapMode="none" fg={theme.overlay1}>{`Balance · 1 year  ${shortMoney(balance().min)}–${shortMoney(balance().max)}`}</text>
          <For each={balance().rows}>{(r) => <text wrapMode="none"><Runs runs={r} /></text>}</For>
        </Show>
        <Show when={stats().interest.latest}>
          <text> </text>
          {row(`Interest`, `${formatMoney(stats().interest.thisYear)} this year`, theme.success)}
          <Show when={stats().interest.impliedAnnualRatePct != null}>
            {row("Rate", `≈${stats().interest.impliedAnnualRatePct!.toFixed(2)}% p.a.`)}
          </Show>
        </Show>
        <Show when={stats().topOutflows.length}>
          <text> </text>
          <text wrapMode="none" fg={theme.overlay1}>{"Top outflows · 90 days"}</text>
          <For each={stats().topOutflows}>
            {(o) => (
              <text wrapMode="none">
                <S fg={theme.text}>{fit(o.description, WIDTH - 12)}</S>
                <S fg={theme.error}>{formatMoney(o.amount).padStart(12)}</S>
              </text>
            )}
          </For>
        </Show>
      </Show>
    </SectionCard>
  )
}

/** Chart runs whose inks are colours. */
function Runs(props: { runs: Run[] }) {
  return <For each={props.runs}>{(run) => <S fg={run.ink ?? undefined}>{run.text}</S>}</For>
}
