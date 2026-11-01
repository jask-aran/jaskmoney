import { Show, createMemo, createSignal, onCleanup, type JSX } from "solid-js"
import { dailySpendSeries } from "../../domain/dashboard"
import { addMonths } from "../../domain/days"
import { ACCEPT_ALL_AT } from "../../domain/questions"
import { data } from "../../state/dataStore"
import { TOUR_CHART_VIEWS, askAt, chartViewAt, demoFilter, demoWorld, filterAt, suggestAt, tourTopics, waiting, type DemoTry } from "../../state/tour"
import { ink, theme, tone } from "../../theme"
import { StyledLine, type StyledSpan } from "../primitives/StyledLine"
import { TransactionTable } from "../manager/TransactionTable"
import { TransactionsPane, rowsShown, rowsToCategorise, type FilterBarView } from "../manager/TransactionsPane"
import { ChartCard } from "../charts/ChartCard"
import { TOUR_CHART_MS } from "../charts/motion"
import { axisWidth, AXIS_GUESS } from "../charts/ChartBody"
import { balancesChart, cashFlowChart, spendingChart } from "../overview/periodCharts"

export { DEMOS } from "../../state/tour"

/**
 * The tour's demos drawn: the app's own Transactions pane (TransactionsPane
 * and TransactionTable, as the Manager draws them), filter engine and
 * Overview charts, on demo mode's made-up years (state/tour). Each frame
 * comes either from the demo's script, `now - startedAt` into it, or from
 * `trying`, the demo frozen and handed to you. Nothing is drawn inside the
 * pane that the app doesn't draw there: the keys the suggestions demo
 * presses show below it. Change the pane, the filter language or the
 * charts, and the demos change with them.
 */
const TICK_MS = 60

export function DemoReel(props: { scene: number; startedAt: number; trying: DemoTry | null; width: number; height: number }) {
  const [now, setNow] = createSignal(performance.now())
  const timer = setInterval(() => setNow(performance.now()), TICK_MS)
  onCleanup(() => clearInterval(timer))
  const ms = () => Math.max(0, now() - props.startedAt)
  const world = createMemo(() => demoWorld(data.state.categories))
  const topics = createMemo(() => tourTopics(world()))
  // The pane, and a line under it for the keys being pressed.
  const paneHeight = () => props.height - 1
  const tableWidth = () => props.width - 4
  // Border (2), the filter bar and the column header.
  const visible = () => Math.max(3, paneHeight() - 4)
  const top = (cursor: number) => Math.max(0, cursor - visible() + 1)

  /** The bar for a filter typed into the demo, read as the store reads it. */
  const bar = (raw: string, caret: number, editing: boolean, extra: Partial<FilterBarView> = {}): FilterBarView => {
    const f = demoFilter(world(), raw)
    return { editing, raw, caret, err: f.err, note: f.note, question: null, jev: false, writing: false, drillReturn: false, preview: f.preview, ...extra }
  }
  const shown = (count: number, cursor: number) => rowsShown({ top: top(cursor), visible: visible(), count, total: world().rows.length, selected: 0, hidden: 0, range: false, sort: "date", ascending: false })

  // ---- Filter: / then what the script types, or what you type.
  const filterText = () => props.trying?.filter ?? (() => { const v = filterAt(ms(), topics()); return { value: v, caret: v.length } })()
  // The script presses / just before it types.
  const filterOpen = () => !!props.trying || ms() % 13000 > 700
  const filterRows = createMemo(() => demoFilter(world(), filterText().value).rows)
  // ---- Smart search.
  const ask = createMemo(() => askAt(ms(), topics()))
  const askRows = createMemo(() => (ask().question ? demoFilter(world(), ask().raw).rows : world().rows))
  // ---- Suggestions: the script's state, or yours.
  const wait = createMemo(() => waiting(world()))
  const suggest = createMemo(() => (props.trying ? { state: props.trying, pressed: null } : suggestAt(ms(), world())))
  const waitingRows = createMemo(() => wait().rows.filter((r) => !suggest().state.accepted.includes(r.id)))
  const suggestions = createMemo(() => {
    const gone = suggest().state.dismissed
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
    const height = Math.max(4, paneHeight() - 3)
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

  /** Under the pane: keys, the one being pressed lit. */
  const keys = (list: Array<[string, string]>, pressed: string | null, note?: string | null): StyledSpan[] => [
    ...list.flatMap(([k, desc]): StyledSpan[] => [
      { text: ` ${k} `, fg: pressed === k ? theme.rowCursorText : tone.key, bg: pressed === k ? tone.key : undefined, bold: true },
      { text: ` ${desc}   `, fg: pressed === k ? ink.figure : ink.note },
    ]),
    ...(note ? [{ text: note, fg: tone.good }] : []),
  ]
  const under = (spans: StyledSpan[]): JSX.Element => <StyledLine spans={spans} bg={theme.canvas} />

  const cursor = () => props.trying?.cursor ?? 0

  return (
    <box width={props.width} height={props.height} flexDirection="column">
      <Show when={props.scene === 0}>
        <TransactionsPane title="Transactions" filter={filterOpen() ? bar(filterText().value, filterText().caret, true) : null} focused width={props.width} height={paneHeight()} bottom={shown(filterRows().length, cursor())}>
          <TransactionTable rows={filterRows()} top={top(cursor())} visible={visible()} cursor={cursor()} width={tableWidth()} showAccount={false} showTags empty="No matches" />
        </TransactionsPane>
      </Show>
      <Show when={props.scene === 1}>
        <TransactionsPane title="Transactions" filter={bar(ask().raw, ask().raw.length, ask().editing, { writing: ask().writing, question: ask().question })} focused width={props.width} height={paneHeight()} bottom={shown(askRows().length, 0)}>
          <TransactionTable rows={askRows()} top={0} visible={visible()} cursor={0} width={tableWidth()} showAccount={false} showTags empty="No matches" />
        </TransactionsPane>
      </Show>
      <Show when={props.scene === 2}>
        <TransactionsPane title="Transactions · uncategorised" filter={null} focused width={props.width} height={paneHeight()} bottom={rowsToCategorise({
          count: waitingRows().length,
          suggested: waitingRows().filter((r) => suggestions()[r.id]).length,
          confident: waitingRows().filter((r) => (suggestions()[r.id]?.confidence ?? 0) >= ACCEPT_ALL_AT).length,
          suggesting: false, selected: 0, hidden: 0,
        })}>
          <TransactionTable rows={waitingRows()} top={top(suggest().state.cursor)} visible={visible()} cursor={waitingRows().length ? suggest().state.cursor : null} width={tableWidth()} showAccount={false} showTags suggestions={suggestions()} empty="Nothing to categorise" />
        </TransactionsPane>
        {under(keys([["y", "accept"], ["x", "dismiss"], ["j", "down"], ["Y", `accept all ≥${ACCEPT_ALL_AT * 100}%`]], suggest().pressed, suggest().state.note))}
      </Show>
      <Show when={props.scene === 3}>
        <ChartCard title={view() < 3 ? "Spending" : "Balances"} views={TOUR_CHART_VIEWS} current={view()} model={chart()} width={props.width} height={paneHeight()} focused revealKey={TOUR_CHART_VIEWS[view()]!.view} revealMs={TOUR_CHART_MS} />
      </Show>
    </box>
  )
}
