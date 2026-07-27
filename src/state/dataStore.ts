import { createStore } from "solid-js/store"
import { readFileSync, existsSync } from "node:fs"
import { join, resolve } from "node:path"
import {
  addTagToTransactions,
  loadAccounts,
  loadCategories,
  loadDbInfo,
  loadTags,
  loadTransactions,
  openDb,
  removeTagFromTransactions,
  setTransactionCategory,
  type Db,
  type DbInfo,
} from "../db/client"
import { ingestAnzCsv } from "../domain/ingest"
import {
  evalFilter,
  filterExprString,
  parseFilterStrict,
  reparseFilterInput,
  type FilterNode,
} from "../domain/filter"
import type { Account, Category, SortColumn, Tag, Transaction } from "../domain/types"

export interface DataState {
  ready: boolean
  dbPath: string
  accounts: Account[]
  categories: Category[]
  tags: Tag[]
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
  const [state, setState] = createStore<DataState>({
    ready: false,
    dbPath: "",
    accounts: [],
    categories: [],
    tags: [],
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
    const transactions = loadTransactions(db)
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
      transactions,
      accountScope,
      dbInfo,
    })
  }

  function init(dbPath?: string) {
    db = openDb(dbPath)
    setState({ dbPath: dbPath ?? "default" })
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

  function ingestFile(path: string): string {
    if (!db) throw new Error("db not open")
    const text = readFileSync(path, "utf8")
    const result = ingestAnzCsv(db, text, path, { skipDupes: true })
    refresh()
    const summary = `Ingested ${result.inserted} rows into ${result.accountName} (${result.skippedDupes} dupes skipped)`
    setState({ lastIngestSummary: summary })
    return summary
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
    ingestFile,
    findDefaultAnzPath,
    bootstrapAnzIfEmpty,
    filterPreview,
    getDb: () => db,
  }
}

export type DataStore = ReturnType<typeof createDataStore>
export const data = createDataStore()
