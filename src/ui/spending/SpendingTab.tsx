import { For, Show, createEffect, createMemo } from "solid-js"
import { categoryMark } from "../icons"
import { useTerminalDimensions } from "@opentui/solid"
import { SectionCard } from "../primitives/SectionCard"
import { S } from "../primitives/S"
import { CHART_VIEWS, ui, type SectionId } from "../../state/uiStore"
import { data } from "../../state/dataStore"
import { theme } from "../../theme"
import { computeCategorySpend, dailySpendSeries, fitCategoryLines, formatPct, formatWholeMoney, groupCategorySpend } from "../../domain/dashboard"
import { computePeriodFlows } from "../../domain/position"
import { merchantSummaries, spendingCalendar, type CalendarDay } from "../../domain/spending"
import { LOOKBACKS, PERIODS, PERIOD_LABEL, activeChipIndex, comparisonWindows, dataClock, filterByTimeframe, timeframeBounds, toISODate } from "../../domain/timeframe"
import { fit, shortDate } from "../text"
import { spendingScope } from "../../domain/accountTree"
import { AXIS, ChartBody, type ChartModel } from "../charts/ChartBody"
import { INKS, balancesChart, spendingChart } from "./periodCharts"

/** Calendar cell colours by spending level (0 = none). */
const LEVEL_BG = [theme.surface0, "#5b4636", "#8c6146", "#c47f55", theme.peach] as const
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

/** Below this width the chart pane spans the tab and categories sit beside
 * merchants; at or above it, categories take a right-hand column. */
const WIDE = 120
/** The categories column's widest useful size: Up's longest names fit. */
const SIDE_MAX = 48

/**
 * Everything over a chosen period: the Date Range with its flows, one chart
 * pane cycling through spending, balance and calendar views (h/l),
 * categories, and merchants. Spending figures cover the selected spending
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

  // Fixed rows: tab bar + gap (2), status + footer (2), Date Range (4).
  // Wide: the chart pane (55%) above merchants, categories in a right column
  // up to SIDE_MAX wide. Narrow: the chart pane (50%) spans the tab, categories
  // and merchants share the row below.
  const wide = () => dims().width >= WIDE
  const bodyHeight = () => Math.max(8, dims().height - 8)
  const chartHeight = () => Math.max(8, Math.floor(bodyHeight() * (wide() ? 0.55 : 0.5)))
  const lowerHeight = () => bodyHeight() - chartHeight()
  // Categories stop growing at SIDE_MAX (names fit); the chart and merchants
  // take the rest.
  const sideWidth = () => Math.min(SIDE_MAX, Math.floor((dims().width - 1) * 0.4))
  const mainWidth = () => (wide() ? dims().width - 1 - sideWidth() : dims().width)
  const merchantsWidth = () => (wide() ? mainWidth() : dims().width - 1 - sideWidth())
  const merchantsHeight = () => lowerHeight()
  const categoriesHeight = () => (wide() ? bodyHeight() : lowerHeight())
  // Chart pane: border + padding (4) across; border (2), the view strip and
  // a blank line, then the x labels and summary down.
  const plotWidth = () => Math.max(1, mainWidth() - 4 - AXIS)
  const plotRows = () => Math.max(1, chartHeight() - 6)
  const view = () => CHART_VIEWS[ui.state.chartView] ?? CHART_VIEWS[0]
  const chartModel = createMemo(() => {
    const v = view().view
    if (v === "Daily" || v === "Cumulative" || v === "Weekly") return spendingChart(v, series(), plotWidth(), plotRows(), today(), spending())
    if (v === "Calendar") return null
    return balancesChart(v, series().dates, plotWidth(), plotRows(), today(), data.state.accounts, data.state.transactions)
  })

  const merchantRows = () => Math.max(1, merchantsHeight() - 3)
  createEffect(() => {
    const n = merchantRows()
    const cur = ui.state.merchantCursor
    if (cur >= merchants().length && merchants().length) ui.setState({ merchantCursor: merchants().length - 1 })
    if (cur < ui.state.merchantTop) ui.setState({ merchantTop: cur })
    else if (cur >= ui.state.merchantTop + n) ui.setState({ merchantTop: cur - n + 1 })
  })
  // Total (9), count (4), average (9), change (8), last seen (7); border +
  // padding (4) and a cell of rounding slack.
  const merchantNameWidth = () => Math.max(10, merchantsWidth() - 5 - 9 - 4 - 9 - 8 - 7)
  // Category lines: name, then amount (9) and share (5).
  const categoryNameWidth = () => Math.max(8, sideWidth() - 5 - 14)

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

  const categoriesCard = () => (
    <SectionCard title="Categories" width={sideWidth()} height={categoriesHeight()} focused={props.focused === "spend.categories"}>
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

  const chartPane = () => (
    <SectionCard title={view().group} titleSuffix={view().group === "Calendar" ? undefined : `· ${view().view}`} titleSuffixColor={theme.subtext0} width={mainWidth()} height={chartHeight()} focused={props.focused === "spend.chart"}>
      <ViewStrip />
      <text> </text>
      <Show when={chartModel()} fallback={<CalendarView weeks={calendar()} width={mainWidth() - 4} rows={chartHeight() - 4} today={today()} />}>
        {(model: () => ChartModel) => <ChartBody model={model()} inks={INKS} />}
      </Show>
    </SectionCard>
  )

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
      <Show
        when={wide()}
        fallback={
          <>
            {chartPane()}
            <box flexDirection="row" gap={1} width="100%" height={lowerHeight()}>
              {categoriesCard()}
              <box flexGrow={1} flexBasis={0} minWidth={0} height={lowerHeight()} flexDirection="column" overflow="hidden">
          <SectionCard title="Merchants" focused={props.focused === "spend.merchants"} active={props.focused === "spend.merchants"} height={merchantsHeight()}>
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
          </>
        }
      >
        <box flexDirection="row" gap={1} width="100%" height={bodyHeight()}>
          <box flexDirection="column" width={mainWidth()} height={bodyHeight()}>
            {chartPane()}
            <SectionCard title="Merchants" focused={props.focused === "spend.merchants"} active={props.focused === "spend.merchants"} height={merchantsHeight()}>
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
          <box flexGrow={1} flexBasis={0} minWidth={0} height={bodyHeight()} overflow="hidden">
            {categoriesCard()}
          </box>
        </box>
      </Show>
    </box>
  )
}

/** The chart pane's views in h/l order, the current one highlighted; groups
 * are separated by a rule. */
function ViewStrip() {
  return (
    <text wrapMode="none">
      <For each={CHART_VIEWS}>
        {(v, i) => {
          const current = () => ui.state.chartView === i()
          const rule = () => i() > 0 && CHART_VIEWS[i() - 1]!.group !== v.group
          return (
            <>
              <S fg={theme.surface2}>{i() === 0 ? "" : rule() ? " │ " : "  "}</S>
              <S fg={current() ? theme.accent : theme.overlay1} bg={current() ? theme.surface0 : undefined} bold={current()}>{v.view}</S>
            </>
          )
        }}
      </For>
    </text>
  )
}

/**
 * The period's days as a month grid: a column per week, a row band per
 * weekday (up to three rows each), cells as wide as fit (2–10). Wide cells
 * carry the day of the month; days after today are blank. Below: month
 * labels, the legend, and a summary.
 */
function CalendarView(props: { weeks: Array<Array<CalendarDay | null>>; width: number; rows: number; today: string }) {
  // Rows: month labels, 7 weekday bands, legend, summary.
  const band = () => Math.max(1, Math.min(3, Math.floor((props.rows - 3) / 7)))
  const shown = () => props.weeks.slice(-Math.max(1, Math.floor((props.width - 4) / 2)))
  const cellWidth = () => Math.max(2, Math.min(10, Math.floor((props.width - 4) / Math.max(1, shown().length))))
  const days = () => props.weeks.flat().filter((d): d is CalendarDay => d != null && d.dateISO <= props.today)
  const noSpend = () => days().filter((d) => d.spent === 0).length
  const busiest = () => {
    const totals = [0, 0, 0, 0, 0, 0, 0], counts = [0, 0, 0, 0, 0, 0, 0]
    for (const week of props.weeks) week.forEach((d, i) => { if (d && d.dateISO <= props.today) { totals[i]! += d.spent; counts[i]!++ } })
    const avg = totals.map((t, i) => (counts[i] ? t / counts[i]! : 0))
    return avg.indexOf(Math.max(...avg))
  }
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
      <text wrapMode="none">
        <S fg={theme.overlay1}>{"    less "}</S>
        <For each={[0, 1, 2, 3, 4]}>{(level) => <S bg={LEVEL_BG[level]}>{"  "}</S>}</For>
        <S fg={theme.overlay1}>{" more"}</S>
      </text>
      <text wrapMode="none" fg={theme.overlay1}>
        {days().length ? `${noSpend()} no-spend ${noSpend() === 1 ? "day" : "days"} · busiest day ${WEEKDAYS[busiest()]}` : "No days yet"}
      </text>
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
