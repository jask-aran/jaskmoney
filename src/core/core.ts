/**
 * The jaskmoney core: the one owner of the database, the settings file, the
 * credentials, Up and the models. Framework-free; clients (the TUI, the web
 * app) see it through `CoreState` patches and call its `commands` over a
 * link (client/link: in-process; server/serve: a WebSocket). See
 * core/protocol for the contract.
 */
import { isDeepStrictEqual } from "node:util"
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync } from "node:fs"
import { join, resolve } from "node:path"
import {
  loadAccounts, loadCategories, loadDbInfo, loadRules, loadTags, loadTransactions, loadSuggestions, loadMerchantNotes,
  loadMerchantBreadth, saveMerchantBreadth, loadCategoryChoices, loadPurchaseLookups, logCategories, logTags, openDb,
  createCategory, updateCategory, setCategoryBudgetIgnored, deleteCategory, createTag, updateTag, deleteTag,
  createRule, updateRule, deleteRule, reorderRule, toggleRule, clearAccountTransactions, clearAllData, defaultDbPath,
  loadImports, removeAccountWithTransactions, setAccountSyncEnabled, deleteBudget, loadBudgetCycle, loadBudgets,
  loadBudgetHistory, saveBudget, saveBudgetCycle, loadTransactionDetail, setTransactionNotes, loadRuleDeclines,
  type Db, type TagInput,
} from "../db/client"
import { cycleFor, paydays, type BudgetScope, type CycleConfig } from "../domain/budget"
import { buildImportPreview, commitImportPreview } from "../domain/profileImport"
import { CREDENTIAL_NAMES, credentialEnv, credentialSource, maskSecret, saveCredentials, type CredentialName, NOT_SECRET } from "../ai/credentials"
import { isOrdinaryFlow, isUncategorised } from "../domain/moneyRules"
import { hasJev, type JevClient } from "../ai/jev"
import type { Llm } from "../ai/llm"
import { createUpClient, readUpToken } from "../up/client"
import { signedIn } from "../ai/oauthStore"
import { appNow, appToday } from "../domain/days"
import { demoSource, generateDemo } from "../domain/demo"
import { seedDemoDb } from "../db/demoSeed"
import { jaskmoneyHome } from "../storage/home"
import { addTagLink, queueTagPush } from "../db/tagLinks"
import { syncUp as runUpSync } from "../up/sync"
import { dryRunRules as evaluateRules } from "../domain/rules"
import type { TagCandidate, TagTarget } from "../domain/tagSuggest"
import type { RuleOffer } from "../domain/ruleOffers"
import type { PurchaseLookup } from "../db/client"
import type { Category, ImportPreview, ImportProfile, Rule, RuleRunResult, SavedFilter } from "../domain/types"
import { loadSettingsConfig, saveSettingsConfig, validateImportProfile, validateSavedFilter, type SettingsConfig, type UiPrefs } from "../state/settingsConfig"
import { createUpPush, categoryPush, operationSummary, type PushableRow } from "./upPush"
import { createSuggestions } from "./suggestions"
import { createTagCandidates } from "./tagReview"
import { createRuleOffers } from "./ruleOffers"
import type { CoreContext, TagPatch, UndoResult } from "./context"
import { emptyCoreState, type CoreProgress, type CoreState, type Repeat } from "./protocol"

/** How a command hears about the call it serves. */
export interface CallContext<P = never> {
  progress: (data: P) => void
  signal: AbortSignal
  /** In-process links only (tests): a Jev client or general model in place
   * of the real ones. */
  ai?: Pick<JevClient, "judge">
  llm?: Llm
}

/** How long the range, account and chart views sit still before they're written. */
export const CONFIG_SETTLE_MS = 400

/** Demo mode makes this many years of rows, the same ones each time. */
const DEMO_YEARS = 3
const DEMO_SEED = 20261027

const loadSignedIn = (): CoreState["signedIn"] => ({ openrouter: signedIn("openrouter"), openai: signedIn("openai") })

/** Each API key's source and mask, read now. */
function loadApiKeys(): CoreState["apiKeys"] {
  const env = credentialEnv()
  return Object.fromEntries(CREDENTIAL_NAMES.map((name) => [name, { source: credentialSource(name), mask: NOT_SECRET.has(name) ? (env[name] ?? "") : maskSecret(env[name]) }])) as CoreState["apiKeys"]
}

const keyState = () => ({ apiKeys: loadApiKeys(), signedIn: loadSignedIn(), jev: hasJev() })

export function initialCoreState(): CoreState {
  return { ...emptyCoreState(), apiKeys: loadApiKeys(), signedIn: loadSignedIn() }
}

export function createCore() {
  let db: Db | null = null
  let actualDbPath = ""
  let dbVersion = 0
  // One object for the core's life: its parts read `ctx.state` as they go.
  const state: CoreState = initialCoreState()
  const listeners = new Set<(patch: Partial<CoreState>) => void>()

  /** Change the state and tell every client. */
  function set(patch: Partial<CoreState>) {
    Object.assign(state, patch)
    for (const listener of listeners) listener(patch)
  }

  /** Hear every change, starting with the whole state now. */
  function subscribe(listener: (patch: Partial<CoreState>) => void): () => void {
    listeners.add(listener)
    listener({ ...state })
    return () => { listeners.delete(listener) }
  }

  /** Tag searches stop when the database changes under them. */
  const tagCandidatesFor = (() => {
    let run = 0
    return { invalidate: () => { run++ }, get run() { return run } }
  })()

  let undoStack: { label: string; reverse: () => Promise<string | UndoResult> }[] = []

  function recordUndo(label: string, reverse: () => Promise<string | UndoResult>) {
    undoStack = [...undoStack.slice(-19), { label, reverse }]
    set({ undoLabel: label })
  }

  async function undo(): Promise<UndoResult> {
    const entry = undoStack.at(-1)
    if (!entry) return { message: "Nothing to undo" }
    undoStack = undoStack.slice(0, -1)
    set({ undoLabel: undoStack.at(-1)?.label ?? null })
    const reversed = await entry.reverse()
    const result = typeof reversed === "string" ? { message: reversed } : reversed
    return { ...result, message: `Undid: ${entry.label}${result.message ? ` · ${result.message}` : ""}` }
  }

  async function repeatLast(ids: number[]): Promise<string> {
    const repeat = state.lastRepeat
    if (!repeat) return "Nothing to repeat"
    return repeat.kind === "category" ? categorizeTransactions(ids, repeat.categoryId) : applyTagPatch(ids, repeat.patch)
  }

  const transactions = () => state.transactions

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

  /** Reload everything the clients see from the database. */
  function refresh() {
    if (!db) return
    // Every write ends here: what's cached from the database is stale.
    dbVersion++
    set({
      ready: true,
      version: dbVersion,
      accounts: loadAccounts(db),
      syncAccounts: loadAccounts(db, { includeUnsynced: true }).filter((a) => a.source !== "csv"),
      budgets: loadBudgets(db),
      budgetHistory: loadBudgetHistory(db),
      budgetCycle: loadBudgetCycle(db),
      categories: loadCategories(db),
      tags: loadTags(db),
      rules: loadRules(db),
      transactions: loadTransactions(db),
      imports: loadImports(db),
      dbInfo: loadDbInfo(db, state.dbPath || "default"),
      merchantNotes: Object.fromEntries(loadMerchantNotes(db)),
      merchantBreadth: Object.fromEntries(loadMerchantBreadth(db)),
      suggestions: Object.fromEntries(loadSuggestions(db).map((s) => [s.transactionId, s])),
      categoryChoices: loadCategoryChoices(db),
      purchaseLookups: Object.fromEntries(loadPurchaseLookups(db)),
    })
  }

  /** A write to the open database, then a reload of the state from it. */
  function mutate<T>(write: (db: Db) => T): T {
    if (!db) throw new Error("db not open")
    const result = write(db)
    refresh()
    return result
  }

  /** An Up client for the token in the environment now. */
  const upClient = () => createUpClient({ token: readUpToken() })

  /** The real database, kept open while demo mode shows the made-up one. */
  let beforeDemo: { path: string; db: Db } | null = null

  /** Demo mode on: three years sampled from your spending, scrambled,
   * or a built-in life with too little history, in ~/.jaskmoney/demo.db.
   * Made afresh with its own categories and monthly budget. Returns how many rows. */
  function enterDemo(): number {
    if (state.demo) return state.transactions.length
    const demo = generateDemo({ today: appToday(), years: DEMO_YEARS, seed: DEMO_SEED,
      history: demoSource(transactions(), state.categories) })
    const path = join(jaskmoneyHome(), "demo.db")
    mkdirSync(jaskmoneyHome(), { recursive: true, mode: 0o700 })
    seedDemoDb(path, demo)
    // Your merchants' checks (does the name say what was bought?) come
    // along, so the demo's suggestions don't ask them again.
    const checked = loadMerchantBreadth(db!)
    const demoDb = openDb(path)
    saveMerchantBreadth(demoDb, checked)
    beforeDemo = { path: actualDbPath, db: db! }
    attach(path, demoDb)
    set({ demo: true })
    return demo.transactions.length
  }

  /** Demo mode off: back on the real database, as it was. */
  function leaveDemo(): void {
    if (!state.demo || !beforeDemo) return
    const was = beforeDemo
    beforeDemo = null
    db?.close()
    attach(was.path, was.db)
    set({ demo: false })
  }

  /** Open the database at `dbPath` (the default one when not given). */
  function open(dbPath?: string) {
    const path = dbPath ?? defaultDbPath()
    attach(path, openDb(path))
  }

  /** Point the core at an open database and load it (and the settings). */
  function attach(path: string, handle: Db) {
    undoStack = []
    tagCandidatesFor.invalidate()
    actualDbPath = path
    db = handle
    const config = loadSettingsConfig()
    set({
      ...keyState(),
      session: state.session + 1,
      undoLabel: null,
      lastRepeat: null,
      aiRuleOffers: [],
      dbPath: actualDbPath === ":memory:" ? ":memory:" : actualDbPath,
      savedFilters: config.savedFilters,
      importProfiles: config.importProfiles,
      icons: config.icons !== false,
      weekStart: config.ui?.weekStart ?? "monday",
      uiPrefs: config.ui ?? {},
    })
    refresh()
  }

  /** Test isolation only: close the database and restore the pre-open
   * state. Call open() before using database actions again. Does not erase
   * disk data. */
  function close() {
    undoStack = []
    db?.close()
    db = null
    actualDbPath = ""
    dbVersion = 0
    tagCandidatesFor.invalidate()
    // Session 0 is "no database": still a change for a client that had one.
    set(initialCoreState())
  }

  /** The budget cycle with the pay dates `payEarly` needs. */
  const cycle = (): CycleConfig => ({ ...state.budgetCycle, paydays: paydays(transactions()) })

  /** Save a row's note. A waiting row's suggestion is asked again with it
   * (Jev reads it as your_note; saving again re-asks, for a note written
   * before this); resolves to whether it was. */
  function updateTransactionNotes(id: number, notes: string, ai?: Pick<JevClient, "judge">): Promise<boolean> {
    mutate((db) => setTransactionNotes(db, id, notes))
    const t = transactions().find((row) => row.id === id)
    if (!t || !t.notes.trim() || !state.suggestions[id] || !isOrdinaryFlow(t) || !isUncategorised(t) || (!ai && !hasJev())) return Promise.resolve(false)
    return suggestCategories([id], ai, { replace: true }).then(() => true, () => false)
  }

  const ctx: CoreContext = {
    state, set, mutate, refresh, transactions, upClient, recordUndo,
    categorySnapshot, restoreCategories, setLastRepeat: (repeat: Repeat | null) => set({ lastRepeat: repeat }),
    createSettingsTag, saveSavedFilter, createSettingsRule, applyRules, deleteSettingsRule, deleteSavedFilter,
    get db() { return db },
    get dbVersion() { return dbVersion },
  }
  const push = createUpPush(ctx, { ruleOfferNote: (ids) => ruleOfferNote(ids) })
  const { applyCategories, retryPendingCategories, retryPendingTags, categorizeTransactions, applyTagPatch } = push
  const { suggestCategories, resuggestLike, setMerchantNote, recordPurchases, judgeAsk, acceptSuggestions, dismissSuggestions } =
    createSuggestions(ctx, { applyCategories, ruleOfferNote: (ids) => ruleOfferNote(ids) })
  const { historyData, askForRules, ruleOfferNote, makeOfferedRule, declineRuleOffer } = createRuleOffers(ctx, { retryPendingCategories, retryPendingTags, applyTagPatch })
  const { tagCandidates, dismissTagCandidates } = createTagCandidates(ctx)

  function createSettingsCategory(input: Pick<Category, "name" | "color"> & { notSpending?: boolean }): number {
    return mutate((db) => createCategory(db, input))
  }

  function createSettingsTag(input: TagInput): number {
    return mutate((db) => createTag(db, input))
  }

  function createSettingsRule(input: Omit<Rule, "id" | "sortOrder">): number {
    return mutate((db) => createRule(db, input))
  }

  function deleteSettingsRule(id: number) { mutate((db) => deleteRule(db, id)) }

  /** The names cat:, tag: and acc: values are found among (shortened names). */
  function filterNames() {
    return { cat: state.categories.map((c) => c.name), tag: state.tags.map((t) => t.name), acc: state.accounts.map((a) => a.name) }
  }

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

  /** `soon`: written once keys settle (CONFIG_SETTLE_MS), for prefs that
   * change on every press; otherwise now. */
  function saveUiPrefs(patch: Partial<UiPrefs>, { soon = false } = {}) {
    const next = { ...state.uiPrefs, ...patch }
    if (next.filterUsage) next.filterUsage = Object.fromEntries(Object.entries(next.filterUsage).filter(([id]) => state.savedFilters.some((filter) => filter.id === id)))
    if (isDeepStrictEqual(next, state.uiPrefs)) return
    if (!soon) persistConfig({ ui: next })
    set({ uiPrefs: next, weekStart: next.weekStart ?? "monday" })
    if (soon) {
      if (configTimer) clearTimeout(configTimer)
      configTimer = setTimeout(flushConfig, CONFIG_SETTLE_MS)
    }
  }

  function saveSavedFilter(filter: SavedFilter, originalId?: string) {
    const others = state.savedFilters.filter((f) => f.id !== originalId)
    const normalized = validateSavedFilter(filter, others, filterNames())
    const next = originalId ? state.savedFilters.map((f) => f.id === originalId ? normalized : f) : [...state.savedFilters, normalized]
    persistConfig({ savedFilters: next })
    set({ savedFilters: next })
  }

  function deleteSavedFilter(id: string) {
    const next = state.savedFilters.filter((f) => f.id !== id)
    const filterUsage = state.uiPrefs.filterUsage ? Object.fromEntries(Object.entries(state.uiPrefs.filterUsage).filter(([filterId]) => filterId !== id)) : undefined
    const prefs = { ...state.uiPrefs, ...(filterUsage ? { filterUsage } : {}) }
    persistConfig({ savedFilters: next, ui: prefs })
    set({ savedFilters: next, uiPrefs: prefs })
  }

  function applyRules(transactionIds?: number[], dryRun = false): RuleRunResult {
    if (!db) throw new Error("db not open")
    const ids = transactionIds ? new Set(transactionIds) : null
    const report = evaluateRules(ids ? transactions().filter((txn) => ids.has(txn.id)) : transactions(), state.rules, state.savedFilters, state.categories, state.tags)
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
        for (const tagId of change.tagIds) if (addTagLink(database, change.id, tagId)) {
          logTags(database, [change.id], tagId, true, "rule", at)
          const row = database.query<{ source: string; externalId: string | null }, [number]>(
            "SELECT source, external_id AS externalId FROM transactions WHERE id = ?").get(change.id)
          const tag = state.tags.find((t) => t.id === tagId)
          // Approved deviation from legacy: rule tags on Up rows wait for Up.
          if (row?.source === "up" && row.externalId != null && tag && tag.name.toUpperCase() !== "IGNORE" && tag.extId?.toUpperCase() !== "IGNORE") {
            queueTagPush(database, change.id, tagId, "add")
          }
        }
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

  function commitPreview(preview: ImportPreview, skipDuplicates: boolean): string {
    if (!db) throw new Error("db not open")
    const result = mutate((db) => commitImportPreview(db, preview, skipDuplicates))
    const applied = preview.rulesEnabled && result.transactionIds.length ? applyRules(result.transactionIds) : null
    return `Imported ${result.inserted} rows from ${result.accountName}${result.skippedDupes ? ` (${result.skippedDupes} duplicates ${skipDuplicates ? "skipped" : "forced"})` : ""}${applied?.updatedTransactions ? ` · ${applied.updatedTransactions} rules applied` : ""}`
  }

  async function syncUp(): Promise<string> {
    if (state.upSyncing) throw new Error("Up sync is already running")
    if (!db) throw new Error("db not open")
    set({ upSyncing: true })
    try {
      const result = await runUpSync(db, upClient()).catch((error: unknown) => {
        try { refresh() } catch { /* Preserve the sync error if reloading also fails. */ }
        throw error
      })
      refresh()
      const applied = result.insertedIds.length ? applyRules(result.insertedIds) : null
      // Categorisations Up hasn't confirmed go again now Up is answering.
      const retried = await retryPendingCategories()
      const tagsRetried = await retryPendingTags()
      const parts = [`Up sync: ${result.inserted} new, ${result.updated} updated, ${result.removedHeld} pending removed${applied?.updatedTransactions ? ` · ${applied.updatedTransactions} rules applied` : ""}`]
      if (retried.pushed) parts.push(`${retried.pushed} waiting categor${retried.pushed === 1 ? "y" : "ies"} sent to Up`)
      if (retried.rejected) parts.push(`${retried.rejected} Up refused (kept here only)`)
      if (retried.waiting) parts.push(`${retried.waiting} still waiting for Up`)
      if (tagsRetried.pushed) parts.push(`${tagsRetried.pushed} waiting tag changes sent to Up`)
      if (tagsRetried.rejected) parts.push(`${tagsRetried.rejected} tag changes Up refused (reverted here)`)
      if (tagsRetried.waiting) parts.push(`${tagsRetried.waiting} tag changes still waiting for Up`)
      return parts.join(" · ")
    } finally {
      set({ upSyncing: false })
    }
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
    refresh()
  }

  /**
   * Everything a client can ask of the core. Each takes one params object
   * (JSON over the wire) and, where it needs one, the call's context.
   */
  const commands = {
    enterDemo: (_: object) => enterDemo(),
    leaveDemo: (_: object) => leaveDemo(),
    undo: (_: object) => undo(),
    repeatLast: (p: { ids: number[] }) => repeatLast(p.ids),

    categorize: (p: { ids: number[]; categoryId: number }, cx: CallContext<CoreProgress["categorize"]>) =>
      categorizeTransactions(p.ids, p.categoryId, (pushed, total) => cx.progress({ pushed, total })),
    applyTagPatch: (p: { ids: number[]; patch: TagPatch; how?: "picker" | "review" | "undo" }) => applyTagPatch(p.ids, p.patch, p.how),
    retryPendingCategories: (_: object) => retryPendingCategories(),
    retryPendingTags: (_: object) => retryPendingTags(),

    suggestCategories: (p: { ids?: number[]; replace?: boolean }, cx: CallContext): Promise<string | number> =>
      p.replace ? suggestCategories(p.ids ?? [], cx.ai, { replace: true }) : suggestCategories(p.ids, cx.ai),
    resuggestLike: (p: { ids: number[] }, cx: CallContext) => resuggestLike(p.ids, cx.ai),
    setMerchantNote: (p: { description: string; note: string }, cx: CallContext) => setMerchantNote(p.description, p.note, cx.ai),
    recordPurchases: (p: { lookups: PurchaseLookup[] }, cx: CallContext) => recordPurchases(p.lookups, cx.ai),
    acceptSuggestions: (p: { ids: number[] }, cx: CallContext<CoreProgress["acceptSuggestions"]>) =>
      acceptSuggestions(p.ids, (pushed, total) => cx.progress({ pushed, total })),
    dismissSuggestions: (p: { ids: number[] }) => dismissSuggestions(p.ids),
    updateTransactionNotes: (p: { id: number; notes: string }, cx: CallContext) => updateTransactionNotes(p.id, p.notes, cx.ai),
    transactionDetail: (p: { id: number }) => db ? loadTransactionDetail(db, p.id) : null,

    judgeAsk: (p: { words: string; ids: number[] }, cx: CallContext<CoreProgress["judgeAsk"]>) =>
      judgeAsk(p.words, p.ids, cx.ai, { onJudged: cx.progress, active: () => !cx.signal.aborted }),
    tagCandidates: (p: { target: TagTarget }, cx: CallContext<CoreProgress["tagCandidates"]>) => {
      const run = tagCandidatesFor.run
      return tagCandidates(p.target, cx.ai, { onCandidates: cx.progress, active: () => !cx.signal.aborted && run === tagCandidatesFor.run })
    },
    dismissTagCandidates: (p: { tag: string; candidates: TagCandidate[]; review: number }) => dismissTagCandidates(p.tag, p.candidates, p.review),

    saveApiKeys: (p: { patch: Partial<Record<CredentialName, string | null>> }) => { saveCredentials(p.patch); set(keyState()) },
    /** After a sign-in or sign-out. */
    refreshApiKeys: (_: object) => set(keyState()),

    createCategory: (p: { input: Pick<Category, "name" | "color"> & { notSpending?: boolean } }) => createSettingsCategory(p.input),
    updateCategory: (p: { id: number; input: Pick<Category, "name" | "color"> & { notSpending?: boolean } }) => mutate((db) => updateCategory(db, p.id, p.input)),
    setCategoryBudgetIgnored: (p: { id: number; ignored: boolean }) => mutate((db) => setCategoryBudgetIgnored(db, p.id, p.ignored)),
    deleteCategory: (p: { id: number }) => mutate((db) => deleteCategory(db, p.id)),
    createTag: (p: { input: TagInput }) => createSettingsTag(p.input),
    updateTag: (p: { id: number; input: TagInput }) => mutate((db) => updateTag(db, p.id, p.input)),
    deleteTag: (p: { id: number }) => mutate((db) => deleteTag(db, p.id)),
    createRule: (p: { input: Omit<Rule, "id" | "sortOrder"> }) => createSettingsRule(p.input),
    updateRule: (p: { rule: Rule }) => mutate((db) => updateRule(db, p.rule)),
    deleteRule: (p: { id: number }) => deleteSettingsRule(p.id),
    reorderRule: (p: { id: number; index: number }) => mutate((db) => reorderRule(db, p.id, p.index)),
    toggleRule: (p: { id: number; enabled: boolean }) => mutate((db) => toggleRule(db, p.id, p.enabled)),
    applyRules: (p: { ids?: number[]; dryRun?: boolean }) => applyRules(p.ids, p.dryRun),

    saveSavedFilter: (p: { filter: SavedFilter; originalId?: string }) => saveSavedFilter(p.filter, p.originalId),
    deleteSavedFilter: (p: { id: string }) => deleteSavedFilter(p.id),
    recordFilterUsage: (p: { id: string }) => saveUiPrefs({ filterUsage: { ...state.uiPrefs.filterUsage, [p.id]: new Date().toISOString() } }),
    setIcons: (p: { on: boolean }) => { persistConfig({ icons: p.on }); set({ icons: p.on }) },
    saveUiPrefs: (p: { patch: Partial<UiPrefs>; soon?: boolean }) => saveUiPrefs(p.patch, { soon: p.soon }),
    /** Save a profile; `originalId` is the id it had when editing began, so
     * renaming one replaces it instead of leaving the old one behind. */
    saveImportProfile: (p: { profile: ImportProfile; originalId?: string | null }) => {
      const normalized = validateImportProfile(p.profile)
      const next = [...state.importProfiles.filter((x) => x.id !== normalized.id && x.id !== p.originalId), normalized].sort((a, b) => a.id.localeCompare(b.id))
      persistConfig({ importProfiles: next })
      set({ importProfiles: next })
    },
    deleteImportProfile: (p: { id: string }) => {
      const next = state.importProfiles.filter((x) => x.id !== p.id)
      persistConfig({ importProfiles: next })
      set({ importProfiles: next })
    },

    importDirectory: (_: object) => resolve(process.env.JASKMONEY_IMPORT_DIR ?? process.cwd()),
    csvFiles: (p: { directory: string }) => csvFiles(p.directory),
    previewImport: (p: { path: string; profile: ImportProfile }): ImportPreview => {
      if (!db) throw new Error("db not open")
      return buildImportPreview(db, readFileSync(p.path, "utf8"), p.path, validateImportProfile(p.profile))
    },
    commitPreview: (p: { preview: ImportPreview; skipDuplicates: boolean }) => commitPreview(p.preview, p.skipDuplicates),
    syncUp: (_: object) => syncUp(),

    /** Returns the number of transactions removed when switching sync off. */
    setAccountSync: (p: { accountId: number; enabled: boolean }) => mutate((db) => setAccountSyncEnabled(db, p.accountId, p.enabled)),
    setBudget: (p: { scope: BudgetScope; amount: number }) => mutate((db) => saveBudget(db, p.scope, p.amount, cycleFor(cycle(), appToday()).start)),
    removeBudget: (p: { id: number }) => mutate((db) => deleteBudget(db, p.id, cycleFor(cycle(), appToday()).start)),
    setBudgetCycle: (p: { config: CycleConfig }) => mutate((db) => saveBudgetCycle(db, p.config)),
    clearDatabaseData: (_: object) => mutate((db) => clearAllData(db)),
    clearAccountData: (p: { accountId: number }) => mutate((db) => clearAccountTransactions(db, p.accountId)),
    removeAccountData: (p: { accountId: number }) => mutate((db) => removeAccountWithTransactions(db, p.accountId)),
    factoryResetDatabase: (_: object) => factoryResetDatabase(),

    /** What the general model reads to write rules (ai/ruleWriter), and the
     * rules declined so far. */
    ruleWriterInput: (_: object) => {
      const { categorySources, ...history } = historyData()
      return { history: { ...history, categorySources: categorySources ? [...categorySources] : undefined }, declined: db ? loadRuleDeclines(db) : [] }
    },
    askForRules: (p: { focus?: string }, cx: CallContext) => askForRules(cx.llm, p.focus),
    makeOfferedRule: (p: { offer: RuleOffer }) => makeOfferedRule(p.offer),
    declineRuleOffer: (p: { offer: RuleOffer }) => declineRuleOffer(p.offer),
  }

  return {
    state: state as Readonly<CoreState>,
    subscribe,
    commands,
    open,
    close,
    refresh,
    /** Test seams (in-process only): write the state, reach the database. */
    set,
    get db() { return db },
  }
}

export type Core = ReturnType<typeof createCore>
export type CoreCommands = Core["commands"]
