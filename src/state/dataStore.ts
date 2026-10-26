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
} from "../db/client"
import { ingestAnzCsv } from "../domain/ingest"
import { buildImportPreview, commitImportPreview, matchingProfiles } from "../domain/profileImport"
import {
  evalFilter,
  filterExprString,
  parseFilterStrict,
  reparseFilterInput,
  type FilterNode,
} from "../domain/filter"
import type { Account, Category, ImportPreview, ImportProfile, ImportRecord, Rule, RuleRunResult, SavedFilter, SortColumn, Tag, Transaction } from "../domain/types"
import { loadSettingsConfig, saveSettingsConfig, validateImportProfile, validateSavedFilter } from "./settingsConfig"

export interface DataState {
  ready: boolean
  dbPath: string
  accounts: Account[]
  categories: Category[]
  tags: Tag[]
  rules: Rule[]
  savedFilters: SavedFilter[]
  importProfiles: ImportProfile[]
  imports: ImportRecord[]
  transactions: Transaction[]
  accountScope: Record<number, boolean>
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
    dbPath: "",
    accounts: [],
    categories: [],
    tags: [],
    rules: [],
    savedFilters: [],
    importProfiles: [],
    imports: [],
    transactions: [],
    accountScope: {},
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
    const accountScope: Record<number, boolean> = { ...state.accountScope }
    for (const a of accounts) {
      if (accountScope[a.id] === undefined) accountScope[a.id] = true
    }
    const dbInfo = loadDbInfo(db, state.dbPath || "default")
    setState({
      ready: true,
      accounts,
      categories,
      tags,
      rules,
      transactions,
      imports,
      accountScope,
      dbInfo,
    })
  }

  function init(dbPath?: string) {
    actualDbPath = dbPath ?? defaultDbPath()
    db = openDb(actualDbPath)
    const config = loadSettingsConfig()
    setState({ dbPath: actualDbPath === ":memory:" ? ":memory:" : actualDbPath })
    setState({ savedFilters: config.savedFilters, importProfiles: config.importProfiles })
    refresh()
  }

  function accountScoped(): Transaction[] {
    const scope = state.accountScope
    const anyOff = state.accounts.some((a) => scope[a.id] === false)
    if (!anyOff) return state.transactions
    return state.transactions.filter(
      (t) => t.accountId != null && scope[t.accountId] !== false,
    )
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

  function toggleAccount(id: number) {
    setState("accountScope", id, !(state.accountScope[id] !== false))
  }

  function categorizeTransaction(txnId: number, categoryId: number): string {
    if (!db) throw new Error("db not open")
    setTransactionCategory(db, txnId, categoryId)
    refresh()
    const cat = state.categories.find((c) => c.id === categoryId)
    return `Categorized #${txnId} → ${cat?.name ?? categoryId}`
  }

  function toggleTagOnTransactions(txnIds: number[], tagId: number): string {
    if (!db) throw new Error("db not open")
    // If all have tag → remove; else add
    const allHave = txnIds.every((id) => {
      const t = state.transactions.find((x) => x.id === id)
      return t?.tagIds.includes(tagId)
    })
    if (allHave) removeTagFromTransactions(db, txnIds, tagId)
    else addTagToTransactions(db, txnIds, tagId)
    refresh()
    const tag = state.tags.find((t) => t.id === tagId)
    return allHave
      ? `Removed tag ${tag?.name ?? tagId} from ${txnIds.length}`
      : `Added tag ${tag?.name ?? tagId} to ${txnIds.length}`
  }

  function createSettingsCategory(input: Pick<Category, "name" | "color">): number {
    if (!db) throw new Error("db not open")
    const id = createCategory(db, input)
    refresh()
    return id
  }

  function updateSettingsCategory(id: number, input: Pick<Category, "name" | "color">) {
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
    saveSettingsConfig({ version: 2, savedFilters: next, importProfiles: state.importProfiles })
    setState({ savedFilters: next })
  }

  function deleteSavedFilter(id: string) {
    const next = state.savedFilters.filter((f) => f.id !== id)
    saveSettingsConfig({ version: 2, savedFilters: next, importProfiles: state.importProfiles })
    setState({ savedFilters: next })
  }

  function saveImportProfile(profile: ImportProfile) {
    const normalized = validateImportProfile(profile)
    const next = [...state.importProfiles.filter((p) => p.id !== normalized.id), normalized].sort((a, b) => a.id.localeCompare(b.id))
    saveSettingsConfig({ version: 2, savedFilters: state.savedFilters, importProfiles: next })
    setState({ importProfiles: next })
  }

  function deleteImportProfile(id: string) {
    const next = state.importProfiles.filter((p) => p.id !== id)
    saveSettingsConfig({ version: 2, savedFilters: state.savedFilters, importProfiles: next })
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
      for (const rule of enabled) {
        const expression = filters.get(rule.savedFilterId)
        if (!expression) { if (!failures.includes(rule.savedFilterId)) failures.push(rule.savedFilterId); continue }
        const categoryName = state.categories.find((c) => c.id === categoryId)?.name ?? "Uncategorised"
        const tagNames = [...tagIds].map((id) => state.tags.find((t) => t.id === id)?.name).filter((x): x is string => !!x)
        if (!evalFilter(expression, { ...txn, categoryName, tagNames })) continue
        if (rule.setCategoryId != null && rule.setCategoryId !== categoryId) { categoryId = rule.setCategoryId; categoryChanges++; changed = true }
        for (const tagId of rule.addTagIds) if (!tagIds.has(tagId)) { tagIds.add(tagId); tagChanges++; changed = true }
      }
      if (!changed) continue
      updatedTransactions++
      if (!dryRun) {
        db.query(`UPDATE transactions SET category_id = ? WHERE id = ?`).run(categoryId, txn.id)
        const insert = db.query(`INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)`)
        for (const tagId of tagIds) insert.run(txn.id, tagId)
      }
    }
    if (!dryRun) refresh()
    return { updatedTransactions, categoryChanges, tagChanges, failedRules: failures }
  }

  function ingestFile(path: string): string {
    if (!db) throw new Error("db not open")
    const text = readFileSync(path, "utf8")
    const result = ingestAnzCsv(db, text, path, { skipDupes: true })
    refresh()
    const applied = result.transactionIds.length ? applyRules(result.transactionIds) : null
    const summary = `Ingested ${result.inserted} rows into ${result.accountName} (${result.skippedDupes} dupes skipped)${applied?.updatedTransactions ? ` · ${applied.updatedTransactions} rules applied` : ""}`
    setState({ lastIngestSummary: summary })
    return summary
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

  function clearDatabaseData(): void { if (!db) throw new Error("db not open"); clearAllData(db); refresh() }
  function clearAccountData(accountId: number): number { if (!db) throw new Error("db not open"); const n = clearAccountTransactions(db, accountId); refresh(); return n }
  function removeAccountData(accountId: number): number {
    if (!db) throw new Error("db not open")
    const n = removeAccountWithTransactions(db, accountId)
    const scope = { ...state.accountScope }; delete scope[accountId]
    setState({ accountScope: scope })
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
    setState({ accountScope: {} })
    refresh()
  }

  function findDefaultAnzPath(): string | null {
    const candidates = [
      resolve(process.cwd(), "ANZ.csv"),
      resolve(import.meta.dir, "../../ANZ.csv"),
      join(process.env.HOME ?? "", "jaskmoney", "ANZ.csv"),
    ]
    for (const p of candidates) {
      if (existsSync(p)) return p
    }
    return null
  }

  function bootstrapAnzIfEmpty(): string | null {
    if (!db) return null
    if (state.transactions.length > 0) return null
    const path = findDefaultAnzPath()
    if (!path) return null
    return ingestFile(path)
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
    toggleAccount,
    categorizeTransaction,
    toggleTagOnTransactions,
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
    deleteSavedFilter,
    saveImportProfile,
    deleteImportProfile,
    applyRules,
    ingestFile,
    csvFiles,
    importDirectory,
    profileMatches,
    previewImport,
    commitPreview,
    clearDatabaseData,
    clearAccountData,
    removeAccountData,
    factoryResetDatabase,
    findDefaultAnzPath,
    bootstrapAnzIfEmpty,
    filterPreview,
    getDb: () => db,
  }
}

export type DataStore = ReturnType<typeof createDataStore>
export const data = createDataStore()
