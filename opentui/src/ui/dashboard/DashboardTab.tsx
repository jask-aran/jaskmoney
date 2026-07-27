import { For, createMemo } from "solid-js"
import { SectionCard } from "../primitives/SectionCard"
import { S } from "../primitives/S"
import { ui, type SectionId } from "../../state/uiStore"
import { data } from "../../state/dataStore"
import { theme } from "../../theme"
import {
  barFill,
  computeCategorySpend,
  computeOverview,
  dailySpendSeries,
  formatMoney,
  formatPct,
  formatRunway,
  sparkline,
} from "../../domain/dashboard"
import {
  LOOKBACKS,
  PERIODS,
  PERIOD_LABEL,
  activeChipIndex,
  dataClock,
  filterByTimeframe,
  timeframeBounds,
} from "../../domain/timeframe"

export function DashboardTab(props: { focused: SectionId }) {
  const clock = createMemo(() => dataClock(data.state.transactions))
  const bounds = createMemo(() => timeframeBounds(ui.state.timeframe, clock()))
  const scoped = createMemo(() => {
    const byAcct = data.accountScoped()
    return filterByTimeframe(byAcct, ui.state.timeframe, clock())
  })
  const stats = createMemo(() => computeOverview(scoped()))
  const cats = createMemo(() =>
    computeCategorySpend(scoped(), data.state.categories).slice(0, 10),
  )
  const series = createMemo(() => {
    const b = bounds()
    return dailySpendSeries(scoped(), b.start, b.end)
  })
  const spark = createMemo(() => sparkline(series().values, 56))

  const dateFocused = () => props.focused === "dash.date"
  const chipCursor = () =>
    dateFocused() ? ui.state.dashChipCursor : activeChipIndex(ui.state.timeframe)

  return (
    <box width="100%" height="100%" flexDirection="column" gap={0} backgroundColor={theme.base}>
      <SectionCard title="Date Range" focused={dateFocused()} height={3}>
        <box flexDirection="row" justifyContent="space-between" width="100%">
          <text fg={theme.subtext0}>
            Presets{" "}
            <For each={LOOKBACKS}>
              {(lb, i) => {
                const idx = () => i()
                const active = () =>
                  ui.state.timeframe.family === "lookback" &&
                  ui.state.timeframe.lookback === lb
                const cur = () => chipCursor() === idx()
                return (
                  <S
                    fg={active() ? theme.accent : theme.overlay1}
                    bg={cur() && dateFocused() ? theme.surface0 : undefined}
                    bold={active()}
                  >
                    {cur() && dateFocused() ? ">" : " "}[{lb}]
                  </S>
                )
              }}
            </For>
            <S fg={theme.overlay1}> | </S>
            <For each={PERIODS}>
              {(p, i) => {
                const idx = () => LOOKBACKS.length + i()
                const active = () =>
                  ui.state.timeframe.family === "period" && ui.state.timeframe.period === p
                const cur = () => chipCursor() === idx()
                return (
                  <S
                    fg={active() ? theme.accent : theme.overlay1}
                    bg={cur() && dateFocused() ? theme.surface0 : undefined}
                    bold={active()}
                  >
                    {cur() && dateFocused() ? ">" : " "}[{PERIOD_LABEL[p]}]
                  </S>
                )
              }}
            </For>
          </text>
          <text fg={theme.subtext0}>
            Timeframe <S fg={theme.peach}>{bounds().label}</S>
          </text>
        </box>
      </SectionCard>

      <SectionCard title="Overview" height={6}>
        <text>
          <S fg={theme.subtext0}>Balance      </S>
          <S fg={stats().balance >= 0 ? theme.success : theme.error}>
            {formatMoney(stats().balance).padEnd(18)}
          </S>
          <S fg={theme.subtext0}>
            Uncat {stats().uncatCount} ({formatMoney(stats().uncatTotal)})
          </S>
        </text>
        <text>
          <S fg={theme.subtext0}>Debits       </S>
          <S fg={theme.error}>{formatMoney(stats().debits).padEnd(18)}</S>
          <S fg={theme.subtext0}>Transactions {stats().txnCount}</S>
        </text>
        <text>
          <S fg={theme.subtext0}>Credits      </S>
          <S fg={theme.success}>{formatMoney(stats().credits).padEnd(18)}</S>
          <S fg={theme.subtext0}>
            Daily Burn {stats().dailyBurn != null ? formatMoney(stats().dailyBurn!) : "—"}
          </S>
        </text>
        <text>
          <S fg={theme.subtext0}>Savings Rate </S>
          <S fg={theme.peach}>{formatPct(stats().savingsRate).padEnd(18)}</S>
          <S fg={theme.subtext0}>Runway {formatRunway(stats().runwayDays)}</S>
        </text>
      </SectionCard>

      <box flexDirection="row" flexGrow={1} gap={1} width="100%">
        <box flexGrow={3} height="100%">
          <SectionCard title="Spending Tracker" flexGrow={1} height="100%">
            <text fg={theme.peach}>{spark()}</text>
            <text fg={theme.overlay1}>
              {bounds().start} → {bounds().end} · max day{" "}
              {formatMoney(Math.max(0, ...series().values, 0))}
            </text>
            <text fg={theme.overlay1}>
              {stats().txnCount} txns in scope (block sparkline · braille later)
            </text>
          </SectionCard>
        </box>
        <box flexGrow={2} height="100%" flexDirection="column" gap={0}>
          <SectionCard title="Spending by Category" flexGrow={1}>
            {cats().length === 0 ? (
              <text fg={theme.overlay1}>No spend in range</text>
            ) : (
              <For each={cats()}>
                {(c) => (
                  <text>
                    <S fg={c.color}>{truncate(c.name, 14).padEnd(15)}</S>
                    <S fg={c.color}>{barFill(c.pct, 12)}</S>
                    <S fg={theme.subtext0}>
                      {" "}
                      {Math.round(c.pct).toString().padStart(3)}% {formatMoney(c.amount)}
                    </S>
                  </text>
                )}
              </For>
            )}
          </SectionCard>
          <SectionCard
            title="Composition [C] · Category Share"
            focused={props.focused === "dash.composition"}
            flexGrow={1}
          >
            {cats().length === 0 ? (
              <text fg={theme.overlay1}>—</text>
            ) : (
              <For each={cats().slice(0, 8)}>
                {(c) => (
                  <text>
                    <S fg={c.color}>{truncate(c.name, 14).padEnd(15)}</S>
                    <S fg={c.color}>{barFill(c.pct, 10)}</S>
                    <S fg={theme.subtext0}>
                      {" "}
                      {Math.round(c.pct).toString().padStart(3)}%
                    </S>
                  </text>
                )}
              </For>
            )}
          </SectionCard>
        </box>
      </box>

      <SectionCard
        title="Cashflow [N] · Net Worth"
        focused={props.focused === "dash.cashflow"}
        height={4}
      >
        <text fg={theme.overlay1}>
          Balance {formatMoney(stats().balance)} · credits {formatMoney(stats().credits)} ·
          debits {formatMoney(stats().debits)}
        </text>
        <text fg={theme.overlay1}>Net series chart deferred (sparkline above covers spend).</text>
      </SectionCard>
    </box>
  )
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s
  return s.slice(0, Math.max(0, n - 1)) + "…"
}
