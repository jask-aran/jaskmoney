import { createStore, reconcile, unwrap } from "solid-js/store"
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
import type { Budget, BudgetScope, CycleConfig } from "../domain/budget"
import { buildImportPreview, commitImportPreview, matchingProfiles } from "../domain/profileImport"
import { createUpClient, readUpToken } from "../up/client"
import { pushTransactions } from "../up/push"
import type { WeekStart } from "../domain/days"
import { addTagLink } from "../db/tagLinks"
import { syncUp as runUpSync } from "../up/sync"
import { dryRunRules as evaluateRules } from "../domain/rules"
import { pushTagChange } from "../up/tags"
import {
  evalFilter,
  filterExprString,
  parseFilterStrict,
  reparseFilterInput,
  type FilterNode,
} from "../domain/filter"
import { type Account, type Category, type ImportPreview, type ImportProfile, type ImportRecord, type Rule, type RuleRunResult, type SavedFilter, type SortColumn, type Tag, type Transaction } from "../domain/types"
import { loadSettingsConfig, saveSettingsConfig, validateImportProfile, validateSavedFilter, type SettingsConfig, type UiPrefs } from "./settingsConfig"

export interface DataState {
  ready: boolean
  upSyncing: boolean
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

function createDataStore() {
  let db: Db | null = null
  let actualDbPath = ""
  const [state, setState] = createStore<DataState>({
    ready: false,
    upSyncing: false,
    dbPath: "",
    accounts: [],
    syncAccounts: [],
    budgets: [],
    budgetCycle: { unit: "month", anchor: "calendar", anchorDate: null },
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
    actualDbPath = dbPath ?? defaultDbPath()
    db = openDb(actualDbPath)
    const config = loadSettingsConfig()
    setState({ dbPath: actualDbPath === ":memory:" ? ":memory:" : actualDbPath })
    setState({ savedFilters: config.savedFilters, importProfiles: config.importProfiles, icons: config.icons !== false, weekStart: config.ui?.weekStart ?? "monday" })
    setState("uiPrefs", reconcile(config.ui ?? {}))
    refresh()
  }

  /** Transactions of the Transactions tab's selected account(s). */
  function accountScoped(): Transaction[] {
    const ids = new Set(selectedAccounts(state.accounts, state.accountSelection).map((a) => a.id))
    return state.transactions.filter((t) => t.accountId != null && ids.has(t.accountId))
  }

  function sortRows(rows: Transaction[]): Transaction[] {
    const col = state.sortColumn
    const asc = state.sortAscending
    const out = rows.slice()
    out.sort((a, b) => {
      let cmp = 0
      switch (col) {
        case "date":
          cmp = a.dateISO.localeCompare(b.dateISO) || a.id - b.id
          break
        case "amount":
          cmp = a.amount - b.amount
          break
        case "description":
          cmp = a.description.localeCompare(b.description)
          break
        case "category":
          cmp = a.categoryName.localeCompare(b.categoryName)
          break
        case "account":
          cmp = a.accountName.localeCompare(b.accountName)
          break
      }
      return asc ? cmp : -cmp
    })
    return out
  }

  function scopedTransactions(): Transaction[] {
    let rows = accountScoped()
    const expr = state.filterExpr
    if (expr) {
      rows = rows.filter((t) =>
        evalFilter(expr, {
          description: t.description,
          categoryName: t.categoryName,
          accountName: t.accountName,
          notes: t.notes,
          amount: t.amount,
          dateISO: t.dateISO,
          tagNames: t.tagNames,
        }),
      )
    }
    return sortRows(rows)
  }

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
    setState({
      filterQuery: "",
      filterExpr: null,
      filterErr: "",
    })
  }

  function cycleSortColumn(): string {
    const i = SORT_CYCLE.indexOf(state.sortColumn)
    const next = SORT_CYCLE[(i + 1) % SORT_CYCLE.length]!
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
   * Categorise transactions, pushing to the provider where it can hold the
   * choice: an Up transaction it marks categorisable takes an Up subcategory,
   * or "no category" for the default (Uncategorised). Pushed rows then follow
   * the provider (source 'provider'). Anything else (a local-only category,
   * a transfer, a CSV row) is saved locally as the user's choice ('user').
   * A failed push leaves that transaction unchanged. Pushes run one at a time.
   */
  async function categorizeTransactions(txnIds: number[], categoryId: number): Promise<string> {
    if (!db) throw new Error("db not open")
    const category = state.categories.find((c) => c.id === categoryId)
    if (!category) throw new Error("category not found")
    const parentExt = category.parentId != null ? state.categories.find((c) => c.id === category.parentId)?.extId ?? null : null
    // undefined: the provider cannot represent this category.
    const providerId: string | null | undefined = category.extId && category.parentId != null ? category.extId : category.isDefault ? null : undefined
    const database = db
    let local = 0
    const { pushed, failures } = await pushTransactions(txnIds, (id) => {
      const row = database.query(`SELECT source, external_id AS externalId, ext_categorizable AS categorizable FROM transactions WHERE id = ?`)
        .get(id) as { source: string; externalId: string | null; categorizable: number | null } | null
      if (!row) return null
      const pushable = row.source === "up" && row.externalId != null && row.categorizable === 1 && providerId !== undefined
      if (!pushable) {
        setTransactionCategory(database, id, categoryId, "user")
        local++
        return null
      }
      return async () => {
        await upClient().setTransactionCategory(row.externalId!, providerId ?? null)
        setTransactionCategory(database, id, categoryId, providerId ? "provider" : null, { extCategory: providerId ?? null, extParentCategory: providerId ? parentExt : null })
        return 1
      }
    }, refresh)
    const done = pushed + local
    const parts = [`Categorized ${done} → ${category.name}`]
    if (pushed) parts.push(`${pushed} updated in Up`)
    if (failures.length) parts.push(`${failures.length} failed: ${failures[0]}`)
    return parts.join(" · ")
  }

  async function applyTagPatch(txnIds: number[], patch: Record<number, "add" | "remove">): Promise<string> {
    if (!db) throw new Error("db not open")
    const database = db
    if (!Object.keys(patch).length) return "Tags unchanged"
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
        const targets = [...new Set(txnIds)].filter((id) => {
          const t = state.transactions.find((t) => t.id === id)
          return t && t.tagIds.includes(tagId) !== add
        })
        const local = targets.filter((id) => tag.name.toUpperCase() === "IGNORE"
          || state.transactions.find((t) => t.id === id)?.source !== "up")
        if (add) addTagToTransactions(database, local, tagId)
        else removeTagFromTransactions(database, local, tagId)
        for (const id of local) updated.add(id)
        for (const id of targets.filter((id) => !local.includes(id))) {
          const result = await pushTagChange(database, client, [id], tagId, add)
          if (result.changed) updated.add(id)
          if (result.pushed) pushed.add(id)
          failures.push(...result.failures)
        }
      }
    } finally {
      refresh()
    }
    const parts = [`Tags: ${labels.join(", ")} on ${updated.size}`]
    if (pushed.size) parts.push(`${pushed.size} updated in Up`)
    if (failures.length) parts.push(`${failures.length} failed: ${failures[0]}`)
    return parts.join(" · ")
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

  function createSettingsTag(input: Pick<Tag, "name" | "color" | "categoryId">): number {
    return mutate((db) => createTag(db, input))
  }

  function updateSettingsTag(id: number, input: Pick<Tag, "name" | "color" | "categoryId">) {
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
    return evaluateRules(ids ? state.transactions.filter((txn) => ids.has(txn.id)) : state.transactions, state.rules, state.savedFilters, state.categories, state.tags)
  }

  function applyRules(transactionIds?: number[], dryRun = false): RuleRunResult {
    if (!db) throw new Error("db not open")
    const report = dryRunRules(transactionIds)
    if (!dryRun) mutate((database) => database.transaction(() => {
      for (const change of report.changes) {
        // 'rule' keeps sync from replacing a rule's category with the provider's.
        if (change.categorySet) database.query(`UPDATE transactions SET category_id = ?, category_source = 'rule' WHERE id = ?`).run(change.categoryId, change.id)
        for (const tagId of change.tagIds) addTagLink(database, change.id, tagId)
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
      return `Up sync: ${result.inserted} new, ${result.updated} updated, ${result.removedHeld} pending removed${applied?.updatedTransactions ? ` · ${applied.updatedTransactions} rules applied` : ""}`
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
    init,
    refresh,
    accountScoped,
    scopedTransactions,
    setFilterLive,
    commitFilter,
    clearFilter,
    cycleSortColumn,
    toggleSortDirection,
    setAccountSelection,
    categorizeTransactions,
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
