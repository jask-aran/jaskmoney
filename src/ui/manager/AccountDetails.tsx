import { For, Show, createMemo } from "solid-js"
import { SectionCard } from "../primitives/SectionCard"
import { S } from "../primitives/S"
import { data } from "../../state/dataStore"
import { theme } from "../../theme"
import { formatMoney } from "../../domain/dashboard"
import { computeAccountStats } from "../../domain/accountStats"
import { selectedAccounts, selectionLabel } from "../../domain/accountTree"
import { fit } from "../text"
import { barChart, levelChart } from "../dashboard/charts"

/** Inner width of the sidebar cards (SIDEBAR_WIDTH − border − padding). */
const WIDTH = 32
const LABEL = 10
const COL = 11

/** Statistics for the Manager's selected account(s), under the account list. */
export function AccountDetails() {
  const accounts = createMemo(() => selectedAccounts(data.state.accounts, data.state.accountSelection))
  const stats = createMemo(() => computeAccountStats(accounts(), data.state.transactions, localTodayISO()))
  const monthsIn = createMemo(() => barChart(stats().monthly.map((m) => m.moneyIn), WIDTH - 4, 2))
  const monthsOut = createMemo(() => barChart(stats().monthly.map((m) => m.moneyOut), WIDTH - 4, 2))
  const balance = createMemo(() => levelChart(stats().history.map((h) => h.value), WIDTH, 3))
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
        <For each={monthsIn()}>{(r, i) => <text wrapMode="none"><S fg={theme.overlay1}>{i() === monthsIn().length - 1 ? "In  " : "    "}</S><S fg={theme.success}>{r}</S></text>}</For>
        <For each={monthsOut()}>{(r, i) => <text wrapMode="none"><S fg={theme.overlay1}>{i() === monthsOut().length - 1 ? "Out " : "    "}</S><S fg={theme.error}>{r}</S></text>}</For>
        <Show when={stats().history.length}>
          <text> </text>
          <text wrapMode="none" fg={theme.overlay1}>{`Balance · 1 year  ${shortMoney(balance().min)}–${shortMoney(balance().max)}`}</text>
          <For each={balance().rows}>{(r) => <text wrapMode="none" fg={theme.lavender}>{r}</text>}</For>
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

function shortMoney(n: number): string {
  const a = Math.abs(n)
  const sign = n < 0 ? "-" : ""
  if (a >= 10000) return `${sign}$${Math.round(a / 1000)}k`
  if (a >= 1000) return `${sign}$${(a / 1000).toFixed(1)}k`
  return `${sign}$${Math.round(a)}`
}

function localTodayISO(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
}
