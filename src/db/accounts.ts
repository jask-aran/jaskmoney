import type { Account } from "../domain/types"
import type { Db } from "./client"

/** Tracked accounts only, unless `includeUnsynced`: an account whose sync the
 * user switched off is hidden everywhere except the sync settings. */
export function loadAccounts(db: Db, { includeUnsynced = false }: { includeUnsynced?: boolean } = {}): Account[] {
  const rows = db
    .query(
      `SELECT id, name, type, sort_order AS sortOrder, is_active AS isActive,
              source, external_kind AS externalKind, balance, sync_enabled AS syncEnabled
       FROM accounts ${includeUnsynced ? "" : "WHERE sync_enabled = 1"} ORDER BY sort_order, id`,
    )
    .all() as Array<{
    id: number
    name: string
    type: "debit" | "credit"
    sortOrder: number
    isActive: number
    source: Account["source"]
    externalKind: string | null
    balance: number | null
    syncEnabled: number
  }>
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    sortOrder: r.sortOrder,
    isActive: r.isActive === 1,
    source: r.source,
    externalKind: r.externalKind,
    balance: r.balance,
    syncEnabled: r.syncEnabled === 1,
  }))
}

export function clearAccountTransactions(db: Db, accountId: number): number {
  const row = db.query(`DELETE FROM transactions WHERE account_id = ?`).run(accountId)
  return Number(row.changes)
}

export function removeAccountWithTransactions(db: Db, accountId: number): number {
  const count = db.query(`SELECT COUNT(*) AS count FROM accounts`).get() as { count: number }
  if (count.count <= 1) throw new Error("cannot delete the last account")
  return Number(db.transaction(() => {
    const removed = db.query(`DELETE FROM transactions WHERE account_id = ?`).run(accountId)
    db.query(`DELETE FROM account_selection WHERE account_id = ?`).run(accountId)
    const account = db.query(`DELETE FROM accounts WHERE id = ?`).run(accountId)
    if (!account.changes) throw new Error("account not found")
    return removed.changes
  })())
}

export function ensureAccount(
  db: Db,
  name: string,
  type: "debit" | "credit",
): Account {
  const existing = db.query(`SELECT id FROM accounts WHERE name = ?`).get(name) as { id: number } | null
  const id = existing
    ? existing.id
    : Number(db.query(`INSERT INTO accounts (name, type, sort_order, is_active) VALUES (?, ?, 1, 1)`).run(name, type).lastInsertRowid)
  return loadAccounts(db).find((account) => account.id === id)!
}

/** Switch provider sync for one account. Switching off removes the account's
 * transactions in the same transaction (sync will not bring them back);
 * switching on only sets the flag, and the next sync fetches its history.
 * Returns the number of transactions removed. */
export function setAccountSyncEnabled(db: Db, accountId: number, enabled: boolean): number {
  return db.transaction(() => {
    const row = db.query(`SELECT source FROM accounts WHERE id = ?`).get(accountId) as { source: string } | null
    if (!row) throw new Error("account not found")
    if (row.source === "csv") throw new Error("CSV accounts are not synced")
    db.query(`UPDATE accounts SET sync_enabled = ? WHERE id = ?`).run(enabled ? 1 : 0, accountId)
    if (enabled) return 0
    db.query(`DELETE FROM account_selection WHERE account_id = ?`).run(accountId)
    // Counted, not read from the delete's changes: SQLite versions differ on
    // whether those include rows its foreign keys cascade to (a tag link).
    const { n } = db.query(`SELECT COUNT(*) AS n FROM transactions WHERE account_id = ?`).get(accountId) as { n: number }
    db.query(`DELETE FROM transactions WHERE account_id = ?`).run(accountId)
    return n
  })()
}
