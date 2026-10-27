import { createUpPush, categoryPush, operationSummary, type PushableRow } from "./store/upPush"
import { createSuggestions } from "./store/suggestions"
import { createTagReview, type TagReview } from "./store/tagReview"
import { createRuleOffers } from "./store/ruleOffers"
import type { StoreContext, Repeat } from "./store/context"
export type { TagReview } from "./store/tagReview"
import { createMemo, createRoot, createSignal } from "solid-js"
import { createStore, reconcile, unwrap } from "solid-js/store"
import { isDeepStrictEqual } from "node:util"
import { existsSync, readFileSync, readdirSync, unlinkSync } from "node:fs"
import { basename, join, resolve } from "node:path"
import {
  loadAccounts,
  loadCategories,
  loadDbInfo,
  loadRules,
  loadTags,
  loadTransactions,
  loadSuggestions,
  logCategories,
  logTags,
  openDb,
  createCategory,
  updateCategory,
  deleteCategory,
  createTag,
  updateTag,
  deleteTag,
  createRule,
  updateRule,
  deleteRule,
  reorderRule,
  toggleRule,
  type Db,
  type DbInfo,
  clearAccountTransactions,
  clearAllData,
  defaultDbPath,
  loadImports,
  removeAccountWithTransactions,
  setAccountSyncEnabled,
  deleteBudget,
  loadBudgetCycle,
  loadBudgets,
  saveBudget,
  saveBudgetCycle,
  loadTransactionDetail,
  setTransactionNotes,
  type TransactionDetail,
} from "../db/client"
import { normaliseSelection, selectedAccounts, type AccountSelection } from "../domain/accountTree"
import { paydays, type Budget, type BudgetScope, type CycleConfig } from "../domain/budget"
import { buildImportPreview, commitImportPreview, matchingProfiles } from "../domain/profileImport"
import { CREDENTIAL_NAMES, credentialEnv, credentialSource, maskSecret, saveCredentials, type CredentialName, NOT_SECRET } from "../ai/credentials"
import { isOrdinaryFlow, isUncategorised } from "../domain/moneyRules"
import { createUpClient, readUpToken } from "../up/client"
import { type RuleOffer } from "../domain/ruleOffers"
import { type LlmProvider } from "../ai/llm"
import { signedIn } from "../ai/oauthStore"
import { TAG_SHOW_AT } from "../domain/tagSuggest"
import { appNow, type WeekStart } from "../domain/days"
import { MATCH_AT, NEAR_AT } from "../domain/questions"
import { addTagLink } from "../db/tagLinks"
import { syncUp as runUpSync } from "../up/sync"
import { dryRunRules as evaluateRules } from "../domain/rules"
import {
  evalFilter,
  filterExprString,
  parseFilterStrict,
  reparseFilterInput,
  askTerms,
  type AskVerdict,
  type FilterNode,
} from "../domain/filter"
import { type Account, type Category, type CategorySuggestion, type ImportPreview, type ImportProfile, type ImportRecord, type Rule, type RuleRunResult, type SavedFilter, type SortColumn, type Tag, type Transaction } from "../domain/types"
import { loadSettingsConfig, saveSettingsConfig, validateImportProfile, validateSavedFilter, type SettingsConfig, type UiPrefs } from "./settingsConfig"

export interface DataState {
  ready: boolean
  upSyncing: boolean
  suggesting: boolean
  /** Rules the general model proposed this session (R's list, after the repeat offers). */
  aiRuleOffers: RuleOffer[]
  /** The model is writing rules. */
  writingRules: boolean
  suggestions: Record<number, CategorySuggestion>
  /** The Transactions table shows only ordinary uncategorised rows. */
  uncategorisedOnly: boolean
  /** Finding transactions for a tag: the table shows its candidates. */
  tagReview: TagReview | null
  /** Where each API key comes from, masked (`maskSecret`); never the key. */
  apiKeys: Record<CredentialName, { source: "saved" | "env" | null; mask: string }>
  /** Browser sign-ins to the general model's providers (oauth.json). */
  signedIn: Record<LlmProvider, boolean>
  /** `ask:` terms also pass near misses (NEAR_AT up to MATCH_AT): on, off,
   * or null to decide by the counts (`showNearMisses`). */
  askLoose: boolean | null
  /** Jev is judging rows for an `ask:` term. */
  asking: { words: string; judged: number; total: number } | null
  dbPath: string
  accounts: Account[]
  /** Every provider-synced account, including ones whose sync is off. */
  syncAccounts: Account[]
  budgets: Budget[]
  budgetCycle: CycleConfig
  categories: Category[]
  tags: Tag[]
  rules: Rule[]
  savedFilters: SavedFilter[]
  uiPrefs: UiPrefs
  weekStart: WeekStart
  /** Show Nerd Font category icons (settings config). */
  icons: boolean
  importProfiles: ImportProfile[]
  imports: ImportRecord[]
  transactions: Transaction[]
  /** Which accounts the Transactions tab shows. Approved deviation from Go's per-account
   * on/off scope (2026-10-26): one selection from the accounts pane. */
  accountSelection: AccountSelection
  dbInfo: DbInfo | null
  filterQuery: string
  filterExpr: FilterNode | null
  filterErr: string
  sortColumn: SortColumn
  sortAscending: boolean
}

const SORT_CYCLE: SortColumn[] = [
  "date",
  "amount",
  "description",
  "category",
  "account",
]

/** Text order as `localeCompare` gives it, without building a collator per call. */
const textOrder = new Intl.Collator().compare

/** Rows in a column's order; dates tie-break on id so the order is stable.
 * Confidence sorts by `confidence(id)` (no suggestion lowest), then date. */
function sortRows(rows: Transaction[], col: SortColumn, asc: boolean, confidence: (id: number) => number = () => -1): Transaction[] {
  const byDate = (a: Transaction, b: Transaction) => (a.dateISO < b.dateISO ? -1 : a.dateISO > b.dateISO ? 1 : a.id - b.id)
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

const loadSignedIn = (): Record<LlmProvider, boolean> => ({ openrouter: signedIn("openrouter"), openai: signedIn("openai") })

/** Each API key's source and mask, read now. */
function loadApiKeys(): DataState["apiKeys"] {
  const env = credentialEnv()
  return Object.fromEntries(CREDENTIAL_NAMES.map((name) => [name, { source: credentialSource(name), mask: NOT_SECRET.has(name) ? (env[name] ?? "") : maskSecret(env[name]) }])) as DataState["apiKeys"]
}

/** Near misses show by themselves when they don't swamp the results: at
 * most as many as the matches, and a handful whatever the matches. */
export function showNearMisses(matches: number, near: number): boolean {
  return near <= Math.max(matches, 5)
}

/** How long the range, account and chart views sit still before they're written. */
export const CONFIG_SETTLE_MS = 400

function createDataStore() {
  let db: Db | null = null
  let actualDbPath = ""
  const [lastRepeat, setLastRepeat] = createSignal<Repeat | null>(null)
  const [undoStack, setUndoStack] = createSignal<{ label: string; reverse: () => Promise<string> }[]>([])

  function recordUndo(label: string, reverse: () => Promise<string>) {
    setUndoStack((entries) => [...entries.slice(-19), { label, reverse }])
  }

  async function undo(): Promise<string> {
    const entry = undoStack().at(-1)
    if (!entry) return "Nothing to undo"
    setUndoStack((entries) => entries.slice(0, -1))
    const summary = await entry.reverse()
    return `Undid: ${entry.label}${summary ? ` · ${summary}` : ""}`
  }

  async function repeatLast(ids: number[]): Promise<string> {
    const repeat = lastRepeat()
    if (!repeat) return "Nothing to repeat"
    return repeat.kind === "category" ? categorizeTransactions(ids, repeat.categoryId) : applyTagPatch(ids, repeat.patch)
  }

  function categorySnapshot(assignments: Map<number, number>) {
    return transactions().filter((t) => assignments.has(t.id) && t.categoryId !== assignments.get(t.id))
      .map((t) => ({ id: t.id, categoryId: t.categoryId, description: t.description }))
  }

  async function restoreCategories(rows: { id: number; categoryId: number | null }[]): Promise<string> {
    const defaultId = state.categories.find((c) => c.isDefault)?.id
    const assignments = new Map<number, number>()
    for (const row of rows) {
      const categoryId = row.categoryId ?? defaultId
      if (categoryId == null) throw new Error("default category not found")
      assignments.set(row.id, categoryId)
    }
    if (!assignments.size) return ""
    // Cancel the forward push even if Up rejects the reversal.
    mutate((db) => {
      const cancelPending = db.query("UPDATE transactions SET category_source = 'user' WHERE id = ? AND category_source = 'pending'")
      for (const row of rows) cancelPending.run(row.id)
    })
    const result = await applyCategories(assignments, "undo")
    // The default sends "no category" to Up; preserve a formerly null local value.
    mutate((db) => {
      const restoreNull = db.query("UPDATE transactions SET category_id = NULL WHERE id = ? AND category_id = ?")
      for (const row of rows) if (row.categoryId == null) restoreNull.run(row.id, defaultId!)
    })
    return operationSummary(`Restored ${result.done}`, result)
  }
  const initialState = (): DataState => ({
    ready: false,
    upSyncing: false,
    suggesting: false,
    aiRuleOffers: [],
    writingRules: false,
    suggestions: {},
    uncategorisedOnly: false,
    tagReview: null,
    apiKeys: loadApiKeys(),
    signedIn: loadSignedIn(),
    askLoose: null,
    asking: null,
    dbPath: "",
    accounts: [],
    syncAccounts: [],
    budgets: [],
    budgetCycle: { unit: "month", anchor: "calendar", anchorDate: null, payEarly: false },
    categories: [],
    tags: [],
    rules: [],
    savedFilters: [],
    icons: true,
    uiPrefs: {},
    weekStart: "monday",
    importProfiles: [],
    imports: [],
    transactions: [],
    accountSelection: "all",
    dbInfo: null,
    filterQuery: "",
    filterExpr: null,
    filterErr: "",
    sortColumn: "date",
    sortAscending: false, // date desc default like Go
  })
  const [state, setState] = createStore<DataState>(initialState())

  function refresh() {
    if (!db) return
    // Every write ends here: what's cached from the database is stale.
    dbVersion++
    const accounts = loadAccounts(db)
    const categories = loadCategories(db)
    const tags = loadTags(db)
    const rules = loadRules(db)
    const transactions = loadTransactions(db)
    const imports = loadImports(db)
    const accountSelection = normaliseSelection(accounts, state.accountSelection)
    const syncAccounts = loadAccounts(db, { includeUnsynced: true }).filter((a) => a.source !== "csv")
    const dbInfo = loadDbInfo(db, state.dbPath || "default")
    setState("suggestions", reconcile(Object.fromEntries(loadSuggestions(db).map((s) => [s.transactionId, s]))))
    setState({
      ready: true,
      accounts,
      syncAccounts,
      budgets: loadBudgets(db),
      budgetCycle: loadBudgetCycle(db),
      categories,
      tags,
      rules,
      transactions,
      imports,
      accountSelection,
      dbInfo,
    })
  }

  /** A write to the open database, then a reload of the store from it. */
  let dbVersion = 0

  function mutate<T>(write: (db: Db) => T): T {
    if (!db) throw new Error("db not open")
    const result = write(db)
    refresh()
    return result
  }

  /** An Up client for the token in the environment now. */
  const upClient = () => createUpClient({ token: readUpToken() })

  function init(dbPath?: string) {
    setUndoStack([])
    setLastRepeat(null)
    setState({ apiKeys: loadApiKeys() })
    // Verdicts are per row id, and a new database reuses ids.
    askVerdicts.clear()
    askRun++
    tagReview.invalidateTagReview()
    suggestTried.clear()
    setState({ tagReview: null, aiRuleOffers: [] })
    actualDbPath = dbPath ?? defaultDbPath()
    db = openDb(actualDbPath)
    const config = loadSettingsConfig()
    setState({ dbPath: actualDbPath === ":memory:" ? ":memory:" : actualDbPath })
    setState({ savedFilters: config.savedFilters, importProfiles: config.importProfiles, icons: config.icons !== false, weekStart: config.ui?.weekStart ?? "monday" })
    setState("uiPrefs", reconcile(config.ui ?? {}))
    refresh()
  }

  // Rows derived from the transactions, recomputed once per change and
  // shared by every reader. They work on the plain arrays behind the store:
  // `transactions` and `filterExpr` are only ever replaced whole, so
  // tracking those properties is enough.

  /** Every transaction, as the plain array behind the store. Readers that
   * walk all of them use this: through the store each field read would be
   * a tracked dependency, tens of thousands per pass. */
  const transactions = createRoot(() => createMemo(() => unwrap(state.transactions)))

  /** The budget cycle with the pay dates `payEarly` needs. Everything that
   * works out cycles reads this, not `state.budgetCycle`. */
  const cycle = createRoot(() => createMemo((): CycleConfig => ({ ...state.budgetCycle, paydays: paydays(transactions()) })))

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
  /** Bumped by each ask run and by clearing the filter; a run stops once it's stale. */
  let askRun = 0

  /** Test isolation only: close the database and restore the pre-init state.
   * Call init() before using database actions again. Does not erase disk data. */
  function reset() {
    setUndoStack([])
    setLastRepeat(null)
    db?.close()
    db = null
    actualDbPath = ""
    askRun++
    tagReview.invalidateTagReview()
    suggestTried.clear()
    askVerdicts.clear()
    setAskVersion(0)
    setState(reconcile(initialState()))
  }

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
    if (askTerms(expr).length) askVersion()
    return rows.filter((t) => inView(t) && (!expr || evalFilter(expr, t, askVerdict)))
  }))

  /** The account's rows through the filter, in the table's sort. */
  const scopedTransactions = createRoot(() => createMemo(() => {
    const review = state.tagReview
    const confidence = state.sortColumn !== "confidence" ? undefined
      : review ? (id: number) => review.candidates[id]?.confidence ?? -1
      : (id: number) => state.suggestions[id]?.confidence ?? -1
    const sorted = sortRows(filtered(), state.sortColumn, state.sortAscending, confidence)
    // Near misses after every match, each part in the table's order.
    const near = nearMissIds()
    return near.size ? [...sorted.filter((t) => !near.has(t.id)), ...sorted.filter((t) => near.has(t.id))] : sorted
  }))

  function setFilterLive(q: string) {
    const { expr, err } = reparseFilterInput(q)
    setState({
      filterQuery: q,
      filterExpr: expr,
      filterErr: err,
    })
  }

  function commitFilter(q: string): { ok: boolean; err: string } {
    const trimmed = q.trim()
    if (!trimmed) {
      clearFilter()
      return { ok: true, err: "" }
    }
    const { node, error } = parseFilterStrict(trimmed)
    const live = reparseFilterInput(trimmed)
    if (error || !node) {
      setState({
        filterQuery: trimmed,
        filterExpr: live.expr,
        filterErr: error ?? live.err,
      })
      return { ok: false, err: error ?? "invalid filter" }
    }
    setState({
      filterQuery: trimmed,
      filterExpr: live.expr ?? node,
      filterErr: "",
    })
    return { ok: true, err: "" }
  }

  function clearFilter() {
    askRun++
    setState({
      asking: null,
      askLoose: null,
      filterQuery: "",
      filterExpr: null,
      filterErr: "",
    })
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

  function transactionDetail(id: number): TransactionDetail | null {
    return db ? loadTransactionDetail(db, id) : null
  }

  function updateTransactionNotes(id: number, notes: string): void {
    mutate((db) => setTransactionNotes(db, id, notes))
  }

  const ctx: StoreContext = {
    state, setState, mutate, refresh, transactions, upClient, recordUndo,
    categorySnapshot, restoreCategories, setLastRepeat, askVerdicts, setAskVersion,
    askVerdict, accountScoped, inView, createSettingsTag, saveSavedFilter,
    createSettingsRule, applyRules, deleteSettingsRule, deleteSavedFilter,
    get db() { return db },
    get dbVersion() { return dbVersion },
    get askRun() { return askRun },
    set askRun(value) { askRun = value },
  }
  const push = createUpPush(ctx, { ruleOfferNote: (ids) => ruleOfferNote(ids) })
  const { applyCategories, retryPendingCategories, categorizeTransactions, applyTagPatch } = push
  const suggestions = createSuggestions(ctx, { applyCategories, ruleOfferNote: (ids) => ruleOfferNote(ids) })
  const { suggestCategories, resuggestLike, askAbout, suggestTried, untriedWaiting, markTried, acceptSuggestions, dismissSuggestions } = suggestions
  const tagReview = createTagReview(ctx, { applyTagPatch })
  const { tagGroups, openTagReview, acceptTagCandidates, dismissTagCandidates, closeTagReview } = tagReview
  const { historyData, ruleOffersFor, allRuleOffers, askForRules, ruleOfferNote, makeOfferedRule, declineRuleOffer } = createRuleOffers(ctx, { retryPendingCategories })

  function createSettingsCategory(input: Pick<Category, "name" | "color"> & { notSpending?: boolean }): number {
    return mutate((db) => createCategory(db, input))
  }

  function updateSettingsCategory(id: number, input: Pick<Category, "name" | "color"> & { notSpending?: boolean }) {
    mutate((db) => updateCategory(db, id, input))
  }

  function deleteSettingsCategory(id: number) {
    mutate((db) => deleteCategory(db, id))
  }

  function createSettingsTag(input: Pick<Tag, "name" | "color" | "scope">): number {
    return mutate((db) => createTag(db, input))
  }

  function updateSettingsTag(id: number, input: Pick<Tag, "name" | "color" | "scope">) {
    mutate((db) => updateTag(db, id, input))
  }

  function deleteSettingsTag(id: number) {
    mutate((db) => deleteTag(db, id))
  }

  function createSettingsRule(input: Omit<Rule, "id" | "sortOrder">): number {
    return mutate((db) => createRule(db, input))
  }

  function updateSettingsRule(rule: Rule) { mutate((db) => updateRule(db, rule)) }
  function deleteSettingsRule(id: number) { mutate((db) => deleteRule(db, id)) }
  function reorderSettingsRule(id: number, index: number) { mutate((db) => reorderRule(db, id, index)) }
  function toggleSettingsRule(id: number, enabled: boolean) { mutate((db) => toggleRule(db, id, enabled)) }

  function persistConfig(patch: Partial<SettingsConfig>) {
    // Writes everything as it is now, so a deferred UI write is done too.
    if (configTimer) { clearTimeout(configTimer); configTimer = null }
    saveSettingsConfig({ version: 2, icons: state.icons, savedFilters: state.savedFilters, importProfiles: state.importProfiles, ui: state.uiPrefs, ...patch })
  }

  // Prefs that change with each key (the range, the account, the charts)
  // are written once they settle, not on every press; exit writes any left.
  let configTimer: ReturnType<typeof setTimeout> | null = null
  function flushConfig() {
    if (!configTimer) return
    try { persistConfig({}) } catch { /* the next write or exit tries again */ }
  }
  process.on("exit", flushConfig)

  function recordFilterUsage(id: string) {
    saveUiPrefs({ filterUsage: { ...state.uiPrefs.filterUsage, [id]: new Date().toISOString() } })
  }

  /** `soon`: written once keys settle (CONFIG_SETTLE_MS), for prefs that
   * change on every press; otherwise now. */
  function saveUiPrefs(patch: Partial<UiPrefs>, { soon = false } = {}) {
    const next = { ...state.uiPrefs, ...patch }
    if (next.filterUsage) next.filterUsage = Object.fromEntries(Object.entries(next.filterUsage).filter(([id]) => state.savedFilters.some((filter) => filter.id === id)))
    if (isDeepStrictEqual(unwrap(next), unwrap(state.uiPrefs))) return
    if (!soon) persistConfig({ ui: next })
    setState({ uiPrefs: next, weekStart: next.weekStart ?? "monday" })
    if (soon) {
      if (configTimer) clearTimeout(configTimer)
      configTimer = setTimeout(flushConfig, CONFIG_SETTLE_MS)
    }
  }

  function saveSavedFilter(filter: SavedFilter, originalId?: string) {
    const others = state.savedFilters.filter((f) => f.id !== originalId)
    const normalized = validateSavedFilter(filter, others)
    const next = originalId ? state.savedFilters.map((f) => f.id === originalId ? normalized : f) : [...state.savedFilters, normalized]
    persistConfig({ savedFilters: next })
    setState({ savedFilters: next })
  }

  function setIcons(on: boolean) {
    persistConfig({ icons: on })
    setState({ icons: on })
  }

  function deleteSavedFilter(id: string) {
    const next = state.savedFilters.filter((f) => f.id !== id)
    const filterUsage = state.uiPrefs.filterUsage ? Object.fromEntries(Object.entries(state.uiPrefs.filterUsage).filter(([filterId]) => filterId !== id)) : undefined
    const prefs = { ...state.uiPrefs, ...(filterUsage ? { filterUsage } : {}) }
    persistConfig({ savedFilters: next, ui: prefs })
    setState({ savedFilters: next, uiPrefs: prefs })
  }

  /** Save a profile; `originalId` is the id it had when editing began, so
   * renaming one replaces it instead of leaving the old one behind. */
  function saveImportProfile(profile: ImportProfile, originalId?: string | null) {
    const normalized = validateImportProfile(profile)
    const next = [...state.importProfiles.filter((p) => p.id !== normalized.id && p.id !== originalId), normalized].sort((a, b) => a.id.localeCompare(b.id))
    persistConfig({ importProfiles: next })
    setState({ importProfiles: next })
  }

  function deleteImportProfile(id: string) {
    const next = state.importProfiles.filter((p) => p.id !== id)
    persistConfig({ importProfiles: next })
    setState({ importProfiles: next })
  }

  function dryRunRules(transactionIds?: number[]) {
    const ids = transactionIds ? new Set(transactionIds) : null
    return evaluateRules(ids ? transactions().filter((txn) => ids.has(txn.id)) : transactions(), state.rules, state.savedFilters, state.categories, state.tags)
  }

  function applyRules(transactionIds?: number[], dryRun = false): RuleRunResult {
    if (!db) throw new Error("db not open")
    const report = dryRunRules(transactionIds)
    if (!dryRun) mutate((database) => database.transaction(() => {
      const at = appNow().toISOString()
      for (const change of report.changes) {
        // 'rule' keeps sync from replacing a rule's category with the
        // provider's. An Up row Up can hold the category for goes to Up like
        // any categorisation: 'pending' until retryPendingCategories (which a
        // sync runs right after its rules) sends it. (A deviation from the
        // legacy app, which had no provider to send to.)
        if (change.categorySet) {
          const row = database.query(`SELECT source, external_id AS externalId, ext_categorizable AS categorizable FROM transactions WHERE id = ?`).get(change.id) as PushableRow | null
          const category = state.categories.find((c) => c.id === change.categoryId)
          const source = row && category && categoryPush(row, category, state.categories) ? "pending" : "rule"
          database.query(`UPDATE transactions SET category_id = ?, category_source = ? WHERE id = ?`).run(change.categoryId, source, change.id)
          const previous = transactions().find((t) => t.id === change.id)?.categoryId ?? null
          if (change.categoryId != null) logCategories(database, [{ transactionId: change.id, categoryId: change.categoryId, previousCategoryId: previous }], "rule", at)
        }
        for (const tagId of change.tagIds) if (addTagLink(database, change.id, tagId)) logTags(database, [change.id], tagId, true, "rule", at)
      }
    })())
    return { updatedTransactions: report.updatedTransactions, categoryChanges: report.categoryChanges, tagChanges: report.tagChanges, failedRules: report.failedRules }
  }

  function csvFiles(directory: string): string[] {
    try {
      return readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".csv"))
        .map((entry) => join(directory, entry.name)).sort((a, b) => a.localeCompare(b))
    } catch (error) { throw new Error(`cannot read import folder: ${error instanceof Error ? error.message : String(error)}`) }
  }

  function importDirectory(): string { return resolve(process.env.JASKMONEY_IMPORT_DIR ?? process.cwd()) }

  function profileMatches(path: string): ImportProfile[] { return matchingProfiles(state.importProfiles, basename(path)) }

  function previewImport(path: string, profile: ImportProfile): ImportPreview {
    if (!db) throw new Error("db not open")
    return buildImportPreview(db, readFileSync(path, "utf8"), path, validateImportProfile(profile))
  }

  function commitPreview(preview: ImportPreview, skipDuplicates: boolean): string {
    if (!db) throw new Error("db not open")
    const result = mutate((db) => commitImportPreview(db, preview, skipDuplicates))
    const applied = preview.rulesEnabled && result.transactionIds.length ? applyRules(result.transactionIds) : null
    const summary = `Imported ${result.inserted} rows from ${result.accountName}${result.skippedDupes ? ` (${result.skippedDupes} duplicates ${skipDuplicates ? "skipped" : "forced"})` : ""}${applied?.updatedTransactions ? ` · ${applied.updatedTransactions} rules applied` : ""}`
    return summary
  }

  async function syncUp(): Promise<string> {
    if (state.upSyncing) throw new Error("Up sync is already running")
    if (!db) throw new Error("db not open")
    setState({ upSyncing: true })
    try {
      const result = await runUpSync(db, upClient()).catch((error: unknown) => {
        try { refresh() } catch { /* Preserve the sync error if reloading also fails. */ }
        throw error
      })
      refresh()
      const applied = result.insertedIds.length ? applyRules(result.insertedIds) : null
      // Categorisations Up hasn't confirmed go again now Up is answering.
      const retried = await retryPendingCategories()
      const parts = [`Up sync: ${result.inserted} new, ${result.updated} updated, ${result.removedHeld} pending removed${applied?.updatedTransactions ? ` · ${applied.updatedTransactions} rules applied` : ""}`]
      if (retried.pushed) parts.push(`${retried.pushed} waiting categor${retried.pushed === 1 ? "y" : "ies"} sent to Up`)
      if (retried.rejected) parts.push(`${retried.rejected} Up refused (kept here only)`)
      if (retried.waiting) parts.push(`${retried.waiting} still waiting for Up`)
      return parts.join(" · ")
    } finally {
      setState({ upSyncing: false })
    }
  }

  function setBudget(scope: BudgetScope, amount: number): void {
    mutate((db) => saveBudget(db, scope, amount))
  }

  function removeBudget(id: number): void {
    mutate((db) => deleteBudget(db, id))
  }

  function setBudgetCycle(config: CycleConfig): void {
    mutate((db) => saveBudgetCycle(db, config))
  }

  /** Returns the number of transactions removed when switching sync off. */
  function setAccountSync(accountId: number, enabled: boolean): number {
    return mutate((db) => setAccountSyncEnabled(db, accountId, enabled))
  }

  function clearDatabaseData(): void { mutate((db) => clearAllData(db)) }
  function clearAccountData(accountId: number): number { return mutate((db) => clearAccountTransactions(db, accountId)) }
  function removeAccountData(accountId: number): number {
    if (!db) throw new Error("db not open")
    const n = removeAccountWithTransactions(db, accountId)
    if (state.accountSelection === accountId) setState({ accountSelection: "all" })
    refresh()
    return n
  }

  function factoryResetDatabase(): void {
    if (!db) throw new Error("db not open")
    if (actualDbPath === ":memory:") { db.close(); db = openDb(":memory:") }
    else {
      db.close()
      // Explicit paths only: never use a glob or a user-entered directory.
      for (const path of [actualDbPath, `${actualDbPath}-wal`, `${actualDbPath}-shm`]) if (existsSync(path)) unlinkSync(path)
      db = openDb(actualDbPath)
    }
    setState({ accountSelection: "all" })
    refresh()
  }

  function filterPreview(): string {
    if (state.filterExpr) return filterExprString(state.filterExpr)
    return state.filterQuery
  }

  return {
    state,
    setState,
    reset,
    init,
    refresh,
    transactions,
    cycle,
    accountScoped,
    scopedTransactions,
    setFilterLive,
    commitFilter,
    clearFilter,
    cycleSortColumn,
    toggleSortDirection,
    setAccountSelection,
    categorizeTransactions,
    undoLabel: () => undoStack().at(-1)?.label ?? null,
    undo,
    lastRepeat,
    repeatLast,
    /** The Uncategorised view sorts by suggestion confidence, most sure
     * first; leaving it goes back to date order if it still was. */
    askScore,
    askCounts,
    nearMissesShown,
    nearMissIds,
    setAskLoose: (on: boolean | null) => setState({ askLoose: on }),
    setUncategorisedOnly: (on: boolean) => setState(on
      ? { uncategorisedOnly: true, sortColumn: "confidence", sortAscending: false }
      : { uncategorisedOnly: false, ...(state.sortColumn === "confidence" ? { sortColumn: "date" as const, sortAscending: false } : {}) }),
    /** Save (or with null, remove) API keys entered in Settings. */
    saveApiKeys: (patch: Partial<Record<CredentialName, string | null>>) => { saveCredentials(patch); setState({ apiKeys: loadApiKeys(), signedIn: loadSignedIn() }) },
    /** After a sign-in or sign-out. */
    refreshApiKeys: () => setState({ apiKeys: loadApiKeys(), signedIn: loadSignedIn() }),
    askAbout,
    suggestCategories,
    resuggestLike,
    retryPendingCategories,
    tagGroups,
    untriedWaiting,
    markTried,
    openTagReview,
    acceptTagCandidates,
    dismissTagCandidates,
    closeTagReview,
    acceptSuggestions,
    dismissSuggestions,
    applyTagPatch,
    transactionDetail,
    updateTransactionNotes,
    createSettingsCategory,
    updateSettingsCategory,
    deleteSettingsCategory,
    createSettingsTag,
    updateSettingsTag,
    deleteSettingsTag,
    createSettingsRule,
    updateSettingsRule,
    deleteSettingsRule,
    reorderSettingsRule,
    toggleSettingsRule,
    saveSavedFilter,
    setIcons,
    saveUiPrefs,
    deleteSavedFilter,
    saveImportProfile,
    deleteImportProfile,
    applyRules,
    ruleOffersFor,
    allRuleOffers,
    askForRules,
    historyData,
    makeOfferedRule,
    declineRuleOffer,
    dryRunRules,
    recordFilterUsage,
    csvFiles,
    importDirectory,
    profileMatches,
    previewImport,
    commitPreview,
    syncUp,
    setAccountSync,
    setBudget,
    removeBudget,
    setBudgetCycle,
    clearDatabaseData,
    clearAccountData,
    removeAccountData,
    factoryResetDatabase,
    filterPreview,
    getDb: () => db,
  }
}

export type DataStore = ReturnType<typeof createDataStore>
export const data = createDataStore()
