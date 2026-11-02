import type { CategorySource } from "../db/schema"
import { setTransactionCategory, recordCategoryChoices, unrecordCategoryChoices, logCategories, unlogCategory, unlogTag, type Db, type CategoryHow, type TagHow } from "../db/client"
import type { Category } from "../domain/types"
import { UpApiError } from "../up/client"
import { PUSH_CONCURRENCY, pushTransactions } from "../up/push"
import { sendQueuedTagChange } from "../up/tags"
import { addTagLink, removeTagLink, stageTagChange } from "../db/tagLinks"
import { appNow } from "../domain/days"
import type { CoreContext, Session, TagPatch } from "./context"

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
function confirmCategoryPush(db: Db, id: number, p: CategoryPush, confirmed: (id: number) => void): void {
  confirmed(id)
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

export function createUpPush(ctx: CoreContext, deps: { ruleOfferNote: (ids: number[]) => string }) {
  const { state, refresh, transactions, upClient, recordUndo, categorySnapshot, restoreCategories, setLastRepeat } = ctx
  const { ruleOfferNote } = deps
  // Only the latest local write owns a row when Up answers.
  const sessions = new WeakMap<Session, { latest: Map<number, number>; pushingIds: Map<number, number>; pushingTags: Set<string> }>()
  function pushesFor(session: Session) {
    let pushes = sessions.get(session)
    if (!pushes) {
      pushes = { latest: new Map(), pushingIds: new Map(), pushingTags: new Set() }
      sessions.set(session, pushes)
    }
    return pushes
  }
  // Counts preserve a newer reservation when an older push of the same row settles.
  const reserve = (ids: Map<number, number>, id: number) => { ids.set(id, (ids.get(id) ?? 0) + 1) }
  const release = (ids: Map<number, number>, id: number) => {
    const count = ids.get(id) ?? 0
    if (count <= 1) ids.delete(id)
    else ids.set(id, count - 1)
  }
  let sequence = 0

  // Rows Up confirmed a change for, heard by each sync fetching meanwhile.
  const watchers = new Set<Set<number>>()
  const confirmed = (id: number) => { for (const ids of watchers) ids.add(id) }

  /** Hear which rows Up confirms a change for from now until `stop`: a sync
   * fetching meanwhile has their older copy (up/sync `keep`). */
  function watchUpWrites(): { ids: ReadonlySet<number>; stop: () => void } {
    const ids = new Set<number>()
    watchers.add(ids)
    return { ids, stop: () => { watchers.delete(ids) } }
  }

  /**
   * Give each row (id → category id) its category: all of them locally at
   * once, shown before any request, then pushed to the provider where it
   * can hold the choice: an Up transaction it marks categorisable takes an
   * Up subcategory, or "no category" for the default (Uncategorised). Pushed
   * rows then follow the provider (source 'provider'). Anything else (a
   * local-only category, a transfer, a CSV row) is the user's choice
   * ('user'). A rejected push puts its row back as it was, unless a newer
   * local write owns it. `afterLocal` records undo before any push. Up has
   * no batch endpoint: pushes run PUSH_CONCURRENCY at a time, `onProgress` hearing
   * each (0 of n first, once every row shows its new category).
   */
  async function applyCategories(
    assignments: Map<number, number>,
    how: CategoryHow,
    onProgress?: (pushed: number, total: number) => void,
    afterLocal?: () => void,
  ): Promise<CategorizeResult> {
    const session = ctx.session()
    const database = session.db
    const { latest, pushingIds } = pushesFor(session)
    type Prior = { categoryId: number | null; source: CategorySource | null; ext: string | null; extParent: string | null }
    const pushes = new Map<number, CategoryPush & { prior: Prior; sequence: number }>()
    const writes = new Map<number, number>()
    let local = 0
    const chosen = new Map<string, { description: string; categoryId: number; times: number }>()
    const logged: { transactionId: number; categoryId: number; previousCategoryId: number | null }[] = []
    const byId = new Map(transactions().map(t => [t.id, t]))
    try { database.transaction(() => {
      for (const [id, categoryId] of assignments) {
        const t = byId.get(id)
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
            categoryId: number | null; categorySource: CategorySource | null; ext: string | null; extParent: string | null
          } | null
        if (!row) continue
        const push = categoryPush(row, category, state.categories)
        // Shown at once; a push confirms it, a rejection puts it back.
        setTransactionCategory(database, id, categoryId, push ? "pending" : "user")
        writes.set(id, ++sequence)
        if (push) {
          pushes.set(id, { ...push, sequence, prior: { categoryId: row.categoryId, source: row.categorySource, ext: row.ext, extParent: row.extParent } })
          reserve(pushingIds, id)
        } else local++
      }
      // Repeated choices turn into rule offers (ruleOffersFor).
      if (how !== "undo") recordCategoryChoices(database, [...chosen.values()])
      logCategories(database, logged, how, appNow().toISOString())
    })() } catch (error) {
      for (const id of pushes.keys()) release(pushingIds, id)
      throw error
    }
    // A rolled-back transaction must not supersede an in-flight push.
    for (const [id, sequence] of writes) latest.set(id, sequence)
    refresh(writes.keys())
    afterLocal?.()
    let settled = 0, waiting = 0
    const waitingErrors: string[] = []
    onProgress?.(0, pushes.size)
    const { changed: pushed, failures } = await pushTransactions([...pushes.keys()], (id) => {
      const p = pushes.get(id)!
      return async () => {
        try {
          ctx.ensureCurrent(session, "categories were sent to Up")
          await upClient().setTransactionCategory(p.externalId, p.providerId)
          ctx.ensureCurrent(session, "categories were sent to Up")
        } catch (error) {
          ctx.ensureCurrent(session, "categories were sent to Up")
          if (!upRejected(error)) {
            if (latest.get(id) !== p.sequence) return 0
            // Up didn't answer: it stays 'pending' for the next sync.
            waiting++
            waitingErrors.push(waitReason(error))
            return 0
          }
          if (latest.get(id) === p.sequence) {
            database.query(`UPDATE transactions SET category_id = ?, category_source = ?, ext_category = ?, ext_parent_category = ? WHERE id = ?`)
              .run(p.prior.categoryId, p.prior.source, p.prior.ext, p.prior.extParent, id)
            unlogCategory(database, id, p.categoryId)
          }
          throw error
        } finally {
          release(pushingIds, id)
        }
        if (latest.get(id) === p.sequence) confirmCategoryPush(database, id, p, confirmed)
        return 1
      }
    // With nothing pushed, the refresh above already shows every write.
    }, { complete: () => { if (pushes.size && ctx.isCurrent(session)) refresh(pushes.keys()) }, onSettled: () => { if (ctx.isCurrent(session)) onProgress?.(++settled, pushes.size) }, concurrency: PUSH_CONCURRENCY })
    ctx.ensureCurrent(session, "categories were sent to Up")
    return { done: local + pushed + waiting, pushed, failures, waiting, waitingError: waitingErrors[0] }
  }

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
    const session = ctx.session()
    const database = session.db
    const { latest, pushingIds } = pushesFor(session)
    const rows = database.query(`SELECT id, category_id AS categoryId, source, external_id AS externalId, ext_categorizable AS categorizable
      FROM transactions WHERE category_source = 'pending'`).all() as Array<PushableRow & { id: number; categoryId: number | null }>
    const pushes = new Map<number, CategoryPush & { sequence: number | undefined }>()
    try { database.transaction(() => {
      for (const row of rows) {
        if (pushingIds.has(row.id)) continue
        const category = state.categories.find((c) => row.categoryId == null ? c.isDefault : c.id === row.categoryId)
        const push = category && categoryPush(row, category, state.categories)
        if (push) {
          pushes.set(row.id, { ...push, sequence: latest.get(row.id) })
          reserve(pushingIds, row.id)
        } else database.query(`UPDATE transactions SET category_source = 'user' WHERE id = ?`).run(row.id)
      }
    })() } catch (error) {
      for (const id of pushes.keys()) release(pushingIds, id)
      throw error
    }
    let rejected = 0, waiting = 0
    const { changed: pushed } = await pushTransactions([...pushes.keys()], (id) => {
      const p = pushes.get(id)!
      return async () => {
        try {
          ctx.ensureCurrent(session, "pending categories were sent to Up")
          await upClient().setTransactionCategory(p.externalId, p.providerId)
          ctx.ensureCurrent(session, "pending categories were sent to Up")
        } catch (error) {
          ctx.ensureCurrent(session, "pending categories were sent to Up")
          if (upRejected(error)) {
            rejected++
            if (latest.get(id) === p.sequence) database.query(`UPDATE transactions SET category_source = 'user' WHERE id = ?`).run(id)
          } else if (latest.get(id) === p.sequence) waiting++
          throw error
        } finally {
          release(pushingIds, id)
        }
        if (latest.get(id) === p.sequence) confirmCategoryPush(database, id, p, confirmed)
        return 1
      }
    }, { concurrency: PUSH_CONCURRENCY })
    ctx.ensureCurrent(session, "pending categories were sent to Up")
    if (rows.length) refresh(rows.map((row) => row.id))
    return { pushed, rejected, waiting }
  }

  /** Put `txnIds` in one category (see applyCategories). */
  async function categorizeTransactions(txnIds: number[], categoryId: number, onProgress?: (pushed: number, total: number) => void): Promise<string> {
    const session = ctx.session()
    const category = state.categories.find((c) => c.id === categoryId)
    if (!category) throw new Error("category not found")
    const assignments = new Map(txnIds.map((id) => [id, categoryId]))
    const before = categorySnapshot(assignments)
    setLastRepeat({ kind: "category", categoryId })
    const result = await applyCategories(assignments, "choose", onProgress, () => {
      const byId = new Map(transactions().map(t => [t.id, t]))
      const changed = before.filter((row) => {
        const t = byId.get(row.id)
        return t && t.categoryId !== row.categoryId
      })
      if (changed.length) recordUndo(`categorised ${changed.length} → ${category.name}`, async () => {
        const summary = await restoreCategories(changed)
        // Only the choices table changes: every row stays as it is.
        ctx.mutateSession(session, "categories were restored", (db) => unrecordCategoryChoices(db, before.map((row) => ({ description: row.description, categoryId, times: 1 }))), [])
        return summary
      })
    })
    ctx.ensureCurrent(session, "categories were sent to Up")
    return operationSummary(`Categorized ${result.done} → ${category.name}`, result) + ruleOfferNote(txnIds)
  }

  type TagPush = { id: number; tagId: number; action: "add" | "remove" }
  const tagPushKey = (p: TagPush) => `${p.id}:${p.tagId}`

  /** State matrix (approved provider deviation from legacy local-only tags):
   * local/IGNORE: link + log only; Up: link + log + latest queued intent.
   * Confirm: update provider snapshot + drop intent; refuse: inverse link +
   * unlog + drop intent; no answer: retain link, log and intent. Sync overlays
   * waiting intent on Up's links. A retry skips every reserved in-flight pair.
   */
  async function pushQueuedTags(session: Session, candidates: TagPush[]) {
    const database = session.db
    // The shared sender writes after its own await. Check each database
    // access too: a guard in the client promise leaves a microtask gap.
    const guardedDatabase = new Proxy(database, {
      get(target, key) {
        ctx.ensureCurrent(session, "tags were sent to Up")
        const value = Reflect.get(target, key, target)
        return typeof value === "function" ? value.bind(target) : value
      },
    })
    const { pushingTags } = pushesFor(session)
    const pushes = candidates.filter((p) => !pushingTags.has(tagPushKey(p))).map((p) => ({
      ...p,
      logId: database.query<{ id: number | null }, [number, number]>(
        "SELECT MAX(id) AS id FROM tag_log WHERE transaction_id = ? AND tag_id = ?").get(p.id, p.tagId)!.id,
    }))
    for (const p of pushes) pushingTags.add(tagPushKey(p))
    let pushed = 0, rejected = 0, waiting = 0
    const pushedIds = new Set<number>()
    let waitingError: string | undefined
    const client = {
      addTransactionTags: (id: string, tags: string[]) => upClient().addTransactionTags(id, tags),
      removeTransactionTags: (id: string, tags: string[]) => upClient().removeTransactionTags(id, tags),
    }
    const result = await pushTransactions(pushes.map((_, i) => i), (i) => {
      const p = pushes[i]!
      return async () => {
        try {
          ctx.ensureCurrent(session, "tags were sent to Up")
          const sent = await sendQueuedTagChange(guardedDatabase, client, p.id, p.tagId, p.action, p.logId)
          ctx.ensureCurrent(session, "tags were sent to Up")
          if (!sent) return 0
          confirmed(p.id)
          pushed++
          pushedIds.add(p.id)
          return 1
        } catch (error) {
          ctx.ensureCurrent(session, "tags were sent to Up")
          if (!upRejected(error)) {
            waiting++
            waitingError ??= waitReason(error)
            return 0
          }
          rejected++
          database.transaction(() => {
            const removed = database.query(`DELETE FROM tag_pushes WHERE transaction_id = ? AND tag_id = ? AND action = ?
              AND ? IS (SELECT MAX(id) FROM tag_log WHERE transaction_id = ? AND tag_id = ?)`)
              .run(p.id, p.tagId, p.action, p.logId, p.id, p.tagId).changes
            unlogTag(database, p.logId)
            if (!removed) return // A newer intent owns the link and its log.
            if (p.action === "add") removeTagLink(database, p.id, p.tagId)
            else addTagLink(database, p.id, p.tagId)
          })()
          throw error
        } finally {
          pushingTags.delete(tagPushKey(p))
        }
      }
    }, { complete: () => { if (ctx.isCurrent(session)) refresh() }, concurrency: PUSH_CONCURRENCY })
    ctx.ensureCurrent(session, "tags were sent to Up")
    return { pushed, pushedIds, rejected, waiting, waitingError, failures: result.failures }
  }

  async function retryPendingTags(): Promise<{ pushed: number; rejected: number; waiting: number }> {
    if (!ctx.db) return { pushed: 0, rejected: 0, waiting: 0 }
    const session = ctx.session()
    const rows = session.db.query<TagPush, []>("SELECT transaction_id AS id, tag_id AS tagId, action FROM tag_pushes ORDER BY transaction_id, tag_id").all()
    // Nothing waiting: nothing to send or reload (after every sync).
    if (!rows.length) return { pushed: 0, rejected: 0, waiting: 0 }
    const { pushed, rejected, waiting } = await pushQueuedTags(session, rows)
    ctx.ensureCurrent(session, "pending tags were sent to Up")
    return { pushed, rejected, waiting }
  }

  async function applyTagPatch(txnIds: number[], patch: TagPatch, how: TagHow = "picker"): Promise<string> {
    const session = ctx.session()
    const database = session.db
    if (!Object.keys(patch).length) return "Tags unchanged"
    if (how === "picker") setLastRepeat({ kind: "tags", patch: { ...patch } })
    const selected = new Set(txnIds)
    const before = transactions().filter((t) => selected.has(t.id)).map((t) => ({ id: t.id, tagIds: [...t.tagIds] }))
    const pushes: TagPush[] = []
    const labels: string[] = [], failures: string[] = []
    database.transaction(() => {
      const at = appNow().toISOString()
      for (const [key, action] of Object.entries(patch)) {
        const tagId = Number(key)
        const tag = state.tags.find((t) => t.id === tagId)
        if (!tag) throw new Error("tag not found")
        const add = action === "add"
        labels.push(`${add ? "+" : "-"}${tag.name}`)
        for (const t of before.filter((t) => t.tagIds.includes(tagId) !== add)) {
          const staged = stageTagChange(database, { transactionId: t.id, tagId, action, how, at })
          if (staged.kind === "refused") failures.push(staged.reason)
          else if (staged.kind === "changed" && staged.queued) pushes.push({ id: t.id, tagId, action })
        }
      }
    })()
    refresh(before.map((t) => t.id))
    const result = pushes.length ? await pushQueuedTags(session, pushes) : { pushed: 0, pushedIds: new Set<number>(), rejected: 0, waiting: 0, failures: [] }
    // What changed is read from this database, and undo belongs to it.
    ctx.ensureCurrent(session, "tags were sent to Up")
    failures.push(...result.failures)
    const byId = new Map(transactions().map(t => [t.id, t]))
    const updated = new Set<number>()
    const reversals: { ids: number[]; patch: TagPatch }[] = []
    for (const [key, action] of Object.entries(patch)) {
      const tagId = Number(key)
      const changed = before.filter((t) => {
        const now = byId.get(t.id)
        return now && now.tagIds.includes(tagId) !== t.tagIds.includes(tagId)
      }).map((t) => t.id)
      for (const id of changed) updated.add(id)
      if (changed.length) reversals.push({ ids: changed, patch: { [tagId]: action === "add" ? "remove" : "add" } })
    }
    if ((how === "picker" || how === "review") && updated.size) recordUndo(`${labels.join(", ")} on ${updated.size}`, async () => {
      const summaries: string[] = []
      for (const reversal of reversals) {
        summaries.push(await applyTagPatch(reversal.ids, reversal.patch, "undo"))
        ctx.ensureCurrent(session, "tags were restored")
      }
      return summaries.join(" · ")
    })
    return operationSummary(`Tags: ${labels.join(", ")} on ${updated.size}`, { ...result, pushed: result.pushedIds.size, failures })
  }

  return { applyCategories, retryPendingCategories, retryPendingTags, categorizeTransactions, applyTagPatch, watchUpWrites }
}
