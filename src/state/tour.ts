import { DEMO_SEED, DEMO_YEARS, generateDemo } from "../domain/demo"
import { addMonths, appToday } from "../domain/days"
import { applyTop, evalFilter, parseFilter } from "../domain/filter"
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
 * demo's own rows: nothing reaches your data. ui/welcome/Demos draws
 * either, through the app's own table, filter engine and charts.
 */
export const DEMOS = [
  { id: "filter", name: "Filter", caption: [["/", "filters as you type: words, amt:, cat:, date:, combined"]] },
  { id: "ask", name: "Smart search", caption: [["?", "asks in words; Jev turns them into a filter you can read and edit"]] },
  { id: "suggest", name: "Suggestions", caption: [["i", "shows rows without a category, each with a suggestion"], ["y", "accepts it"]] },
  { id: "chart", name: "Overview", caption: [["h/l", "switch the chart's view"]] },
] as const

export const DEMO_COUNT = DEMOS.length

// ---- The world: demo mode's made-up years, as ordinary rows.

export interface DemoWorld {
  /** Newest first, as the Transactions table sorts. */
  rows: Transaction[]
  spending: Transaction[]
  accounts: Account[]
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
  const world = { rows, spending: rows.filter(isSpending), accounts: accountList, today }
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

/** The rows a filter keeps, as the store applies one. */
export function filtered(rows: Transaction[], text: string): Transaction[] {
  const { node } = parseFilter(text)
  return node ? applyTop(node, rows.filter((t) => evalFilter(node, t))) : rows
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

export interface AskFrame { question: string; thinking: boolean; filter: string | null }

const askWords = (t: TourTopics) => `${t.category.toLowerCase().replace(" & ", " and ")} last month`
const askFilter = (t: TourTopics) => `cat:"${t.category}" date:${t.lastMonth}`

/** Smart search: ? and words, a moment, then the filter it became.
 * Scripted: no model is asked. */
export function askAt(ms: number, t: TourTopics): AskFrame {
  const loop = ms % 11000
  const words = askWords(t)
  const question = typed(loop, [[600, words, 85], [10400, "", 30]])
  const typedAll = 600 + words.length * 85
  const thinking = loop >= typedAll + 300 && loop < typedAll + 1500
  const answered = loop >= typedAll + 1500 && loop < 10400
  return { question, thinking, filter: answered ? askFilter(t) : null }
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

const SUGGEST_LOOP = 14000, SUGGEST_START = 1500, SUGGEST_EVERY = 1300

/** How many of `n` waiting rows the script has accepted, top first. */
export function acceptedAt(ms: number, n: number): number {
  return Math.max(0, Math.min(n, Math.floor(((ms % SUGGEST_LOOP) - SUGGEST_START) / SUGGEST_EVERY) + 1))
}

/** The script's y is down (drawn pressed). */
export function pressingAt(ms: number): boolean {
  const m = (ms % SUGGEST_LOOP) - SUGGEST_START
  return m >= 0 && m % SUGGEST_EVERY < 260
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
  /** Smart search: what was asked (no model here to ask again). */
  question: string
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

/** The demo `demo`, `ms` into its script, frozen as it stands. Smart
 * search stopped before its answer jumps to the answer: there's nothing
 * to do with half a question and no model. */
export function tryFrom(demo: number, ms: number, world: DemoWorld): DemoTry {
  const t = tourTopics(world)
  const field = (value: string): TextField => ({ value, caret: value.length })
  const base: DemoTry = { filter: field(""), question: "", cursor: 0, accepted: [], dismissed: [], view: 0, note: null }
  switch (DEMOS[demo]?.id) {
    case "filter": return { ...base, filter: field(filterAt(ms, t)) }
    case "ask": {
      const at = askAt(ms, t)
      return { ...base, question: at.filter ? at.question : askWords(t), filter: field(at.filter ?? askFilter(t)) }
    }
    case "suggest": {
      const w = waiting(world)
      return { ...base, accepted: w.rows.slice(0, acceptedAt(ms, w.rows.length)).map((r) => r.id) }
    }
    case "chart": return { ...base, view: chartViewAt(ms) }
    default: return base
  }
}

/** The rows a try shows: what its filter keeps, or what's still waiting. */
export function tryRows(demo: number, s: DemoTry, world: DemoWorld): Transaction[] {
  const id = DEMOS[demo]?.id
  if (id === "suggest") return waiting(world).rows.filter((r) => !s.accepted.includes(r.id))
  if (id === "filter" || id === "ask") return filtered(world.rows, s.filter.value)
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
  if (id === "filter" || id === "ask") {
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
    case "filter": case "ask": return [{ key: "type", desc: "the filter" }, { key: "↑↓", desc: "rows" }]
    case "suggest": return [{ key: "j/k", desc: "move" }, { key: "y", desc: "accept" }, { key: "x", desc: "dismiss" }, { key: "Y", desc: `accept all ≥${ACCEPT_ALL_AT * 100}%` }]
    case "chart": return [{ key: "h/l", desc: "view" }]
    default: return []
  }
}
