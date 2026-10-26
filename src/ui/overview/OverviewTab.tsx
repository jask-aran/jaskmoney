import { For, Show, createEffect, createMemo } from "solid-js"
import { categoryMark, viewMark } from "../icons"
import { useTerminalDimensions } from "@opentui/solid"
import { SectionCard, type Span } from "../primitives/SectionCard"
import { S } from "../primitives/S"
import { CHART_VIEWS, ui, type SectionId } from "../../state/uiStore"
import { data } from "../../state/dataStore"
import { theme } from "../../theme"
import { computeCategorySpend, dailySpendSeries, fitCategoryLines, formatMoney, formatPct, formatWholeMoney, groupCategorySpend } from "../../domain/dashboard"
import { computePeriodFlows, computePosition } from "../../domain/position"
import { budgetProgress, cycleFor, type BudgetProgress } from "../../domain/budget"
import { spendingCalendar, type CalendarDay } from "../../domain/spending"
import { LOOKBACKS, PERIODS, PERIOD_LABEL, activeChipIndex, comparisonWindows, dataClock, filterByTimeframe, timeframeBounds, toISODate } from "../../domain/timeframe"
import { fit } from "../text"
import { spendingScope } from "../../domain/accountTree"
import { AXIS_GUESS, ChartBody, axisWidth, type ChartModel } from "../charts/ChartBody"
import { INKS, addDays, balancesChart, cashFlowChart, spendingChart, type PeriodNames } from "./periodCharts"

/** Calendar cell colours by spending level (0 = none). */
const LEVEL_BG = [theme.surface0, "#5b4636", "#8c6146", "#c47f55", theme.peach] as const
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

/** Below this width the chart pane spans the tab with categories below it;
 * at or above it, categories take a right-hand column. */
const WIDE = 120
/** The categories column's widest useful size: Up's longest names fit. */
const SIDE_MAX = 48
/** Stack columns: value and note widths; the label takes the rest. */
const VALUE = 12
const NOTE = 11
/** Savers fold to their total before Categories drop under this many rows. */
const MIN_CATEGORIES = 8

/**
 * The overview: the Date Range (opens on the current budget cycle), two chart
 * panes cycling through spending, cash flow, balance and calendar views (h/l
 * the top or focused pane, H/L the bottom), and a column of stacks: Now
 * (figures with no range), Savers, Totals (the range against the same days of
 * the previous period, with the overall budget when the range is the current
 * cycle) and Categories. Spending figures cover the selected spending account
 * (see spendingScope); internal transfers and not-spending categories are
 * excluded.
 */
export function OverviewTab(props: { focused: SectionId }) {
  const dims = useTerminalDimensions()
  const today = () => toISODate(new Date())
  const clock = createMemo(() => dataClock(data.state.transactions))
  const cycleConfig = () => data.state.budgetCycle
  const bounds = createMemo(() => timeframeBounds(ui.state.timeframe, clock(), cycleConfig()))
  const scope = createMemo(() => spendingScope(data.state.accounts, data.state.accountSelection))
  const scopeIds = createMemo(() => new Set(scope().accounts.map((a) => a.id)))
  // Compare like with like: the period so far against the same days of the
  // previous period.
  const windows = createMemo(() => comparisonWindows(bounds().start, bounds().end, today()))
  const previous = () => windows().previous
  const spending = createMemo(() => data.state.transactions.filter((t) => t.accountId != null && scopeIds().has(t.accountId)))
  const inPeriod = createMemo(() => filterByTimeframe(spending(), ui.state.timeframe, clock(), cycleConfig()))
  const inPrevious = createMemo(() => data.state.transactions.filter((t) => t.dateISO >= previous().start && t.dateISO <= previous().end))
  // Flows see every tracked account (money moved to savers), narrowed to the
  // scope for spending and income.
  const flows = createMemo(() => computePeriodFlows(data.state.accounts, filterByTimeframe(data.state.transactions, ui.state.timeframe, clock(), cycleConfig()), scopeIds()))
  const previousFlows = createMemo(() => computePeriodFlows(data.state.accounts, inPrevious(), scopeIds()))
  const groups = createMemo(() => groupCategorySpend(computeCategorySpend(inPeriod(), data.state.categories), data.state.categories))
  const calendar = createMemo(() => spendingCalendar(inPeriod(), bounds().start, bounds().end))
  const series = createMemo(() => dailySpendSeries(inPeriod(), bounds().start, bounds().end))

  // Now: point-in-time figures, whatever the range.
  const position = createMemo(() => computePosition(data.state.accounts, data.state.transactions, today()))
  const saverChanges = createMemo(() => {
    const since = addDays(today(), -30)
    return computePeriodFlows(data.state.accounts, data.state.transactions.filter((t) => t.dateISO > since && t.dateISO <= today())).saverChanges
  })
  const change30 = () => {
    const h = position().history
    return h.length >= 31 ? h[h.length - 1]!.value - h[h.length - 31]!.value : 0
  }
  // The overall budget applies while the range is the current cycle.
  const budget = createMemo(() => {
    const overall = data.state.budgets.find((b) => b.scope.kind === "overall")
    const current = cycleFor(cycleConfig(), today())
    if (!overall || bounds().start !== current.start || bounds().end !== current.end) return null
    return budgetProgress([overall], cycleConfig(), today(), data.state.accounts, data.state.categories, data.state.transactions)[0] ?? null
  })

  // What the range and the one before it are called in chart labels.
  const periodNames = (): PeriodNames => {
    const tf = ui.state.timeframe
    if (tf.family === "lookback") return { current: "Range", previous: "Before" }
    const unit = PERIOD_UNIT[tf.period]
    return { current: `This ${unit}`, previous: `Last ${unit}` }
  }

  // Fixed rows: tab bar + gap (2), status + footer (2), Date Range (3).
  // Wide: two chart panes share the left column; the right column (up to
  // SIDE_MAX wide) stacks Now, Savers, Totals and Categories. Narrow: the
  // top chart spans the tab, with Now and Savers beside Totals and
  // Categories below it.
  const wide = () => dims().width >= WIDE
  const bodyHeight = () => Math.max(8, dims().height - 7)
  const sideWidth = () => (wide() ? Math.min(SIDE_MAX, Math.floor((dims().width - 1) * 0.4)) : Math.floor((dims().width - 1) / 2))
  const mainWidth = () => (wide() ? dims().width - 1 - sideWidth() : dims().width)
  const topChartHeight = () => (wide() ? Math.ceil(bodyHeight() / 2) : Math.max(8, Math.floor(bodyHeight() * 0.45)))
  const bottomChartHeight = () => bodyHeight() - topChartHeight()
  const lowerHeight = () => bodyHeight() - topChartHeight()

  // The stacks: label, value (VALUE) and a note or comparison (NOTE).
  const nowRows = () => 4 + (position().pendingCount > 0 ? 1 : 0)
  const totalsRows = () => 8 + (budget() ? (budget()!.remaining > 0 ? 2 : 1) : 0)
  // Savers fold to their total when Categories would get under
  // MIN_CATEGORIES rows.
  const saverRows = (full: boolean) => (full ? 2 + position().savers.length : 1)
  const stackSpace = () => (wide() ? bodyHeight() : lowerHeight())
  const saversFull = () =>
    wide()
      ? stackSpace() - (nowRows() + 2) - (totalsRows() + 2) - (saverRows(true) + 2) >= MIN_CATEGORIES + 2
      : stackSpace() - (nowRows() + 2) >= saverRows(true) + 2
  const categoriesHeight = () =>
    wide()
      ? Math.max(3, bodyHeight() - (nowRows() + 2) - (saverRows(saversFull()) + 2) - (totalsRows() + 2))
      : Math.max(3, lowerHeight() - (totalsRows() + 2))
  const stackWidth = () => sideWidth() - 4
  const labelWidth = () => Math.max(6, stackWidth() - VALUE - NOTE)

  // Chart panes: border + padding (4) across; border (2) and the x labels
  // down. The view picker and the legend sit in the borders.
  // The y-axis is as wide as its labels: build once with a guessed width,
  // then again if the labels need a different one.
  const model = (index: number, height: number): ChartModel | null => {
    const v = (CHART_VIEWS[index] ?? CHART_VIEWS[0]).view
    const rows = Math.max(1, height - 3)
    const build = (axis: number): ChartModel | null => {
      const width = Math.max(1, mainWidth() - 4 - axis)
      if (v === "Daily" || v === "Cumulative" || v === "Weekly") return spendingChart(v, series(), width, rows, today(), spending(), budget()?.budget.amount, periodNames())
      if (v === "Cash flow") return cashFlowChart(series().dates, width, rows, today(), data.state.accounts, data.state.transactions, scopeIds())
      if (v === "Calendar") return null
      return balancesChart(v, series().dates, width, rows, today(), data.state.accounts, data.state.transactions)
    }
    const first = build(AXIS_GUESS)
    if (!first || first.ticks.size === 0 || axisWidth(first.ticks) === AXIS_GUESS) return first
    return build(axisWidth(first.ticks))
  }
  const topModel = createMemo(() => model(ui.state.chartViews[0], topChartHeight()))
  const bottomModel = createMemo(() => (wide() ? model(ui.state.chartViews[1], bottomChartHeight()) : null))

  // Category lines: name, then amount (9) and share (5).
  const categoryNameWidth = () => Math.max(8, sideWidth() - 5 - 14)

  // Go narrow fallback: the preset chips keep priority and the timeframe
  // label is shown only when both fit on the card's single content line.
  const presetsWidth =
    LOOKBACKS.reduce((n, lb) => n + lb.length + 3, 0) +
    " │".length +
    PERIODS.reduce((n, p) => n + PERIOD_LABEL[p].length + 3, 0)
  const showTimeframe = () => dims().width - 4 >= presetsWidth + 2 + bounds().label.length
  const dateFocused = () => props.focused === "ov.range"
  const chipCursor = () => (dateFocused() ? ui.state.dashChipCursor : activeChipIndex(ui.state.timeframe))
  // `active` is a function: For runs its callback once per chip, so a plain
  // boolean would keep the first render's value.
  const chip = (label: string, idx: number, active: () => boolean) => {
    const cur = () => chipCursor() === idx && dateFocused()
    return (
      <S fg={active() ? theme.accent : theme.overlay1} bg={cur() ? theme.surface0 : undefined} bold={active()}>
        {cur() ? ">" : " "}[{label}]
      </S>
    )
  }

  const stat = (label: string, value: string, note = "", colors: { value?: string; note?: string; bold?: boolean } = {}) => (
    <text wrapMode="none">
      <S fg={theme.subtext0} bold={colors.bold}>{fit(label, labelWidth())}</S>
      <S fg={colors.value ?? theme.text} bold={colors.bold}>{value.padStart(VALUE)}</S>
      <S fg={colors.note ?? theme.overlay1}>{note.padStart(NOTE)}</S>
    </text>
  )
  const signColor = (n: number) => (n > 0.005 ? theme.success : n < -0.005 ? theme.error : theme.overlay1)

  const nowCard = () => (
    <SectionCard title="Now" width={sideWidth()} height={nowRows() + 2}>
      {stat("Net position", position().netPosition != null ? formatMoney(position().netPosition!) : "—", "", { bold: true })}
      {stat("Available", position().spendingBalance != null ? formatMoney(position().spendingBalance!) : "—")}
      <Show when={position().pendingCount > 0}>
        {stat("  pending", formatMoney(Math.abs(position().pendingAmount)), `${position().pendingCount} txn`, { value: theme.overlay1 })}
      </Show>
      {stat("Runway", position().runwayDays != null ? `${Math.round(position().runwayDays!)} days` : "—", position().dailySpend != null ? `${formatWholeMoney(position().dailySpend!)}/day` : "", { value: theme.peach })}
      {stat("30 day change", signedWhole(change30()), "", { value: signColor(change30()) })}
    </SectionCard>
  )

  const saverChange = (accountId: number) => saverChanges().find((c) => c.accountId === accountId)?.change ?? 0
  const saversTotalChange = () => saverChanges().reduce((sum, c) => sum + c.change, 0)
  const saversCard = () => (
    <SectionCard title="Savers" width={sideWidth()} height={saverRows(saversFull()) + 2}>
      <Show when={saversFull()}>
        <text wrapMode="none" fg={theme.overlay1}>{" ".repeat(labelWidth()) + "Balance".padStart(VALUE) + "30 days".padStart(NOTE)}</text>
        <For each={position().savers}>
          {(saver) => stat(saver.name, formatWholeMoney(saver.balance), signedWhole(saverChange(saver.accountId)), { note: signColor(saverChange(saver.accountId)) })}
        </For>
      </Show>
      {stat("Total", formatWholeMoney(position().saversTotal), signedWhole(saversTotalChange()), { bold: true, note: signColor(saversTotalChange()) })}
    </SectionCard>
  )

  // Totals: the range against the same days of the previous period.
  const daily = (spent: number) => formatWholeMoney(windows().days ? spent / windows().days : 0)
  const totalsCard = () => (
    <SectionCard title="Totals" width={sideWidth()} height={totalsRows() + 2}>
      <text wrapMode="none" fg={theme.overlay1}>{" ".repeat(labelWidth()) + "Range".padStart(VALUE) + "Before".padStart(NOTE)}</text>
      {stat("Spent", formatWholeMoney(flows().spent), formatWholeMoney(previousFlows().spent), { value: changeColor(flows().spent, previousFlows().spent) })}
      {stat("Income", formatWholeMoney(flows().income), formatWholeMoney(previousFlows().income))}
      {stat("Net", signedWhole(flows().net), signedWhole(previousFlows().net), { value: signColor(flows().net) })}
      {stat("To savers", signedWhole(flows().savedToSavers), signedWhole(previousFlows().savedToSavers), { value: signColor(flows().savedToSavers) })}
      {stat("Savings rate", formatPct(flows().savingsRate), formatPct(previousFlows().savingsRate))}
      {stat("Daily", daily(flows().spent), daily(previousFlows().spent))}
      {stat("Transactions", String(flows().txnCount), String(previousFlows().txnCount))}
      <Show when={budget()}>
        {(p: () => BudgetProgress) => (
          <>
            {stat("Budget", formatWholeMoney(p().budget.amount), `${Number.isFinite(p().usedPct) ? Math.round(p().usedPct) : "—"}% used`, {
              note: p().usedPct > 100 ? theme.error : p().usedPct >= 80 ? theme.warning : theme.success,
            })}
            <Show when={p().remaining > 0}>{stat("  left", formatWholeMoney(p().remaining), `${formatWholeMoney(p().dailyAllowance)}/day`)}</Show>
          </>
        )}
      </Show>
    </SectionCard>
  )

  const categoriesCard = () => (
    <SectionCard title="Categories" width={sideWidth()} height={categoriesHeight()} focused={props.focused === "ov.categories"}>
      <Show when={groups().length} fallback={<text fg={theme.overlay1}>No spending in this period</text>}>
        <For each={fitCategoryLines(groups(), categoriesHeight() - 2)}>
          {(line) => (
            <text wrapMode="none">
              <S fg={line.color}>{line.child ? "  " : ""}{`${categoryMark(line.categoryId)} `}</S>
              <S fg={line.child ? theme.subtext0 : line.color} bold={!line.child}>{fit(line.label, -(line.child ? 4 : 2) + categoryNameWidth())}</S>
              <S fg={line.child ? theme.subtext0 : theme.text} bold={!line.child}>{formatWholeMoney(line.amount).padStart(9)}</S>
              <S fg={theme.overlay1}>{(line.pct != null ? `${Math.round(line.pct)}%` : "").padStart(5)}</S>
            </text>
          )}
        </For>
      </Show>
    </SectionCard>
  )

  const chartPane = (pane: 0 | 1, height: number, chart: ChartModel | null) => {
    const index = ui.state.chartViews[pane]
    const view = CHART_VIEWS[index] ?? CHART_VIEWS[0]
    return (
      <SectionCard
        title={view.group}
        titleSuffix={view.group === view.view ? undefined : `· ${view.view}`}
        titleSuffixColor={theme.subtext0}
        titleRight={viewPicker(index)}
        bottomSpans={chart ? chart.legend : calendarLegend(calendar(), today())}
        width={mainWidth()}
        height={height}
        focused={props.focused === (pane === 0 ? "ov.chart" : "ov.chart2")}
      >
        <Show when={chart} fallback={<CalendarView weeks={calendar()} width={mainWidth() - 4} rows={height - 2} today={today()} />}>
          {(m: () => ChartModel) => <ChartBody model={m()} inks={INKS} />}
        </Show>
      </SectionCard>
    )
  }

  return (
    <box width="100%" height="100%" flexDirection="column" backgroundColor={theme.canvas}>
      <SectionCard title="Date Range" titleSuffix={`· ${scope().label}`} titleSuffixColor={theme.subtext0} focused={dateFocused()} height={3}>
        <box flexDirection="row" justifyContent="space-between" width="100%">
          <text fg={theme.subtext0} wrapMode="none">
            <For each={LOOKBACKS}>
              {(lb, i) => chip(lb, i(), () => ui.state.timeframe.family === "lookback" && ui.state.timeframe.lookback === lb)}
            </For>
            <S fg={theme.surface2}>{" │"}</S>
            <For each={PERIODS}>
              {(p, i) => chip(PERIOD_LABEL[p], LOOKBACKS.length + i(), () => ui.state.timeframe.family === "period" && ui.state.timeframe.period === p)}
            </For>
          </text>
          <Show when={showTimeframe()}>
            <text fg={theme.peach} flexShrink={0}>{bounds().label}</text>
          </Show>
        </box>
      </SectionCard>
      <Show
        when={wide()}
        fallback={
          <>
            {chartPane(0, topChartHeight(), topModel())}
            <box flexDirection="row" gap={1} width="100%" height={lowerHeight()}>
              <box flexDirection="column" width={sideWidth()}>
                {nowCard()}
                <Show when={stackSpace() - (nowRows() + 2) >= 3}>{saversCard()}</Show>
              </box>
              <box flexDirection="column" flexGrow={1} minWidth={0}>
                {totalsCard()}
                {categoriesCard()}
              </box>
            </box>
          </>
        }
      >
        <box flexDirection="row" gap={1} width="100%" height={bodyHeight()}>
          <box flexDirection="column" width={mainWidth()} height={bodyHeight()}>
            {chartPane(0, topChartHeight(), topModel())}
            {chartPane(1, bottomChartHeight(), bottomModel())}
          </box>
          <box flexDirection="column" flexGrow={1} flexBasis={0} minWidth={0} height={bodyHeight()} overflow="hidden">
            {nowCard()}
            {saversCard()}
            {totalsCard()}
            {categoriesCard()}
          </box>
        </box>
      </Show>
    </box>
  )
}

/** The chart pane's views in h/l order as icons (dots when icons are off),
 * the current one bright; a space between groups. */
function viewPicker(current: number): Span[] {
  return CHART_VIEWS.flatMap((v, i) => [
    ...(i > 0 ? [{ text: CHART_VIEWS[i - 1]!.group !== v.group ? "  " : " ", fg: theme.overlay1 }] : []),
    { text: viewMark(v.view, i === current), fg: i === current ? theme.accent : theme.overlay0, bold: i === current },
  ])
}

const PERIOD_UNIT: Record<string, string> = { cycle: "cycle", month: "month", qtr: "quarter", half: "half", fy: "FY", year: "year" }

/** The calendar's legend for the pane's bottom border: the levels as
 * swatches, the no-spend days and the busiest weekday. */
function calendarLegend(weeks: Array<Array<CalendarDay | null>>, today: string): Span[] {
  const muted = (text: string): Span => ({ text, fg: theme.overlay1 })
  const days = weeks.flat().filter((d): d is CalendarDay => d != null && d.dateISO <= today)
  if (!days.length) return [muted("No days yet")]
  const noSpend = days.filter((d) => d.spent === 0).length
  const totals = [0, 0, 0, 0, 0, 0, 0], counts = [0, 0, 0, 0, 0, 0, 0]
  for (const week of weeks) week.forEach((d, i) => { if (d && d.dateISO <= today) { totals[i]! += d.spent; counts[i]!++ } })
  const avg = totals.map((t, i) => (counts[i] ? t / counts[i]! : 0))
  const busiest = avg.indexOf(Math.max(...avg))
  return [
    muted("less "),
    ...LEVEL_BG.map((fg): Span => ({ text: "■", fg })),
    muted(" more"),
    muted(`   ${noSpend} no-spend ${noSpend === 1 ? "day" : "days"}   busiest ${WEEKDAYS[busiest]}`),
  ]
}

/**
 * The period's days as a month grid: a column per week, a row band per
 * weekday (up to three rows each), cells as wide as fit (2–10). Wide cells
 * carry the day of the month; days after today are blank. Month labels on
 * top; the legend is in the pane's border (calendarLegend).
 */
function CalendarView(props: { weeks: Array<Array<CalendarDay | null>>; width: number; rows: number; today: string }) {
  // Rows: month labels, 7 weekday bands.
  const band = () => Math.max(1, Math.min(3, Math.floor((props.rows - 1) / 7)))
  const shown = () => props.weeks.slice(-Math.max(1, Math.floor((props.width - 4) / 2)))
  const cellWidth = () => Math.max(2, Math.min(10, Math.floor((props.width - 4) / Math.max(1, shown().length))))
  return (
    <>
      <text wrapMode="none" fg={theme.overlay1}>{"    " + monthLabels(shown(), cellWidth())}</text>
      <For each={WEEKDAYS}>
        {(label, row) => (
          <For each={Array.from({ length: band() }, (_, k) => k)}>
            {(line) => (
              <text wrapMode="none">
                <S fg={theme.overlay1}>{(line === 0 ? label : "").padEnd(4)}</S>
                <For each={shown()}>
                  {(week) => <Cell day={week[row()] ?? null} width={cellWidth()} today={props.today} label={line === 0} />}
                </For>
              </text>
            )}
          </For>
        )}
      </For>
    </>
  )
}

/** One day (one line of its band); a gap column keeps wide cells apart. The
 * band's first line carries the day of the month when the cell is wide
 * enough. Days after today are blank. */
function Cell(props: { day: CalendarDay | null; width: number; today: string; label: boolean }) {
  const filled = () => props.day != null && props.day.dateISO <= props.today
  const inner = () => (props.width > 2 ? props.width - 1 : props.width)
  const text = () => {
    if (!props.label || props.day == null || inner() < 3) return " ".repeat(inner())
    return (" " + Number(props.day.dateISO.slice(8, 10))).padEnd(inner())
  }
  // Day numbers: dark on the brighter levels, muted on empty and future days.
  const fg = () => (!filled() ? theme.surface1 : props.day!.level >= 3 ? theme.crust : theme.subtext0)
  return (
    <>
      <S fg={fg()} bg={filled() ? LEVEL_BG[props.day!.level] : theme.canvas}>{text()}</S>
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

/** More spending than before is red, less is green. */
function changeColor(now: number, before: number): string {
  if (before <= 0 || Math.abs(now - before) < 0.005) return theme.overlay1
  return now > before ? theme.error : theme.success
}

function signedWhole(n: number): string {
  return n > 0 ? `+${formatWholeMoney(n)}` : formatWholeMoney(n)
}
