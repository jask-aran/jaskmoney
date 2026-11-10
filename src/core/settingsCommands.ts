import { isDeepStrictEqual } from "node:util"
import { logCategories, createCategory, updateCategory, setCategoryBudgetIgnored, deleteCategory, createTag, updateTag, deleteTag, createRule, updateRule, deleteRule, reorderRule, toggleRule, type TagInput } from "../db/client"
import { appNow } from "../domain/days"
import { stageTagChange } from "../db/tagLinks"
import { dryRunRules as evaluateRules } from "../domain/rules"
import type { Category, ImportProfile, Rule, RuleRunResult, SavedFilter } from "../domain/types"
import { saveSettingsConfig, validateImportProfile, validateSavedFilter, type SettingsConfig, type UiPrefs } from "../state/settingsConfig"
import { categoryPush, type PushableRow } from "./upPush"
import type { CoreRuntime } from "./runtime"
import { CONFIG_SETTLE_MS } from "./runtime"

export class SettingsCommands {
  constructor(private readonly ctx: CoreRuntime) {}
  // Prefs that change with each key (the range, the account, the charts)
  // are written once they settle, not on every press; exit writes any left.
  // Dirty until a write succeeds, so a failed one is tried again.
  configTimer: ReturnType<typeof setTimeout> | null = null
  configDirty = false

  createSettingsCategory = (input: Pick<Category, "name" | "color"> & { notSpending?: boolean }): number => {
    return this.ctx.mutate((db) => createCategory(db, input))
  }

  createSettingsTag = (input: TagInput): number => {
    return this.ctx.mutate((db) => createTag(db, input))
  }

  createSettingsRule = (input: Omit<Rule, "id" | "sortOrder">): number => {
    return this.ctx.mutate((db) => createRule(db, input))
  }

  deleteSettingsRule = (id: number) => { this.ctx.mutate((db) => deleteRule(db, id)) }

  /** The names cat:, tag: and acc: values are found among (shortened names). */
  filterNames = () => {
    return { cat: this.ctx.state.categories.map((c) => c.name), tag: this.ctx.state.tags.map((t) => t.name), acc: this.ctx.state.accounts.map((a) => a.name) }
  }

  persistConfig = (patch: Partial<SettingsConfig>) => {
    // Writes everything as it is now, so a deferred UI write is done too.
    if (this.configTimer) { clearTimeout(this.configTimer); this.configTimer = null }
    saveSettingsConfig({ version: 2, icons: this.ctx.state.icons, welcomed: this.ctx.state.welcomed, savedFilters: this.ctx.state.savedFilters, importProfiles: this.ctx.state.importProfiles, ui: this.ctx.state.uiPrefs, ...patch })
    this.configDirty = false
  }

  flushConfig = () => {
    if (!this.configDirty) return
    try { this.persistConfig({}) } catch { /* the next write or exit tries again */ }
  }

  /** `soon`: written once keys settle (CONFIG_SETTLE_MS), for prefs that
   * change on every press; otherwise now. */
  saveUiPrefs = (patch: Partial<UiPrefs>, { soon = false } = {}) => {
    const next = { ...this.ctx.state.uiPrefs, ...patch }
    if (next.filterUsage) next.filterUsage = Object.fromEntries(Object.entries(next.filterUsage).filter(([id]) => this.ctx.state.savedFilters.some((filter) => filter.id === id)))
    if (isDeepStrictEqual(next, this.ctx.state.uiPrefs)) return
    if (!soon) this.persistConfig({ ui: next })
    this.ctx.set({ uiPrefs: next, weekStart: next.weekStart ?? "monday" })
    if (soon) {
      this.configDirty = true
      if (this.configTimer) clearTimeout(this.configTimer)
      this.configTimer = setTimeout(this.flushConfig, CONFIG_SETTLE_MS)
    }
  }

  saveSavedFilter = (filter: SavedFilter, originalId?: string) => {
    const others = this.ctx.state.savedFilters.filter((f) => f.id !== originalId)
    const normalized = validateSavedFilter(filter, others, this.filterNames())
    const next = originalId ? this.ctx.state.savedFilters.map((f) => f.id === originalId ? normalized : f) : [...this.ctx.state.savedFilters, normalized]
    this.persistConfig({ savedFilters: next })
    this.ctx.set({ savedFilters: next })
  }

  deleteSavedFilter = (id: string) => {
    const next = this.ctx.state.savedFilters.filter((f) => f.id !== id)
    const filterUsage = this.ctx.state.uiPrefs.filterUsage ? Object.fromEntries(Object.entries(this.ctx.state.uiPrefs.filterUsage).filter(([filterId]) => filterId !== id)) : undefined
    const prefs = { ...this.ctx.state.uiPrefs, ...(filterUsage ? { filterUsage } : {}) }
    this.persistConfig({ savedFilters: next, ui: prefs })
    this.ctx.set({ savedFilters: next, uiPrefs: prefs })
  }

  applyRules = (transactionIds?: number[], dryRun = false): RuleRunResult => {
    if (!this.ctx.db) throw new Error("db not open")
    const ids = transactionIds ? new Set(transactionIds) : null
    const report = evaluateRules(ids ? this.ctx.transactions().filter((txn) => ids.has(txn.id)) : this.ctx.transactions(), this.ctx.state.rules, this.ctx.state.savedFilters, this.ctx.state.categories, this.ctx.state.tags)
    let tagChanges = 0, updatedTransactions = 0
    // No change, no write: a reload would send every row again for nothing.
    if (!dryRun && report.changes.length) this.ctx.mutate((database) => database.transaction(() => {
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
          const category = this.ctx.state.categories.find((c) => c.id === change.categoryId)
          const source = row && category && categoryPush(row, category, this.ctx.state.categories) ? "pending" : "rule"
          database.query(`UPDATE transactions SET category_id = ?, category_source = ? WHERE id = ?`).run(change.categoryId, source, change.id)
          const previous = this.ctx.transactions().find((t) => t.id === change.id)?.categoryId ?? null
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
  settingsCommands = {
    createCategory: (p: { input: Pick<Category, "name" | "color"> & { notSpending?: boolean } }) => this.createSettingsCategory(p.input),
    updateCategory: (p: { id: number; input: Pick<Category, "name" | "color"> & { notSpending?: boolean } }) => this.ctx.mutate((db) => updateCategory(db, p.id, p.input)),
    setCategoryBudgetIgnored: (p: { id: number; ignored: boolean }) => this.ctx.mutate((db) => setCategoryBudgetIgnored(db, p.id, p.ignored)),
    deleteCategory: (p: { id: number }) => this.ctx.mutate((db) => deleteCategory(db, p.id)),
    createTag: (p: { input: TagInput }) => this.createSettingsTag(p.input),
    updateTag: (p: { id: number; input: TagInput }) => this.ctx.mutate((db) => updateTag(db, p.id, p.input)),
    deleteTag: (p: { id: number }) => this.ctx.mutate((db) => deleteTag(db, p.id)),
    createRule: (p: { input: Omit<Rule, "id" | "sortOrder"> }) => this.createSettingsRule(p.input),
    updateRule: (p: { rule: Rule }) => this.ctx.mutate((db) => updateRule(db, p.rule)),
    deleteRule: (p: { id: number }) => this.deleteSettingsRule(p.id),
    reorderRule: (p: { id: number; index: number }) => this.ctx.mutate((db) => reorderRule(db, p.id, p.index)),
    toggleRule: (p: { id: number; enabled: boolean }) => this.ctx.mutate((db) => toggleRule(db, p.id, p.enabled)),
    applyRules: (p: { ids?: number[]; dryRun?: boolean }) => this.applyRules(p.ids, p.dryRun),

    saveSavedFilter: (p: { filter: SavedFilter; originalId?: string }) => this.saveSavedFilter(p.filter, p.originalId),
    deleteSavedFilter: (p: { id: string }) => this.deleteSavedFilter(p.id),
    recordFilterUsage: (p: { id: string }) => this.saveUiPrefs({ filterUsage: { ...this.ctx.state.uiPrefs.filterUsage, [p.id]: appNow().toISOString() } }),
    setIcons: (p: { on: boolean }) => { this.persistConfig({ icons: p.on }); this.ctx.set({ icons: p.on }) },
    setWelcomed: (p: { done: boolean }) => { this.persistConfig({ welcomed: p.done }); this.ctx.set({ welcomed: p.done }) },
    saveUiPrefs: (p: { patch: Partial<UiPrefs>; soon?: boolean }) => this.saveUiPrefs(p.patch, { soon: p.soon }),
    /** Save a profile; `originalId` is the id it had when editing began, so
     * renaming one replaces it instead of leaving the old one behind. */
    saveImportProfile: (p: { profile: ImportProfile; originalId?: string | null }) => {
      const normalized = validateImportProfile(p.profile)
      const next = [...this.ctx.state.importProfiles.filter((x) => x.id !== normalized.id && x.id !== p.originalId), normalized].sort((a, b) => a.id.localeCompare(b.id))
      this.persistConfig({ importProfiles: next })
      this.ctx.set({ importProfiles: next })
    },
    deleteImportProfile: (p: { id: string }) => {
      const next = this.ctx.state.importProfiles.filter((x) => x.id !== p.id)
      this.persistConfig({ importProfiles: next })
      this.ctx.set({ importProfiles: next })
    }
  }
}
