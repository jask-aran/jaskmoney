import { Show, createMemo, type JSX } from "solid-js"
import { dailySpendSeries } from "../../domain/dashboard"
import { addDays, addMonths } from "../../domain/days"
import { ACCEPT_ALL_AT } from "../../domain/questions"
import { data } from "../../state/dataStore"
import { DEMOS, askAt, chartViewAt, demoFilter, demoWorld, filterAt, suggestAt, tourTopics, waiting, type DemoTry } from "../../state/tour"
import { ink, theme, tone } from "../../theme"
import { StyledLine, type StyledSpan } from "../primitives/StyledLine"
import { TransactionTable } from "../manager/TransactionTable"
import { TransactionDetailCard } from "../manager/TransactionDetail"
import type { Transaction } from "../../domain/types"
import { TransactionsPane, rowsShown, rowsToCategorise, type FilterBarView } from "../manager/TransactionsPane"
import { TOUR_CHART_MS } from "../charts/motion"
import { OverviewChartCard, chartRows, overviewChartModel, type OverviewChartInput } from "../overview/OverviewTab"
import { CHART_VIEWS } from "../../state/uiStore"
import { accountRole } from "../../domain/types"
import { spendingCalendar } from "../../domain/spending"
import { subscriptions, upcomingCharges } from "../../domain/subscriptions"

export { DEMOS }

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
/** `now`: the setup's clock (performance.now() at its latest step), so a
 * demo moves in the same frames as everything else on the setup. */
export function DemoReel(props: { scene: number; startedAt: number; now: number; trying: DemoTry | null; width: number; height: number }) {
  const ms = () => Math.max(0, props.now - props.startedAt)
  const id = () => DEMOS[props.scene]?.id
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

  // A demo's script plays only while it's the one shown, and what follows
  // from it (its rows, the bar, the table) is worked out again only when
  // the script's frame changes, not on every step of the clock: a frame
  // the same as the last (by value) is the last.
  const playing = (demo: string) => id() === demo
  // ---- Filter: / then what the script types, or what you type.
  const filterText = createMemo(() => props.trying?.filter ?? (() => { const v = playing("filter") ? filterAt(ms(), topics()) : ""; return { value: v, caret: v.length } })(),
    undefined, { equals: (a, b) => a.value === b.value && a.caret === b.caret })
  // The script presses / just before it types.
  const filterOpen = createMemo(() => !!props.trying || ms() % 13000 > 700)
  const filterRows = createMemo(() => demoFilter(world(), filterText().value).rows)
  const filterBar = createMemo(() => (filterOpen() ? bar(filterText().value, filterText().caret, true) : null))
  // ---- Smart search.
  const ask = createMemo(() => (playing("ask") ? askAt(ms(), topics()) : { raw: "", editing: false, writing: false, question: null }),
    undefined, { equals: (a, b) => a.raw === b.raw && a.editing === b.editing && a.writing === b.writing && a.question === b.question })
  const askRows = createMemo(() => (ask().question ? demoFilter(world(), ask().raw).rows : world().rows))
  const askBar = createMemo(() => bar(ask().raw, ask().raw.length, ask().editing, { writing: ask().writing, question: ask().question }))
  // ---- Suggestions: the script's state, or yours.
  const wait = createMemo(() => waiting(world()))
  const suggest = createMemo(() => (props.trying ? { state: props.trying, pressed: null } : suggestAt(playing("suggest") ? ms() : 0, world())),
    undefined, { equals: (a, b) => a.pressed === b.pressed && (a.state === b.state || JSON.stringify(a.state) === JSON.stringify(b.state)) })
  const waitingRows = createMemo(() => wait().rows.filter((r) => !suggest().state.accepted.includes(r.id)))
  const suggestions = createMemo(() => {
    const gone = suggest().state.dismissed
    return Object.fromEntries(Object.entries(wait().suggestions).filter(([id]) => !gone.includes(Number(id))))
  })
  // ---- Charts: the Overview's pane over last month (every day of it),
  // fed as the Overview feeds it: the spending accounts' rows, the range's
  // series, the calendar and the subscriptions. A memo per view, so a
  // chart is built when the view changes, not on every tick.
  const view = createMemo(() => props.trying?.view ?? chartViewAt(ms()))
  const overview = createMemo(() => {
    const w = world()
    const monthStart = `${w.today.slice(0, 7)}-01`
    const start = addMonths(monthStart, -1)
    const end = addDays(monthStart, -1)
    const scopeIds = new Set(w.accounts.filter((a) => accountRole(a) === "spending").map((a) => a.id))
    const spending = w.rows.filter((t) => t.accountId != null && scopeIds.has(t.accountId))
    const inPeriod = spending.filter((t) => t.dateISO >= start && t.dateISO <= end)
    const subs = subscriptions(spending, w.today)
    const payday = addMonths(monthStart, 1)
    const month = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleString("en-AU", { month: "long", timeZone: "UTC" })
    const input: OverviewChartInput = {
      series: dailySpendSeries(inPeriod, start, end), today: w.today, spending, names: { current: month(start), previous: month(addMonths(start, -1)) },
      weekStart: data.state.weekStart, accounts: w.accounts, transactions: w.rows, scopeIds, zeroAxis: false, projection: [],
    }
    return {
      input, subs, payday,
      calendar: spendingCalendar(inPeriod, start, end, data.state.weekStart),
      dueBeforePayday: upcomingCharges(subs, w.today, addDays(payday, -1)).reduce((sum, c) => sum + c.amount, 0),
    }
  })
  const chart = createMemo(() => overviewChartModel(CHART_VIEWS[view()]!.view, overview().input, props.width - 4, chartRows(paneHeight(), false)))

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
      <Show when={id() === "chart"}>
        <OverviewChartCard index={view()} model={chart()} calendar={overview().calendar} subs={overview().subs} today={world().today} payday={overview().payday} dueBeforePayday={overview().dueBeforePayday}
          width={props.width} height={paneHeight()} focused revealKey={CHART_VIEWS[view()]!.view} revealMs={TOUR_CHART_MS} curve={data.state.uiPrefs.chartCurve} labels={data.state.uiPrefs.chartLabels} />
      </Show>
      <Show when={id() === "filter"}>
        <TransactionsPane title="Transactions" filter={filterBar()} focused width={props.width} height={paneHeight()} bottom={shown(filterRows().length, cursor())}>
          <TransactionTable rows={filterRows()} top={top(cursor())} visible={visible()} cursor={cursor()} width={tableWidth()} showAccount={false} showTags empty="No matches" />
        </TransactionsPane>
      </Show>
      <Show when={id() === "ask"}>
        <TransactionsPane title="Transactions" filter={askBar()} focused width={props.width} height={paneHeight()} bottom={shown(askRows().length, 0)}>
          <TransactionTable rows={askRows()} top={0} visible={visible()} cursor={0} width={tableWidth()} showAccount={false} showTags empty="No matches" />
        </TransactionsPane>
      </Show>
      <Show when={id() === "suggest"}>
        <TransactionsPane title="Transactions · uncategorised" filter={null} focused width={props.width} height={paneHeight()} bottom={rowsToCategorise({
          count: waitingRows().length,
          suggested: waitingRows().filter((r) => suggestions()[r.id]).length,
          confident: waitingRows().filter((r) => (suggestions()[r.id]?.confidence ?? 0) >= ACCEPT_ALL_AT).length,
          suggesting: false, selected: 0, hidden: 0,
        })}>
          <TransactionTable rows={waitingRows()} top={top(suggest().state.cursor)} visible={visible()} cursor={waitingRows().length ? suggest().state.cursor : null} width={tableWidth()} showAccount={false} showTags suggestions={suggestions()} empty="Nothing to categorise" />
        </TransactionsPane>
        {/* The row's detail, as enter opens it in the Manager: the real card. */}
        <Show when={suggest().state.detail != null ? wait().originals[suggest().state.detail!] : undefined}>
          {(row: () => Transaction) => <TransactionDetailCard row={row()} detail={null} boughtTop={0} lookup={null} notes={null} width={Math.min(props.width - 8, 96)} />}
        </Show>
        {under(keys([["Y", `accept all ≥${ACCEPT_ALL_AT * 100}%`], ["y", "accept"], ["x", "dismiss"], ["j", "down"], ["enter", "detail"], ["esc", "close"]], suggest().pressed, suggest().state.note))}
      </Show>
    </box>
  )
}
