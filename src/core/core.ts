/**
 * The jaskmoney core: the one owner of the database, the settings file, the
 * credentials, Up and the models. Framework-free; clients (the TUI, the web
 * app) see it through `CoreState` patches and call its `commands` over a
 * link (client/link: in-process; server/serve: a WebSocket). See
 * core/protocol for the contract.
 */
import type { Models } from "@earendil-works/pi-ai"
import { isDeepStrictEqual } from "node:util"
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync } from "node:fs"
import { join, resolve } from "node:path"
import {
  loadAccounts, loadCategories, loadDbInfo, loadRules, loadTags, loadTransactions, loadSuggestions, loadMerchantNotes,
  loadMerchantBreadth, saveMerchantBreadth, loadCategoryChoices, loadPurchaseLookups, logCategories, openDb,
  createCategory, updateCategory, setCategoryBudgetIgnored, deleteCategory, createTag, updateTag, deleteTag,
  createRule, updateRule, deleteRule, reorderRule, toggleRule, clearAccountTransactions, clearAllData, defaultDbPath,
  loadImports, removeAccountWithTransactions, setAccountSyncEnabled, loadBudgetCycle, loadBudgets,
  loadBudgetHistory, recordBudget, saveBudgetCycle, loadTransactionDetail, setTransactionNotes, loadRuleDeclines,
  type Db, type TagInput,
} from "../db/client"
import { cycleFor, paydays, type BudgetScope, type CycleConfig } from "../domain/budget"
import { scopeKey } from "../domain/budgetScopes"
import { buildImportPreview, commitImportPreview } from "../domain/profileImport"
import { CREDENTIAL_NAMES, credentialEnv, credentialSource, saveCredentials, type CredentialName, NOT_SECRET } from "../ai/credentials"
import { isOrdinaryFlow, isUncategorised } from "../domain/moneyRules"
import { hasJev, jevClient, jevRoute, JEV_SETUP, type JevClient } from "../ai/jev"
import { hasLlm, llmModelId, llmModels, LLM_PROVIDERS, type Llm, type LlmProvider } from "../ai/llm"
import { cloudflare, createWorkersAiClient, readWorkersAiCredentials, searchUsesClairic } from "../ai/workersAi"
import { createUpClient, hasUpToken, readUpToken } from "../up/client"
import { smartSearch } from "../domain/smartSearch"
import { categoryUses, merchantBreadth } from "../domain/suggest"
import { createFileCredentialStore, installationId, signedIn } from "../ai/oauthStore"
import { appNow, appToday } from "../domain/days"
import { DEMO_SEED, DEMO_YEARS, demoSource, generateDemo } from "../domain/demo"
import { seedDemoDb } from "../db/demoSeed"
import { jaskmoneyHome } from "../storage/home"
import { stageTagChange } from "../db/tagLinks"
import { syncUp as runUpSync } from "../up/sync"
import { dryRunRules as evaluateRules } from "../domain/rules"
import type { TagCandidate, TagTarget } from "../domain/tagSuggest"
import type { RuleOffer } from "../domain/ruleOffers"
import type { PurchaseLookup } from "../db/client"
import type { Category, ImportPreview, ImportProfile, Rule, RuleRunResult, SavedFilter, Transaction } from "../domain/types"
import { loadSettingsConfig, saveSettingsConfig, validateImportProfile, validateSavedFilter, type SettingsConfig, type UiPrefs } from "../state/settingsConfig"
import { createUpPush, categoryPush, operationSummary, type PushableRow } from "./upPush"
import { createSuggestions } from "./suggestions"
import { createTagCandidates } from "./tagReview"
import { createRuleOffers } from "./ruleOffers"
import type { CoreContext, Session, TagPatch, UndoResult } from "./context"
import { createLane } from "./lane"
import { emptyCoreState, type CoreProgress, type CoreState, type Repeat } from "./protocol"

/** How a command hears about the call it serves. */
export interface CallContext<P = never> {
  progress: (data: P) => void
  signal: AbortSignal
  /** In-process links only (tests): a Jev client or general model in place
   * of the real ones. */
  ai?: Pick<JevClient, "judge">
  llm?: Llm
  models?: Pick<Models, "login">
}

/** Let the event loop turn (keys, frames) between long steps of a command. */
const breathe = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/** How long the range, account and chart views sit still before they're written. */
export const CONFIG_SETTLE_MS = 400


const SYNC_CONFLICTING_COMMANDS = {
  enterDemo: "demo mode", leaveDemo: "leaving demo mode", factoryResetDatabase: "a reset",
  clearDatabaseData: "clearing database data", clearAccountData: "clearing account data", removeAccountData: "removing an account",
}

const loadSignedIn = (): CoreState["signedIn"] => ({ openrouter: signedIn("openrouter"), openai: signedIn("openai") })

/** Each API key's source and mask, read now. */
function loadApiKeys(): CoreState["apiKeys"] {
  const env = credentialEnv()
  return Object.fromEntries(CREDENTIAL_NAMES.map((name) => [name, { source: credentialSource(name), mask: NOT_SECRET.has(name) ? (env[name] ?? "") : "" }])) as CoreState["apiKeys"]
}

/** What the clients know of the credentials: which services are set up. */
function keyState(): Pick<CoreState, "apiKeys" | "signedIn" | "jev" | "clairic" | "llm" | "upToken"> {
  const env = credentialEnv()
  return { apiKeys: loadApiKeys(), signedIn: loadSignedIn(), jev: jevRoute(env)?.provider ?? null, clairic: searchUsesClairic(env), llm: hasLlm(env) ? llmModelId(env) : null, upToken: hasUpToken(env) }
}

export function initialCoreState(): CoreState {
  return { ...emptyCoreState(), apiKeys: loadApiKeys(), signedIn: loadSignedIn() }
}

export function createCore() {
  let db: Db | null = null
  let actualDbPath = ""
  let dbVersion = 0
  /** The open database's session (CoreContext Session); null before open. */
  let current: Session | null = null
  // One object for the core's life: its parts read `ctx.state` as they go.
  const state: CoreState = initialCoreState()
  const listeners = new Set<(patch: Partial<CoreState>) => void>()
  // Prompts stay in the core; clients send only the pasted code.
  const signIns = new Map<LlmProvider, { paste: ((value: string) => void) | null }>()

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

  // Cleared by attach: an entry reverses rows of the session it was made in.
  let undoStack: { label: string; reverse: () => Promise<string | UndoResult> }[] = []
  let undoState: "idle" | "undoing" = "idle"

  function recordUndo(label: string, reverse: () => Promise<string | UndoResult>) {
    undoStack = [...undoStack.slice(-19), { label, reverse }]
    set({ undoLabel: label })
  }

  async function undo(): Promise<UndoResult> {
    if (undoState === "undoing") throw new Error("Undo is already running")
    const entry = undoStack.at(-1)
    if (!entry) return { message: "Nothing to undo" }
    undoStack = undoStack.slice(0, -1)
    set({ undoLabel: undoStack.at(-1)?.label ?? null })
    const session = ctx.session()
    undoState = "undoing"
    let reversed: string | UndoResult
    try {
      reversed = await entry.reverse()
      ctx.ensureCurrent(session, "undo was running")
    } catch (error) {
      // A reverse can fail after partial work. Drop it rather than replay it.
      throw new Error(`Couldn't undo ${entry.label}: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      undoState = "idle"
    }
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
    const session = ctx.session()
    const defaultId = state.categories.find((c) => c.isDefault)?.id
    const assignments = new Map<number, number>()
    for (const row of rows) {
      const categoryId = row.categoryId ?? defaultId
      if (categoryId == null) throw new Error("default category not found")
      if (!state.categories.some((c) => c.id === categoryId)) throw new Error("category not found")
      assignments.set(row.id, categoryId)
    }
    if (!assignments.size) return ""
    // Cancel the forward push even if Up rejects the reversal.
    const ids = rows.map((row) => row.id)
    ctx.mutateSession(session, "categories were restored", (db) => {
      const cancelPending = db.query("UPDATE transactions SET category_source = 'user' WHERE id = ? AND category_source = 'pending'")
      for (const row of rows) cancelPending.run(row.id)
    }, ids)
    const result = await applyCategories(assignments, "undo")
    // The default sends "no category" to Up; preserve a formerly null local value.
    const wereNull = rows.filter((row) => row.categoryId == null)
    if (wereNull.length) ctx.mutateSession(session, "categories were restored", (db) => {
      const restoreNull = db.query("UPDATE transactions SET category_id = NULL WHERE id = ? AND category_id = ?")
      for (const row of wereNull) restoreNull.run(row.id, defaultId!)
    }, wereNull.map((row) => row.id))
    return operationSummary(`Restored ${result.done}`, result)
  }

  /** The rows with `changed` reloaded: the others as they are. Null when
   * that can't give what a whole reload would (a row came or moved), or
   * reading them alone wouldn't pay. */
  function reloadRows(database: Db, changed: Iterable<number>): Transaction[] | null {
    const wanted = new Set(changed), ids = [...wanted]
    if (ids.length > 500) return null
    const fresh = new Map(loadTransactions(database, ids).map((t) => [t.id, t]))
    const before = state.transactions
    let seen = 0
    const rows: Transaction[] = []
    for (const t of before) {
      const next = fresh.get(t.id)
      if (!next) { if (!wanted.has(t.id)) rows.push(t); continue }
      // The order is by date, time and id: a row whose date moved goes in afresh.
      if (next.dateISO !== t.dateISO || next.createdMs !== t.createdMs) return null
      seen++
      rows.push(next)
    }
    return seen === fresh.size ? rows : null
  }

  /** What the rows are read with besides their own table (loadTransactions
   * joins): account names and switches, categories, tags, purchases. */
  function rowJoins(s: Partial<CoreState>) {
    return [[...(s.accounts ?? []), ...(s.syncAccounts ?? [])].map((a) => [a.id, a.name, a.syncEnabled]), s.categories, s.tags, s.purchaseLookups]
  }

  /** Reload everything the clients see from the database; `rows`, when
   * given, are the only transactions the write changed. None: the rows stay
   * as they are and aren't sent (unless what they're read with changed). */
  function refresh(rows?: Iterable<number>) {
    if (!db) return
    // Every write ends here: what's cached from the database is stale.
    dbVersion++
    const changed = rows === undefined ? undefined : [...rows]
    const loaded: Partial<CoreState> = {
      accounts: loadAccounts(db),
      syncAccounts: loadAccounts(db, { includeUnsynced: true }).filter((a) => a.source !== "csv"),
      budgets: loadBudgets(db),
      budgetHistory: loadBudgetHistory(db),
      budgetCycle: loadBudgetCycle(db),
      categories: loadCategories(db),
      tags: loadTags(db),
      rules: loadRules(db),
      imports: loadImports(db),
      dbInfo: loadDbInfo(db, state.dbPath || "default"),
      merchantNotes: Object.fromEntries(loadMerchantNotes(db)),
      merchantBreadth: Object.fromEntries(loadMerchantBreadth(db)),
      suggestions: Object.fromEntries(loadSuggestions(db).map((s) => [s.transactionId, s])),
      categoryChoices: loadCategoryChoices(db),
      purchaseLookups: Object.fromEntries(loadPurchaseLookups(db)),
    }
    const same = changed?.length === 0 && isDeepStrictEqual(rowJoins(loaded), rowJoins(state))
    if (!same) loaded.transactions = (changed?.length && reloadRows(db, changed)) || loadTransactions(db)
    // Only the slices that changed go out: a client re-derives what reads
    // a slice it is sent, equal or not. The rows go whenever they're
    // reloaded (comparing them costs about what sending does).
    for (const key of Object.keys(loaded) as (keyof CoreState)[])
      if (key !== "transactions" && isDeepStrictEqual(loaded[key], state[key])) delete loaded[key]
    set({ ready: true, version: dbVersion, ...loaded })
  }

  /** A write to the open database, then a reload of the state from it. */
  function mutate<T>(write: (db: Db) => T): T {
    if (!db) throw new Error("db not open")
    const result = write(db)
    refresh()
    return result
  }

  function mutateSession<T>(session: Session, doing: string, write: (db: Db) => T, rows?: Iterable<number>): T {
    ctx.ensureCurrent(session, doing)
    const result = write(session.db)
    refresh(rows)
    return result
  }

  /** An Up client for the token in the environment now. */
  const upClient = () => createUpClient({ token: readUpToken() })

  /** The real database, kept open while demo mode shows the made-up one. */
  let beforeDemo: { path: string; db: Db } | null = null

  /** Demo mode on: three years sampled from your spending, scrambled,
   * or a built-in life with too little history, in ~/.jaskmoney/demo.db.
   * Made afresh with its own categories and monthly budget. Returns how many rows. */
  /** A sync writes to the database it began on and then runs rules and
   * pushes on the open one: the database stays put until it's done. */
  function ensureNoSync(command: keyof typeof SYNC_CONFLICTING_COMMANDS): void {
    if (state.upSyncing) throw new Error(`Wait for the Up sync to finish before ${SYNC_CONFLICTING_COMMANDS[command]}`)
  }

  function enterDemo(): number {
    if (state.demo) return state.transactions.length
    ensureNoSync("enterDemo")
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
    ensureNoSync("leaveDemo")
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
    // A deferred prefs write lands before the settings are read back.
    flushConfig()
    undoStack = []
    tagCandidatesFor.invalidate()
    actualDbPath = path
    db = handle
    current = { id: state.session + 1, db: handle }
    const config = loadSettingsConfig()
    set({
      ...keyState(),
      session: current.id,
      undoLabel: null,
      lastRepeat: null,
      aiRuleOffers: [],
      dbPath: actualDbPath === ":memory:" ? ":memory:" : actualDbPath,
      savedFilters: config.savedFilters,
      importProfiles: config.importProfiles,
      icons: config.icons !== false,
      welcomed: config.welcomed === true,
      weekStart: config.ui?.weekStart ?? "monday",
      uiPrefs: config.ui ?? {},
    })
    refresh()
  }

  /** Test isolation only: close the database and restore the pre-open
   * state. Call open() before using database actions again. Does not erase
   * disk data. */
  function close() {
    flushConfig()
    if (configTimer) clearTimeout(configTimer)
    configTimer = null
    configDirty = false
    undoStack = []
    db?.close()
    db = null
    current = null
    beforeDemo?.db.close()
    beforeDemo = null
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
    return askAgain([id], ai).then(() => true, () => false)
  }

  const ctx: CoreContext = {
    state, set, mutate, mutateSession, refresh, transactions, upClient, recordUndo,
    categorySnapshot, restoreCategories, setLastRepeat: (repeat: Repeat | null) => set({ lastRepeat: repeat }),
    createSettingsTag, saveSavedFilter, createSettingsRule, applyRules, deleteSettingsRule, deleteSavedFilter,
    get db() { return db },
    get dbVersion() { return dbVersion },
    session: () => {
      if (!current) throw new Error("db not open")
      return current
    },
    isCurrent: (session) => session === current,
    ensureCurrent: (session, doing) => {
      if (session !== current) throw new Error(`The database changed while ${doing}; nothing more was saved`)
    },
  }
  const push = createUpPush(ctx, { ruleOfferNote: (ids) => ruleOfferNote(ids) })
  const { applyCategories, retryPendingCategories, retryPendingTags, categorizeTransactions, applyTagPatch } = push
  const { suggestCategories, askAgain, resuggestLike, setMerchantNote, recordPurchases, judgeAsk, acceptSuggestions, dismissSuggestions } =
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
    saveSettingsConfig({ version: 2, icons: state.icons, welcomed: state.welcomed, savedFilters: state.savedFilters, importProfiles: state.importProfiles, ui: state.uiPrefs, ...patch })
    configDirty = false
  }

  // Prefs that change with each key (the range, the account, the charts)
  // are written once they settle, not on every press; exit writes any left.
  // Dirty until a write succeeds, so a failed one is tried again.
  let configTimer: ReturnType<typeof setTimeout> | null = null
  let configDirty = false
  function flushConfig() {
    if (!configDirty) return
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
      configDirty = true
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
    let tagChanges = 0, updatedTransactions = 0
    // No change, no write: a reload would send every row again for nothing.
    if (!dryRun && report.changes.length) mutate((database) => database.transaction(() => {
      const at = appNow().toISOString()
      for (const change of report.changes) {
        let changed = change.categorySet
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
        // Approved provider deviation from legacy: rule tags use the same
        // staging and six-tag limit as the picker.
        for (const tagId of change.tagIds) {
          const staged = stageTagChange(database, { transactionId: change.id, tagId, action: "add", how: "rule", at })
          if (staged.kind === "changed") { tagChanges++; changed = true }
        }
        if (changed) updatedTransactions++
      }
    })())
    return { updatedTransactions: dryRun ? report.updatedTransactions : updatedTransactions, categoryChanges: report.categoryChanges, tagChanges: dryRun ? report.tagChanges : tagChanges, failedRules: report.failedRules }
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
    const rebuilt = commands.previewImport({ path: preview.path, profile: preview.profile })
    const result = mutate((db) => commitImportPreview(db, rebuilt, skipDuplicates))
    const applied = preview.rulesEnabled && result.transactionIds.length ? applyRules(result.transactionIds) : null
    return `Imported ${result.inserted} rows from ${result.accountName}${result.skippedDupes ? ` (${result.skippedDupes} duplicates ${skipDuplicates ? "skipped" : "forced"})` : ""}${applied?.updatedTransactions ? ` · ${applied.updatedTransactions} rules applied` : ""}`
  }

  const upSync = createLane({ state, set }, "upSyncing", "Up sync is already running")

  /** Fetch from Up and save, then run rules on the new rows and send what
   * Up hasn't confirmed. Never in demo mode: its rows are made up. */
  function syncUp(off?: string[]): Promise<string> {
    if (state.demo) return Promise.reject(new Error("Sync is off in demo mode"))
    return upSync.run(() => syncNow(off))
  }

  async function syncNow(off?: string[]): Promise<string> {
    const session = ctx.session()
    // A row Up confirms a change for while the sync fetches keeps its
    // copy: the fetched one predates the change (upPush watchUpWrites).
    const confirmed = push.watchUpWrites()
    const result = await runUpSync(session.db, upClient(), { keep: confirmed.ids, ensureCurrent: () => ctx.ensureCurrent(session, "Up sync was running"), ...(off ? { off: new Set(off) } : {}) }).catch((error: unknown) => {
      try { if (ctx.isCurrent(session)) refresh() } catch { /* Preserve the sync error if reloading also fails. */ }
      throw error
    }).finally(confirmed.stop)
    // The write, the reload (every client re-derives what reads the rows)
    // and the rules each take a turn of their own, with keys and frames
    // between them: a first sync's are ~50-100 ms each.
    await breathe()
    ctx.ensureCurrent(session, "Up sync was running")
    // A sync that brought no new, changed or removed row (most background
    // ones) leaves the rows as they are: no client rebuilds what reads them.
    refresh(result.inserted || result.updated || result.removedHeld ? undefined : [])
    await breathe()
    ctx.ensureCurrent(session, "Up sync was running")
    const applied = result.insertedIds.length ? applyRules(result.insertedIds) : null
    // Categorisations Up hasn't confirmed go again now Up is answering.
    const retried = await retryPendingCategories()
    ctx.ensureCurrent(session, "Up sync was running")
    const tagsRetried = await retryPendingTags()
    ctx.ensureCurrent(session, "Up sync was running")
    const parts = [`Up sync: ${result.inserted} new, ${result.updated} updated, ${result.removedHeld} pending removed${applied?.updatedTransactions ? ` · ${applied.updatedTransactions} rules applied` : ""}`]
    if (retried.pushed) parts.push(`${retried.pushed} waiting categor${retried.pushed === 1 ? "y" : "ies"} sent to Up`)
    if (retried.rejected) parts.push(`${retried.rejected} Up refused (kept here only)`)
    if (retried.waiting) parts.push(`${retried.waiting} still waiting for Up`)
    if (tagsRetried.pushed) parts.push(`${tagsRetried.pushed} waiting tag changes sent to Up`)
    if (tagsRetried.rejected) parts.push(`${tagsRetried.rejected} tag changes Up refused (reverted here)`)
    if (tagsRetried.waiting) parts.push(`${tagsRetried.waiting} tag changes still waiting for Up`)
    return parts.join(" · ")
  }

  /** A new, empty database at the same path: a new session (attach), so
   * undo, rule offers and the clients' caches of the old rows go with it. */
  function factoryResetDatabase(): void {
    if (!db) throw new Error("db not open")
    ensureNoSync("factoryResetDatabase")
    db.close()
    // Explicit paths only: never use a glob or a user-entered directory.
    if (actualDbPath !== ":memory:") for (const path of [actualDbPath, `${actualDbPath}-wal`, `${actualDbPath}-shm`]) if (existsSync(path)) unlinkSync(path)
    attach(actualDbPath, openDb(actualDbPath))
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
    /** `session`: the one the lookups were made for (CoreState.session). */
    recordPurchases: (p: { lookups: PurchaseLookup[]; session?: number }, cx: CallContext) => recordPurchases(p.lookups, cx.ai, p.session),
    acceptSuggestions: (p: { ids: number[] }, cx: CallContext<CoreProgress["acceptSuggestions"]>) =>
      acceptSuggestions(p.ids, (pushed, total) => cx.progress({ pushed, total })),
    dismissSuggestions: (p: { ids: number[] }) => dismissSuggestions(p.ids),
    updateTransactionNotes: (p: { id: number; notes: string }, cx: CallContext) => updateTransactionNotes(p.id, p.notes, cx.ai),
    transactionDetail: (p: { id: number }) => db ? loadTransactionDetail(db, p.id) : null,

    /** A filter expression written from `query` (domain/smartSearch), with
     * the words found among `descriptions` (the client's rows). */
    smartSearch: async (p: { query: string; descriptions: string[] }) => {
      const session = current
      if (!hasJev()) throw new Error(`Smart search needs Jev (${JEV_SETUP})`)
      const clairicOn = searchUsesClairic()
      const ai = { clairic: clairicOn ? createWorkersAiClient(readWorkersAiCredentials()).clairic : undefined, jev: jevClient() }
      const uses = categoryUses(transactions(), state.categories, merchantBreadth(transactions(), state.categories, new Map(Object.entries(state.merchantBreadth))))
      const { expr, clairic } = await smartSearch(ai, p.query, { today: appToday(), cycle: cycle(), categories: state.categories, descriptions: p.descriptions, uses })
      if (current !== session) throw new Error("The database changed while the filter was written; nothing more was saved")
      return { expr, clairic, clairicOn }
    },
    judgeAsk: (p: { words: string; ids: number[] }, cx: CallContext<CoreProgress["judgeAsk"]>) =>
      judgeAsk(p.words, p.ids, cx.ai, { onJudged: cx.progress, active: () => !cx.signal.aborted }),
    tagCandidates: (p: { target: TagTarget }, cx: CallContext<CoreProgress["tagCandidates"]>) => {
      const run = tagCandidatesFor.run
      return tagCandidates(p.target, cx.ai, { onCandidates: cx.progress, active: () => !cx.signal.aborted && run === tagCandidatesFor.run })
    },
    dismissTagCandidates: (p: { tag: string; candidates: TagCandidate[]; review: number }) => dismissTagCandidates(p.tag, p.candidates, p.review),

    saveApiKeys: (p: { patch: Partial<Record<CredentialName, string | null>> }) => { saveCredentials(p.patch); set(keyState()) },
    /** Clairic's account from its saved token (cloudflareAccounts): saved
     * when the token reaches exactly one; else how many it reaches. */
    findCloudflareAccount: async (_: object): Promise<{ name: string } | { count: number }> => {
      const token = credentialEnv().JASKMONEY_CF_TOKEN?.trim()
      if (!token) throw new Error("Save the API token first")
      const accounts = await cloudflare.accounts(token)
      if (accounts.length !== 1) return { count: accounts.length }
      saveCredentials({ JASKMONEY_CF_ACCOUNT_ID: accounts[0]!.id })
      set(keyState())
      return { name: accounts[0]!.name }
    },
    /** After a sign-in or sign-out. */
    refreshApiKeys: (_: object) => set(keyState()),

    signInLlm: async (p: { provider: LlmProvider }, cx: CallContext<CoreProgress["signInLlm"]>) => {
      const on = current
      const { provider } = p
      const { label, signIn } = LLM_PROVIDERS[provider]
      if (signIns.has(provider)) throw new Error(`${label} sign-in is already running`)
      cx.signal.throwIfAborted()
      const run: { paste: ((value: string) => void) | null } = { paste: null }
      signIns.set(provider, run)
      let view: CoreProgress["signInLlm"] = { url: null, message: `${signIn}…`, paste: null }
      const report = (patch: Partial<typeof view>) => { view = { ...view, ...patch }; cx.progress(view) }
      let cleanup = () => {}
      try {
        const models = cx.models ?? llmModels()
        await models.login(provider, "oauth", {
          signal: cx.signal,
          notify: (event) => {
            if (event.type === "auth_url") report({ url: event.url, message: "Your browser should open; finish signing in there." })
            else if (event.type === "device_code") report({ url: event.verificationUri, message: `Enter the code ${event.userCode} at the address below.` })
            else report({ message: event.message })
          },
          prompt: (prompt) => new Promise<string>((resolve, reject) => {
            if (prompt.type === "select") { reject(new Error(`${label} asked a question this app can't show: ${prompt.message}`)); return }
            // The callback won the race: the paste field goes.
            const abort = () => { cleanup(); report({ paste: null }); reject(new Error("callback received")) }
            const cancel = () => { cleanup(); report({ paste: null }); reject(new Error("cancelled")) }
            cleanup = () => {
              run.paste = null
              prompt.signal?.removeEventListener("abort", abort)
              cx.signal.removeEventListener("abort", cancel)
            }
            run.paste = (value) => { cleanup(); report({ paste: null, message: "Checking…" }); resolve(value) }
            prompt.signal?.addEventListener("abort", abort, { once: true })
            cx.signal.addEventListener("abort", cancel, { once: true })
            if (cx.signal.aborted) cancel()
            else if (prompt.signal?.aborted) abort()
            else report({ paste: prompt.message })
          }),
        }, { getDeviceId: installationId, agentName: "jaskmoney" })
        if (current !== on) return
        set(keyState())
      } finally {
        cleanup()
        signIns.delete(provider)
      }
    },
    signInPaste: (p: { provider: LlmProvider; value: string }): boolean => {
      const paste = signIns.get(p.provider)?.paste
      if (!paste) return false
      paste(p.value)
      return true
    },
    signOutLlm: async (p: { provider: LlmProvider }) => {
      const on = current
      await createFileCredentialStore().delete(p.provider)
      if (current !== on) return
      set(keyState())
    },

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
    setWelcomed: (p: { done: boolean }) => { persistConfig({ welcomed: p.done }); set({ welcomed: p.done }) },
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
      return buildImportPreview(db, readFileSync, p.path, validateImportProfile(p.profile))
    },
    commitPreview: (p: { preview: ImportPreview; skipDuplicates: boolean }) => commitPreview(p.preview, p.skipDuplicates),
    /** `off`: the setup's choice of accounts not to sync (Up's ids). */
    syncUp: (p: { off?: string[] }) => syncUp(p.off),

    /** Returns the number of transactions removed when switching sync off. */
    setAccountSync: (p: { accountId: number; enabled: boolean }) => mutate((db) => setAccountSyncEnabled(db, p.accountId, p.enabled)),
    /** A budget from the cycle starting `from` (default this one) until its
     * next change. One first set in this cycle is recorded since always, so
     * it measures earlier cycles too. `replaces`: the budget this one was
     * (the editor changed what it covers) ends then, in the same write. */
    setBudget: (p: { scope: BudgetScope; amount: number; from?: string; replaces?: BudgetScope }) => {
      const now = cycleFor(cycle(), appToday()).start
      const fresh = !state.budgetHistory.some((e) => scopeKey(e.scope) === scopeKey(p.scope))
      mutate((db) => db.transaction(() => {
        if (p.replaces && scopeKey(p.replaces) !== scopeKey(p.scope)) recordBudget(db, p.replaces, null, p.from ?? now, now)
        recordBudget(db, p.scope, p.amount, fresh && (p.from ?? now) === now ? null : p.from ?? now, now)
      })())
    },
    /** No budget for `scope` from the cycle starting `from` (default this one). */
    removeBudget: (p: { scope: BudgetScope; from?: string }) => {
      const now = cycleFor(cycle(), appToday()).start
      mutate((db) => recordBudget(db, p.scope, null, p.from ?? now, now))
    },
    setBudgetCycle: (p: { config: CycleConfig }) => mutate((db) => saveBudgetCycle(db, p.config)),
    clearDatabaseData: (_: object) => { ensureNoSync("clearDatabaseData"); return mutate((db) => clearAllData(db)) },
    clearAccountData: (p: { accountId: number }) => { ensureNoSync("clearAccountData"); return mutate((db) => clearAccountTransactions(db, p.accountId)) },
    removeAccountData: (p: { accountId: number }) => { ensureNoSync("removeAccountData"); return mutate((db) => removeAccountWithTransactions(db, p.accountId)) },
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
    dispose: () => { process.off("exit", flushConfig) },
    refresh,
    /** Test seams (in-process only): write the state, reach the database. */
    set,
    get db() { return db },
  }
}

export type Core = ReturnType<typeof createCore>
export type CoreCommands = Core["commands"]
