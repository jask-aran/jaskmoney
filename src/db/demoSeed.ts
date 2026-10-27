import { unlinkSync } from "node:fs"
import { openDb, loadCategories, uncategorisedCategoryId } from "./client"
import type { DemoAccount, DemoTransaction } from "../domain/demo"
import type { Category } from "../domain/types"

/** Destructive by contract: call only with the separate demo database path. */
export function seedDemoDb(path: string, demo: { accounts: DemoAccount[]; transactions: DemoTransaction[] }, categories: readonly Category[]): void {
  for (const file of [path, `${path}-wal`, `${path}-shm`]) {
    try { unlinkSync(file) } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
    }
  }
  const db = openDb(path)
  try {
    db.transaction(() => {
      const upsert = db.query(`INSERT INTO categories (name, color, sort_order, is_default, not_spending, income)
        VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET color = excluded.color,
        sort_order = excluded.sort_order, is_default = excluded.is_default,
        not_spending = excluded.not_spending, income = excluded.income`)
      for (const c of categories) upsert.run(c.name, c.color, c.sortOrder, Number(c.isDefault), Number(c.notSpending), Number(c.income))
      const categoryIds = new Map(loadCategories(db).map(c => [c.name, c.id]))
      const uncategorisedId = uncategorisedCategoryId(db)
      const sourceCategories = new Map(categories.map(c => [c.id, c]))
      for (const c of categories) {
        const parent = c.parentId === null ? null : sourceCategories.get(c.parentId)
        if (c.parentId !== null && !parent) throw new Error(`Missing demo category parent: ${c.name}`)
        db.query("UPDATE categories SET parent_id = ? WHERE name = ?").run(parent ? categoryIds.get(parent.name) ?? null : null, c.name)
      }
      const accountIds = new Map<string, number>()
      const insertAccount = db.query(`INSERT INTO accounts (name, type, source, external_id, external_kind, balance, sync_enabled, sort_order)
        VALUES (?, 'debit', 'up', NULL, ?, ?, 1, ?)`)
      demo.accounts.forEach((a, i) => {
        if (accountIds.has(a.key)) throw new Error(`Duplicate demo account key: ${a.key}`)
        const result = insertAccount.run(a.name, a.kind === "saver" ? "SAVER" : "TRANSACTIONAL", a.balance, i)
        accountIds.set(a.key, Number(result.lastInsertRowid))
      })
      const insert = db.query(`INSERT INTO transactions (source, external_id, date_raw, date_iso, amount, description,
        account_id, category_id, category_source, transfer_account_id, status, transaction_type, message, foreign_amount, ext_categorizable)
        VALUES ('up', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      for (const t of demo.transactions) {
        const accountId = accountIds.get(t.accountKey)
        const transferId = t.transferToKey === undefined ? null : accountIds.get(t.transferToKey)
        const categoryId = t.categoryName === null ? uncategorisedId : categoryIds.get(t.categoryName)
        if (accountId === undefined || transferId === undefined) throw new Error("Missing demo transaction account")
        if (categoryId === undefined) throw new Error(`Missing demo transaction category: ${t.categoryName}`)
        const categorySource = t.categoryName === null ? null : t.transactionType === "Salary" || t.transactionType === "Interest" ? "type" : "provider"
        insert.run(t.dateISO, t.dateISO, t.amount, t.description, accountId, categoryId, categorySource, transferId,
          t.status, t.transactionType, t.message, t.foreignAmount, transferId === null ? 1 : 0)
      }
    })()
  } finally {
    db.close()
  }
}
