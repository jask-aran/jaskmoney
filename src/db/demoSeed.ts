import { unlinkSync } from "node:fs"
import { openDb, loadCategories, uncategorisedCategoryId, saveBudget, saveBudgetCycle } from "./client"
import { DEMO_CATEGORIES, type DemoData } from "../domain/demo"

/** Destructive by contract: call only with the separate demo database path. */
export function seedDemoDb(path: string, demo: DemoData): void {
  for (const file of [path, `${path}-wal`, `${path}-shm`]) {
    try { unlinkSync(file) } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
    }
  }
  const db = openDb(path)
  try {
    db.transaction(() => {
      const defaults = loadCategories(db)
      const upsert = db.query(`INSERT INTO categories (name, color, sort_order, is_default, not_spending, income)
        VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET color = excluded.color,
        sort_order = excluded.sort_order, is_default = excluded.is_default,
        not_spending = excluded.not_spending, income = excluded.income`)
      DEMO_CATEGORIES.forEach((c, i) => upsert.run(c.name, c.color, i, 0, Number(!!c.notSpending), Number(!!c.income)))
      const categoryIds = new Map(loadCategories(db).map(c => [c.name, c.id]))
      const uncategorisedId = uncategorisedCategoryId(db)
      // Uncategorised after the demo's tree, so no group's categories are split by it.
      db.query("UPDATE categories SET sort_order = ? WHERE id = ?").run(DEMO_CATEGORIES.length, uncategorisedId)
      for (const c of DEMO_CATEGORIES) {
        const parentId = c.parent === null ? null : categoryIds.get(c.parent)
        if (parentId === undefined) throw new Error(`Missing demo category parent: ${c.name}`)
        db.query("UPDATE categories SET parent_id = ? WHERE name = ?").run(parentId, c.name)
      }
      saveBudget(db, { kind: "overall" }, demo.budget.monthly)
      saveBudgetCycle(db, { unit: "month", anchor: "calendar", anchorDate: null })
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
      // Only remove unused defaults from this freshly created demo database.
      const names = new Set(DEMO_CATEGORIES.map(c => c.name))
      const remove = db.query(`DELETE FROM categories WHERE id = ? AND is_default = 0
        AND NOT EXISTS (SELECT 1 FROM transactions WHERE category_id = categories.id)
        AND NOT EXISTS (SELECT 1 FROM categories AS child WHERE child.parent_id = categories.id)`)
      for (const category of defaults) {
        if (!names.has(category.name)) remove.run(category.id)
      }
    })()
  } finally {
    db.close()
  }
}
