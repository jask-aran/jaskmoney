import { uncategorisedCategoryId, type Db } from "../db/client"
import type { createUpClient } from "./client"
import { assignProviderCategories, assignTypeCategories, resolveUpName, syncCategoryTree } from "./categories"
import { syncTagLinks } from "./tags"
import type { UpAccount, UpTransaction } from "./types"

type LocalTransaction = { id: number; external_id: string | null; status: string | null; external_created_at: string | null; ext_categorizable: number | null }
type SyncClient = Pick<ReturnType<typeof createUpClient>, "listAccounts" | "listAccountTransactions" | "listCategories">
type Batch = { accountId: string; local: LocalTransaction[]; since: string | undefined; transactions: Awaited<ReturnType<SyncClient["listAccountTransactions"]>> }

/**
 * Fetch Up's accounts, categories and transactions, then save them in one
 * write. `keep`: local rows whose fetched copy is older than what's here
 * (Up confirmed a change for them while this fetched); they're left as they
 * are, and the next sync brings them up to date.
 */
/** `off`: the accounts (Up's ids) chosen not to sync (the setup's account
 * choice): they're saved switched off, as Settings › Up Bank would leave
 * them, and their transactions never fetched. Every other account Up
 * lists is switched on. Without it, each account keeps its switch. */
export async function syncUp(db: Db, client: SyncClient, { now = new Date(), keep, ensureCurrent, off }: { now?: Date; keep?: ReadonlySet<number>; ensureCurrent?: () => void; off?: ReadonlySet<string> } = {}) {
  try {
    const tree = await client.listCategories()
    ensureCurrent?.()
    const accounts = await client.listAccounts()
    ensureCurrent?.()
    const disabledAccounts = () => off ?? new Set(db.query<{ external_id: string }, []>("SELECT external_id FROM accounts WHERE source = 'up' AND sync_enabled = 0 AND external_id IS NOT NULL").all().map(a => a.external_id))
    const batches = await fetchBatches(db, client, accounts, disabledAccounts, ensureCurrent)
    const syncedAt = now.toISOString()
    return db.transaction(() => {
      syncCategoryTree(db, tree)
      const disabled = disabledAccounts()
      const accountIds = saveAccounts(db, accounts, off, syncedAt)
      const { inserted, updated: saved, insertedIds } = saveTransactions(db, batches, accountIds, disabled, keep)
      let updated = saved
      const removedHeld = removeHeld(db, batches, disabled)
      // Rows outside the fetch window still follow Up's (stored) category.
      updated += assignProviderCategories(db)
      updated += assignTypeCategories(db)
      const tags = syncTagLinks(db)
      updated += tags.linksAdded + tags.linksRemoved
      db.query(`INSERT INTO sync_state (source, last_synced_at, last_error) VALUES ('up', ?, NULL)
        ON CONFLICT(source) DO UPDATE SET last_synced_at = excluded.last_synced_at, last_error = NULL`).run(syncedAt)
      return { accounts: accounts.length, inserted, updated, removedHeld, insertedIds }
    })()
  } catch (error) {
    ensureCurrent?.()
    db.query(`INSERT INTO sync_state (source, last_error) VALUES ('up', ?)
      ON CONFLICT(source) DO UPDATE SET last_error = excluded.last_error`).run(error instanceof Error ? error.message : String(error))
    throw error
  }
}

/** Each synced account's transactions: since 14 days before its newest
 * (or its oldest held row), or all of them while any row lacks its details. */
async function fetchBatches(db: Db, client: SyncClient, accounts: UpAccount[], disabledAccounts: () => ReadonlySet<string>, ensureCurrent: (() => void) | undefined): Promise<Batch[]> {
  const batches: Batch[] = []
  for (const account of accounts) {
    if (disabledAccounts().has(account.id)) continue
    const local = db.query<LocalTransaction, [string]>(`SELECT t.id, t.external_id, t.status, t.external_created_at, t.ext_categorizable FROM transactions t
      JOIN accounts a ON a.id = t.account_id WHERE t.source = 'up' AND a.source = 'up' AND a.external_id = ?`).all(account.id)
    let since: string | undefined
    if (local.length && !local.some(t => t.ext_categorizable === null)) {
      const times = local.map(t => Date.parse(t.external_created_at ?? ""))
      if (times.some(t => !Number.isFinite(t))) throw new Error("Invalid local Up transaction timestamp")
      const newest = times.reduce((a, b) => Math.max(a, b), -Infinity)
      const held = local.filter(t => t.status === "HELD").map(t => Date.parse(t.external_created_at ?? ""))
      since = new Date(held.reduce((a, b) => Math.min(a, b), newest - 14 * 86400000)).toISOString()
    }
    const transactions = await client.listAccountTransactions(account.id, since === undefined ? {} : { since })
    ensureCurrent?.()
    batches.push({ accountId: account.id, local, since, transactions })
  }
  return batches
}

/** Save Up's accounts; the local id for each Up account id, previously
 * synced ones included. */
function saveAccounts(db: Db, accounts: UpAccount[], off: ReadonlySet<string> | undefined, syncedAt: string): Map<string, number> {
  const accountIds = new Map<string, number>()
  for (const account of accounts) {
    const existing = db.query<{ id: number }, [string]>("SELECT id FROM accounts WHERE source = 'up' AND external_id = ?").get(account.id)
    // Up's display name as-is; a clash with another account adds " (Up)".
    const name = resolveUpName(account.attributes.displayName,
      name => db.query<{ id: number }, [string]>("SELECT id FROM accounts WHERE name = ?").get(name)?.id,
      existing?.id)
    const a = account.attributes
    if (existing) {
      db.query("UPDATE accounts SET name = ?, type = 'debit', external_kind = ?, balance = ?, balance_at = ? WHERE id = ?")
        .run(name, a.accountType, a.balance.valueInBaseUnits / 100, syncedAt, existing.id)
      if (off) db.query("UPDATE accounts SET sync_enabled = ? WHERE id = ?").run(off.has(account.id) ? 0 : 1, existing.id)
      accountIds.set(account.id, existing.id)
    } else {
      const result = db.query(`INSERT INTO accounts (name, type, source, external_id, external_kind, balance, balance_at, sort_order, is_active, sync_enabled)
        VALUES (?, 'debit', 'up', ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM accounts), 1, ?)`)
        .run(name, account.id, a.accountType, a.balance.valueInBaseUnits / 100, syncedAt, off?.has(account.id) ? 0 : 1)
      accountIds.set(account.id, Number(result.lastInsertRowid))
    }
  }
  // Include previously synced accounts if a transfer counterpart is absent from this response.
  for (const account of db.query<{ id: number; external_id: string }, []>("SELECT id, external_id FROM accounts WHERE source = 'up' AND external_id IS NOT NULL").all()) accountIds.set(account.external_id, account.id)
  return accountIds
}

/** Insert the fetched transactions, or update the ones already here (a
 * category you chose kept); `keep`'s rows are left as they are. */
function saveTransactions(db: Db, batches: Batch[], accountIds: Map<string, number>, disabled: ReadonlySet<string>, keep: ReadonlySet<number> | undefined) {
  const columns = ["status", "amount", "description", "date_raw", "date_iso", "settled_at", "raw_text", "message", "account_id", "transfer_account_id", "ext_category", "ext_parent_category", "ext_tags", "ext_categorizable", "transaction_type", "card_method", "card_suffix", "foreign_amount", "round_up", "cashback", "category_id", "category_source"]
  const update = db.query(`UPDATE transactions SET ${columns.map(c => `${c} = ?`).join(", ")} WHERE id = ? AND NOT (${columns.map(c => `${c} IS ?`).join(" AND ")})`)
  const insert = db.query(`INSERT INTO transactions (${columns.join(", ")}, source, external_id, external_created_at, notes, import_id)
    VALUES (${columns.map(() => "?").join(", ")}, 'up', ?, ?, '', NULL)`)
  const categoryId = uncategorisedCategoryId(db)
  const providerCategories = new Map(db.query<{ id: number; ext_id: string }, []>(
    "SELECT id, ext_id FROM categories WHERE ext_id IS NOT NULL AND parent_id IS NOT NULL").all().map(c => [c.ext_id, c.id]))
  let inserted = 0, updated = 0
  const insertedIds: number[] = []
  for (const transaction of batches.flatMap(batch => batch.transactions)) {
    const a = transaction.attributes, r = transaction.relationships
    if (disabled.has(r.account.data.id)) continue
    if (!Number.isFinite(Date.parse(a.createdAt))) throw new Error("Invalid Up transaction timestamp")
    const accountId = accountIds.get(r.account.data.id)
    if (accountId === undefined) throw new Error("Up transaction account is missing")
    const existing = db.query<{ id: number; category_id: number | null; category_source: string | null }, [string]>(
      "SELECT id, category_id, category_source FROM transactions WHERE source = 'up' AND external_id = ?").get(transaction.id)
    if (existing && keep?.has(existing.id)) continue
    const values = transactionValues(transaction, accountId, accountIds, existing, providerCategories, categoryId)
    if (existing) updated += update.run(...values, existing.id, ...values).changes
    else {
      const result = insert.run(...values, transaction.id, a.createdAt)
      inserted++
      insertedIds.push(Number(result.lastInsertRowid))
    }
  }
  return { inserted, updated, insertedIds }
}

/** A fetched transaction's column values (saveTransactions' columns). */
function transactionValues(transaction: UpTransaction, accountId: number, accountIds: Map<string, number>, existing: { id: number; category_id: number | null; category_source: string | null } | null, providerCategories: Map<string, number>, categoryId: number) {
  const a = transaction.attributes, r = transaction.relationships
  const providerCategory = providerCategories.get(r.category.data?.id ?? "")
  const preserveCategory = existing && existing.category_source !== null && existing.category_source !== "provider"
  const assignedCategory = preserveCategory ? existing.category_id : providerCategory ?? categoryId
  const categorySource = preserveCategory ? existing.category_source : providerCategory === undefined ? null : "provider"
  return [a.status, a.amount.valueInBaseUnits / 100, a.description, a.createdAt, a.createdAt.slice(0, 10), a.settledAt, a.rawText, a.message,
    accountId, r.transferAccount.data ? accountIds.get(r.transferAccount.data.id) ?? null : null,
    r.category.data?.id ?? null, r.parentCategory.data?.id ?? null, JSON.stringify(r.tags.data.map(t => t.id)),
    a.isCategorizable ? 1 : 0, a.transactionType, a.cardPurchaseMethod?.method ?? null, a.cardPurchaseMethod?.cardNumberSuffix ?? null,
    a.foreignAmount ? `${a.foreignAmount.currencyCode} ${a.foreignAmount.value}` : null,
    a.roundUp ? a.roundUp.amount.valueInBaseUnits / 100 : null, a.cashback ? a.cashback.amount.valueInBaseUnits / 100 : null, assignedCategory, categorySource]
}

/** Delete the held rows in each fetch window that Up no longer returns (they
 * settled under a new id, or were cancelled); how many. */
function removeHeld(db: Db, batches: Batch[], disabled: ReadonlySet<string>): number {
  let removedHeld = 0
  const remove = db.query("DELETE FROM transactions WHERE id = ? AND source = 'up' AND status = 'HELD'")
  const markMissing = db.query("UPDATE transactions SET ext_categorizable = 0 WHERE id = ? AND ext_categorizable IS NULL")
  for (const { accountId, local, since, transactions } of batches) {
    if (disabled.has(accountId)) continue
    const returned = new Set(transactions.filter(t => t.relationships.account.data.id === accountId).map(t => t.id))
    for (const row of local) {
      if (row.status === "HELD" && (since === undefined || Date.parse(row.external_created_at ?? "") >= Date.parse(since)) &&
        (row.external_id === null || !returned.has(row.external_id))) removedHeld += remove.run(row.id).changes > 0 ? 1 : 0
    }
    // After a full-history fetch, a row Up no longer returns can never get
    // its details; mark it not categorisable so it stops forcing full
    // fetches (and is never pushed to).
    if (since === undefined) {
      for (const row of local) {
        if (row.ext_categorizable === null && row.external_id !== null && !returned.has(row.external_id)) markMissing.run(row.id)
      }
    }
  }
  return removedHeld
}
