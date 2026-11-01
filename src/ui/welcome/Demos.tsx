import { Show, createMemo, createSignal, onCleanup } from "solid-js"
import { applyTop, evalFilter, parseFilter } from "../../domain/filter"
import { dailySpendSeries } from "../../domain/dashboard"
import { addMonths } from "../../domain/days"
import type { Transaction } from "../../domain/types"
import { data } from "../../state/dataStore"
import { ink, theme, tone } from "../../theme"
import { SectionCard } from "../primitives/SectionCard"
import { StyledLine, type StyledSpan } from "../primitives/StyledLine"
import { TransactionTable, type TableSuggestion } from "../manager/TransactionTable"
import { ChartCard } from "../charts/ChartCard"
import { axisWidth, AXIS_GUESS } from "../charts/ChartBody"
import { spendingChart } from "../overview/periodCharts"
import { demoWorld, type DemoWorld } from "./demoData"

/**
 * The setup's demos: the app's own pieces (the Transactions table, the
 * filter engine, the suggestion column, the spending chart) on a made-up
 * year (demoData), played by a script. Each scene is a pure function of
 * the time into it; one clock drives whichever is shown. Change the table
 * or the filter language and the demos change with them.
 */
export const DEMOS = [
  { id: "filter", name: "Filter", caption: [["/", "filters as you type: words, amt:, cat:, date:, combined"]] },
  { id: "ask", name: "Smart search", caption: [["?", "asks in words; Jev turns them into a filter you can read and edit"]] },
  { id: "suggest", name: "Suggestions", caption: [["i", "shows rows without a category, each with a suggestion"], ["y", "accepts it"]] },
  { id: "chart", name: "Overview", caption: [["h/l", "switch the chart's view"]] },
] as const

const TICK_MS = 60
const SPINNER = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"

/** Text typed by a script of [start ms, text, ms per char]; later entries
 * replace earlier ones, erasing back to their common start first. */
function typed(ms: number, script: Array<[number, string, number]>): string {
  let shown = ""
  for (const [start, text, per] of script) {
    if (ms < start) break
    // Erase what doesn't match, then type the rest.
    let common = 0
    while (common < shown.length && common < text.length && shown[common] === text[common]) common++
    const erase = shown.length - common
    const t = ms - start
    const erased = Math.min(erase, Math.floor(t / 40))
    if (erased < erase) return shown.slice(0, shown.length - erased)
    const typing = Math.min(text.length - common, Math.floor((t - erase * 40) / per))
    shown = text.slice(0, common + typing)
  }
  return shown
}

/** What the demo year makes good to search for: its commonest shop and category lately. */
function topics(world: DemoWorld) {
  // Over the whole year, so a trip's hotel doesn't win: an everyday shop.
  const recent = world.spending.filter((t) => t.amount < 0)
  const count = (key: (t: Transaction) => string) => {
    const n = new Map<string, number>()
    for (const t of recent) { const k = key(t); if (k) n.set(k, (n.get(k) ?? 0) + 1) }
    return [...n].sort((a, b) => b[1] - a[1]).map(([k]) => k)
  }
  const shop = (count((t) => t.description.split(/\s+/)[0]!.toLowerCase())[0] ?? "coffee").replace(/[^a-z0-9]/g, "")
  const category = count((t) => t.categoryName)[0] ?? "Groceries"
  // An amount that keeps about half the shop's rows: the narrowing shows.
  const spent = recent.filter((t) => t.description.toLowerCase().startsWith(shop)).map((t) => -t.amount).sort((a, b) => a - b)
  const cut = Math.max(1, Math.floor(spent[Math.floor(spent.length / 2)] ?? 10))
  const lastMonth = addMonths(world.today, -1).slice(0, 7)
  return { shop, category, lastMonth, cut }
}

const filtered = (rows: Transaction[], text: string) => {
  const { node } = parseFilter(text)
  return node ? applyTop(node, rows.filter((t) => evalFilter(node, t))) : rows
}

export function DemoReel(props: { scene: number; width: number; height: number }) {
  const [ms, setMs] = createSignal(0)
  let started = performance.now()
  let shownScene = -1
  const timer = setInterval(() => {
    if (props.scene !== shownScene) { shownScene = props.scene; started = performance.now() }
    setMs(performance.now() - started)
  }, TICK_MS)
  onCleanup(() => clearInterval(timer))
  const world = createMemo(() => demoWorld(data.state.categories))
  const t = createMemo(() => topics(world()))
  const tableWidth = () => props.width - 4
  const visible = () => Math.max(3, props.height - 4)

  // ---- Filter: / then words, a field, a fresh search.
  const filterText = createMemo(() => {
    const { shop, category, lastMonth, cut } = t()
    const loop = ms() % 13000
    return typed(loop, [[700, shop, 110], [2600, `${shop} amt:<-${cut}`, 110], [6200, `cat:"${category}" date:${lastMonth}`, 90], [11800, "", 40]])
  })
  // ---- Smart search: ? and words, a moment, then the filter it became.
  const ask = createMemo(() => {
    const { category, lastMonth } = t()
    const loop = ms() % 11000
    const words = `${category.toLowerCase().replace(" & ", " and ")} last month`
    const question = typed(loop, [[600, words, 85], [10400, "", 30]])
    const typedAll = 600 + words.length * 85
    const thinking = loop >= typedAll + 300 && loop < typedAll + 1500
    const answered = loop >= typedAll + 1500 && loop < 10400
    return { question, thinking, filter: answered ? `cat:"${category}" date:${lastMonth}` : null }
  })
  // ---- Suggestions: the waiting rows, each accepted in turn.
  const waiting = createMemo(() => {
    const picks = world().spending.filter((r) => r.categoryId != null && r.categoryId > 0 && r.amount < 0).slice(0, 8)
    const rows = picks.map((r) => ({ ...r, categoryId: null, categoryName: "", categoryColor: "", categoryGroup: "" }))
    const confidences = [0.97, 0.93, 0.9, 0.84, 0.77, 0.68, 0.61, 0.55]
    const suggestions: Record<number, TableSuggestion> = Object.fromEntries(picks.map((r, i) => [r.id, { categoryId: r.categoryId!, confidence: confidences[i] ?? 0.5, source: i % 3 === 0 ? "history" : "jev" }]))
    return { rows, suggestions }
  })
  const accepted = () => Math.max(0, Math.min(waiting().rows.length, Math.floor(((ms() % 14000) - 1500) / 1300) + 1))
  const pressing = () => { const m = (ms() % 14000) - 1500; return m >= 0 && m % 1300 < 260 && accepted() <= waiting().rows.length }
  // ---- Chart: this month's spending, its views in turn.
  const VIEWS = [{ view: "Cumulative", group: "spending" }, { view: "Daily", group: "spending" }, { view: "Weekly", group: "spending" }] as const
  const view = () => Math.floor(ms() / 2600) % VIEWS.length
  const chart = createMemo(() => {
    // Last month, whole: a month with every day in it.
    const start = addMonths(`${world().today.slice(0, 7)}-01`, -1)
    const last = new Date(Date.parse(`${world().today.slice(0, 7)}-01T00:00:00Z`) - 86400000).toISOString().slice(0, 10)
    const today = last
    const rows = world().spending.filter((r) => r.dateISO >= start && r.dateISO <= last)
    const series = dailySpendSeries(rows, start, last)
    const height = Math.max(4, props.height - 3)
    const build = (axis: number) => spendingChart(VIEWS[view()]!.view, series, Math.max(10, props.width - 4 - axis), height, today, rows)
    let model = build(AXIS_GUESS)
    const axis = axisWidth(model.ticks)
    if (axis !== AXIS_GUESS) model = build(axis)
    return model
  })

  const bar = (key: string, text: string, caret: boolean, after?: StyledSpan[]): StyledSpan[] => [
    { text: ` ${key} `, fg: tone.key, bold: true },
    { text, fg: ink.figure },
    { text: caret && Math.floor(ms() / 450) % 2 === 0 ? "▌" : " ", fg: tone.key },
    ...(after ?? []),
  ]

  return (
    <box width={props.width} height={props.height} flexDirection="column">
      <Show when={props.scene === 0}>
        {(() => {
          const rows = () => filtered(world().rows, filterText())
          return (
            <SectionCard title="Transactions" titleSuffix={filterText() ? `· ${rows().length} of ${world().rows.length}` : undefined} titleSuffixColor={tone.scope} width={props.width} height={props.height} focused>
              <StyledLine spans={filterText() || ms() % 13000 > 700 ? bar("/", filterText(), true) : [{ text: " ", fg: ink.note }]} bg={theme.canvas} />
              <TransactionTable rows={rows()} top={0} visible={visible()} cursor={0} width={tableWidth()} showAccount={false} showTags={false} empty="No transactions match" />
            </SectionCard>
          )
        })()}
      </Show>
      <Show when={props.scene === 1}>
        {(() => {
          const rows = () => (ask().filter ? filtered(world().rows, ask().filter!) : world().rows)
          const line = (): StyledSpan[] => ask().filter
            ? bar("?", ask().question, false, [{ text: "  → ", fg: ink.note }, { text: ask().filter!, fg: tone.ai, bold: true }])
            : bar("?", ask().question, !ask().thinking, ask().thinking ? [{ text: ` ${SPINNER[Math.floor(ms() / 80) % SPINNER.length]} Jev is reading it`, fg: tone.ai }] : [])
          return (
            <SectionCard title="Transactions" titleSuffix={ask().filter ? `· ${rows().length} of ${world().rows.length}` : undefined} titleSuffixColor={tone.scope} width={props.width} height={props.height} focused>
              <StyledLine spans={line()} bg={theme.canvas} />
              <TransactionTable rows={rows()} top={0} visible={visible()} cursor={0} width={tableWidth()} showAccount={false} showTags={false} empty="No transactions match" />
            </SectionCard>
          )
        })()}
      </Show>
      <Show when={props.scene === 2}>
        {(() => {
          const rows = () => waiting().rows.slice(accepted())
          return (
            <SectionCard title="Transactions · uncategorised" titleSuffix={`· ${rows().length} waiting`} titleSuffixColor={tone.caution} width={props.width} height={props.height} focused>
              <StyledLine bg={theme.canvas} spans={[
                { text: " y", fg: tone.key, bold: true, bg: pressing() ? theme.surface1 : undefined }, { text: " accept  ", fg: ink.note },
                { text: "c", fg: tone.key, bold: true }, { text: " choose  ", fg: ink.note },
                { text: "x", fg: tone.key, bold: true }, { text: " dismiss  ", fg: ink.note },
                { text: "Y", fg: tone.key, bold: true }, { text: " accept all ≥80%", fg: ink.note },
              ]} />
              <TransactionTable rows={rows()} top={0} visible={visible()} cursor={rows().length ? 0 : null} width={tableWidth()} showAccount={false} showTags={false} suggestions={waiting().suggestions} empty="All categorised" />
            </SectionCard>
          )
        })()}
      </Show>
      <Show when={props.scene === 3}>
        <ChartCard title="Spending" views={VIEWS} current={view()} model={chart()} width={props.width} height={props.height} focused />
      </Show>
    </box>
  )
}
