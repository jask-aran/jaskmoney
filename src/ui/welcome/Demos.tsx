import { Show, createMemo, createSignal, onCleanup } from "solid-js"
import { parseFilter } from "../../domain/filter"
import { dailySpendSeries } from "../../domain/dashboard"
import { addMonths } from "../../domain/days"
import type { TextField } from "../../domain/textField"
import { data } from "../../state/dataStore"
import { ACCEPT_ALL_AT } from "../../domain/questions"
import { TOUR_CHART_VIEWS, acceptedAt, askAt, chartViewAt, demoWorld, filterAt, filtered, pressingAt, tourTopics, waiting, type DemoTry } from "../../state/tour"
import { ink, theme, tone } from "../../theme"
import { SectionCard } from "../primitives/SectionCard"
import { StyledLine, type StyledSpan } from "../primitives/StyledLine"
import { TransactionTable } from "../manager/TransactionTable"
import { ChartCard } from "../charts/ChartCard"
import { axisWidth, AXIS_GUESS } from "../charts/ChartBody"
import { balancesChart, cashFlowChart, spendingChart } from "../overview/periodCharts"

export { DEMOS } from "../../state/tour"

/**
 * The tour's demos drawn: the app's own pieces (the Transactions table,
 * the filter engine, the suggestion column, the Overview's charts) on
 * demo mode's made-up years (state/tour). Each frame comes either from
 * the demo's script, `now - startedAt` into it, or from `trying`, the
 * demo frozen and handed to you. Change the table, the filter language
 * or the charts, and the demos change with them.
 */
const TICK_MS = 60
const SPINNER = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"

export function DemoReel(props: { scene: number; startedAt: number; trying: DemoTry | null; width: number; height: number }) {
  const [now, setNow] = createSignal(performance.now())
  const timer = setInterval(() => setNow(performance.now()), TICK_MS)
  onCleanup(() => clearInterval(timer))
  const ms = () => Math.max(0, now() - props.startedAt)
  const world = createMemo(() => demoWorld(data.state.categories))
  const topics = createMemo(() => tourTopics(world()))
  const tableWidth = () => props.width - 4
  const visible = () => Math.max(3, props.height - 4)
  const blink = () => Math.floor(now() / 450) % 2 === 0
  // The table's window keeps the cursor in view.
  const top = (cursor: number) => Math.max(0, cursor - visible() + 1)
  const suffix = (base: string | undefined): string | undefined => (props.trying ? `${base ?? ""} · yours to try`.trim() : base)

  /** A filter as typed: the caret where it is when it's yours, at the end blinking when it's the script's. */
  const field = (f: TextField, fg: string): StyledSpan[] => [
    { text: f.value.slice(0, f.caret), fg },
    { text: blink() ? "▌" : " ", fg: tone.key },
    { text: f.value.slice(f.caret), fg },
  ]
  /** What the filter engine says about a filter you're typing, when it can't read it. */
  const problem = (text: string): StyledSpan[] => {
    const error = props.trying ? parseFilter(text).error : undefined
    return error ? [{ text: `  ${error}`, fg: tone.caution }] : []
  }
  const key = (k: string): StyledSpan => ({ text: ` ${k} `, fg: tone.key, bold: true })

  // ---- Filter.
  const filterField = (): TextField => props.trying?.filter ?? (() => { const v = filterAt(ms(), topics()); return { value: v, caret: v.length } })()
  const filterRows = createMemo(() => filtered(world().rows, filterField().value))
  // ---- Smart search.
  const ask = createMemo(() => askAt(ms(), topics()))
  const askFilter = (): string | null => props.trying?.filter.value ?? ask().filter
  const askRows = createMemo(() => { const f = askFilter(); return f ? filtered(world().rows, f) : world().rows })
  // ---- Suggestions.
  const wait = createMemo(() => waiting(world()))
  const waitingRows = createMemo(() => {
    const t = props.trying
    return t ? wait().rows.filter((r) => !t.accepted.includes(r.id)) : wait().rows.slice(acceptedAt(ms(), wait().rows.length))
  })
  const suggestions = createMemo(() => {
    const gone = props.trying?.dismissed ?? []
    return Object.fromEntries(Object.entries(wait().suggestions).filter(([id]) => !gone.includes(Number(id))))
  })
  // ---- Overview: a memo, so the chart is built when the view changes,
  // not on every tick.
  const view = createMemo(() => props.trying?.view ?? chartViewAt(ms()))
  const days = (from: string, to: string) => {
    const out: string[] = []
    for (let d = Date.parse(`${from}T00:00:00Z`); d <= Date.parse(`${to}T00:00:00Z`); d += 86400000) out.push(new Date(d).toISOString().slice(0, 10))
    return out
  }
  const chart = createMemo(() => {
    const w = world()
    const monthStart = `${w.today.slice(0, 7)}-01`
    const last = new Date(Date.parse(`${monthStart}T00:00:00Z`) - 86400000).toISOString().slice(0, 10)
    const v = TOUR_CHART_VIEWS[view()]!.view
    const height = Math.max(4, props.height - 3)
    const build = (axis: number) => {
      const width = Math.max(10, props.width - 4 - axis)
      if (v === "Net position" || v === "Cash flow") {
        const dates = days(addMonths(w.today, -12), w.today)
        if (v === "Cash flow") return cashFlowChart(dates, width, height, w.today, w.accounts, w.rows, new Set(w.accounts.map((a) => a.id)))
        return balancesChart(v, dates, width, height, w.today, w.accounts, w.rows)
      }
      // Last month, every day of it, against the month before (all of the
      // history goes in, as the Overview's does).
      const start = addMonths(monthStart, -1)
      const series = dailySpendSeries(w.spending.filter((r) => r.dateISO >= start && r.dateISO <= last), start, last)
      return spendingChart(v, series, width, height, last, w.spending)
    }
    let model = build(AXIS_GUESS)
    const axis = axisWidth(model.ticks)
    if (axis !== AXIS_GUESS) model = build(axis)
    return model
  })

  const cursor = () => props.trying?.cursor ?? 0
  const count = (n: number) => `· ${n} of ${world().rows.length}`

  return (
    <box width={props.width} height={props.height} flexDirection="column">
      <Show when={props.scene === 0}>
        <SectionCard title="Transactions" titleSuffix={suffix(filterField().value ? count(filterRows().length) : undefined)} titleSuffixColor={tone.scope} width={props.width} height={props.height} focused>
          <StyledLine bg={theme.canvas} spans={filterField().value || props.trying || ms() % 13000 > 700 ? [key("/"), ...field(filterField(), ink.figure), ...problem(filterField().value)] : [{ text: " " }]} />
          <TransactionTable rows={filterRows()} top={top(cursor())} visible={visible()} cursor={cursor()} width={tableWidth()} showAccount={false} showTags={false} empty="No transactions match" />
        </SectionCard>
      </Show>
      <Show when={props.scene === 1}>
        <SectionCard title="Transactions" titleSuffix={suffix(askFilter() ? count(askRows().length) : undefined)} titleSuffixColor={tone.scope} width={props.width} height={props.height} focused>
          <StyledLine bg={theme.canvas} spans={props.trying
            ? [key("?"), { text: props.trying.question, fg: ink.note }, { text: "  → ", fg: ink.note }, ...field(props.trying.filter, tone.ai), ...problem(props.trying.filter.value)]
            : ask().filter
              ? [key("?"), { text: ask().question, fg: ink.figure }, { text: "  → ", fg: ink.note }, { text: ask().filter!, fg: tone.ai, bold: true }]
              : [key("?"), { text: ask().question, fg: ink.figure }, ...(ask().thinking
                ? [{ text: ` ${SPINNER[Math.floor(now() / 80) % SPINNER.length]} Jev is reading it`, fg: tone.ai }]
                : [{ text: blink() ? "▌" : " ", fg: tone.key }])]} />
          <TransactionTable rows={askRows()} top={top(cursor())} visible={visible()} cursor={cursor()} width={tableWidth()} showAccount={false} showTags={false} empty="No transactions match" />
        </SectionCard>
      </Show>
      <Show when={props.scene === 2}>
        <SectionCard title="Transactions · uncategorised" titleSuffix={suffix(`· ${waitingRows().length} waiting`)} titleSuffixColor={tone.caution} width={props.width} height={props.height} focused>
          <StyledLine bg={theme.canvas} spans={[
            { text: " y", fg: tone.key, bold: true, bg: !props.trying && pressingAt(ms()) ? theme.surface1 : undefined }, { text: " accept  ", fg: ink.note },
            { text: "x", fg: tone.key, bold: true }, { text: " dismiss  ", fg: ink.note },
            { text: "Y", fg: tone.key, bold: true }, { text: ` accept all ≥${ACCEPT_ALL_AT * 100}%`, fg: ink.note },
            ...(props.trying?.note ? [{ text: `   ${props.trying.note}`, fg: tone.good }] : []),
          ]} />
          <TransactionTable rows={waitingRows()} top={top(cursor())} visible={visible()} cursor={waitingRows().length ? cursor() : null} width={tableWidth()} showAccount={false} showTags={false} suggestions={suggestions()} empty="All categorised" />
        </SectionCard>
      </Show>
      <Show when={props.scene === 3}>
        <ChartCard title={view() < 3 ? "Spending" : "Balances"} views={TOUR_CHART_VIEWS} current={view()} model={chart()} width={props.width} height={props.height} focused revealKey={TOUR_CHART_VIEWS[view()]!.view} revealMs={900} />
      </Show>
    </box>
  )
}
