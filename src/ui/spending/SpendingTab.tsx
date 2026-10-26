import { For, Show, createEffect, createMemo } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { SectionCard } from "../primitives/SectionCard"
import { S } from "../primitives/S"
import { BALANCE_VIEWS, TRACKER_VIEWS, ui, type SectionId } from "../../state/uiStore"
import { data } from "../../state/dataStore"
import { theme } from "../../theme"
import { computeCategorySpend, dailySpendSeries, fitCategoryLines, formatPct, formatWholeMoney, groupCategorySpend } from "../../domain/dashboard"
import { computePeriodFlows } from "../../domain/position"
import { merchantSummaries, spendingCalendar, type CalendarDay } from "../../domain/spending"
import { LOOKBACKS, PERIODS, PERIOD_LABEL, activeChipIndex, comparisonWindows, dataClock, filterByTimeframe, timeframeBounds, toISODate } from "../../domain/timeframe"
import { fit, shortDate } from "../text"
import { spendingScope } from "../../domain/accountTree"
import { AXIS, ChartBody } from "../charts/ChartBody"
import { INKS, balancesChart, spendingChart } from "./periodCharts"

/** Calendar cell colours by spending level (0 = none). */
const LEVEL_BG = [theme.surface0, "#5b4636", "#8c6146", "#c47f55", theme.peach] as const
const WEEKDAYS = ["Mon", "", "Wed", "", "Fri", "", "Sun"]

/**
 * Everything over a chosen period: the Date Range with its flows, the spending
 * tracker and balances charts (each with views), categories, a calendar of
 * daily spending, and merchants. Spending figures cover the selected spending
 * account (see spendingScope); internal transfers and not-spending categories
 * are excluded.
 */
export function SpendingTab(props: { focused: SectionId }) {
  const dims = useTerminalDimensions()
  const today = () => toISODate(new Date())
  const clock = createMemo(() => dataClock(data.state.transactions))
  const bounds = createMemo(() => timeframeBounds(ui.state.timeframe, clock()))
  const scope = createMemo(() => spendingScope(data.state.accounts, data.state.accountSelection))
  const scopeIds = createMemo(() => new Set(scope().accounts.map((a) => a.id)))
  // Compare like with like: the period so far against the same days of the
  // previous period.
  const windows = createMemo(() => comparisonWindows(bounds().start, bounds().end, today()))
  const previous = () => windows().previous
  const spending = createMemo(() => data.state.transactions.filter((t) => t.accountId != null && scopeIds().has(t.accountId)))
  const inPeriod = createMemo(() => filterByTimeframe(spending(), ui.state.timeframe, clock()))
  const inPrevious = createMemo(() => spending().filter((t) => t.dateISO >= previous().start && t.dateISO <= previous().end))
  // Flows see every tracked account (money moved to savers), narrowed to the
  // scope for spending and income.
  const flows = createMemo(() => computePeriodFlows(data.state.accounts, filterByTimeframe(data.state.transactions, ui.state.timeframe, clock()), scopeIds()))
  const previousFlows = createMemo(() => computePeriodFlows(data.state.accounts, inPrevious(), scopeIds()))
  const groups = createMemo(() => groupCategorySpend(computeCategorySpend(inPeriod(), data.state.categories), data.state.categories))
  const merchants = createMemo(() => merchantSummaries(spending(), bounds().start, bounds().end, previous()))
  const calendar = createMemo(() => spendingCalendar(inPeriod(), bounds().start, bounds().end))
  const series = createMemo(() => dailySpendSeries(inPeriod(), bounds().start, bounds().end))

  // Fixed rows: tab bar + gap (2), status + footer (2), Date Range (4). The
  // charts row takes 40% of the rest (12–20 rows; dropped when short), then
  // categories beside the calendar and merchants.
  const bodyHeight = () => Math.max(8, dims().height - 8)
  const showCharts = () => bodyHeight() >= 30
  const chartsHeight = () => (showCharts() ? Math.max(12, Math.min(20, Math.floor(bodyHeight() * 0.4))) : 0)
  const lowerHeight = () => bodyHeight() - chartsHeight()
  // Chart cards split the width; each spends 4 cells on border + padding.
  const trackerWidth = () => Math.floor((dims().width - 1) / 2)
  const trackerPlot = () => Math.max(1, trackerWidth() - 4 - AXIS)
  const balancesPlot = () => Math.max(1, dims().width - 1 - trackerWidth() - 5 - AXIS)
  const trackerView = () => TRACKER_VIEWS[ui.state.trackerView] ?? TRACKER_VIEWS[0]
  const balanceView = () => BALANCE_VIEWS[ui.state.balanceView] ?? BALANCE_VIEWS[0]
  // Card rows less border (2), x labels and summary.
  const trackerModel = createMemo(() => spendingChart(trackerView(), series(), trackerPlot(), Math.max(1, chartsHeight() - 4), today(), spending()))
  const balancesModel = createMemo(() => balancesChart(balanceView(), series().dates, balancesPlot(), Math.max(1, chartsHeight() - 4), today(), data.state.accounts, data.state.transactions))

  const leftWidth = () => Math.floor((dims().width - 1) * 0.42)
  // Right column inner width: border + padding (4) and a cell of rounding slack.
  const rightInner = () => dims().width - 1 - leftWidth() - 5
  // Calendar: label column (4) then one column per week, 2–6 cells wide;
  // long periods show the latest weeks that fit at the minimum width.
  const calendarWeeks = createMemo(() => calendar().slice(-Math.max(1, Math.floor((rightInner() - 4) / 2))))
  const cellWidth = () => Math.max(2, Math.min(6, Math.floor((rightInner() - 4) / Math.max(1, calendarWeeks().length))))
  const merchantRows = () => Math.max(1, lowerHeight() - 11 - 3)
  createEffect(() => {
    const n = merchantRows()
    const cur = ui.state.merchantCursor
    if (cur >= merchants().length && merchants().length) ui.setState({ merchantCursor: merchants().length - 1 })
    if (cur < ui.state.merchantTop) ui.setState({ merchantTop: cur })
    else if (cur >= ui.state.merchantTop + n) ui.setState({ merchantTop: cur - n + 1 })
  })
  // Total (9), count (4), average (9), change (8), last seen (7).
  const merchantNameWidth = () => Math.max(10, rightInner() - 9 - 4 - 9 - 8 - 7)

  // Go narrow fallback: the preset chips keep priority and the timeframe
  // label is shown only when both fit on the card's single content line.
  const presetsWidth =
    "Presets ".length +
    LOOKBACKS.reduce((n, lb) => n + lb.length + 3, 0) +
    " | ".length +
    PERIODS.reduce((n, p) => n + PERIOD_LABEL[p].length + 3, 0)
  const showTimeframe = () => dims().width - 4 >= presetsWidth + 2 + `Timeframe ${bounds().label}`.length
  const dateFocused = () => props.focused === "spend.date"
  const chipCursor = () => (dateFocused() ? ui.state.dashChipCursor : activeChipIndex(ui.state.timeframe))
  const chip = (label: string, idx: number, active: boolean) => {
    const cur = () => chipCursor() === idx && dateFocused()
    return (
      <S fg={active ? theme.accent : theme.overlay1} bg={cur() ? theme.surface0 : undefined} bold={active}>
        {cur() ? ">" : " "}[{label}]
      </S>
    )
  }

  return (
    <box width="100%" height="100%" flexDirection="column" backgroundColor={theme.canvas}>
      <SectionCard title="Date Range" titleSuffix={`· ${scope().label}`} titleSuffixColor={theme.subtext0} focused={dateFocused()} height={4}>
        <box flexDirection="row" justifyContent="space-between" width="100%">
          <text fg={theme.subtext0} wrapMode="none">
            Presets{" "}
            <For each={LOOKBACKS}>
              {(lb, i) => chip(lb, i(), ui.state.timeframe.family === "lookback" && ui.state.timeframe.lookback === lb)}
            </For>
            <S fg={theme.overlay1}> | </S>
            <For each={PERIODS}>
              {(p, i) => chip(PERIOD_LABEL[p], LOOKBACKS.length + i(), ui.state.timeframe.family === "period" && ui.state.timeframe.period === p)}
            </For>
          </text>
          <Show when={showTimeframe()}>
            <text fg={theme.subtext0} flexShrink={0}>
              Timeframe <S fg={theme.peach}>{bounds().label}</S>
            </text>
          </Show>
        </box>
        <text wrapMode="none">
          <S fg={theme.subtext0}>{"Spent "}</S>
          <S fg={theme.text} bold>{formatWholeMoney(flows().spent)}</S>
          <S fg={changeColor(flows().spent, previousFlows().spent)}>{` ${changePct(flows().spent, previousFlows().spent)}`}</S>
          <S fg={theme.overlay1}>{` vs ${formatWholeMoney(previousFlows().spent)}`}</S>
          <S fg={theme.subtext0}>{"   Income "}</S>
          <S fg={theme.success}>{formatWholeMoney(flows().income)}</S>
          <S fg={theme.subtext0}>{"   Net "}</S>
          <S fg={flows().net >= 0 ? theme.success : theme.error}>{signedWhole(flows().net)}</S>
          <S fg={theme.subtext0}>{"   To savers "}</S>
          <S fg={flows().savedToSavers >= 0 ? theme.peach : theme.error}>{signedWhole(flows().savedToSavers)}</S>
          <S fg={theme.subtext0}>{"   Savings rate "}</S>
          <S fg={theme.peach}>{formatPct(flows().savingsRate)}</S>
          <S fg={theme.subtext0}>{"   Daily "}</S>
          <S fg={theme.text}>{formatWholeMoney(windows().days ? flows().spent / windows().days : 0)}</S>
          <S fg={theme.overlay1}>{`   ${flows().txnCount} txns`}</S>
        </text>
      </SectionCard>
      <Show when={showCharts()}>
        <box flexDirection="row" gap={1} width="100%" height={chartsHeight()}>
          <SectionCard title="Spending Tracker" titleSuffix={`· ${trackerView()}`} titleSuffixColor={theme.subtext0} width={trackerWidth()} height={chartsHeight()} focused={props.focused === "spend.tracker"}>
            <ChartBody model={trackerModel()} inks={INKS} />
          </SectionCard>
          <box flexGrow={1} flexBasis={0} minWidth={0} height={chartsHeight()} overflow="hidden">
            <SectionCard title="Balances" titleSuffix={`· ${balanceView()}`} titleSuffixColor={theme.subtext0} height={chartsHeight()} focused={props.focused === "spend.balances"}>
              <ChartBody model={balancesModel()} inks={INKS} />
            </SectionCard>
          </box>
        </box>
      </Show>
      <box flexDirection="row" gap={1} width="100%" height={lowerHeight()}>
        <SectionCard title="Categories" width={leftWidth()} height={lowerHeight()} focused={props.focused === "spend.categories"}>
          <Show when={groups().length} fallback={<text fg={theme.overlay1}>No spending in this period</text>}>
            <For each={fitCategoryLines(groups(), lowerHeight() - 2)}>
              {(line) => (
                <text wrapMode="none">
                  <S fg={line.child ? theme.subtext0 : line.color} bold={!line.child}>{fit(line.child ? `  ${line.label}` : line.label, leftWidth() - 4 - 14)}</S>
                  <S fg={line.child ? theme.subtext0 : theme.text} bold={!line.child}>{formatWholeMoney(line.amount).padStart(9)}</S>
                  <S fg={theme.overlay1}>{(line.pct != null ? `${Math.round(line.pct)}%` : "").padStart(5)}</S>
                </text>
              )}
            </For>
          </Show>
        </SectionCard>
        <box flexGrow={1} flexBasis={0} minWidth={0} height={lowerHeight()} flexDirection="column" overflow="hidden">
          <SectionCard title="Calendar" height={11}>
            <text wrapMode="none" fg={theme.overlay1}>{"    " + monthLabels(calendarWeeks(), cellWidth())}</text>
            <For each={WEEKDAYS}>
              {(label, row) => (
                <text wrapMode="none">
                  <S fg={theme.overlay1}>{label.padEnd(4)}</S>
                  <For each={calendarWeeks()}>
                    {(week) => <Cell day={week[row()] ?? null} width={cellWidth()} today={today()} />}
                  </For>
                </text>
              )}
            </For>
            <text wrapMode="none">
              <S fg={theme.overlay1}>{"    less "}</S>
              <For each={[0, 1, 2, 3, 4]}>{(level) => <S bg={LEVEL_BG[level]}>{"  "}</S>}</For>
              <S fg={theme.overlay1}>{" more"}</S>
            </text>
          </SectionCard>
          <SectionCard title="Merchants" focused={props.focused === "spend.merchants"} active={props.focused === "spend.merchants"} flexGrow={1}>
            <text wrapMode="none" fg={theme.overlay1}>
              {fit("Merchant", merchantNameWidth()) + "Total".padStart(9) + "#".padStart(4) + "Avg".padStart(9) + "vs prev".padStart(8) + "Last".padStart(7)}
            </text>
            <Show when={merchants().length} fallback={<text fg={theme.overlay1}>No spending in this period</text>}>
              <For each={merchants().slice(ui.state.merchantTop, ui.state.merchantTop + merchantRows())}>
                {(m, i) => {
                  const selected = () => props.focused === "spend.merchants" && ui.state.merchantTop + i() === ui.state.merchantCursor
                  const bg = () => (selected() ? theme.surface0 : theme.canvas)
                  return (
                    <text wrapMode="none" bg={bg()}>
                      <S fg={theme.text} bg={bg()} bold={selected()}>{fit(m.merchant, merchantNameWidth())}</S>
                      <S fg={theme.text} bg={bg()}>{formatWholeMoney(m.total).padStart(9)}</S>
                      <S fg={theme.subtext0} bg={bg()}>{String(m.count).padStart(4)}</S>
                      <S fg={theme.subtext0} bg={bg()}>{formatWholeMoney(m.average).padStart(9)}</S>
                      <S fg={changeColor(m.total, m.previousTotal)} bg={bg()}>{changePct(m.total, m.previousTotal).padStart(8)}</S>
                      <S fg={theme.overlay1} bg={bg()}>{shortDate(m.lastISO).padStart(7)}</S>
                    </text>
                  )
                }}
              </For>
            </Show>
          </SectionCard>
        </box>
      </box>
    </box>
  )
}

/** One day; a gap column keeps wide cells apart. Days after today are blank. */
function Cell(props: { day: CalendarDay | null; width: number; today: string }) {
  const filled = () => props.day != null && props.day.dateISO <= props.today
  return (
    <>
      <S bg={filled() ? LEVEL_BG[props.day!.level] : theme.canvas}>{" ".repeat(props.width > 2 ? props.width - 1 : props.width)}</S>
      {props.width > 2 ? <S bg={theme.canvas}>{" "}</S> : null}
    </>
  )
}

/** Three-letter month names over the week where each month starts; a name
 * may run over the following columns and is skipped if it would touch the
 * previous one. */
function monthLabels(weeks: Array<Array<CalendarDay | null>>, width: number): string {
  const out = new Array<string>(weeks.length * width).fill(" ")
  let last = ""
  let free = 0
  weeks.forEach((week, i) => {
    const month = (week.find((d) => d)?.dateISO ?? "").slice(5, 7)
    if (month && month !== last) {
      const pos = i * width
      if (pos >= free) {
        const name = MONTHS[Number(month) - 1]!
        for (let k = 0; k < name.length && pos + k < out.length; k++) out[pos + k] = name[k]!
        free = pos + name.length + 1
      }
    }
    last = month || last
  })
  return out.join("")
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** "+12%", "-8%", "new" (nothing before), "—" (nothing now or before). */
function changePct(now: number, before: number): string {
  if (before <= 0) return now > 0 ? "new" : "—"
  const pct = Math.round(((now - before) / before) * 100)
  return `${pct > 0 ? "+" : ""}${pct}%`
}

/** More spending than before is red, less is green. */
function changeColor(now: number, before: number): string {
  if (before <= 0 || Math.abs(now - before) < 0.005) return theme.overlay1
  return now > before ? theme.error : theme.success
}

function signedWhole(n: number): string {
  return n > 0 ? `+${formatWholeMoney(n)}` : formatWholeMoney(n)
}
