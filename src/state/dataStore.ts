import { createMemo, createRoot, createSignal } from "solid-js"
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
  loadSuggestions,
  saveSuggestions,
  deleteSuggestions,
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
import { historySuggestions, jevSuggestions } from "../domain/suggest"
import { isOrdinaryFlow, isUncategorised } from "../domain/moneyRules"
import { createUpClient, readUpToken } from "../up/client"
import { pushTransactions } from "../up/push"
import { appToday, type WeekStart } from "../domain/days"
import { askCandidates, ASK_DEFAULT_DAYS, ASK_LIMIT, judgeRows } from "../domain/ask"
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
  mightMatch,
  type AskVerdict,
  type FilterNode,
} from "../domain/filter"
import { type Account, type Category, type CategorySuggestion, type ImportPreview, type ImportProfile, type ImportRecord, type Rule, type RuleRunResult, type SavedFilter, type SortColumn, type Tag, type Transaction } from "../domain/types"
import { loadSettingsConfig, saveSettingsConfig, validateImportProfile, validateSavedFilter, type SettingsConfig, type UiPrefs } from "./settingsConfig"

export interface DataState {
  ready: boolean
  upSyncing: boolean
  suggesting: boolean
  suggestions: Record<number, CategorySuggestion>
  /** The Transactions table shows only ordinary uncategorised rows. */
  uncategorisedOnly: boolean
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

/** Rows in a column's order; dates tie-break on id so the order is stable. */
function sortRows(rows: Transaction[], col: SortColumn, asc: boolean): Transaction[] {
  const compare = (a: Transaction, b: Transaction): number => {
    switch (col) {
      case "date": return a.dateISO < b.dateISO ? -1 : a.dateISO > b.dateISO ? 1 : a.id - b.id
      case "amount": return a.amount - b.amount
      case "description": return textOrder(a.description, b.description)
      case "category": return textOrder(a.categoryName, b.categoryName)
      case "account": return textOrder(a.accountName, b.accountName)
    }
  }
  return rows.slice().sort((a, b) => (asc ? compare(a, b) : -compare(a, b)))
}

function createDataStore() {
  let db: Db | null = null
  let actualDbPath = ""
  const [state, setState] = createStore<DataState>({
    ready: false,
    upSyncing: false,
    suggesting: false,
    suggestions: {},
    uncategorisedOnly: false,
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
    // Verdicts are per row id, and a new database reuses ids.
    askVerdicts.clear()
    askRun++
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

  /** Jev's verdicts on `ask:` terms for this session: words (lower-cased)
   * → row id → match. Each new batch bumps `askVersion`. */
  const askVerdicts = new Map<string, Map<number, boolean>>()
  const [askVersion, setAskVersion] = createSignal(0)
  const askVerdict: AskVerdict<Transaction> = (words, t) => askVerdicts.get(words.toLowerCase())?.get(t.id)
  /** Bumped by each ask run and by clearing the filter; a run stops once it's stale. */
  let askRun = 0

  /** The Uncategorised view's narrowing. */
  const inView = (t: Transaction) => !state.uncategorisedOnly || (isOrdinaryFlow(t) && isUncategorised(t))

  const filtered = createRoot(() => createMemo(() => {
    const expr = state.filterExpr ? unwrap(state.filterExpr) : null
    const rows = accountScoped()
    if (!expr && !state.uncategorisedOnly) return rows
    if (askTerms(expr).length) askVersion()
    return rows.filter((t) => inView(t) && (!expr || evalFilter(expr, t, askVerdict)))
  }))

  /** The account's rows through the filter, in the table's sort. */
  const scopedTransactions = createRoot(() => createMemo(() => sortRows(filtered(), state.sortColumn, state.sortAscending)))

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

  /**
   * Suggest categories for ordinary uncategorised rows (`ids` narrows them)
   * that have none yet: history first, then Jev when it is set up, each
   * request's suggestions saved as they arrive. `ai` replaces the Jev client
   * (tests).
   */
  async function suggestCategories(ids?: number[], ai?: Pick<JevClient, "judge">): Promise<string> {
    if (state.suggesting) throw new Error("Category suggestions are already running")
    if (!db) throw new Error("db not open")
    const database = db
    setState({ suggesting: true })
    try {
      const selected = ids ? new Set(ids) : null
      const targets = transactions().filter((t) => isOrdinaryFlow(t) && isUncategorised(t) && !state.suggestions[t.id] && (!selected || selected.has(t.id)))
      const history = historySuggestions(transactions(), state.categories, new Set(targets.map((t) => t.id)))
      saveSuggestions(database, history)
      refresh()
      const failures: string[] = []
      let fromJev = 0
      const enabled = !!ai || hasJev()
      if (enabled) {
        const targetIds = new Set(targets.map((t) => t.id))
        const remaining = transactions().filter((t) => targetIds.has(t.id) && !state.suggestions[t.id] && isOrdinaryFlow(t) && isUncategorised(t))
        if (remaining.length) await jevSuggestions(ai ?? jevClient(), remaining, state.categories, {
          history: transactions(),
          onSuggestion: (s) => {
            const current = transactions().find((t) => t.id === s.transactionId)
            if (!current || !isOrdinaryFlow(current) || !isUncategorised(current) || state.suggestions[s.transactionId]) return
            saveSuggestions(database, [s])
            setState("suggestions", s.transactionId, s)
            fromJev++
          },
          onError: (ids, error) => failures.push(`${ids.length} rows: ${error instanceof Error ? error.message : String(error)}`),
        })
      }
      const parts = [`Suggested ${history.length + fromJev}: ${history.length} from history, ${fromJev} from Jev`]
      if (!enabled) parts.push("Jev is not set up (JASKMONEY_JEV_TOKEN)")
      if (failures.length) parts.push(`${failures.length} failed: ${failures[0]}`)
      return parts.join(" · ")
    } finally {
      try { refresh() } finally { setState({ suggesting: false }) }
    }
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
        const known = askVerdicts.get(key) ?? new Map<number, boolean>()
        askVerdicts.set(key, known)
        // Rows the rest of the filter allows, whatever Jev says about these words.
        const others: AskVerdict<Transaction> = (w, t) => w.toLowerCase() === key ? undefined : askVerdict(w, t)
        const possible = accountScoped().filter((t) => inView(t) && mightMatch(expr, t, others))
        const { rows, skipped } = askCandidates(possible, appToday(), hasDateTerm(expr))
        const todo = rows.filter((t) => !known.has(t.id))
        setState({ asking: { words, judged: 0, total: todo.length } })
        await judgeRows(client, words, todo, {
          active: () => run === askRun,
          onJudged: (verdicts) => {
            if (run !== askRun) return
            for (const [id, match] of verdicts) known.set(id, match)
            setAskVersion((v) => v + 1)
            setState("asking", (a) => a && { ...a, judged: a.judged + verdicts.size })
          },
          onError: (error) => failures.push(error instanceof Error ? error.message : String(error)),
        })
        if (run !== askRun) return ""
        const matched = rows.filter((t) => known.get(t.id)).length
        let part = `ask "${words}": ${matched} of ${rows.length} match`
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

  /** Categorise the rows among `ids` that have a suggestion as suggested
   * (pushing to Up where it allows, as any categorisation does), then clear
   * those suggestions. */
  async function acceptSuggestions(ids: number[]): Promise<string> {
    if (!db) throw new Error("db not open")
    refresh()
    const groups = new Map<number, number[]>()
    for (const id of new Set(ids)) {
      const suggestion = state.suggestions[id]
      if (!suggestion) continue
      const group = groups.get(suggestion.categoryId) ?? []
      group.push(id)
      groups.set(suggestion.categoryId, group)
    }
    const results: string[] = []
    for (const [categoryId, groupIds] of groups) {
      results.push(await categorizeTransactions(groupIds, categoryId))
      const accepted = groupIds.filter((id) => transactions().some((t) => t.id === id && t.categoryId === categoryId))
      mutate((db) => deleteSuggestions(db, accepted))
    }
    return results.length ? results.join(" · ") : "No suggestions accepted"
  }

  function dismissSuggestions(ids: number[]): void {
    mutate((db) => deleteSuggestions(db, ids))
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
          const t = transactions().find((t) => t.id === id)
          return t && t.tagIds.includes(tagId) !== add
        })
        const local = targets.filter((id) => tag.name.toUpperCase() === "IGNORE"
          || transactions().find((t) => t.id === id)?.source !== "up")
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
    return evaluateRules(ids ? transactions().filter((txn) => ids.has(txn.id)) : transactions(), state.rules, state.savedFilters, state.categories, state.tags)
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
    setUncategorisedOnly: (on: boolean) => setState({ uncategorisedOnly: on }),
    askAbout,
    suggestCategories,
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
