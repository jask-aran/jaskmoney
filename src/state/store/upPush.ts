import { addTagToTransactions, removeTagFromTransactions, setTransactionCategory, recordCategoryChoices, unrecordCategoryChoices, logCategories, unlogCategory, logTags, type Db, type CategoryHow, type TagHow } from "../../db/client"
import type { Category } from "../../domain/types"
import { UpApiError } from "../../up/client"
import { PUSH_CONCURRENCY, pushTransactions } from "../../up/push"
import { pushTagChange } from "../../up/tags"
import { appNow } from "../../domain/days"
import type { StoreContext, TagPatch } from "./context"

export interface CategorizeResult { done: number; pushed: number; failures: string[]; waiting: number; waitingError?: string }

/** "<what> · N updated in Up · N waiting for Up … · N failed: <first error>". */
export function operationSummary(head: string, r: Pick<CategorizeResult, "pushed" | "failures"> & Partial<Pick<CategorizeResult, "waiting" | "waitingError">>): string {
  const parts = [head]
  if (r.pushed) parts.push(`${r.pushed} updated in Up`)
  if (r.waiting) parts.push(`${r.waiting} waiting for Up (${r.waitingError}; sent on the next sync)`)
  if (r.failures.length) parts.push(`${r.failures.length} failed: ${r.failures[0]}`)
  return parts.join(" · ")
}

/** A transaction as far as pushing its category goes. */
export interface PushableRow { source: string; externalId: string | null; categorizable: number | null }
/** Where a category goes in Up: an Up subcategory, or null (no category). */
interface CategoryPush { categoryId: number; externalId: string; providerId: string | null; parentExt: string | null }

/** The push that puts `category` on `row` in Up, or null when Up can't hold
 * it: not an Up row, one Up won't categorise, or a local-only category. */
export function categoryPush(row: PushableRow, category: Category, categories: Category[]): CategoryPush | null {
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

export function createUpPush(ctx: StoreContext, deps: { ruleOfferNote: (ids: number[]) => string }) {
  const { state, mutate, refresh, transactions, upClient, recordUndo, categorySnapshot, restoreCategories, setLastRepeat } = ctx
  const { ruleOfferNote } = deps

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
    if (!ctx.db) throw new Error("db not open")
    const database = ctx.db
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
    if (!ctx.db) return { pushed: 0, rejected: 0, waiting: 0 }
    const database = ctx.db
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

  async function applyTagPatch(txnIds: number[], patch: TagPatch, how: TagHow = "picker"): Promise<string> {
    if (!ctx.db) throw new Error("db not open")
    const database = ctx.db
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

  return { applyCategories, retryPendingCategories, categorizeTransactions, applyTagPatch }
}
