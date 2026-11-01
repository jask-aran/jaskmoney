/**
 * A client's reactive layer over the core: a Solid store mirroring
 * `CoreState` from the core's patches, the view state that is this client's
 * alone (filter, sort, account selection, a tag review, `ask:` verdicts),
 * the rows derived from both, and the core's commands as methods.
 *
 * No database, file or model SDK here: the TUI runs it over an in-process
 * link (state/dataStore) and the web app over a WebSocket (web/main).
 */
import type { Models } from "@earendil-works/pi-ai"
import { batch, createEffect, createMemo, createRoot, createSignal, on } from "solid-js"
import { $RAW, createStore, produce, reconcile, unwrap } from "solid-js/store"
import { chronological } from "../domain/chronology"
import { lazyMemo } from "./lazyMemo"
import { categoryUses as findCategoryUses, merchantBreadth, notePrompts as findNotePrompts } from "../domain/suggest"
import { normaliseSelection, selectedAccounts, type AccountSelection } from "../domain/accountTree"
import { paydays, type BudgetScope, type CycleConfig } from "../domain/budget"
import { matchingProfiles } from "../domain/profileMatch"
import { isOrdinaryFlow, isUncategorised } from "../domain/moneyRules"
import { ruleOffers, type RuleOffer } from "../domain/ruleOffers"
import { TAG_SHOW_AT, type TagCandidate, type TagTarget } from "../domain/tagSuggest"
import { detectRecurring, detectTrips } from "../domain/tagGroups"
import { ACCEPT_ALL_AT, MATCH_AT, NEAR_AT } from "../domain/questions"
import { appToday } from "../domain/days"
import { askCandidates } from "../domain/ask"
import { dryRunRules as evaluateRules } from "../domain/rules"
import type { HistoryData } from "../domain/aiHistory"
import { JEV_SETUP } from "../ai/judge"
import type { JevClient } from "../ai/jev"
import type { Llm, LlmProvider } from "../ai/llm"
import type { CredentialName } from "../ai/credentials"
import type { PurchaseLookup, TagInput } from "../db/client"
import {
  applyTop, evalFilter, filterExprString, canonicalFilter, reparseFilterInput, filterNote, askTerms, hasDateTerm, undecided,
  type FilterNames, type FilterNote, type AskVerdict, type FilterNode,
} from "../domain/filter"
import type { Category, ImportProfile, Rule, SavedFilter, SortColumn, Transaction } from "../domain/types"
import type { UiPrefs } from "../state/settingsConfig"
import { emptyCoreState, type CoreParams, type CoreResult, type CoreState, type SignInProgress, type TagPatch } from "../core/protocol"
import type { CoreLink } from "./link"
import { createLatestRun } from "./latestRun"

/** Finding transactions for a tag: its target and the candidates so far. */
export interface TagReview extends TagTarget {
  candidates: Record<number, TagCandidate>
  /** Jev is still answering. */
  asking: boolean
}

/** What an ask run judged, per `ask:` term: the rows it covered, how many
 * were sent to Jev (the rest were known), and how they came out. */
export interface AskResult {
  terms: Array<{ words: string; rows: number; asked: number; matched: number; near: number; skipped: number }>
  failures: string[]
  ms: number
  /** The filter limits dates (else only the last ASK_DEFAULT_DAYS were judged). */
  dated: boolean
}

/** What this client alone decides: how it looks at the core's rows. */
export interface ViewState {
  /** The Transactions table shows only ordinary uncategorised rows. */
  uncategorisedOnly: boolean
  /** Finding transactions for a tag: the table shows its candidates. */
  tagReview: TagReview | null
  /** `ask:` terms also pass near misses (NEAR_AT up to MATCH_AT): on, off,
   * or null to decide by the counts (`showNearMisses`). */
  askLoose: boolean | null
  /** Jev is judging rows for an `ask:` term. */
  asking: { words: string; judged: number; total: number } | null
  /** Which accounts the Transactions tab shows. Approved deviation from Go's per-account
   * on/off scope (2026-10-26): one selection from the accounts pane. */
  accountSelection: AccountSelection
  filterQuery: string
  filterExpr: FilterNode | null
  filterErr: string
  /** Beside the bar's dot: why it doesn't parse (error), what saving
   * would refuse (warn), or the full form a forgiven search reads as. */
  filterNote: FilterNote | null
  sortColumn: SortColumn
  sortAscending: boolean
}

export type DataState = CoreState & ViewState

const initialView = (): ViewState => ({
  uncategorisedOnly: false,
  tagReview: null,
  askLoose: null,
  asking: null,
  accountSelection: "all",
  filterQuery: "",
  filterExpr: null,
  filterErr: "",
  filterNote: null,
  sortColumn: "date",
  sortAscending: false, // date desc default like Go
})

/** Slices patched in place, so a reader of one entry reruns only when it changes. */
const RECONCILED = new Set<keyof CoreState>(["suggestions", "merchantNotes", "merchantBreadth", "uiPrefs", "purchaseLookups"])

const SORT_CYCLE: SortColumn[] = [
  "date",
  "amount",
  "description",
  "category",
  "account",
]

/** A tag created from a review (the schema's default tag colour). */
const NEW_TAG_COLOR = "#94e2d5"

/** Text order as `localeCompare` gives it, without building a collator per call. */
const textOrder = new Intl.Collator().compare

/** Rows in a column's order; dates tie-break on id so the order is stable.
 * Confidence sorts by `confidence(id)` (no suggestion lowest), then date. */
function sortRows(rows: Transaction[], col: SortColumn, asc: boolean, confidence: (id: number) => number = () => -1): Transaction[] {
  const byDate = chronological
  const compare = (a: Transaction, b: Transaction): number => {
    switch (col) {
      case "confidence": return confidence(a.id) - confidence(b.id) || byDate(a, b)
      case "date": return byDate(a, b)
      case "amount": return a.amount - b.amount
      case "description": return textOrder(a.description, b.description)
      case "category": return textOrder(a.categoryName, b.categoryName)
      case "account": return textOrder(a.accountName, b.accountName)
    }
  }
  return rows.slice().sort((a, b) => (asc ? compare(a, b) : -compare(a, b)))
}

/** Near misses show by themselves when they don't swamp the results: at
 * most as many as the matches, and a handful whatever the matches. */
export function showNearMisses(matches: number, near: number): boolean {
  return near <= Math.max(matches, 5)
}

/** The core's rows, marked as already plain. Setting a store value unwraps
 * it deeply (every field of every row, ~half of a write's cost); the core's
 * rows are fresh plain objects, never store proxies, so the marker (which
 * Solid's `unwrap` returns as is) skips that walk. Reads still wrap them. */
function plainRows<T>(rows: T): T {
  if (Array.isArray(rows) && Object.isExtensible(rows) && !Object.prototype.hasOwnProperty.call(rows, $RAW))
    Object.defineProperty(rows, $RAW, { value: rows })
  return rows
}

export function createClientStore(initialLink: CoreLink) {
  let link = initialLink
  const [state, setState] = createStore<DataState>({ ...emptyCoreState(), ...initialView() })
  let session = -1

  /** Take in a patch from the core. */
  function applyPatch(patch: Partial<CoreState>) {
    batch(() => {
      const plain: Partial<CoreState> = {}
      for (const [key, value] of Object.entries(patch) as [keyof CoreState, never][]) {
        if (RECONCILED.has(key)) setState(key, reconcile(value))
        else (plain as Record<string, unknown>)[key] = key === "transactions" ? plainRows(value) : value
      }
      setState(plain)
      if (patch.session !== undefined && patch.session !== session) {
        session = patch.session
        newSession()
      }
      if (patch.accounts) setState({ accountSelection: normaliseSelection(state.accounts, state.accountSelection) })
    })
  }

  let unsubscribe = () => {}

  /** Use another link (another core): the mirror starts again from its state. */
  function connect(next: CoreLink) {
    unsubscribe()
    // Another core's sessions are numbered on their own: its first patch is a new one.
    session = -1
    link = next
    unsubscribe = link.subscribe(applyPatch)
  }

  /** The core opened another database: what this client knew of the last one goes. */
  function newSession() {
    // Verdicts are per row id, and a new database reuses ids.
    askVerdicts.clear()
    askRuns.stop()
    stopTagReview()
    suggestTried.clear()
    setState({
      tagReview: null,
      asking: null,
      ...(!state.uncategorisedOnly && state.sortColumn === "confidence" ? { sortColumn: "date" as const, sortAscending: false } : {}),
    })
  }

  /** Test isolation: the view as it starts (the core's state comes from the core). */
  function resetView() {
    newSession()
    setAskVersion(0)
    setState(initialView())
  }

  // Rows derived from the transactions, recomputed once per change and
  // shared by every reader. They work on the plain arrays behind the store:
  // `transactions` and `filterExpr` are only ever replaced whole, so
  // tracking those properties is enough.

  /** Every transaction, as the plain array behind the store. Readers that
   * walk all of them use this: through the store each field read would be
   * a tracked dependency, tens of thousands per pass. */
  const transactions = createRoot(() => createMemo(() => unwrap(state.transactions)))

  /** Merchants worth a note (domain/suggest notePrompts), by key. */
  // These four walk the whole history: computed when read (lazyMemo), not
  // on every write and at start whether anything reads them or not.
  const notePrompts = lazyMemo(() => findNotePrompts(transactions(), state.categories,
    new Map(Object.entries(state.merchantBreadth)), new Map(Object.entries(state.merchantNotes))))
  /** The account holder's examples per category, for Jev (suggest categoryUses). */
  const categoryUses = lazyMemo(() => findCategoryUses(transactions(), state.categories,
    merchantBreadth(transactions(), state.categories, new Map(Object.entries(state.merchantBreadth)))))
  /** The budget cycle with the pay dates `payEarly` needs. Everything that
   * works out cycles reads this, not `state.budgetCycle`. */
  const cycle = createRoot(() => createMemo((): CycleConfig => ({ ...state.budgetCycle, paydays: paydays(transactions()) })))
  /** Detected groupings in the history: trips, then regular payments. */
  const tagGroups = lazyMemo(() => [...detectTrips(transactions()), ...detectRecurring(transactions())])
  /** Order-email lookups so far, by row. */
  const purchaseLookups = createRoot(() => createMemo(() => new Map(Object.entries(state.purchaseLookups).map(([id, l]) => [Number(id), { ...l, items: l.items.map((item) => ({ ...item })) }]))))

  /** Transactions of the Transactions tab's selected account(s). */
  const accountScoped = createRoot(() => createMemo(() => {
    const ids = new Set(selectedAccounts(state.accounts, state.accountSelection).map((a) => a.id))
    return transactions().filter((t) => t.accountId != null && ids.has(t.accountId))
  }))

  /** Jev's probabilities for `ask:` terms this session: words (lower-cased)
   * → row id → how likely the row matches. Each new batch bumps `askVersion`. */
  const askVerdicts = new Map<string, Map<number, number>>()
  const [askVersion, setAskVersion] = createSignal(0)
  /** A row matches at MATCH_AT, or with near misses shown, at NEAR_AT. */
  const verdictAt = (at: number): AskVerdict<Transaction> => (words, t) => {
    const p = askVerdicts.get(words.toLowerCase())?.get(t.id)
    return p == null ? undefined : p >= at
  }
  const askVerdict: AskVerdict<Transaction> = (words, t) => verdictAt(nearMissesShown() ? NEAR_AT : MATCH_AT)(words, t)
  const askRuns = createLatestRun()

  /** The Uncategorised view's narrowing. */
  const inView = (t: Transaction) => (!state.uncategorisedOnly || (isOrdinaryFlow(t) && isUncategorised(t)))
    && (!state.tagReview || (state.tagReview.candidates[t.id]?.confidence ?? 0) >= TAG_SHOW_AT)

  /** How likely a row matches the filter's `ask:` terms: the lowest of its
   * judged terms' probabilities (the one holding it back); undefined if none
   * is judged. */
  function askScore(id: number): number | undefined {
    askVersion()
    let low: number | undefined
    for (const words of askTerms(state.filterExpr ? unwrap(state.filterExpr) : null)) {
      const p = askVerdicts.get(words.toLowerCase())?.get(id)
      if (p != null) low = low == null ? p : Math.min(low, p)
    }
    return low
  }

  /** With `ask:` terms: rows that match, and near misses (rows that pass
   * only when near misses count). */
  const askCounts = createRoot(() => createMemo(() => {
    const expr = state.filterExpr ? unwrap(state.filterExpr) : null
    if (!askTerms(expr).length) return null
    askVersion()
    const rows = accountScoped().filter(inView)
    const matches = rows.filter((t) => evalFilter(expr, t, verdictAt(MATCH_AT))).length
    const loose = rows.filter((t) => evalFilter(expr, t, verdictAt(NEAR_AT))).length
    return { matches, near: loose - matches }
  }))

  /** Whether near misses are in the table: as `n` last set it, else when
   * they don't outnumber the matches (a few are always worth a look). */
  const nearMissesShown = createRoot(() => createMemo(() => {
    if (state.askLoose != null) return state.askLoose
    const c = askCounts()
    return !!c && c.near > 0 && showNearMisses(c.matches, c.near)
  }))

  /** Rows in the table only as near misses (they follow the matches). */
  const nearMissIds = createRoot(() => createMemo(() => {
    const expr = state.filterExpr ? unwrap(state.filterExpr) : null
    if (!nearMissesShown() || !expr) return new Set<number>()
    askVersion()
    return new Set(filtered().filter((t) => !evalFilter(expr, t, verdictAt(MATCH_AT))).map((t) => t.id))
  }))

  const filtered = createRoot(() => createMemo(() => {
    const expr = state.filterExpr ? unwrap(state.filterExpr) : null
    const rows = accountScoped()
    if (!expr && !state.uncategorisedOnly && !state.tagReview) return rows
    const asks = askTerms(expr).length > 0
    if (asks) askVersion()
    // top: cuts the matches; near misses (when shown) follow, cut alike.
    const matches = applyTop(expr, rows.filter((t) => inView(t) && (!expr || evalFilter(expr, t, verdictAt(MATCH_AT)))))
    if (!asks || !nearMissesShown()) return matches
    const near = rows.filter((t) => inView(t) && evalFilter(expr, t, verdictAt(NEAR_AT)) && !evalFilter(expr, t, verdictAt(MATCH_AT)))
    return [...matches, ...applyTop(expr, near)]
  }))

  /**
   * Confidence order holds still while you review: a row sorts by the
   * lowest confidence it has had in this view, so accepting one (which asks
   * its namesakes again) or an answer arriving can drop a row down, never
   * lift it; the numbers and categories shown are always the latest. A row
   * waiting for its first answer is placed when it comes; a dismissed one
   * (no suggestion) drops to the bottom. Reopening the view or changing the
   * sort sorts afresh.
   */
  const sortedAt = new Map<number, number>()
  let sortedFor = ""

  /** The account's rows through the filter, in the table's sort. */
  const scopedTransactions = createRoot(() => createMemo(() => {
    const review = state.tagReview
    const live = state.sortColumn !== "confidence" ? undefined
      : review ? (id: number) => review.candidates[id]?.confidence ?? -1
      : (id: number) => state.suggestions[id]?.confidence ?? -1
    const view = `${state.demo}|${state.uncategorisedOnly}|${review?.name ?? ""}|${state.sortColumn}`
    if (view !== sortedFor) { sortedAt.clear(); sortedFor = view }
    const confidence = live && ((id: number) => {
      const now = live(id), held = sortedAt.get(id)
      if (held !== undefined && held <= now) return held
      if (held !== undefined || now >= 0) sortedAt.set(id, now)
      return now
    })
    const sorted = sortRows(filtered(), state.sortColumn, state.sortAscending, confidence)
    // Near misses after every match, each part in the table's order.
    const near = nearMissIds()
    return near.size ? [...sorted.filter((t) => !near.has(t.id)), ...sorted.filter((t) => near.has(t.id))] : sorted
  }))

  /** The names cat:, tag: and acc: values are found among (shortened names). */
  function filterNames(): FilterNames {
    return { cat: state.categories.map((c) => c.name), tag: state.tags.map((t) => t.name), acc: state.accounts.map((a) => a.name) }
  }

  function setFilterLive(q: string) {
    const names = filterNames()
    const { expr, err, hints } = reparseFilterInput(q, names)
    setState({
      filterQuery: q,
      filterExpr: expr,
      filterErr: err,
      filterNote: filterNote(q, err, hints, names),
    })
  }

  /** Enter: keeps the search as typed (loose), and flags what saving it
   * would refuse (a name several fit, a mistyped field) or what doesn't
   * parse at all. */
  function commitFilter(q: string): { ok: boolean; err: string } {
    const trimmed = q.trim()
    if (!trimmed) {
      clearFilter()
      return { ok: true, err: "" }
    }
    const names = filterNames()
    const live = reparseFilterInput(trimmed, names)
    const err = live.err || canonicalFilter(trimmed, names).error || ""
    setState({
      filterQuery: trimmed,
      filterExpr: live.expr,
      filterErr: err,
      filterNote: filterNote(trimmed, live.err, live.hints, names),
    })
    return { ok: !err, err }
  }

  function clearFilter() {
    askRuns.stop()
    setState({
      asking: null,
      askLoose: null,
      filterQuery: "",
      filterExpr: null,
      filterErr: "",
      filterNote: null,
    })
  }

  function filterPreview(): string {
    if (state.filterExpr) return filterExprString(state.filterExpr)
    return state.filterQuery
  }

  function cycleSortColumn(): string {
    // Confidence is a column only where rows have suggestions.
    const cycle: SortColumn[] = state.uncategorisedOnly || state.tagReview ? ["confidence", ...SORT_CYCLE] : SORT_CYCLE
    const i = cycle.indexOf(state.sortColumn)
    const next = cycle[(i + 1) % cycle.length]!
    setState({ sortColumn: next })
    return next
  }

  function toggleSortDirection(): boolean {
    const next = !state.sortAscending
    setState({ sortAscending: next })
    return next
  }

  function setAccountSelection(selection: AccountSelection) {
    setState({ accountSelection: normaliseSelection(state.accounts, selection) })
  }

  /**
   * Have Jev judge the rows the current filter's `ask:` terms are waiting
   * on: those the rest of the filter leaves possible, not judged yet, from
   * the last ASK_DEFAULT_DAYS unless the filter limits dates, at most
   * ASK_LIMIT, newest first. Matches show as each batch lands. Returns what
   * was judged (app/searchReport words it), or null when a newer run or a
   * cleared filter took over.
   */
  async function askAbout(ai?: Pick<JevClient, "judge">): Promise<AskResult | null> {
    const expr = state.filterExpr ? unwrap(state.filterExpr) : null
    const terms = askTerms(expr)
    if (!terms.length) return null
    if (!ai && !state.jev) throw new Error(`ask: needs Jev (${JEV_SETUP})`)
    const run = askRuns.start()
    const started = Date.now()
    const result: AskResult = { terms: [], failures: [], ms: 0, dated: hasDateTerm(expr) }
    try {
      // One term at a time: each verdict narrows the rows the next must judge.
      for (const words of terms) {
        const key = words.toLowerCase()
        const known = askVerdicts.get(key) ?? new Map<number, number>()
        askVerdicts.set(key, known)
        // Rows whose match turns on these words: not ruled out by the rest of
        // the filter, nor matched without them (a covered category's rows).
        const others: AskVerdict<Transaction> = (w, t) => w.toLowerCase() === key ? undefined : askVerdict(w, t)
        const possible = accountScoped().filter((t) => inView(t) && undecided(expr, t, others))
        const { rows, skipped } = askCandidates(possible, appToday(), hasDateTerm(expr))
        const todo = rows.filter((t) => !known.has(t.id))
        setState({ asking: { words, judged: 0, total: todo.length } })
        if (todo.length) result.failures.push(...await link.call("judgeAsk", { words, ids: todo.map((t) => t.id) }, {
          ai,
          signal: run.signal,
          onProgress: (scores) => {
            if (!run.isCurrent()) return
            for (const [id, p] of scores) known.set(id, p)
            setAskVersion((v) => v + 1)
            setState("asking", (a) => a && { ...a, judged: a.judged + scores.length })
          },
        }))
        if (!run.isCurrent()) return null
        const matched = rows.filter((t) => (known.get(t.id) ?? 0) >= MATCH_AT).length
        const near = rows.filter((t) => { const p = known.get(t.id) ?? 0; return p >= NEAR_AT && p < MATCH_AT }).length
        result.terms.push({ words, rows: rows.length, asked: todo.length, matched, near, skipped })
      }
    } catch (error) {
      if (!run.isCurrent()) return null
      throw error
    } finally {
      if (run.isCurrent()) setState({ asking: null })
    }
    result.ms = Date.now() - started
    return result
  }

  const tagRuns = createLatestRun()
  /** Identifies the review opening when undo restores a dismissal. */
  let tagReviewId = 0
  function stopTagReview() {
    tagReviewId++
    tagRuns.stop()
  }

  /**
   * Show the transactions `target` could go on (see tagSuggest): the group's
   * and history's at once, Jev's as its answers land (`ai` replaces the Jev
   * client in tests). Returns a summary, or "" when closed meanwhile.
   */
  async function openTagReview(target: TagTarget, ai?: Pick<JevClient, "judge">): Promise<string> {
    // Tag names are upper case (createTag); a new one is named as it will be.
    if (target.tagId == null) target = { ...target, name: target.name.trim().toUpperCase() }
    stopTagReview()
    const run = tagRuns.start()
    setState({
      uncategorisedOnly: false, sortColumn: "confidence", sortAscending: false,
      tagReview: { ...target, candidates: {}, asking: true },
    })
    try {
      const { failures, jev } = await link.call("tagCandidates", { target: unwrap(target) }, {
        ai,
        signal: run.signal,
        onProgress: (found) => {
          if (!run.isCurrent()) return
          setState("tagReview", "candidates", (prev) => {
            const next = { ...prev }
            for (const c of found) if (!next[c.transactionId] || c.confidence > next[c.transactionId]!.confidence) next[c.transactionId] = c
            return next
          })
        },
      })
      if (!run.isCurrent() || !state.tagReview) return ""
      const shown = Object.values(state.tagReview.candidates).filter((c) => c.confidence >= TAG_SHOW_AT)
      const parts = [`${target.name}: ${shown.length} to review, ${shown.filter((c) => c.confidence >= ACCEPT_ALL_AT).length} at ${ACCEPT_ALL_AT * 100}% or more`]
      if (!jev) parts.push("Jev isn't set up: tag history and detected groups only")
      if (failures.length) parts.push(`${failures.length} failed: ${failures[0]}`)
      return parts.join(" · ")
    } catch (error) {
      if (!run.isCurrent()) return ""
      throw error
    } finally {
      if (run.isCurrent() && state.tagReview) setState("tagReview", "asking", false)
    }
  }

  /** Put the review's tag on the candidates among `ids` (creating the tag
   * when it is new: anywhere, a trip's included); they leave the review. */
  async function acceptTagCandidates(ids: number[]): Promise<string> {
    const review = state.tagReview
    if (!review) return ""
    const take = ids.filter((id) => review.candidates[id])
    if (!take.length) return "Nothing to tag"
    // The review may close (or another open) while the core answers.
    const reviewId = tagReviewId
    const open = () => reviewId === tagReviewId && !!state.tagReview
    let tagId = review.tagId
    if (tagId == null) {
      tagId = await link.call("createTag", { input: { name: review.name, color: NEW_TAG_COLOR } })
      if (open()) setState("tagReview", "tagId", tagId)
    }
    const summary = await applyTagPatch(take, { [tagId]: "add" }, "review")
    const tagged = new Set(transactions().filter((t) => t.tagIds.includes(tagId!)).map((t) => t.id))
    // produce: a store merges a plain object into the old one, keeping removed keys.
    if (open()) setState("tagReview", "candidates", produce((c) => { for (const id of take) if (tagged.has(id)) delete c[id] }))
    return summary
  }

  /** Drop candidates from the review, remembered for the tag (by name). */
  function dismissTagCandidates(ids: number[]): Promise<void> {
    const review = state.tagReview
    if (!review) return Promise.resolve()
    const removed = Object.values(unwrap(review.candidates)).filter((c) => ids.includes(c.transactionId)).map((c) => ({ ...c }))
    if (!removed.length) return Promise.resolve()
    const done = link.call("dismissTagCandidates", { tag: review.name, candidates: removed, review: tagReviewId })
    setState("tagReview", "candidates", produce((c) => { for (const id of ids) delete c[id] }))
    return done
  }

  function closeTagReview(): void {
    stopTagReview()
    setState({ tagReview: null, ...(state.sortColumn === "confidence" ? { sortColumn: "date" as const, sortAscending: false } : {}) })
  }

  async function undo(): Promise<string> {
    const result = await link.call("undo", {})
    const back = result.restored
    if (back && back.review === tagReviewId && state.tagReview?.name === back.tag) {
      setState("tagReview", "candidates", (prev) => ({ ...prev, ...Object.fromEntries(back.candidates.map((c) => [c.transactionId, c])) }))
    }
    return result.message
  }

  /** Rows background suggesting has asked about since the database opened:
   * one Jev couldn't place isn't asked again every sync. */
  const suggestTried = new Set<number>()
  /** Waiting rows with no suggestion that background suggesting hasn't tried. */
  const untriedWaiting = () => transactions().filter((t) => isOrdinaryFlow(t) && isUncategorised(t) && !state.suggestions[t.id] && !suggestTried.has(t.id)).map((t) => t.id)
  const markTried = (ids: number[]) => { for (const id of ids) suggestTried.add(id) }

  /** Rules worth making from your repeated categorisations (all of them, or
   * those for the descriptions of `ids`). */
  function ruleOffersFor(ids?: number[]): RuleOffer[] {
    if (!state.ready) return []
    const descriptions = ids && transactions().filter((t) => ids.includes(t.id)).map((t) => t.description)
    return ruleOffers(unwrap(state.categoryChoices), transactions(), unwrap(state.rules), unwrap(state.savedFilters), unwrap(state.categories), unwrap(state.tags), descriptions)
  }

  /** R's list: the repeat offers, then the model's (one per expression and
   * category). */
  const allRuleOffers = lazyMemo(() => {
    void state.version
    const repeat = ruleOffersFor()
    const saved = new Set(state.savedFilters.map((f) => f.expr.toLowerCase()))
    const ai = unwrap(state.aiRuleOffers).filter((o) => !saved.has(o.expr.toLowerCase()) && !repeat.some((r) => r.expr.toLowerCase() === o.expr.toLowerCase() && r.categoryId === o.categoryId && r.tagId === o.tagId))
    return [...repeat, ...ai]
  })

  /** How many rules are offered, for the footer's "R rules (n)": worked
   * out 150 ms after the last write rather than in its frame (the offers
   * walk the whole history). */
  const [ruleOfferCount, setRuleOfferCount] = createSignal(0)
  createRoot(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    createEffect(on(() => [state.version, state.aiRuleOffers, state.savedFilters, state.ready], () => {
      clearTimeout(timer)
      timer = setTimeout(() => setRuleOfferCount(allRuleOffers().length), 150)
    }))
  })

  function dryRunRules(transactionIds?: number[]) {
    const ids = transactionIds ? new Set(transactionIds) : null
    return evaluateRules(ids ? transactions().filter((txn) => ids.has(txn.id)) : transactions(), unwrap(state.rules), unwrap(state.savedFilters), unwrap(state.categories), unwrap(state.tags))
  }

  /** The import profiles for a file, by its name. */
  function profileMatches(path: string): ImportProfile[] {
    return matchingProfiles(unwrap(state.importProfiles), path.split(/[\\/]/).pop() ?? path)
  }

  /** A row's provider details (the TUI's detail view reads them as a resource). */
  const transactionDetail = (id: number) => link.call("transactionDetail", { id })

  /** What the general model reads to write rules, and the rules declined so far. */
  async function ruleWriterInput(): Promise<{ history: HistoryData; declined: CoreResult<"ruleWriterInput">["declined"] }> {
    const { history, declined } = await link.call("ruleWriterInput", {})
    return { history: { ...history, categorySources: history.categorySources ? new Map(history.categorySources) : undefined }, declined }
  }

  /** Demo mode's previous account selection, put back when it ends. */
  let selectionBeforeDemo: AccountSelection | null = null

  async function enterDemo(): Promise<number> {
    if (state.demo) return link.call("enterDemo", {})
    selectionBeforeDemo = state.accountSelection
    const rows = link.call("enterDemo", {})
    // At once, as the switch began: what the caller sets next (restored prefs) wins.
    setAccountSelection("all")
    return rows
  }

  async function leaveDemo(): Promise<void> {
    if (!state.demo) return
    await link.call("leaveDemo", {})
    setAccountSelection(selectionBeforeDemo ?? "all")
    selectionBeforeDemo = null
  }

  function suggestCategories(ids?: number[], ai?: Pick<JevClient, "judge">): Promise<string>
  function suggestCategories(ids: number[], ai: Pick<JevClient, "judge"> | undefined, options: { replace: true }): Promise<number>
  function suggestCategories(ids?: number[], ai?: Pick<JevClient, "judge">, options: { replace?: boolean } = {}): Promise<string | number> {
    return link.call("suggestCategories", { ids, replace: options.replace }, { ai })
  }

  function applyTagPatch(ids: number[], patch: TagPatch, how?: "picker" | "review" | "undo"): Promise<string> {
    return link.call("applyTagPatch", { ids, patch, how })
  }

  function saveUiPrefs(patch: Partial<UiPrefs>, { soon = false } = {}): Promise<void> {
    return link.call("saveUiPrefs", { patch, soon })
  }

  // Last: the first patch reaches everything above.
  unsubscribe = link.subscribe(applyPatch)

  return {
    state,
    setState,
    connect,
    resetView,
    transactions,
    notePrompts,
    categoryUses,
    cycle,
    tagGroups,
    purchaseLookups,
    accountScoped,
    scopedTransactions,
    askScore,
    askCounts,
    nearMissesShown,
    nearMissIds,
    setFilterLive,
    commitFilter,
    clearFilter,
    filterPreview,
    cycleSortColumn,
    toggleSortDirection,
    setAccountSelection,
    setAskLoose: (on: boolean | null) => setState({ askLoose: on }),
    /** The table's rows are all of them, the uncategorised ones, or a tag
     * review's candidates: never two at once, so each closes the other. */
    setUncategorisedOnly: (on: boolean) => {
      if (on) stopTagReview()
      setState(on
        ? { uncategorisedOnly: true, tagReview: null, sortColumn: "confidence", sortAscending: false }
        : { uncategorisedOnly: false, ...(state.sortColumn === "confidence" ? { sortColumn: "date" as const, sortAscending: false } : {}) })
    },
    askAbout,
    openTagReview,
    acceptTagCandidates,
    dismissTagCandidates,
    closeTagReview,
    untriedWaiting,
    markTried,
    ruleOffersFor,
    allRuleOffers,
    ruleOfferCount,
    dryRunRules,
    profileMatches,
    transactionDetail,
    ruleWriterInput,
    undoLabel: () => state.undoLabel,
    lastRepeat: () => state.lastRepeat,
    undo,
    repeatLast: (ids: number[]) => link.call("repeatLast", { ids }),
    enterDemo,
    leaveDemo,

    categorizeTransactions: (ids: number[], categoryId: number, onProgress?: (pushed: number, total: number) => void) =>
      link.call("categorize", { ids, categoryId }, { onProgress: (p) => onProgress?.(p.pushed, p.total) }),
    applyTagPatch,
    retryPendingCategories: () => link.call("retryPendingCategories", {}),
    retryPendingTags: () => link.call("retryPendingTags", {}),
    suggestCategories,
    resuggestLike: (ids: number[], ai?: Pick<JevClient, "judge">) => link.call("resuggestLike", { ids }, { ai }),
    setMerchantNote: (description: string, note: string, ai?: Pick<JevClient, "judge">) => link.call("setMerchantNote", { description, note }, { ai }),
    /** `session`: the one the lookups were made for, so they never land on another database's rows. */
    recordPurchases: (lookups: PurchaseLookup[], ai?: Pick<JevClient, "judge">, session?: number) => link.call("recordPurchases", { lookups, session }, { ai }),
    acceptSuggestions: (ids: number[], onProgress?: (pushed: number, total: number) => void) =>
      link.call("acceptSuggestions", { ids }, { onProgress: (p) => onProgress?.(p.pushed, p.total) }),
    dismissSuggestions: (ids: number[]) => link.call("dismissSuggestions", { ids }),
    updateTransactionNotes: (id: number, notes: string, ai?: Pick<JevClient, "judge">) => link.call("updateTransactionNotes", { id, notes }, { ai }),

    /** Save (or with null, remove) API keys entered in Settings. */
    saveApiKeys: (patch: Partial<Record<CredentialName, string | null>>) => link.call("saveApiKeys", { patch }),
    /** After a sign-in or sign-out. */
    refreshApiKeys: () => link.call("refreshApiKeys", {}),
    signInLlm: (provider: LlmProvider, onProgress: (p: SignInProgress) => void, signal?: AbortSignal, models?: Pick<Models, "login">) =>
      link.call("signInLlm", { provider }, { onProgress, signal, models }),
    signInPaste: (provider: LlmProvider, value: string) => link.call("signInPaste", { provider, value }),
    signOutLlm: (provider: LlmProvider) => link.call("signOutLlm", { provider }),

    createSettingsCategory: (input: Pick<Category, "name" | "color"> & { notSpending?: boolean }) => link.call("createCategory", { input }),
    updateSettingsCategory: (id: number, input: Pick<Category, "name" | "color"> & { notSpending?: boolean }) => link.call("updateCategory", { id, input }),
    setCategoryBudgetIgnored: (id: number, ignored: boolean) => link.call("setCategoryBudgetIgnored", { id, ignored }),
    deleteSettingsCategory: (id: number) => link.call("deleteCategory", { id }),
    createSettingsTag: (input: TagInput) => link.call("createTag", { input }),
    updateSettingsTag: (id: number, input: TagInput) => link.call("updateTag", { id, input }),
    deleteSettingsTag: (id: number) => link.call("deleteTag", { id }),
    createSettingsRule: (input: Omit<Rule, "id" | "sortOrder">) => link.call("createRule", { input }),
    updateSettingsRule: (rule: Rule) => link.call("updateRule", { rule }),
    deleteSettingsRule: (id: number) => link.call("deleteRule", { id }),
    reorderSettingsRule: (id: number, index: number) => link.call("reorderRule", { id, index }),
    toggleSettingsRule: (id: number, enabled: boolean) => link.call("toggleRule", { id, enabled }),
    applyRules: (ids?: number[], dryRun?: boolean) => link.call("applyRules", { ids, dryRun }),

    saveSavedFilter: (filter: SavedFilter, originalId?: string) => link.call("saveSavedFilter", { filter, originalId }),
    deleteSavedFilter: (id: string) => link.call("deleteSavedFilter", { id }),
    recordFilterUsage: (id: string) => link.call("recordFilterUsage", { id }),
    setIcons: (on: boolean) => link.call("setIcons", { on }),
    setWelcomed: (done: boolean) => link.call("setWelcomed", { done }),
    saveUiPrefs,
    saveImportProfile: (profile: ImportProfile, originalId?: string | null) => link.call("saveImportProfile", { profile, originalId }),
    deleteImportProfile: (id: string) => link.call("deleteImportProfile", { id }),

    importDirectory: () => link.call("importDirectory", {}),
    csvFiles: (directory: string) => link.call("csvFiles", { directory }),
    previewImport: (path: string, profile: ImportProfile) => link.call("previewImport", { path, profile }),
    commitPreview: (preview: CoreParams<"commitPreview">["preview"], skipDuplicates: boolean) => link.call("commitPreview", { preview, skipDuplicates }),
    syncUp: () => link.call("syncUp", {}),

    /** Returns the number of transactions removed when switching sync off. */
    setAccountSync: (accountId: number, enabled: boolean) => link.call("setAccountSync", { accountId, enabled }),
    setBudget: (scope: BudgetScope, amount: number, from?: string, replaces?: BudgetScope) => link.call("setBudget", { scope, amount, from, replaces }),
    removeBudget: (scope: BudgetScope, from?: string) => link.call("removeBudget", { scope, from }),
    setBudgetCycle: (config: CycleConfig) => link.call("setBudgetCycle", { config }),
    clearDatabaseData: () => link.call("clearDatabaseData", {}),
    clearAccountData: (accountId: number) => link.call("clearAccountData", { accountId }),
    removeAccountData: async (accountId: number) => {
      const removed = await link.call("removeAccountData", { accountId })
      if (state.accountSelection === accountId) setAccountSelection("all")
      return removed
    },
    factoryResetDatabase: async () => {
      await link.call("factoryResetDatabase", {})
      setAccountSelection("all")
    },

    smartSearch: (query: string, descriptions: string[]) => link.call("smartSearch", { query, descriptions }),
    askForRules: (llm?: Llm, focus?: string) => link.call("askForRules", { focus }, { llm }),
    makeOfferedRule: (offer: RuleOffer) => link.call("makeOfferedRule", { offer }),
    declineRuleOffer: (offer: RuleOffer) => link.call("declineRuleOffer", { offer }),
  }
}

export type ClientStore = ReturnType<typeof createClientStore>
