import { Show, createMemo, type JSX } from "solid-js"
import { dailySpendSeries } from "../../domain/dashboard"
import { addDays, addMonths } from "../../domain/days"
import { ACCEPT_ALL_AT } from "../../domain/questions"
import { data } from "../../state/dataStore"
import { DEMOS, askAt, chartViewAt, demoFilter, demoWorld, filterAt, suggestAt, tourTopics, waiting, type DemoTry, type DemoWorld, type TourTopics } from "../../state/tour"
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
import { merchantRows, trendRows } from "../../domain/periodTables"

export { DEMOS }

type ReelProps = { scene: number; startedAt: number; now: number; trying: DemoTry | null; width: number; height: number }
interface Reel {
  props: ReelProps
  ms: () => number
  world: () => DemoWorld
  topics: () => TourTopics
  paneHeight: () => number
  playing: (demo: string) => boolean
  bar: (raw: string, caret: number, editing: boolean, extra?: Partial<FilterBarView>) => FilterBarView
}

export function DemoReel(props: ReelProps) {
  const ms = () => Math.max(0, props.now - props.startedAt)
  const id = () => DEMOS[props.scene]?.id
  const world = createMemo(() => demoWorld(data.state.categories))
  const topics = createMemo(() => tourTopics(world()))
  const paneHeight = () => props.height - 1
  const tableWidth = () => props.width - 4
  const visible = () => Math.max(3, paneHeight() - 4)
  const top = (cursor: number) => Math.max(0, cursor - visible() + 1)

  const bar = (raw: string, caret: number, editing: boolean, extra: Partial<FilterBarView> = {}): FilterBarView => {
    const f = demoFilter(world(), raw)
    return { editing, raw, caret, err: f.err, note: f.note, question: null, jev: false, writing: false, drillReturn: false, preview: f.preview, ...extra }
  }
  const shown = (count: number, cursor: number) => rowsShown({ top: top(cursor), visible: visible(), count, total: world().rows.length, selected: 0, hidden: 0, range: false, sort: "date", ascending: false })

  const playing = (demo: string) => id() === demo
  const reel: Reel = { props, ms, world, topics, paneHeight, playing, bar }
  const { filterRows, filterBar } = filterDemo(reel)
  const { askRows, askBar } = askDemo(reel)
  const { wait, suggest, waitingRows, suggestions } = suggestDemo(reel)
  const { view, overview, chart } = chartDemo(reel)

  const cursor = () => props.trying?.cursor ?? 0

  return (
    <box width={props.width} height={props.height} flexDirection="column">
      <Show when={id() === "chart"}>
        <OverviewChartCard index={view()} model={chart()} calendar={overview().calendar} trends={overview().trends} merchants={overview().merchants} today={world().today}
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
        <Show when={suggest().state.detail != null ? wait().originals[suggest().state.detail!] : undefined}>
          {(row: () => Transaction) => <TransactionDetailCard row={row()} detail={null} boughtTop={0} lookup={null} notes={null} width={Math.min(props.width - 8, 96)} />}
        </Show>
        {under(keys([["Y", `accept all ≥${ACCEPT_ALL_AT * 100}%`], ["y", "accept"], ["x", "dismiss"], ["j", "down"], ["enter", "detail"], ["esc", "close"]], suggest().pressed, suggest().state.note))}
      </Show>
    </box>
  )
}

function filterDemo(reel: Reel) {
  const { props, ms, world, topics, playing, bar } = reel
  const filterText = createMemo(() => props.trying?.filter ?? (() => { const v = playing("filter") ? filterAt(ms(), topics()) : ""; return { value: v, caret: v.length } })(),
    undefined, { equals: (a, b) => a.value === b.value && a.caret === b.caret })
  const filterOpen = createMemo(() => !!props.trying || ms() % 13000 > 700)
  const filterRows = createMemo(() => demoFilter(world(), filterText().value).rows)
  const filterBar = createMemo(() => (filterOpen() ? bar(filterText().value, filterText().caret, true) : null))
  return { filterRows, filterBar }
}

function askDemo(reel: Reel) {
  const { ms, world, topics, playing, bar } = reel
  const ask = createMemo(() => (playing("ask") ? askAt(ms(), topics()) : { raw: "", editing: false, writing: false, question: null }),
    undefined, { equals: (a, b) => a.raw === b.raw && a.editing === b.editing && a.writing === b.writing && a.question === b.question })
  const askRows = createMemo(() => (ask().question ? demoFilter(world(), ask().raw).rows : world().rows))
  const askBar = createMemo(() => bar(ask().raw, ask().raw.length, ask().editing, { writing: ask().writing, question: ask().question }))
  return { askRows, askBar }
}

function suggestDemo(reel: Reel) {
  const { props, ms, world, playing } = reel
  const wait = createMemo(() => waiting(world()))
  const suggest = createMemo(() => (props.trying ? { state: props.trying, pressed: null } : suggestAt(playing("suggest") ? ms() : 0, world())),
    undefined, { equals: (a, b) => a.pressed === b.pressed && (a.state === b.state || JSON.stringify(a.state) === JSON.stringify(b.state)) })
  const waitingRows = createMemo(() => wait().rows.filter((r) => !suggest().state.accepted.includes(r.id)))
  const suggestions = createMemo(() => {
    const gone = suggest().state.dismissed
    return Object.fromEntries(Object.entries(wait().suggestions).filter(([id]) => !gone.includes(Number(id))))
  })
  return { wait, suggest, waitingRows, suggestions }
}

function chartDemo(reel: Reel) {
  const { props, ms, world, paneHeight } = reel
  const view = createMemo(() => props.trying?.view ?? chartViewAt(ms()))
  const overview = createMemo(() => demoOverview(world()))
  const chart = createMemo(() => overviewChartModel(CHART_VIEWS[view()]!.view, overview().input, props.width - 4, chartRows(paneHeight(), false)))
  return { view, overview, chart }
}

function demoOverview(w: DemoWorld) {
  const monthStart = `${w.today.slice(0, 7)}-01`
  const start = addMonths(monthStart, -1)
  const end = addDays(monthStart, -1)
  const scopeIds = new Set(w.accounts.filter((a) => accountRole(a) === "spending").map((a) => a.id))
  const spending = w.rows.filter((t) => t.accountId != null && scopeIds.has(t.accountId))
  const inPeriod = spending.filter((t) => t.dateISO >= start && t.dateISO <= end)
  const month = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleString("en-AU", { month: "long", timeZone: "UTC" })
  const input: OverviewChartInput = {
    series: dailySpendSeries(inPeriod, start, end), today: w.today, spending, names: { current: month(start), previous: month(addMonths(start, -1)) },
    weekStart: data.state.weekStart, accounts: w.accounts, transactions: w.rows, scopeIds, zeroAxis: false, projection: [],
  }
  const before = spending.filter((t) => t.dateISO >= addMonths(start, -1) && t.dateISO < start)
  return {
    input,
    calendar: spendingCalendar(inPeriod, start, end, data.state.weekStart),
    trends: trendRows(inPeriod, data.state.categories, start, end, w.today, data.state.weekStart),
    merchants: merchantRows(inPeriod, before),
  }
}

const keys = (list: Array<[string, string]>, pressed: string | null, note?: string | null): StyledSpan[] => [
  ...list.flatMap(([k, desc]): StyledSpan[] => [
    { text: ` ${k} `, fg: pressed === k ? theme.rowCursorText : tone.key, bg: pressed === k ? tone.key : undefined, bold: true },
    { text: ` ${desc}   `, fg: pressed === k ? ink.figure : ink.note },
  ]),
  ...(note ? [{ text: note, fg: tone.good }] : []),
]
const under = (spans: StyledSpan[]): JSX.Element => <StyledLine spans={spans} bg={theme.canvas} />
