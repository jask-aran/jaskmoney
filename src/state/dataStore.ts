import { createStore } from "solid-js/store"
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
import { selectedAccounts, type AccountSelection } from "../domain/accountTree"
import type { Budget, BudgetScope, CycleConfig } from "../domain/budget"
import { buildImportPreview, commitImportPreview, matchingProfiles } from "../domain/profileImport"
import { createUpClient, readUpToken } from "../up/client"
import { syncUp as runUpSync } from "../up/sync"
import { pushTagChange } from "../up/tags"
import {
  evalFilter,
  filterExprString,
  parseFilterStrict,
  reparseFilterInput,
  type FilterNode,
} from "../domain/filter"
import { type Account, type Category, type ImportPreview, type ImportProfile, type ImportRecord, type Rule, type RuleRunResult, type SavedFilter, type SortColumn, type Tag, type Transaction } from "../domain/types"
import { loadSettingsConfig, saveSettingsConfig, validateImportProfile, validateSavedFilter } from "./settingsConfig"

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
  /** Show Nerd Font category icons (settings config). */
  icons: boolean
  importProfiles: ImportProfile[]
  imports: ImportRecord[]
  transactions: Transaction[]
  /** Which accounts the Manager shows. Approved deviation from Go's per-account
   * on/off scope (2026-10-26): one selection from the account sidebar. */
  accountSelection: AccountSelection
  lastIngestSummary: string
  dbInfo: DbInfo | null
  filterQuery: string
  filterExpr: FilterNode | null
  filterErr: string
  filterLastApplied: string
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
    importProfiles: [],
    imports: [],
    transactions: [],
    accountSelection: "all",
    lastIngestSummary: "",
    dbInfo: null,
    filterQuery: "",
    filterExpr: null,
    filterErr: "",
    filterLastApplied: "",
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
    const sel = state.accountSelection
    const accountSelection: AccountSelection = typeof sel === "number" && !accounts.some((a) => a.id === sel) ? "all" : sel
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

  function init(dbPath?: string) {
    actualDbPath = dbPath ?? defaultDbPath()
    db = openDb(actualDbPath)
    const config = loadSettingsConfig()
    setState({ dbPath: actualDbPath === ":memory:" ? ":memory:" : actualDbPath })
    setState({ savedFilters: config.savedFilters, importProfiles: config.importProfiles, icons: config.icons !== false })
    refresh()
  }

  /** Transactions of the Manager's selected account(s). */
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
      filterLastApplied: "",
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
        filterLastApplied: "",
      })
      return { ok: false, err: error ?? "invalid filter" }
    }
    const canonical = filterExprString(node) || trimmed
    setState({
      filterQuery: trimmed,
      filterExpr: live.expr ?? node,
      filterErr: "",
      filterLastApplied: canonical,
    })
    return { ok: true, err: "" }
  }

  function clearFilter() {
    setState({
      filterQuery: "",
      filterExpr: null,
      filterErr: "",
      filterLastApplied: "",
    })
  }

  function setFilterQuery(q: string) {
    setFilterLive(q)
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
    setState({ accountSelection: selection })
  }

  /** Local-only categorisation (no provider push); see categorizeTransactions. */
  function categorizeTransaction(txnId: number, categoryId: number): string {
    if (!db) throw new Error("db not open")
    setTransactionCategory(db, txnId, categoryId, "user")
    refresh()
    const cat = state.categories.find((c) => c.id === categoryId)
    return `Categorized #${txnId} → ${cat?.name ?? categoryId}`
  }

  function transactionDetail(id: number): TransactionDetail | null {
    return db ? loadTransactionDetail(db, id) : null
  }

  function updateTransactionNotes(id: number, notes: string): void {
    if (!db) throw new Error("db not open")
    setTransactionNotes(db, id, notes)
    refresh()
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
    let client: ReturnType<typeof createUpClient> | null = null
    let pushed = 0, local = 0
    const failures: string[] = []
    for (const id of txnIds) {
      const row = db.query(`SELECT source, external_id AS externalId, ext_categorizable AS categorizable FROM transactions WHERE id = ?`)
        .get(id) as { source: string; externalId: string | null; categorizable: number | null } | null
      if (!row) continue
      const pushable = row.source === "up" && row.externalId != null && row.categorizable === 1 && providerId !== undefined
      if (!pushable) {
        setTransactionCategory(db, id, categoryId, "user")
        local++
        continue
      }
      try {
        client ??= createUpClient({ token: readUpToken() })
        await client.setTransactionCategory(row.externalId!, providerId ?? null)
        setTransactionCategory(db, id, categoryId, providerId ? "provider" : null, { extCategory: providerId ?? null, extParentCategory: providerId ? parentExt : null })
        pushed++
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error))
      }
    }
    refresh()
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
    let up: ReturnType<typeof createUpClient> | null = null
    const client = {
      addTransactionTags: (id: string, tags: string[]) => (up ??= createUpClient({ token: readUpToken() })).addTransactionTags(id, tags),
      removeTransactionTags: (id: string, tags: string[]) => (up ??= createUpClient({ token: readUpToken() })).removeTransactionTags(id, tags),
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
    if (!db) throw new Error("db not open")
    const id = createCategory(db, input)
    refresh()
    return id
  }

  function updateSettingsCategory(id: number, input: Pick<Category, "name" | "color"> & { notSpending?: boolean }) {
    if (!db) throw new Error("db not open")
    updateCategory(db, id, input)
    refresh()
  }

  function deleteSettingsCategory(id: number) {
    if (!db) throw new Error("db not open")
    deleteCategory(db, id)
    refresh()
  }

  function createSettingsTag(input: Pick<Tag, "name" | "color" | "categoryId">): number {
    if (!db) throw new Error("db not open")
    const id = createTag(db, input)
    refresh()
    return id
  }

  function updateSettingsTag(id: number, input: Pick<Tag, "name" | "color" | "categoryId">) {
    if (!db) throw new Error("db not open")
    updateTag(db, id, input)
    refresh()
  }

  function deleteSettingsTag(id: number) {
    if (!db) throw new Error("db not open")
    deleteTag(db, id)
    refresh()
  }

  function createSettingsRule(input: Omit<Rule, "id" | "sortOrder">): number {
    if (!db) throw new Error("db not open")
    const id = createRule(db, input)
    refresh()
    return id
  }

  function updateSettingsRule(rule: Rule) { if (!db) throw new Error("db not open"); updateRule(db, rule); refresh() }
  function deleteSettingsRule(id: number) { if (!db) throw new Error("db not open"); deleteRule(db, id); refresh() }
  function reorderSettingsRule(id: number, index: number) { if (!db) throw new Error("db not open"); reorderRule(db, id, index); refresh() }
  function toggleSettingsRule(id: number, enabled: boolean) { if (!db) throw new Error("db not open"); toggleRule(db, id, enabled); refresh() }

  function saveSavedFilter(filter: SavedFilter, originalId?: string) {
    const others = state.savedFilters.filter((f) => f.id !== originalId)
    const normalized = validateSavedFilter(filter, others)
    const next = originalId ? state.savedFilters.map((f) => f.id === originalId ? normalized : f) : [...state.savedFilters, normalized]
    saveSettingsConfig({ version: 2, icons: state.icons, savedFilters: next, importProfiles: state.importProfiles })
    setState({ savedFilters: next })
  }

  function setIcons(on: boolean) {
    saveSettingsConfig({ version: 2, icons: on, savedFilters: state.savedFilters, importProfiles: state.importProfiles })
    setState({ icons: on })
  }

  function deleteSavedFilter(id: string) {
    const next = state.savedFilters.filter((f) => f.id !== id)
    saveSettingsConfig({ version: 2, icons: state.icons, savedFilters: next, importProfiles: state.importProfiles })
    setState({ savedFilters: next })
  }

  function saveImportProfile(profile: ImportProfile) {
    const normalized = validateImportProfile(profile)
    const next = [...state.importProfiles.filter((p) => p.id !== normalized.id), normalized].sort((a, b) => a.id.localeCompare(b.id))
    saveSettingsConfig({ version: 2, icons: state.icons, savedFilters: state.savedFilters, importProfiles: next })
    setState({ importProfiles: next })
  }

  function deleteImportProfile(id: string) {
    const next = state.importProfiles.filter((p) => p.id !== id)
    saveSettingsConfig({ version: 2, icons: state.icons, savedFilters: state.savedFilters, importProfiles: next })
    setState({ importProfiles: next })
  }

  function applyRules(transactionIds?: number[], dryRun = false): RuleRunResult {
    if (!db) throw new Error("db not open")
    const scoped = transactionIds ? new Set(transactionIds) : null
    const filters = new Map(state.savedFilters.map((f) => [f.id, parseFilterStrict(f.expr).node]))
    const failures: string[] = []
    let updatedTransactions = 0, categoryChanges = 0, tagChanges = 0
    const enabled = state.rules.filter((r) => r.enabled)
    for (const txn of state.transactions) {
      if (scoped && !scoped.has(txn.id)) continue
      let categoryId = txn.categoryId
      const tagIds = new Set(txn.tagIds)
      let changed = false
      let categorySet = false
      for (const rule of enabled) {
        const expression = filters.get(rule.savedFilterId)
        if (!expression) { if (!failures.includes(rule.savedFilterId)) failures.push(rule.savedFilterId); continue }
        const categoryName = state.categories.find((c) => c.id === categoryId)?.name ?? "Uncategorised"
        const tagNames = [...tagIds].map((id) => state.tags.find((t) => t.id === id)?.name).filter((x): x is string => !!x)
        if (!evalFilter(expression, { ...txn, categoryName, tagNames })) continue
        if (rule.setCategoryId != null && rule.setCategoryId !== categoryId) { categoryId = rule.setCategoryId; categoryChanges++; changed = true; categorySet = true }
        for (const tagId of rule.addTagIds) if (!tagIds.has(tagId)) { tagIds.add(tagId); tagChanges++; changed = true }
      }
      if (!changed) continue
      updatedTransactions++
      if (!dryRun) {
        // 'rule' keeps sync from replacing a rule's category with the provider's.
        if (categorySet) db.query(`UPDATE transactions SET category_id = ?, category_source = 'rule' WHERE id = ?`).run(categoryId, txn.id)
        const insert = db.query(`INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)`)
        for (const tagId of tagIds) insert.run(txn.id, tagId)
      }
    }
    if (!dryRun) refresh()
    return { updatedTransactions, categoryChanges, tagChanges, failedRules: failures }
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
    const result = commitImportPreview(db, preview, skipDuplicates)
    refresh()
    const applied = preview.rulesEnabled && result.transactionIds.length ? applyRules(result.transactionIds) : null
    const summary = `Imported ${result.inserted} rows from ${result.accountName}${result.skippedDupes ? ` (${result.skippedDupes} duplicates ${skipDuplicates ? "skipped" : "forced"})` : ""}${applied?.updatedTransactions ? ` · ${applied.updatedTransactions} rules applied` : ""}`
    setState({ lastIngestSummary: summary })
    return summary
  }

  async function syncUp(): Promise<string> {
    if (state.upSyncing) throw new Error("Up sync is already running")
    if (!db) throw new Error("db not open")
    setState({ upSyncing: true })
    try {
      const result = await runUpSync(db, createUpClient({ token: readUpToken() }))
      refresh()
      const applied = result.insertedIds.length ? applyRules(result.insertedIds) : null
      return `Up sync: ${result.inserted} new, ${result.updated} updated, ${result.removedHeld} pending removed${applied?.updatedTransactions ? ` · ${applied.updatedTransactions} rules applied` : ""}`
    } finally {
      setState({ upSyncing: false })
    }
  }

  function setBudget(scope: BudgetScope, amount: number): void {
    if (!db) throw new Error("db not open")
    saveBudget(db, scope, amount)
    refresh()
  }

  function removeBudget(id: number): void {
    if (!db) throw new Error("db not open")
    deleteBudget(db, id)
    refresh()
  }

  function setBudgetCycle(config: CycleConfig): void {
    if (!db) throw new Error("db not open")
    saveBudgetCycle(db, config)
    refresh()
  }

  /** Returns the number of transactions removed when switching sync off. */
  function setAccountSync(accountId: number, enabled: boolean): number {
    if (!db) throw new Error("db not open")
    const removed = setAccountSyncEnabled(db, accountId, enabled)
    refresh()
    return removed
  }

  function clearDatabaseData(): void { if (!db) throw new Error("db not open"); clearAllData(db); refresh() }
  function clearAccountData(accountId: number): number { if (!db) throw new Error("db not open"); const n = clearAccountTransactions(db, accountId); refresh(); return n }
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
    setFilterQuery,
    cycleSortColumn,
    toggleSortDirection,
    setAccountSelection,
    categorizeTransaction,
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
    deleteSavedFilter,
    saveImportProfile,
    deleteImportProfile,
    applyRules,
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
