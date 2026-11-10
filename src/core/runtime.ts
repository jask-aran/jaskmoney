import { isDeepStrictEqual } from "node:util"
import { existsSync, mkdirSync, unlinkSync } from "node:fs"
import { join } from "node:path"
import { loadAccounts, loadCategories, loadDbInfo, loadRules, loadTags, loadTransactions, loadSuggestions, loadMerchantNotes, loadMerchantBreadth, loadCategoryChoices, loadPurchaseLookups, openDb, defaultDbPath, loadImports, loadBudgetCycle, loadBudgets, loadBudgetHistory, type Db, type TagInput } from "../db/client"
import { paydays, type CycleConfig } from "../domain/budget"
import { createUpClient, readUpToken, hasUpToken } from "../up/client"
import { appToday } from "../domain/days"
import { DEMO_SEED, DEMO_YEARS, generateDemo } from "../domain/demo"
import { seedDemoDb } from "../db/demoSeed"
import { jaskmoneyHome } from "../storage/home"
import type { Rule, SavedFilter, Transaction } from "../domain/types"
import { loadSettingsConfig } from "../state/settingsConfig"
import { createUpPush, operationSummary } from "./upPush"
import { createSuggestions } from "./suggestions"
import { createTagCandidates } from "./tagReview"
import { createRuleOffers } from "./ruleOffers"
import type { CoreContext, Session, UndoResult } from "./context"
import { type CoreState, type Repeat, emptyCoreState } from "./protocol"
import { SettingsCommands } from "./settingsCommands"
import { CREDENTIAL_NAMES, credentialEnv, credentialSource, NOT_SECRET } from "../ai/credentials"
import { jevRoute } from "../ai/jev"
import { hasLlm, llmModelId } from "../ai/llm"
import { searchUsesClairic } from "../ai/workersAi"
import { signedIn } from "../ai/oauthStore"

/** How long the range, account and chart views sit still before they're written. */
export const CONFIG_SETTLE_MS = 400

const loadSignedIn = (): CoreState["signedIn"] => ({ openrouter: signedIn("openrouter"), openai: signedIn("openai") })

/** Each API key's source and mask, read now. */
function loadApiKeys(): CoreState["apiKeys"] {
  const env = credentialEnv()
  return Object.fromEntries(CREDENTIAL_NAMES.map((name) => [name, { source: credentialSource(name), mask: NOT_SECRET.has(name) ? (env[name] ?? "") : "" }])) as CoreState["apiKeys"]
}

/** What the clients know of the credentials: which services are set up. */
export function keyState(): Pick<CoreState, "apiKeys" | "signedIn" | "jev" | "clairic" | "llm" | "upToken"> {
  const env = credentialEnv()
  return { apiKeys: loadApiKeys(), signedIn: loadSignedIn(), jev: jevRoute(env)?.provider ?? null, clairic: searchUsesClairic(env), llm: hasLlm(env) ? llmModelId(env) : null, upToken: hasUpToken(env) }
}

export function initialCoreState(): CoreState {
  return { ...emptyCoreState(), apiKeys: loadApiKeys(), signedIn: loadSignedIn() }
}

const SYNC_CONFLICTING_COMMANDS = {
  enterDemo: "demo mode", leaveDemo: "leaving demo mode", factoryResetDatabase: "a reset",
  clearDatabaseData: "clearing database data", clearAccountData: "clearing account data", removeAccountData: "removing an account",
}

export class CoreRuntime implements CoreContext {
  db: Db | null = null
  actualDbPath = ""
  dbVersion = 0
  /** The open database's session (CoreContext Session); null before open. */
  current: Session | null = null
  // One object for the core's life: its parts read `ctx.state` as they go.
  state: CoreState = initialCoreState()
  listeners = new Set<(patch: Partial<CoreState>) => void>()
  /** Tag searches stop when the database changes under them. */
  tagCandidatesFor = (() => {
    let run = 0
    return { invalidate: () => { run++ }, get run() { return run } }
  })()
  // Cleared by attach: an entry reverses rows of the session it was made in.
  undoStack: { label: string; reverse: () => Promise<string | UndoResult> }[] = []
  undoState: "idle" | "undoing" = "idle"
  transactions = () => this.state.transactions
  /** An Up client for the token in the environment now. */
  upClient = () => createUpClient({ token: readUpToken() })
  /** The real database, kept open while demo mode shows the made-up one. */
  beforeDemo: { path: string; db: Db } | null = null
  /** The budget cycle with the pay dates `payEarly` needs. */
  cycle = (): CycleConfig => ({ ...this.state.budgetCycle, paydays: paydays(this.transactions()) })

  settings = new SettingsCommands(this)

  /** Change the state and tell every client. */
  set = (patch: Partial<CoreState>) => {
    Object.assign(this.state, patch)
    for (const listener of this.listeners) listener(patch)
  }

  /** Hear every change, starting with the whole state now. */
  subscribe = (listener: (patch: Partial<CoreState>) => void): () => void => {
    this.listeners.add(listener)
    listener({ ...this.state })
    return () => { this.listeners.delete(listener) }
  }

  recordUndo = (label: string, reverse: () => Promise<string | UndoResult>) => {
    this.undoStack = [...this.undoStack.slice(-19), { label, reverse }]
    this.set({ undoLabel: label })
  }

  undo = async (): Promise<UndoResult> => {
    if (this.undoState === "undoing") throw new Error("Undo is already running")
    const entry = this.undoStack.at(-1)
    if (!entry) return { message: "Nothing to undo" }
    this.undoStack = this.undoStack.slice(0, -1)
    this.set({ undoLabel: this.undoStack.at(-1)?.label ?? null })
    const session = this.session()
    this.undoState = "undoing"
    let reversed: string | UndoResult
    try {
      reversed = await entry.reverse()
      this.ensureCurrent(session, "undo was running")
    } catch (error) {
      // A reverse can fail after partial work. Drop it rather than replay it.
      throw new Error(`Couldn't undo ${entry.label}: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      this.undoState = "idle"
    }
    const result = typeof reversed === "string" ? { message: reversed } : reversed
    return { ...result, message: `Undid: ${entry.label}${result.message ? ` · ${result.message}` : ""}` }
  }

  repeatLast = async (ids: number[]): Promise<string> => {
    const repeat = this.state.lastRepeat
    if (!repeat) return "Nothing to repeat"
    return repeat.kind === "category" ? this.push.categorizeTransactions(ids, repeat.categoryId) : this.push.applyTagPatch(ids, repeat.patch)
  }

  categorySnapshot = (assignments: Map<number, number>) => {
    return this.transactions().filter((t) => assignments.has(t.id) && t.categoryId !== assignments.get(t.id))
      .map((t) => ({ id: t.id, categoryId: t.categoryId, description: t.description }))
  }

  restoreCategories = async (rows: { id: number; categoryId: number | null }[]): Promise<string> => {
    const session = this.session()
    const defaultId = this.state.categories.find((c) => c.isDefault)?.id
    const assignments = new Map<number, number>()
    for (const row of rows) {
      const categoryId = row.categoryId ?? defaultId
      if (categoryId == null) throw new Error("default category not found")
      if (!this.state.categories.some((c) => c.id === categoryId)) throw new Error("category not found")
      assignments.set(row.id, categoryId)
    }
    if (!assignments.size) return ""
    // Cancel the forward push even if Up rejects the reversal.
    const ids = rows.map((row) => row.id)
    this.mutateSession(session, "categories were restored", (db) => {
      const cancelPending = db.query("UPDATE transactions SET category_source = 'user' WHERE id = ? AND category_source = 'pending'")
      for (const row of rows) cancelPending.run(row.id)
    }, ids)
    const result = await this.push.applyCategories(assignments, "undo")
    // The default sends "no category" to Up; preserve a formerly null local value.
    const wereNull = rows.filter((row) => row.categoryId == null)
    if (wereNull.length) this.mutateSession(session, "categories were restored", (db) => {
      const restoreNull = db.query("UPDATE transactions SET category_id = NULL WHERE id = ? AND category_id = ?")
      for (const row of wereNull) restoreNull.run(row.id, defaultId!)
    }, wereNull.map((row) => row.id))
    return operationSummary(`Restored ${result.done}`, result)
  }

  /** The rows with `changed` reloaded: the others as they are. Null when
   * that can't give what a whole reload would (a row came or moved), or
   * reading them alone wouldn't pay. */
  reloadRows = (database: Db, changed: Iterable<number>): Transaction[] | null => {
    const wanted = new Set(changed), ids = [...wanted]
    if (ids.length > 500) return null
    const fresh = new Map(loadTransactions(database, ids).map((t) => [t.id, t]))
    const before = this.state.transactions
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
  rowJoins = (s: Partial<CoreState>) => {
    return [[...(s.accounts ?? []), ...(s.syncAccounts ?? [])].map((a) => [a.id, a.name, a.syncEnabled]), s.categories, s.tags, s.purchaseLookups]
  }

  /** Reload everything the clients see from the database; `rows`, when
   * given, are the only transactions the write changed. None: the rows stay
   * as they are and aren't sent (unless what they're read with changed). */
  refresh = (rows?: Iterable<number>) => {
    if (!this.db) return
    // Every write ends here: what's cached from the database is stale.
    this.dbVersion++
    const changed = rows === undefined ? undefined : [...rows]
    const loaded: Partial<CoreState> = {
      accounts: loadAccounts(this.db),
      syncAccounts: loadAccounts(this.db, { includeUnsynced: true }).filter((a) => a.source !== "csv"),
      budgets: loadBudgets(this.db),
      budgetHistory: loadBudgetHistory(this.db),
      budgetCycle: loadBudgetCycle(this.db),
      categories: loadCategories(this.db),
      tags: loadTags(this.db),
      rules: loadRules(this.db),
      imports: loadImports(this.db),
      dbInfo: loadDbInfo(this.db, this.state.dbPath || "default"),
      merchantNotes: Object.fromEntries(loadMerchantNotes(this.db)),
      merchantBreadth: Object.fromEntries(loadMerchantBreadth(this.db)),
      suggestions: Object.fromEntries(loadSuggestions(this.db).map((s) => [s.transactionId, s])),
      categoryChoices: loadCategoryChoices(this.db),
      purchaseLookups: Object.fromEntries(loadPurchaseLookups(this.db)),
    }
    const same = changed?.length === 0 && isDeepStrictEqual(this.rowJoins(loaded), this.rowJoins(this.state))
    if (!same) loaded.transactions = (changed?.length && this.reloadRows(this.db, changed)) || loadTransactions(this.db)
    // Only the slices that changed go out: a client re-derives what reads
    // a slice it is sent, equal or not. The rows go whenever they're
    // reloaded (comparing them costs about what sending does).
    for (const key of Object.keys(loaded) as (keyof CoreState)[])
      if (key !== "transactions" && isDeepStrictEqual(loaded[key], this.state[key])) delete loaded[key]
    this.set({ ready: true, version: this.dbVersion, ...loaded })
  }

  /** A write to the open database, then a reload of the state from it. */
  mutate = <T>(write: (db: Db) => T): T => {
    if (!this.db) throw new Error("db not open")
    const result = write(this.db)
    this.refresh()
    return result
  }

  mutateSession = <T>(session: Session, doing: string, write: (db: Db) => T, rows?: Iterable<number>): T => {
    this.ensureCurrent(session, doing)
    const result = write(session.db)
    this.refresh(rows)
    return result
  }

  /** A sync writes to the database it began on and then runs rules and
   * pushes on the open one: the database stays put until it's done. */
  ensureNoSync = (command: keyof typeof SYNC_CONFLICTING_COMMANDS): void => {
    if (this.state.upSyncing) throw new Error(`Wait for the Up sync to finish before ${SYNC_CONFLICTING_COMMANDS[command]}`)
  }

  /** Demo mode on (Settings, or --demo): the built-in made-up life,
   * three years of it, in ~/.jaskmoney/demo.db. Nothing of yours goes in
   * (screenshots are taken of it; `bun run eval` makes its own set from
   * your history). Made afresh with its own categories and monthly
   * budget. Returns how many rows. */
  enterDemo = (): number => {
    if (this.state.demo) return this.state.transactions.length
    this.ensureNoSync("enterDemo")
    const demo = generateDemo({ today: appToday(), years: DEMO_YEARS, seed: DEMO_SEED })
    const path = join(jaskmoneyHome(), "demo.db")
    mkdirSync(jaskmoneyHome(), { recursive: true, mode: 0o700 })
    seedDemoDb(path, demo)
    const demoDb = openDb(path)
    this.beforeDemo = { path: this.actualDbPath, db: this.db! }
    this.attach(path, demoDb)
    this.set({ demo: true })
    return demo.transactions.length
  }

  /** Demo mode off: back on the real database, as it was. */
  leaveDemo = (): void => {
    if (!this.state.demo || !this.beforeDemo) return
    this.ensureNoSync("leaveDemo")
    const was = this.beforeDemo
    this.beforeDemo = null
    this.db?.close()
    this.attach(was.path, was.db)
    this.set({ demo: false })
  }

  /** Open the database at `dbPath` (the default one when not given). */
  open = (dbPath?: string) => {
    const path = dbPath ?? defaultDbPath()
    this.attach(path, openDb(path))
  }

  /** Point the core at an open database and load it (and the settings). */
  attach = (path: string, handle: Db) => {
    // A deferred prefs write lands before the settings are read back.
    this.settings.flushConfig()
    this.undoStack = []
    this.tagCandidatesFor.invalidate()
    this.actualDbPath = path
    this.db = handle
    this.current = { id: this.state.session + 1, db: handle }
    const config = loadSettingsConfig()
    this.set({
      ...keyState(),
      session: this.current.id,
      undoLabel: null,
      lastRepeat: null,
      aiRuleOffers: [],
      dbPath: this.actualDbPath,
      savedFilters: config.savedFilters,
      importProfiles: config.importProfiles,
      icons: config.icons !== false,
      welcomed: config.welcomed === true,
      weekStart: config.ui?.weekStart ?? "monday",
      uiPrefs: config.ui ?? {},
    })
    this.refresh()
  }

  /** Test isolation only: close the database and restore the pre-open
   * state. Call open() before using database actions again. Does not erase
   * disk data. */
  close = () => {
    this.settings.flushConfig()
    if (this.settings.configTimer) clearTimeout(this.settings.configTimer)
    this.settings.configTimer = null
    this.settings.configDirty = false
    this.undoStack = []
    this.db?.close()
    this.db = null
    this.current = null
    this.beforeDemo?.db.close()
    this.beforeDemo = null
    this.actualDbPath = ""
    this.dbVersion = 0
    this.tagCandidatesFor.invalidate()
    // Session 0 is "no database": still a change for a client that had one.
    this.set(initialCoreState())
  }

  /** A new, empty database at the same path: a new session (attach), so
   * undo, rule offers and the clients' caches of the old rows go with it. */
  factoryResetDatabase = (): void => {
    if (!this.db) throw new Error("db not open")
    this.ensureNoSync("factoryResetDatabase")
    this.db.close()
    // Explicit paths only: never use a glob or a user-entered directory.
    if (this.actualDbPath !== ":memory:") for (const path of [this.actualDbPath, `${this.actualDbPath}-wal`, `${this.actualDbPath}-shm`]) if (existsSync(path)) unlinkSync(path)
    this.attach(this.actualDbPath, openDb(this.actualDbPath))
  }

  setLastRepeat = (repeat: Repeat | null) => this.set({ lastRepeat: repeat })
  createSettingsTag = (input: TagInput) => this.settings.createSettingsTag(input)
  saveSavedFilter = (filter: SavedFilter, originalId?: string) => this.settings.saveSavedFilter(filter, originalId)
  createSettingsRule = (input: Omit<Rule, "id" | "sortOrder">) => this.settings.createSettingsRule(input)
  applyRules = (transactionIds?: number[], dryRun?: boolean) => this.settings.applyRules(transactionIds, dryRun)
  deleteSettingsRule = (id: number) => this.settings.deleteSettingsRule(id)
  deleteSavedFilter = (id: string) => this.settings.deleteSavedFilter(id)
  session = (): Session => {
    if (!this.current) throw new Error("db not open")
    return this.current
  }
  isCurrent = (session: Session) => session === this.current
  ensureCurrent = (session: Session, doing: string) => {
    if (session !== this.current) throw new Error(`The database changed while ${doing}; nothing more was saved`)
  }

  push = createUpPush(this, { ruleOfferNote: (ids) => this.ruleOffers.ruleOfferNote(ids) })
  suggestions = createSuggestions(this, { applyCategories: this.push.applyCategories, ruleOfferNote: (ids) => this.ruleOffers.ruleOfferNote(ids) })
  ruleOffers = createRuleOffers(this, { retryPendingCategories: this.push.retryPendingCategories, retryPendingTags: this.push.retryPendingTags, applyTagPatch: this.push.applyTagPatch })
  tagReview = createTagCandidates(this)

  constructor() {
    process.on("exit", this.settings.flushConfig)
  }

  dispose = () => { process.off("exit", this.settings.flushConfig) }
  demoCommands = {
    enterDemo: (_: object) => this.enterDemo(),
    leaveDemo: (_: object) => this.leaveDemo(),
    undo: (_: object) => this.undo(),
    repeatLast: (p: { ids: number[] }) => this.repeatLast(p.ids)
  }
}
