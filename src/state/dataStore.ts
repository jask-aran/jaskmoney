import { createMemo, createRoot, createSignal } from "solid-js"
import { createStore, reconcile, unwrap, produce } from "solid-js/store"
import { isDeepStrictEqual } from "node:util"
import { existsSync, readFileSync, readdirSync, unlinkSync } from "node:fs"
import { basename, join, resolve } from "node:path"
import {
  addTagToTransactions,
  loadAccounts,
  loadCategories,
  loadDbInfo,
  loadRules,
  loadTags,
  loadTransactions,
  loadSuggestions,
  saveSuggestions,
  deleteSuggestions,
  dismissSuggestionRows,
  recordCategoryChoices,
  unrecordCategoryChoices,
  undismissSuggestionRows,
  deleteTagDismissals,
  logCategories,
  declineRule,
  loadRuleDeclines,
  loadCategoryLog,
  loadTagLog,
  unlogCategory,
  logTags,
  type CategoryHow,
  type TagHow,
  loadCategoryChoices,
  declineCategoryChoice,
  loadDismissedSuggestionIds,
  loadTagDismissals,
  saveTagDismissals,
  openDb,
  removeTagFromTransactions,
  setTransactionCategory,
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
import { hasJev, jevClient, type JevClient } from "../ai/jev"
import { CREDENTIAL_NAMES, credentialEnv, credentialSource, maskSecret, saveCredentials, type CredentialName, NOT_SECRET } from "../ai/credentials"
import { historySuggestions, jevSuggestions } from "../domain/suggest"
import { isOrdinaryFlow, isUncategorised } from "../domain/moneyRules"
import { createUpClient, readUpToken, UpApiError } from "../up/client"
import { PUSH_CONCURRENCY, pushTransactions } from "../up/push"
import { count } from "../ui/text"
import { ruleOffers, type RuleOffer } from "../domain/ruleOffers"
import type { HistoryData } from "../domain/aiHistory"
import { createLlm, type Llm, type LlmProvider } from "../ai/llm"
import { signedIn } from "../ai/oauthStore"
import { writeRules } from "../ai/ruleWriter"
import { detectRecurring, detectTrips } from "../domain/tagGroups"
import { jevTagCandidates, knownTagCandidates, TAG_SHOW_AT, tagExamples, tagPool, type TagCandidate, type TagTarget } from "../domain/tagSuggest"
import { appNow, appToday, type WeekStart } from "../domain/days"
import { askCandidates, ASK_DEFAULT_DAYS, ASK_LIMIT, judgeRows } from "../domain/ask"
import { ACCEPT_ALL_AT, MATCH_AT, NEAR_AT } from "../domain/questions"
import { addTagLink } from "../db/tagLinks"
import { syncUp as runUpSync } from "../up/sync"
import { dryRunRules as evaluateRules } from "../domain/rules"
import { pushTagChange } from "../up/tags"
import {
  evalFilter,
  filterExprString,
  parseFilterStrict,
  reparseFilterInput,
  askTerms,
  hasDateTerm,
  undecided,
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

interface CategorizeResult { done: number; pushed: number; failures: string[]; waiting: number; waitingError?: string }

/** "<what> · N updated in Up · N waiting for Up … · N failed: <first error>". */
function operationSummary(head: string, r: Pick<CategorizeResult, "pushed" | "failures"> & Partial<Pick<CategorizeResult, "waiting" | "waitingError">>): string {
  const parts = [head]
  if (r.pushed) parts.push(`${r.pushed} updated in Up`)
  if (r.waiting) parts.push(`${r.waiting} waiting for Up (${r.waitingError}; sent on the next sync)`)
  if (r.failures.length) parts.push(`${r.failures.length} failed: ${r.failures[0]}`)
  return parts.join(" · ")
}

/** A transaction as far as pushing its category goes. */
interface PushableRow { source: string; externalId: string | null; categorizable: number | null }
/** Where a category goes in Up: an Up subcategory, or null (no category). */
interface CategoryPush { categoryId: number; externalId: string; providerId: string | null; parentExt: string | null }

/** The push that puts `category` on `row` in Up, or null when Up can't hold
 * it: not an Up row, one Up won't categorise, or a local-only category. */
function categoryPush(row: PushableRow, category: Category, categories: Category[]): CategoryPush | null {
  if (row.source !== "up" || row.externalId == null || row.categorizable !== 1) return null
  if (category.extId && category.parentId != null) {
    const parentExt = categories.find((c) => c.id === category.parentId)?.extId ?? null
    return { categoryId: category.id, externalId: row.externalId, providerId: category.extId, parentExt }
  }
  if (category.isDefault) return { categoryId: category.id, externalId: row.externalId, providerId: null, parentExt: null }
  return null
}

/** Up has the category: the row follows Up again ('provider', or never set
 * for no category). */
function confirmCategoryPush(db: Db, id: number, p: CategoryPush): void {
  setTransactionCategory(db, id, p.categoryId, p.providerId ? "provider" : null, { extCategory: p.providerId, extParentCategory: p.providerId ? p.parentExt : null })
}

/** Why Up didn't answer, in a few words (the status line has room for little). */
function waitReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/JASKMONEY_UP_TOKEN/.test(message)) return "no Up token"
  if (error instanceof UpApiError) {
    if (error.status === 401) return "Up token rejected"
    if (error.status === 429) return "Up is busy"
    if (error.status >= 500) return "Up is down"
  }
  return message.length > 40 ? `${message.slice(0, 39)}…` : message
}

/** Up refused the change itself (not a network, rate-limit or token problem):
 * asking again won't help. */
function upRejected(error: unknown): boolean {
  return error instanceof UpApiError && error.status >= 400 && error.status < 500 && error.status !== 401 && error.status !== 429
}

/** Finding transactions for a tag: its target and the candidates so far. */
export interface TagReview extends TagTarget {
  candidates: Record<number, TagCandidate>
  /** Jev is still answering. */
  asking: boolean
}

/** A tag created from a review (the schema's default tag colour). */
const NEW_TAG_COLOR = "#94e2d5"

function createDataStore() {
  let db: Db | null = null
  let actualDbPath = ""
  type TagPatch = Record<number, "add" | "remove">
  type Repeat = { kind: "category"; categoryId: number } | { kind: "tags"; patch: TagPatch }
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
    tagRun++
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
    tagRun++
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

  /**
   * Give each row (id → category id) its category: all of them locally at
   * once, shown before any request, then pushed to the provider where it
   * can hold the choice: an Up transaction it marks categorisable takes an
   * Up subcategory, or "no category" for the default (Uncategorised). Pushed
   * rows then follow the provider (source 'provider'). Anything else (a
   * local-only category, a transfer, a CSV row) is the user's choice
   * ('user'). A rejected push puts its row back as it was. Up has no batch
   * endpoint: pushes run PUSH_CONCURRENCY at a time, `onProgress` hearing
   * each (0 of n first, once every row shows its new category).
   */
  async function applyCategories(
    assignments: Map<number, number>,
    how: CategoryHow,
    onProgress?: (pushed: number, total: number) => void,
  ): Promise<CategorizeResult> {
    if (!db) throw new Error("db not open")
    const database = db
    type Prior = { categoryId: number | null; source: string | null; ext: string | null; extParent: string | null }
    const pushes = new Map<number, CategoryPush & { prior: Prior }>()
    let local = 0
    const chosen = new Map<string, { description: string; categoryId: number; times: number }>()
    const logged: { transactionId: number; categoryId: number; previousCategoryId: number | null }[] = []
    database.transaction(() => {
      for (const [id, categoryId] of assignments) {
        const t = transactions().find((x) => x.id === id)
        if (t && t.categoryId !== categoryId) {
          logged.push({ transactionId: id, categoryId, previousCategoryId: t.categoryId })
          const key = `${t.description.trim().toLowerCase()}\u0000${categoryId}`
          chosen.set(key, { description: t.description, categoryId, times: (chosen.get(key)?.times ?? 0) + 1 })
        }
        const category = state.categories.find((c) => c.id === categoryId)
        if (!category) throw new Error("category not found")
        const row = database.query(`SELECT source, external_id AS externalId, ext_categorizable AS categorizable,
          category_id AS categoryId, category_source AS categorySource, ext_category AS ext, ext_parent_category AS extParent
          FROM transactions WHERE id = ?`).get(id) as PushableRow & {
            categoryId: number | null; categorySource: string | null; ext: string | null; extParent: string | null
          } | null
        if (!row) continue
        const push = categoryPush(row, category, state.categories)
        // Shown at once; a push confirms it, a rejection puts it back.
        setTransactionCategory(database, id, categoryId, push ? "pending" : "user")
        if (push) pushes.set(id, { ...push, prior: { categoryId: row.categoryId, source: row.categorySource, ext: row.ext, extParent: row.extParent } })
        else local++
      }
      // Repeated choices turn into rule offers (ruleOffersFor).
      if (how !== "undo") recordCategoryChoices(database, [...chosen.values()])
      logCategories(database, logged, how, appNow().toISOString())
    })()
    refresh()
    let settled = 0, waiting = 0
    const waitingErrors: string[] = []
    onProgress?.(0, pushes.size)
    const { pushed, failures } = await pushTransactions([...pushes.keys()], (id) => {
      const p = pushes.get(id)!
      return async () => {
        pushingIds.add(id)
        try {
          await upClient().setTransactionCategory(p.externalId, p.providerId)
        } catch (error) {
          if (!upRejected(error)) {
            // Up didn't answer: it stays 'pending' for the next sync.
            waiting++
            waitingErrors.push(waitReason(error))
            return 0
          }
          database.query(`UPDATE transactions SET category_id = ?, category_source = ?, ext_category = ?, ext_parent_category = ? WHERE id = ?`)
            .run(p.prior.categoryId, p.prior.source, p.prior.ext, p.prior.extParent, id)
          unlogCategory(database, id, p.categoryId)
          throw error
        } finally {
          pushingIds.delete(id)
        }
        confirmCategoryPush(database, id, p)
        return 1
      }
    }, { complete: refresh, onSettled: () => onProgress?.(++settled, pushes.size), concurrency: PUSH_CONCURRENCY })
    return { done: local + pushed, pushed: pushed - waiting, failures, waiting, waitingError: waitingErrors[0] }
  }

  /** Rows whose categorisation is on its way to Up now (a retry leaves them alone). */
  const pushingIds = new Set<number>()

  /**
   * Push the categorisations Up hasn't confirmed ('pending': the app closed
   * mid-push, or Up didn't answer), after each Up sync. Confirmed rows follow
   * Up; one Up rejects keeps its category here only ('user'); one it still
   * doesn't answer stays pending for the next sync. A row that can no longer
   * go to Up (its category is local now, or Up says it can't be
   * categorised) becomes 'user'.
   */
  async function retryPendingCategories(): Promise<{ pushed: number; rejected: number; waiting: number }> {
    if (!db) return { pushed: 0, rejected: 0, waiting: 0 }
    const database = db
    const rows = database.query(`SELECT id, category_id AS categoryId, source, external_id AS externalId, ext_categorizable AS categorizable
      FROM transactions WHERE category_source = 'pending'`).all() as Array<PushableRow & { id: number; categoryId: number | null }>
    const pushes = new Map<number, CategoryPush>()
    database.transaction(() => {
      for (const row of rows) {
        if (pushingIds.has(row.id)) continue
        const category = state.categories.find((c) => row.categoryId == null ? c.isDefault : c.id === row.categoryId)
        const push = category && categoryPush(row, category, state.categories)
        if (push) pushes.set(row.id, push)
        else database.query(`UPDATE transactions SET category_source = 'user' WHERE id = ?`).run(row.id)
      }
    })()
    let rejected = 0, waiting = 0
    const { pushed } = await pushTransactions([...pushes.keys()], (id) => {
      const p = pushes.get(id)!
      return async () => {
        try {
          await upClient().setTransactionCategory(p.externalId, p.providerId)
        } catch (error) {
          if (upRejected(error)) { rejected++; database.query(`UPDATE transactions SET category_source = 'user' WHERE id = ?`).run(id) }
          else waiting++
          throw error
        }
        confirmCategoryPush(database, id, p)
        return 1
      }
    }, { concurrency: PUSH_CONCURRENCY })
    if (rows.length) refresh()
    return { pushed, rejected, waiting }
  }

  /** Put `txnIds` in one category (see applyCategories). */
  async function categorizeTransactions(txnIds: number[], categoryId: number, onProgress?: (pushed: number, total: number) => void): Promise<string> {
    const category = state.categories.find((c) => c.id === categoryId)
    if (!category) throw new Error("category not found")
    const assignments = new Map(txnIds.map((id) => [id, categoryId]))
    const before = categorySnapshot(assignments)
    setLastRepeat({ kind: "category", categoryId })
    const result = await applyCategories(assignments, "choose", onProgress)
    const changed = before.filter((row) => transactions().some((t) => t.id === row.id && t.categoryId !== row.categoryId))
    if (changed.length) recordUndo(`categorised ${changed.length} → ${category.name}`, async () => {
      const summary = await restoreCategories(changed)
      mutate((db) => unrecordCategoryChoices(db, before.map((row) => ({ description: row.description, categoryId, times: 1 }))))
      return summary
    })
    return operationSummary(`Categorized ${result.done} → ${category.name}`, result) + ruleOfferNote(txnIds)
  }

  let suggestionsFinished: Promise<void> = Promise.resolve()

  /**
   * Suggest categories for ordinary uncategorised rows (`ids` narrows them)
   * that have none yet: history first, then Jev when it is set up, each
   * request's suggestions saved as they arrive. `ai` replaces the Jev client
   * (tests).
   */
  function suggestCategories(ids?: number[], ai?: Pick<JevClient, "judge">): Promise<string>
  function suggestCategories(ids: number[], ai: Pick<JevClient, "judge"> | undefined, options: { replace: true }): Promise<number>
  async function suggestCategories(ids?: number[], ai?: Pick<JevClient, "judge">, options: { replace?: boolean } = {}): Promise<string | number> {
    if (state.suggesting) throw new Error("Category suggestions are already running")
    if (!db) throw new Error("db not open")
    const database = db
    let finish = () => {}
    const finished = new Promise<void>((resolve) => { finish = resolve })
    suggestionsFinished = finished
    setState({ suggesting: true })
    try {
      const selected = ids ? new Set(ids) : null
      // Rows whose suggestion was dismissed get no new one.
      const dismissed = loadDismissedSuggestionIds(database)
      const targets = transactions().filter((t) => isOrdinaryFlow(t) && isUncategorised(t) && !dismissed.has(t.id) && (options.replace ? !!state.suggestions[t.id] : !state.suggestions[t.id]) && (!selected || selected.has(t.id)))
      const history = historySuggestions(transactions(), state.categories, new Set(targets.map((t) => t.id)))
      saveSuggestions(database, history)
      refresh()
      const failures: string[] = []
      let fromJev = 0
      const enabled = !!ai || hasJev()
      if (enabled) {
        const targetIds = new Set(targets.map((t) => t.id))
        const settled = new Set(history.map((s) => s.transactionId))
        const remaining = transactions().filter((t) => targetIds.has(t.id) && !settled.has(t.id) && (options.replace ? !!state.suggestions[t.id] : !state.suggestions[t.id]) && isOrdinaryFlow(t) && isUncategorised(t))
        if (remaining.length) await jevSuggestions(ai ?? jevClient(), remaining, state.categories, {
          history: transactions(),
          onSuggestion: (s) => {
            if (db !== database || !targetIds.has(s.transactionId)) return
            const current = transactions().find((t) => t.id === s.transactionId)
            if (!current || !isOrdinaryFlow(current) || !isUncategorised(current) || (options.replace ? !state.suggestions[s.transactionId] : state.suggestions[s.transactionId])) return
            saveSuggestions(database, [s])
            setState("suggestions", s.transactionId, s)
            fromJev++
          },
          onError: (ids, error) => failures.push(`${ids.length} rows: ${error instanceof Error ? error.message : String(error)}`),
        })
      }
      if (options.replace) return history.length + fromJev
      const parts = [`Suggested ${history.length + fromJev}: ${history.length} from history, ${fromJev} from Jev`]
      if (!enabled) parts.push("Jev is not set up (JASKMONEY_JEV_TOKEN)")
      if (failures.length) parts.push(`${failures.length} failed: ${failures[0]}`)
      return parts.join(" · ")
    } finally {
      try { if (db === database) refresh() } finally {
        if (suggestionsFinished === finished) setState({ suggesting: false })
        finish()
      }
    }
  }

  /** Replace existing suggestions for waiting rows with the same description. */
  async function resuggestLike(ids: number[], ai?: Pick<JevClient, "judge">): Promise<number> {
    const database = db
    while (state.suggesting) {
      await suggestionsFinished
      if (db !== database) return 0
    }
    if (!database || db !== database) return 0
    const selected = new Set(ids)
    const key = (t: Transaction) => t.description.trim().toLowerCase()
    const descriptions = new Set(transactions().filter((t) => selected.has(t.id)).map(key))
    const targets = transactions().filter((t) => !selected.has(t.id) && descriptions.has(key(t)) && isOrdinaryFlow(t) && isUncategorised(t) && state.suggestions[t.id]).map((t) => t.id)
    if (!targets.length) return 0
    return suggestCategories(targets, ai, { replace: true })
  }

  /**
   * Have Jev judge the rows the current filter's `ask:` terms are waiting
   * on: those the rest of the filter leaves possible, not judged yet, from
   * the last ASK_DEFAULT_DAYS unless the filter limits dates, at most
   * ASK_LIMIT, newest first. Matches show as each batch lands. Returns a
   * summary, or "" when a newer run or a cleared filter took over.
   */
  async function askAbout(ai?: Pick<JevClient, "judge">): Promise<string> {
    const expr = state.filterExpr ? unwrap(state.filterExpr) : null
    const terms = askTerms(expr)
    if (!terms.length) return ""
    if (!ai && !hasJev()) throw new Error("Set JASKMONEY_JEV_TOKEN (a TypeSafe API key) to use ask:")
    const run = ++askRun
    const client = ai ?? jevClient()
    const parts: string[] = []
    const failures: string[] = []
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
        await judgeRows(client, words, todo, {
          active: () => run === askRun,
          onJudged: (scores) => {
            if (run !== askRun) return
            for (const [id, p] of scores) known.set(id, p)
            setAskVersion((v) => v + 1)
            setState("asking", (a) => a && { ...a, judged: a.judged + scores.size })
          },
          onError: (error) => failures.push(error instanceof Error ? error.message : String(error)),
        })
        if (run !== askRun) return ""
        const matched = rows.filter((t) => (known.get(t.id) ?? 0) >= MATCH_AT).length
        const near = rows.filter((t) => { const p = known.get(t.id) ?? 0; return p >= NEAR_AT && p < MATCH_AT }).length
        let part = `ask "${words}": ${matched} of ${rows.length} match`
        if (near) part += `, ${near} near (n shows them)`
        if (skipped && !hasDateTerm(expr)) part += ` · judged the last ${ASK_DEFAULT_DAYS} days (add date: to look further)`
        else if (skipped) part += ` · judged the latest ${ASK_LIMIT} of ${rows.length + skipped}`
        parts.push(part)
      }
    } finally {
      if (run === askRun) setState({ asking: null })
    }
    if (failures.length) parts.push(`${failures.length} request${failures.length > 1 ? "s" : ""} failed: ${failures[0]}`)
    return parts.join(" · ")
  }

  /** Rows background suggesting has asked about since the database opened:
   * one Jev couldn't place isn't asked again every sync. */
  const suggestTried = new Set<number>()
  /** Waiting rows with no suggestion that background suggesting hasn't tried. */
  const untriedWaiting = () => transactions().filter((t) => isOrdinaryFlow(t) && isUncategorised(t) && !state.suggestions[t.id] && !suggestTried.has(t.id)).map((t) => t.id)
  const markTried = (ids: number[]) => { for (const id of ids) suggestTried.add(id) }

  /** Detected groupings in the history: trips, then regular payments. */
  const tagGroups = createRoot(() => createMemo(() => [...detectTrips(transactions()), ...detectRecurring(transactions())]))

  /** Bumped by each tag review opened or closed; a run stops once stale. */
  let tagRun = 0

  /**
   * Show the transactions `target` could go on (see tagSuggest): the group's
   * and history's at once, Jev's as its answers land (`ai` replaces the Jev
   * client in tests). Returns a summary, or "" when closed meanwhile.
   */
  async function openTagReview(target: TagTarget, ai?: Pick<JevClient, "judge">): Promise<string> {
    // Tag names are upper case (createTag); a new one is named as it will be.
    if (target.tagId == null) target = { ...target, name: target.name.trim().toUpperCase() }
    const run = ++tagRun
    const dismissed = db ? loadTagDismissals(db, target.name) : new Set<number>()
    const known = knownTagCandidates(target, transactions()).filter((c) => !dismissed.has(c.transactionId))
    setState({
      uncategorisedOnly: false, sortColumn: "confidence", sortAscending: false,
      tagReview: { ...target, candidates: Object.fromEntries(known.map((c) => [c.transactionId, c])), asking: true },
    })
    const failures: string[] = []
    if (ai || hasJev()) {
      // The group's rows are settled; Jev weighs the rest of the scope.
      const settled = new Set(known.filter((c) => c.source === "group").map((c) => c.transactionId))
      const rows = tagPool(target, transactions()).filter((t) => !settled.has(t.id) && !dismissed.has(t.id))
      await jevTagCandidates(ai ?? jevClient(), target, rows, tagExamples(target, transactions()), {
        active: () => run === tagRun,
        onCandidates: (found) => {
          if (run !== tagRun) return
          setState("tagReview", "candidates", (prev) => {
            const next = { ...prev }
            for (const c of found) if (!next[c.transactionId] || c.confidence > next[c.transactionId]!.confidence) next[c.transactionId] = c
            return next
          })
        },
        onError: (error) => failures.push(error instanceof Error ? error.message : String(error)),
      })
    }
    if (run !== tagRun || !state.tagReview) return ""
    setState("tagReview", "asking", false)
    const shown = Object.values(state.tagReview.candidates).filter((c) => c.confidence >= TAG_SHOW_AT)
    const parts = [`${target.name}: ${shown.length} to review, ${shown.filter((c) => c.confidence >= ACCEPT_ALL_AT).length} at ${ACCEPT_ALL_AT * 100}% or more`]
    if (!ai && !hasJev()) parts.push("Jev isn't set up: tag history and detected groups only")
    if (failures.length) parts.push(`${failures.length} failed: ${failures[0]}`)
    return parts.join(" · ")
  }

  /** Put the review's tag on the candidates among `ids` (creating the tag,
   * with its scope, when it is new); they leave the review. */
  async function acceptTagCandidates(ids: number[]): Promise<string> {
    const review = state.tagReview
    if (!review) return ""
    const take = ids.filter((id) => review.candidates[id])
    if (!take.length) return "Nothing to tag"
    let tagId = review.tagId
    if (tagId == null) {
      tagId = createSettingsTag({ name: review.name, color: NEW_TAG_COLOR, scope: review.scope })
      setState("tagReview", "tagId", tagId)
    }
    const summary = await applyTagPatch(take, { [tagId]: "add" }, "review")
    const tagged = new Set(transactions().filter((t) => t.tagIds.includes(tagId!)).map((t) => t.id))
    // produce: a store merges a plain object into the old one, keeping removed keys.
    setState("tagReview", "candidates", produce((c) => { for (const id of take) if (tagged.has(id)) delete c[id] }))
    return summary
  }

  /** Drop candidates from the review, remembered for the tag (by name). */
  function dismissTagCandidates(ids: number[]): void {
    const review = state.tagReview
    if (!review || !db) return
    const removed = Object.values(unwrap(review.candidates)).filter((c) => ids.includes(c.transactionId)).map((c) => ({ ...c }))
    if (!removed.length) return
    const run = tagRun
    const tagName = review.name
    saveTagDismissals(db, tagName, removed.map((c) => c.transactionId))
    recordUndo(`dismissed ${count(removed.length, "candidate")}`, async () => {
      mutate((db) => deleteTagDismissals(db, tagName, removed.map((c) => c.transactionId)))
      if (tagRun === run && state.tagReview?.name === tagName) {
        setState("tagReview", "candidates", (prev) => ({ ...prev, ...Object.fromEntries(removed.map((c) => [c.transactionId, c])) }))
      }
      return ""
    })
    setState("tagReview", "candidates", produce((c) => { for (const id of ids) delete c[id] }))
  }

  function closeTagReview(): void {
    tagRun++
    setState({ tagReview: null, ...(state.sortColumn === "confidence" ? { sortColumn: "date" as const, sortAscending: false } : {}) })
  }

  /** Categorise the rows among `ids` that have a suggestion as suggested,
   * all at once (see applyCategories), then clear the suggestions that
   * took; a row Up rejected keeps its suggestion. */
  async function acceptSuggestions(ids: number[], onProgress?: (pushed: number, total: number) => void): Promise<string> {
    if (!db) throw new Error("db not open")
    refresh()
    const assignments = new Map<number, number>()
    for (const id of ids) {
      const suggestion = state.suggestions[id]
      if (suggestion) assignments.set(id, suggestion.categoryId)
    }
    if (!assignments.size) return "No suggestions accepted"
    const before = categorySnapshot(assignments)
    const suggestions = [...assignments.keys()].flatMap((id) => state.suggestions[id] ? [{ ...unwrap(state.suggestions[id]!) }] : [])
    const result = await applyCategories(assignments, "accept", onProgress)
    const accepted = [...assignments].filter(([id, categoryId]) => transactions().some((t) => t.id === id && t.categoryId === categoryId)).map(([id]) => id)
    mutate((db) => deleteSuggestions(db, accepted))
    if (accepted.length) recordUndo(`accepted ${count(accepted.length, "suggestion")}`, async () => {
      const summary = await restoreCategories(before.filter((row) => accepted.includes(row.id)))
      mutate((db) => {
        unrecordCategoryChoices(db, before.map((row) => ({ description: row.description, categoryId: assignments.get(row.id)!, times: 1 })))
        saveSuggestions(db, suggestions.filter((s) => accepted.includes(s.transactionId)))
      })
      return summary
    })
    return operationSummary(`Accepted ${result.done} suggestion${result.done === 1 ? "" : "s"}`, result) + ruleOfferNote(accepted)
  }

  function dismissSuggestions(ids: number[]): void {
    // Kept and marked: re-suggesting (i, a sync) won't make it again.
    const dismissed = [...new Set(ids)].filter((id) => state.suggestions[id])
    mutate((db) => dismissSuggestionRows(db, dismissed))
    if (dismissed.length) recordUndo(`dismissed ${count(dismissed.length, "suggestion")}`, async () => {
      mutate((db) => undismissSuggestionRows(db, dismissed))
      return ""
    })
  }

  async function applyTagPatch(txnIds: number[], patch: TagPatch, how: TagHow = "picker"): Promise<string> {
    if (!db) throw new Error("db not open")
    const database = db
    if (!Object.keys(patch).length) return "Tags unchanged"
    if (how === "picker") setLastRepeat({ kind: "tags", patch: { ...patch } })
    const before = transactions().filter((t) => txnIds.includes(t.id)).map((t) => ({ id: t.id, source: t.source, tagIds: [...t.tagIds] }))
    const reversals: { ids: number[]; patch: TagPatch }[] = []
    const client = {
      addTransactionTags: (id: string, tags: string[]) => upClient().addTransactionTags(id, tags),
      removeTransactionTags: (id: string, tags: string[]) => upClient().removeTransactionTags(id, tags),
    }
    const labels: string[] = []
    const updated = new Set<number>(), pushed = new Set<number>()
    const failures: string[] = []
    try {
      for (const [key, action] of Object.entries(patch)) {
        const tagId = Number(key)
        const tag = state.tags.find((t) => t.id === tagId)
        if (!tag) throw new Error("tag not found")
        const add = action === "add"
        labels.push(`${add ? "+" : "-"}${tag.name}`)
        const targets = before.filter((t) => t.tagIds.includes(tagId) !== add).map((t) => t.id)
        const local = targets.filter((id) => tag.name.toUpperCase() === "IGNORE"
          || before.find((t) => t.id === id)?.source !== "up")
        if (add) addTagToTransactions(database, local, tagId)
        else removeTagFromTransactions(database, local, tagId)
        for (const id of local) updated.add(id)
        // Up rows in one batch (pushTagChange sends several at once); each
        // applies here once Up confirms it.
        const remote = targets.filter((id) => !local.includes(id))
        const result = remote.length ? await pushTagChange(database, client, remote, tagId, add) : null
        for (const id of result?.changedIds ?? []) updated.add(id)
        for (const id of result?.pushedIds ?? []) pushed.add(id)
        failures.push(...(result?.failures ?? []))
        const changed = [...local, ...(result?.changedIds ?? [])]
        if (changed.length) reversals.push({ ids: changed, patch: { [tagId]: add ? "remove" : "add" } })
        logTags(database, changed, tagId, add, how, appNow().toISOString())
      }
    } finally {
      refresh()
    }
    if ((how === "picker" || how === "review") && updated.size) recordUndo(`${labels.join(", ")} on ${updated.size}`, async () => {
      const summaries: string[] = []
      for (const reversal of reversals) summaries.push(await applyTagPatch(reversal.ids, reversal.patch, "undo"))
      return summaries.join(" · ")
    })
    return operationSummary(`Tags: ${labels.join(", ")} on ${updated.size}`, { pushed: pushed.size, failures })
  }

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
    saveSettingsConfig({ version: 2, icons: state.icons, savedFilters: state.savedFilters, importProfiles: state.importProfiles, ui: state.uiPrefs, ...patch })
  }

  function recordFilterUsage(id: string) {
    saveUiPrefs({ filterUsage: { ...state.uiPrefs.filterUsage, [id]: new Date().toISOString() } })
  }

  function saveUiPrefs(patch: Partial<UiPrefs>) {
    const next = { ...state.uiPrefs, ...patch }
    if (next.filterUsage) next.filterUsage = Object.fromEntries(Object.entries(next.filterUsage).filter(([id]) => state.savedFilters.some((filter) => filter.id === id)))
    if (isDeepStrictEqual(unwrap(next), unwrap(state.uiPrefs))) return
    persistConfig({ ui: next })
    setState({ uiPrefs: next, weekStart: next.weekStart ?? "monday" })
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

  /** The history the AI reads (domain/aiHistory): current state and the logs. */
  function historyData(): HistoryData {
    return {
      transactions: transactions(), categories: state.categories, tags: state.tags, rules: state.rules, savedFilters: state.savedFilters,
      categoryLog: db ? loadCategoryLog(db) : [], tagLog: db ? loadTagLog(db) : [],
      categorySources: db ? new Map(db.query<{ id: number; source: string | null }, []>("SELECT id, category_source AS source FROM transactions").all().map((r) => [r.id, r.source])) : undefined,
    }
  }

  /** Rules worth making from your repeated categorisations (all of them, or
   * those for the descriptions of `ids`). */
  function ruleOffersFor(ids?: number[]): RuleOffer[] {
    if (!db) return []
    const descriptions = ids && transactions().filter((t) => ids.includes(t.id)).map((t) => t.description)
    return ruleOffers(loadCategoryChoices(db), transactions(), state.rules, state.savedFilters, state.categories, state.tags, descriptions)
  }

  /** R's list: the repeat offers, then the model's (one per expression and category). */
  function allRuleOffers(): RuleOffer[] {
    const repeat = ruleOffersFor()
    const saved = new Set(state.savedFilters.map((f) => f.expr.toLowerCase()))
    const ai = state.aiRuleOffers.filter((o) => !saved.has(o.expr.toLowerCase()) && !repeat.some((r) => r.expr.toLowerCase() === o.expr.toLowerCase() && r.categoryId === o.categoryId))
    return [...repeat, ...ai]
  }

  /** Ask the general model for rules (ai/ruleWriter); `llm` replaces the
   * OpenRouter one (tests). Its offers replace the last run's. */
  async function askForRules(llm?: Llm, focus?: string): Promise<string> {
    if (!db) throw new Error("db not open")
    if (state.writingRules) throw new Error("Already asking for rules")
    setState({ writingRules: true })
    try {
      const model = llm ?? createLlm()
      const result = await writeRules(model, historyData(), { declined: loadRuleDeclines(db), focus })
      setState("aiRuleOffers", result.offers)
      const cost = result.usage.cost ? ` · $${result.usage.cost.toFixed(4)}` : ""
      if (result.error && !result.offers.length) return `No rules: ${result.error}${cost}`
      const turned = result.rejected.length ? `, ${result.rejected.length} turned down by the check` : ""
      return `${model.model.id.split("/").pop()} proposed ${count(result.offers.length, "rule")}${turned}${cost}`
    } finally {
      setState({ writingRules: false })
    }
  }

  /** " · R: rule for Coles → Groceries", or how many, for the rows just categorised. */
  function ruleOfferNote(ids: number[]): string {
    const offers = ruleOffersFor(ids)
    if (!offers.length) return ""
    if (offers.length > 1) return ` · R: ${offers.length} rules to make`
    const category = state.categories.find((c) => c.id === offers[0]!.categoryId)
    return ` · R: rule for ${offers[0]!.description} → ${category?.name ?? "?"}`
  }

  /** Make an offered rule: a saved filter and a rule (last in order), then
   * run it on the rows it finds waiting, Up rows sent to Up. */
  async function makeOfferedRule(offer: RuleOffer): Promise<string> {
    if (!db) throw new Error("db not open")
    const category = state.categories.find((c) => c.id === offer.categoryId)
    if (!category) throw new Error("category not found")
    const base = `desc-${offer.description.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "rule"}`
    let id = base
    for (let n = 2; state.savedFilters.some((f) => f.id === id); n++) id = `${base}-${n}`
    saveSavedFilter({ id, name: offer.description, expr: offer.expr })
    const ruleId = createSettingsRule({ name: `${offer.description} → ${category.name}`, savedFilterId: id, setCategoryId: category.id, addTagIds: [], enabled: true })
    setState("aiRuleOffers", (offers) => offers.filter((o) => o.expr !== offer.expr))
    const before = transactions().filter((t) => offer.waiting.includes(t.id)).map((t) => ({ id: t.id, categoryId: t.categoryId }))
    const applied = offer.waiting.length ? applyRules(offer.waiting) : null
    const changed = before.filter((row) => transactions().some((t) => t.id === row.id && t.categoryId !== row.categoryId))
    const sent = applied?.categoryChanges ? await retryPendingCategories() : null
    recordUndo(`rule ${offer.description} → ${category.name}`, async () => {
      deleteSettingsRule(ruleId)
      deleteSavedFilter(id)
      return restoreCategories(changed)
    })
    return [
      `Rule made: ${offer.description} → ${category.name}`,
      applied?.categoryChanges ? `${count(applied.categoryChanges, "waiting row")} categorised` : "",
      sent?.pushed ? `${sent.pushed} sent to Up` : "",
      sent?.waiting ? `${sent.waiting} waiting for Up` : "",
    ].filter(Boolean).join(" · ")
  }

  function declineRuleOffer(offer: RuleOffer): void {
    if (offer.source === "ai") {
      mutate((db) => declineRule(db, offer.expr, offer.categoryId))
      setState("aiRuleOffers", (offers) => offers.filter((o) => o !== offer && !(o.expr === offer.expr && o.categoryId === offer.categoryId)))
    } else mutate((db) => declineCategoryChoice(db, offer.description, offer.categoryId))
    recordUndo(`declined rule ${offer.description}`, async () => {
      mutate((db) => {
        if (offer.source === "ai") db.query("DELETE FROM rule_declines WHERE expr = ? AND category_id = ?").run(offer.expr, offer.categoryId)
        else db.query("UPDATE category_choices SET declined = 0 WHERE description = ? AND category_id = ?").run(offer.description.trim().toLowerCase(), offer.categoryId)
      })
      if (offer.source === "ai") setState("aiRuleOffers", (offers) => [...offers, offer])
      return ""
    })
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
