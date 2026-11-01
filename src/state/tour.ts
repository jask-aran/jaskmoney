import { DEMO_SEED, DEMO_YEARS, generateDemo } from "../domain/demo"
import { addMonths, appToday } from "../domain/days"
import { applyTop, evalFilter, filterExprString, liveFilter, type FilterNames } from "../domain/filter"
import { isSpending } from "../domain/moneyRules"
import { ACCEPT_ALL_AT } from "../domain/questions"
import { editText, type TextField, type TextKey } from "../domain/textField"
import type { Account, Category, Transaction } from "../domain/types"

/**
 * The setup's tour (state/welcome's "tour" step), pure: the made-up world
 * its demos run on, each demo's script as a function of the time into it,
 * and trying one yourself.
 *
 *   playing ──t / Try it──▶ trying ──esc──▶ playing (from the start)
 *
 * Trying freezes the demo exactly where its script had got to (tryFrom)
 * and hands the keys over (tryKey): the filter to edit, rows to move
 * through, suggestions to accept, chart views to switch. All of it on the
 * demo's own rows: nothing reaches your data. Smart search can't be
 * tried: no AI is connected yet. ui/welcome/Demos draws either through
 * the app's own Transactions pane, filter engine and charts.
 */
export const DEMOS = [
  { id: "filter", name: "Filter", caption: [["/", "filters as you type: words, amt:, cat:, date:, combined"]] },
  { id: "ask", name: "Smart search", caption: [["?", "asks in words; Jev turns them into a filter you can read and edit"]] },
  { id: "suggest", name: "Suggestions", caption: [["i", "shows rows without a category, each with a suggestion"], ["y", "accepts it"]] },
  { id: "chart", name: "Overview", caption: [["h/l", "switch the chart's view"]] },
] as const

export const DEMO_COUNT = DEMOS.length

/** Whether demo `demo` can be tried (not Smart search: it needs the AI). */
export const triable = (demo: number) => DEMOS[demo]?.id !== "ask"

// ---- The world: demo mode's made-up years, as ordinary rows.

export interface DemoWorld {
  /** Newest first, as the Transactions table sorts. */
  rows: Transaction[]
  spending: Transaction[]
  accounts: Account[]
  /** What cat:, acc: and tag: values are found among, as the store's. */
  names: FilterNames
  today: string
}

let cached: { key: string; world: DemoWorld } | null = null

/** Demo mode's life (domain/demo), the same years it shows, turned into
 * rows the real table, filter engine and charts take. Categories take the
 * store's ids where the names match, so suggestions and icons resolve as
 * they do in the app. */
export function demoWorld(categories: Category[]): DemoWorld {
  const today = appToday()
  const key = `${today}:${categories.length}`
  if (cached?.key === key) return cached.world
  const demo = generateDemo({ today, years: DEMO_YEARS, seed: DEMO_SEED })
  const byName = new Map(categories.map((c) => [c.name.toLowerCase(), c]))
  const demoCats = new Map(demo.categories.map((c) => [c.name, c]))
  const accountList: Account[] = demo.accounts.map((a, i) => ({
    id: i + 1, name: a.name, type: "debit", sortOrder: i, isActive: true, source: "up",
    externalKind: a.kind === "saver" ? "SAVER" : "TRANSACTIONAL", balance: a.balance, syncEnabled: true,
  }))
  const accounts = new Map(demo.accounts.map((a, i) => [a.key, accountList[i]!]))
  const rows = demo.transactions
    .filter((t) => t.status === "SETTLED")
    .map((t, i): Transaction => {
      const name = t.categoryName ?? ""
      const ours = name ? byName.get(name.toLowerCase()) : undefined
      const theirs = name ? demoCats.get(name) : undefined
      const account = accounts.get(t.accountKey)
      const internal = !!t.transferToKey
      return {
        id: i + 1, dateRaw: t.dateISO, dateISO: t.dateISO, amount: t.amount, description: t.description,
        categoryId: name ? (ours?.id ?? -(i + 1)) : null,
        categoryName: name, categoryGroup: theirs?.parent ?? "", categoryColor: ours?.color ?? theirs?.color ?? "",
        notes: "", importId: null, accountId: account?.id ?? null, accountName: account?.name ?? "",
        tagNames: [], tagColors: [], tagIds: [], source: "up", status: "SETTLED",
        transactionType: t.transactionType, message: t.message, rawText: t.rawText, foreignAmount: t.foreignAmount, cardMethod: t.cardMethod,
        createdMs: null, transferAccountId: null, internal,
        excluded: internal || !!theirs?.notSpending, income: !!theirs?.income,
      }
    })
    .sort((a, b) => b.dateISO.localeCompare(a.dateISO) || b.id - a.id)
  const names: FilterNames = { cat: [...new Set(rows.map((r) => r.categoryName).filter(Boolean))], tag: [], acc: accountList.map((a) => a.name) }
  const world = { rows, spending: rows.filter(isSpending), accounts: accountList, names, today }
  cached = { key, world }
  return world
}

export interface TourTopics { shop: string; category: string; lastMonth: string; cut: number }

/** What the world makes good to search for: its commonest shop and
 * category, and an amount that keeps about half the shop's rows. */
export function tourTopics(world: DemoWorld): TourTopics {
  // Over all of it, so a trip's hotel doesn't win: an everyday shop.
  const spent = world.spending.filter((t) => t.amount < 0)
  const count = (key: (t: Transaction) => string) => {
    const n = new Map<string, number>()
    for (const t of spent) { const k = key(t); if (k) n.set(k, (n.get(k) ?? 0) + 1) }
    return [...n].sort((a, b) => b[1] - a[1]).map(([k]) => k)
  }
  const shop = (count((t) => t.description.split(/\s+/)[0]!.toLowerCase())[0] ?? "coffee").replace(/[^a-z0-9]/g, "")
  const category = count((t) => t.categoryName)[0] ?? "Groceries"
  const amounts = spent.filter((t) => t.description.toLowerCase().startsWith(shop)).map((t) => -t.amount).sort((a, b) => a - b)
  const cut = Math.max(1, Math.floor(amounts[Math.floor(amounts.length / 2)] ?? 10))
  return { shop, category, lastMonth: addMonths(world.today, -1).slice(0, 7), cut }
}

/** A filter as the store reads it (liveFilter, the world's names) and
 * the rows it keeps (no ask: terms: no AI here). */
export function demoFilter(world: DemoWorld, text: string) {
  const live = liveFilter(text, world.names)
  const expr = live.expr
  return { ...live, preview: expr ? filterExprString(expr) : text, rows: expr ? applyTop(expr, world.rows.filter((t) => evalFilter(expr, t))) : world.rows }
}

// ---- The scripts: what each demo shows `ms` into it (each loops).

/** Text typed by a script of [start ms, text, ms per char]; later entries
 * replace earlier ones, erasing back to their common start first. */
export function typed(ms: number, script: Array<[number, string, number]>): string {
  let shown = ""
  for (const [start, text, per] of script) {
    if (ms < start) break
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

/** Filter: a shop, then an amount, then a category and last month. */
export function filterAt(ms: number, t: TourTopics): string {
  return typed(ms % 13000, [[700, t.shop, 110], [2600, `${t.shop} amt:<-${t.cut}`, 110], [6200, `cat:"${t.category}" date:${t.lastMonth}`, 90], [11800, "", 40]])
}

export interface AskFrame {
  /** What's in the bar: ?words while asking, then the filter written. */
  raw: string
  editing: boolean
  writing: boolean
  /** Once written: the question it was written for. */
  question: string | null
}

const askWords = (t: TourTopics) => `${t.category.toLowerCase().replace(" & ", " and ")} last month`
const askFilter = (t: TourTopics) => `cat:"${t.category}" date:${t.lastMonth}`

/** Smart search: ? and words, Jev writing, the filter it wrote (still
 * being edited), then applied. Scripted: no model is asked. */
export function askAt(ms: number, t: TourTopics): AskFrame {
  const loop = ms % 11000
  const words = askWords(t)
  const typedAll = 600 + words.length * 85
  if (loop < typedAll + 300 || loop >= 10400) {
    const q = typed(loop, [[600, words, 85], [10400, "", 30]])
    return { raw: `?${q}`, editing: true, writing: false, question: null }
  }
  if (loop < typedAll + 1500) return { raw: `?${words}`, editing: true, writing: true, question: null }
  return { raw: askFilter(t), editing: loop < typedAll + 2700, writing: false, question: words }
}

export interface Suggestion { categoryId: number; confidence: number; source: "history" | "jev" }
export interface Waiting {
  /** Uncategorised, as they'd wait in the app. */
  rows: Transaction[]
  /** By row id: the suggestion, and the category it names. */
  suggestions: Record<number, Suggestion>
  names: Record<number, string>
}

/** Suggestions: eight recent rows with their categories taken off, each
 * with a suggestion (the category it had), surest first. */
export function waiting(world: DemoWorld): Waiting {
  const picks = world.spending.filter((r) => r.categoryId != null && r.categoryId > 0 && r.amount < 0).slice(0, 8)
  const confidences = [0.97, 0.93, 0.9, 0.84, 0.77, 0.68, 0.61, 0.55]
  return {
    rows: picks.map((r) => ({ ...r, categoryId: null, categoryName: "", categoryColor: "", categoryGroup: "" })),
    suggestions: Object.fromEntries(picks.map((r, i) => [r.id, { categoryId: r.categoryId!, confidence: confidences[i] ?? 0.5, source: i % 3 === 0 ? "history" : "jev" }])),
    names: Object.fromEntries(picks.map((r) => [r.id, r.categoryName])),
  }
}

/** Suggestions: the keys the script presses, [ms into the loop, key]. */
const SUGGEST_LOOP = 11000
const SUGGEST_KEYS: Array<[number, TryKey]> = [
  [1500, key("y")], [2800, key("x")], [4000, key("j")], [5200, key("y")], [6600, key("y", "Y", true)],
]

function key(name: string, sequence = name, shift = false): TryKey {
  return { name, sequence, ctrl: false, meta: false, shift }
}

/** The suggestions demo `ms` in: the keys pressed so far, played through
 * tryKey (as trying it does), and the one just pressed. */
export function suggestAt(ms: number, world: DemoWorld): { state: DemoTry; pressed: string | null } {
  const loop = ms % SUGGEST_LOOP
  let state = blankTry()
  let pressed: string | null = null
  for (const [at, k] of SUGGEST_KEYS) {
    if (loop < at) break
    state = tryKey(DEMOS.findIndex((d) => d.id === "suggest"), state, k, world) ?? state
    if (loop - at < 320) pressed = k.sequence
  }
  return { state, pressed }
}

/** Overview: the views it shows, in turn. */
export const TOUR_CHART_VIEWS = [
  { view: "Cumulative", group: "spending" }, { view: "Daily", group: "spending" }, { view: "Weekly", group: "spending" },
  { view: "Net position", group: "balances" }, { view: "Cash flow", group: "balances" },
] as const
const VIEW_MS = 3400

export function chartViewAt(ms: number): number {
  return Math.floor(ms / VIEW_MS) % TOUR_CHART_VIEWS.length
}

// ---- Trying a demo yourself.

export interface DemoTry {
  /** Filter and Smart search: the filter, yours to edit. */
  filter: TextField
  /** The table's cursor. */
  cursor: number
  /** Suggestions: accepted (gone from the list) and dismissed, by row id. */
  accepted: number[]
  dismissed: number[]
  /** Overview: the chart's view (TOUR_CHART_VIEWS). */
  view: number
  /** What the last key did. */
  note: string | null
}

const blankTry = (): DemoTry => ({ filter: { value: "", caret: 0 }, cursor: 0, accepted: [], dismissed: [], view: 0, note: null })

/** The demo `demo`, `ms` into its script, frozen as it stands. */
export function tryFrom(demo: number, ms: number, world: DemoWorld): DemoTry {
  const base = blankTry()
  switch (DEMOS[demo]?.id) {
    case "filter": { const v = filterAt(ms, tourTopics(world)); return { ...base, filter: { value: v, caret: v.length } } }
    case "suggest": return suggestAt(ms, world).state
    case "chart": return { ...base, view: chartViewAt(ms) }
    default: return base
  }
}

/** The rows a try shows: what its filter keeps, or what's still waiting. */
export function tryRows(demo: number, s: DemoTry, world: DemoWorld): Transaction[] {
  const id = DEMOS[demo]?.id
  if (id === "suggest") return waiting(world).rows.filter((r) => !s.accepted.includes(r.id))
  if (id === "filter") return demoFilter(world, s.filter.value).rows
  return []
}

export type TryKey = TextKey & { shift?: boolean }

const capital = (key: TryKey, letter: string) => key.sequence === letter.toUpperCase() || (key.name === letter && !!key.shift)

/** A key while trying: the next state, or null when it isn't the demo's. */
export function tryKey(demo: number, s: DemoTry, key: TryKey, world: DemoWorld): DemoTry | null {
  const id = DEMOS[demo]?.id
  const rows = tryRows(demo, s, world)
  const move = (by: number): DemoTry => ({ ...s, cursor: Math.max(0, Math.min(rows.length - 1, s.cursor + by)) })
  const { name } = key
  if (id === "filter") {
    if (name === "up") return move(-1)
    if (name === "down") return move(1)
    if (name === "pageup") return move(-10)
    if (name === "pagedown") return move(10)
    const next = editText(s.filter, key)
    return next ? { ...s, filter: next, cursor: 0, note: null } : null
  }
  if (id === "suggest") {
    if (name === "up" || name === "k") return move(-1)
    if (name === "down" || name === "j") return move(1)
    const w = waiting(world)
    const row = rows[s.cursor]
    const open = (r: Transaction) => !s.dismissed.includes(r.id)
    const after = (accepted: number[], note: string): DemoTry => {
      const left = rows.length - accepted.filter((a) => !s.accepted.includes(a)).length
      return { ...s, accepted, cursor: Math.max(0, Math.min(left - 1, s.cursor)), note }
    }
    if (capital(key, "y")) {
      const sure = rows.filter((r) => open(r) && (w.suggestions[r.id]?.confidence ?? 0) >= ACCEPT_ALL_AT)
      if (!sure.length) return { ...s, note: `None is ${ACCEPT_ALL_AT * 100}% sure or more` }
      return after([...s.accepted, ...sure.map((r) => r.id)], `Accepted ${sure.length}, each ${ACCEPT_ALL_AT * 100}% sure or more`)
    }
    if (name === "y" && row) {
      if (!open(row)) return { ...s, note: "Dismissed: it has no suggestion now" }
      return after([...s.accepted, row.id], `${row.description} → ${w.names[row.id] ?? ""}`)
    }
    if (name === "x" && row && open(row)) return { ...s, dismissed: [...s.dismissed, row.id], note: `${row.description}: suggestion dismissed` }
    return null
  }
  if (id === "chart") {
    const by = name === "left" || name === "h" ? -1 : name === "right" || name === "l" ? 1 : 0
    if (!by) return null
    return { ...s, view: (s.view + by + TOUR_CHART_VIEWS.length) % TOUR_CHART_VIEWS.length }
  }
  return null
}

/** What trying a demo lets you do, for the card and the footer. */
export function tryHints(demo: number): Array<{ key: string; desc: string }> {
  switch (DEMOS[demo]?.id) {
    case "filter": return [{ key: "type", desc: "the filter" }, { key: "↑↓", desc: "rows" }]
    case "suggest": return [{ key: "j/k", desc: "move" }, { key: "y", desc: "accept" }, { key: "x", desc: "dismiss" }, { key: "Y", desc: `accept all ≥${ACCEPT_ALL_AT * 100}%` }]
    case "chart": return [{ key: "h/l", desc: "view" }]
    default: return []
  }
}
