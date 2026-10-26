import { Database } from "bun:sqlite"
import { mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import {
  ACCOUNT_SYNC_COLUMNS_LIST,
  CATEGORY_SOURCE_COLUMN,
  CATEGORY_NOT_SPENDING_COLUMN,
  CATEGORY_TREE_COLUMNS_LIST,
  TAG_EXT_COLUMN,
  DEFAULT_CATEGORIES,
  MANDATORY_TAGS,
  SCHEMA_SQL,
  SCHEMA_VERSION,
  SYNC_SQL,
  TRANSACTION_DETAIL_COLUMNS_LIST,
  TRANSACTION_SYNC_COLUMNS_LIST,
} from "./schema"
import type { Account, Category, ImportRecord, Rule, Tag, Transaction } from "../domain/types"

export type Db = Database

export function defaultDbPath(): string {
  const home = process.env.HOME ?? "."
  return join(home, ".local", "share", "jaskmoney-opentui", "transactions.db")
}

export function openDb(path: string = defaultDbPath()): Db {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true })
  }
  const db = new Database(path, { create: true })
  db.exec("PRAGMA foreign_keys = ON;")
  db.exec("PRAGMA journal_mode = WAL;")
  ensureSchema(db)
  return db
}

function tableExists(db: Db, name: string): boolean {
  return !!db.query(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name)
}

/** Migration bodies are deliberately additive. A failed migration rolls back
 * before the database is touched, instead of silently recreating a profile. */
const MIGRATIONS: Record<number, (db: Db) => void> = {
  8: (db) => db.exec(`
    CREATE TABLE IF NOT EXISTS rules_v2 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      saved_filter_id TEXT NOT NULL,
      set_category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
      add_tag_ids TEXT NOT NULL DEFAULT '[]',
      sort_order INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_rules_v2_sort ON rules_v2(sort_order);
  `),
  9: (db) => {
    for (const column of ACCOUNT_SYNC_COLUMNS_LIST) {
      if (column.startsWith("sync_enabled")) continue // added by v10
      db.exec(`ALTER TABLE accounts ADD COLUMN ${column}`)
    }
    for (const column of TRANSACTION_SYNC_COLUMNS_LIST) db.exec(`ALTER TABLE transactions ADD COLUMN ${column}`)
    db.exec(SYNC_SQL)
  },
  10: (db) => db.exec(`ALTER TABLE accounts ADD COLUMN sync_enabled INTEGER NOT NULL DEFAULT 1`),
  11: (db) => {
    for (const column of TRANSACTION_DETAIL_COLUMNS_LIST) db.exec(`ALTER TABLE transactions ADD COLUMN ${column}`)
  },
  12: (db) => {
    for (const column of CATEGORY_TREE_COLUMNS_LIST) db.exec(`ALTER TABLE categories ADD COLUMN ${column}`)
    db.exec(`ALTER TABLE transactions ADD COLUMN ${CATEGORY_SOURCE_COLUMN}`)
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_ext ON categories(ext_id) WHERE ext_id IS NOT NULL`)
  },
  13: (db) => {
    db.exec(`ALTER TABLE tags ADD COLUMN ${TAG_EXT_COLUMN}`)
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_ext ON tags(ext_id) WHERE ext_id IS NOT NULL`)
  },
  14: (db) => {
    db.exec(`ALTER TABLE categories ADD COLUMN ${CATEGORY_NOT_SPENDING_COLUMN}`)
    db.exec(`UPDATE categories SET not_spending = 1 WHERE name = 'Transfers' AND ext_id IS NULL`)
  },
}

export function ensureSchema(db: Db) {
  db.exec("BEGIN IMMEDIATE")
  try {
    if (!tableExists(db, "schema_meta")) {
      db.exec(SCHEMA_SQL)
      db.query("INSERT INTO schema_meta (version) VALUES (?)").run(SCHEMA_VERSION)
    } else {
      const row = db.query("SELECT version FROM schema_meta LIMIT 1").get() as { version: number } | null
      if (!row) throw new Error("schema_meta has no version; database was left untouched")
      if (row.version > SCHEMA_VERSION) {
        throw new Error(`database schema v${row.version} is newer than OpenTUI v${SCHEMA_VERSION}`)
      }
      for (let version = row.version + 1; version <= SCHEMA_VERSION; version++) {
        const migrate = MIGRATIONS[version]
        if (!migrate) throw new Error(`no additive migration from v${version - 1} to v${version}`)
        migrate(db)
        db.query("UPDATE schema_meta SET version = ?").run(version)
      }
      // v7 OpenTUI profiles already contain the base tables. Do not recreate
      // them: it would mask an incompatible hand-edited profile.
      if (!tableExists(db, "categories") || !tableExists(db, "transactions") || !tableExists(db, "tags")) {
        throw new Error("database schema is incomplete; database was left untouched")
      }
    }
    seedDefaults(db)
    db.exec("COMMIT")
  } catch (error) {
    try { db.exec("ROLLBACK") } catch { /* transaction did not start */ }
    throw error
  }
}

function seedDefaults(db: Db) {
  const catCount = (
    db.query("SELECT COUNT(*) AS c FROM categories").get() as { c: number }
  ).c
  if (catCount === 0) {
    const ins = db.query(
      "INSERT INTO categories (name, color, sort_order, is_default, not_spending) VALUES (?, ?, ?, ?, ?)",
    )
    for (const c of DEFAULT_CATEGORIES) {
      // Transfers start as not-spending, as the v14 migration sets them.
      ins.run(c.name, c.color, c.sortOrder, c.isDefault, c.name === "Transfers" ? 1 : 0)
    }
  }

  const tagCount = (db.query("SELECT COUNT(*) AS c FROM tags").get() as { c: number }).c
  if (tagCount === 0) {
    const ins = db.query(
      "INSERT INTO tags (name, color, sort_order) VALUES (?, ?, 0)",
    )
    for (const t of MANDATORY_TAGS) {
      ins.run(t.name, t.color)
    }
  }
}

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

export function loadCategories(db: Db): Category[] {
  const rows = db
    .query(
      `SELECT id, name, color, sort_order AS sortOrder, is_default AS isDefault,
              parent_id AS parentId, ext_id AS extId, not_spending AS notSpending
       FROM categories ORDER BY sort_order, id`,
    )
    .all() as Array<{
    id: number
    name: string
    color: string
    sortOrder: number
    isDefault: number
    parentId: number | null
    extId: string | null
    notSpending: number
  }>
  return rows.map((r) => ({
    ...r,
    isDefault: r.isDefault === 1,
    notSpending: r.notSpending === 1,
  }))
}

export function loadTags(db: Db): Tag[] {
  const rows = db
    .query(
      `SELECT id, name, color, category_id AS categoryId, sort_order AS sortOrder, ext_id AS extId
       FROM tags ORDER BY sort_order, id`,
    )
    .all() as Array<{
    id: number
    name: string
    color: string
    categoryId: number | null
    sortOrder: number
    extId: string | null
  }>
  return rows
}

export function loadRules(db: Db): Rule[] {
  if (!tableExists(db, "rules_v2")) return []
  const rows = db.query(`
    SELECT id, name, saved_filter_id AS savedFilterId, set_category_id AS setCategoryId,
           add_tag_ids AS addTagIds, sort_order AS sortOrder, enabled
    FROM rules_v2 ORDER BY sort_order, id
  `).all() as Array<Omit<Rule, "addTagIds" | "enabled"> & { addTagIds: string; enabled: number }>
  return rows.map((r) => {
    let addTagIds: number[] = []
    try {
      const parsed: unknown = JSON.parse(r.addTagIds)
      if (Array.isArray(parsed)) addTagIds = parsed.filter(Number.isInteger).map(Number)
    } catch { /* corrupt legacy list is displayed as empty rather than crashing settings */ }
    return { ...r, addTagIds, enabled: r.enabled === 1 }
  })
}

function nextOrder(db: Db, table: "categories" | "tags" | "rules_v2"): number {
  return Number((db.query(`SELECT COALESCE(MAX(sort_order), -1) AS n FROM ${table}`).get() as { n: number }).n) + 1
}

export function createCategory(db: Db, input: Pick<Category, "name" | "color">): number {
  const name = input.name.trim()
  if (!name) throw new Error("category name is required")
  return Number(db.query(`INSERT INTO categories (name, color, sort_order) VALUES (?, ?, ?)`).run(name, input.color, nextOrder(db, "categories")).lastInsertRowid)
}

export function updateCategory(db: Db, id: number, input: Pick<Category, "name" | "color">): void {
  const name = input.name.trim()
  if (!name) throw new Error("category name is required")
  db.query(`UPDATE categories SET name = ?, color = ? WHERE id = ?`).run(name, input.color, id)
}

export function deleteCategory(db: Db, id: number): void {
  const row = db.query(`SELECT is_default AS isDefault FROM categories WHERE id = ?`).get(id) as { isDefault: number } | null
  if (!row) throw new Error("category not found")
  if (row.isDefault) throw new Error("cannot delete the default category")
  db.query(`DELETE FROM categories WHERE id = ?`).run(id)
}

export function createTag(db: Db, input: Pick<Tag, "name" | "color" | "categoryId">): number {
  const name = input.name.trim().toUpperCase()
  if (!name) throw new Error("tag name is required")
  return Number(db.query(`INSERT INTO tags (name, color, category_id, sort_order) VALUES (?, ?, ?, ?)`).run(name, input.color, input.categoryId, nextOrder(db, "tags")).lastInsertRowid)
}

export function updateTag(db: Db, id: number, input: Pick<Tag, "name" | "color" | "categoryId">): void {
  const name = input.name.trim().toUpperCase()
  if (!name) throw new Error("tag name is required")
  db.query(`UPDATE tags SET name = ?, color = ?, category_id = ? WHERE id = ?`).run(name, input.color, input.categoryId, id)
}

export function deleteTag(db: Db, id: number): void {
  const row = db.query(`SELECT name FROM tags WHERE id = ?`).get(id) as { name: string } | null
  if (!row) throw new Error("tag not found")
  if (row.name.toUpperCase() === "IGNORE") throw new Error("cannot delete mandatory IGNORE tag")
  db.query(`DELETE FROM tags WHERE id = ?`).run(id)
}

export function createRule(db: Db, input: Omit<Rule, "id" | "sortOrder">): number {
  if (!input.name.trim()) throw new Error("rule name is required")
  if (!input.savedFilterId.trim()) throw new Error("saved filter id is required")
  return Number(db.query(`INSERT INTO rules_v2 (name, saved_filter_id, set_category_id, add_tag_ids, sort_order, enabled) VALUES (?, ?, ?, ?, ?, ?)`).run(
    input.name.trim(), input.savedFilterId.trim(), input.setCategoryId, JSON.stringify(input.addTagIds), nextOrder(db, "rules_v2"), input.enabled ? 1 : 0,
  ).lastInsertRowid)
}

export function updateRule(db: Db, rule: Rule): void {
  if (!rule.name.trim() || !rule.savedFilterId.trim()) throw new Error("rule name and saved filter are required")
  db.query(`UPDATE rules_v2 SET name = ?, saved_filter_id = ?, set_category_id = ?, add_tag_ids = ?, sort_order = ?, enabled = ? WHERE id = ?`).run(
    rule.name.trim(), rule.savedFilterId.trim(), rule.setCategoryId, JSON.stringify(rule.addTagIds), rule.sortOrder, rule.enabled ? 1 : 0, rule.id,
  )
}

export function deleteRule(db: Db, id: number): void {
  db.exec("BEGIN")
  try {
    db.query(`DELETE FROM rules_v2 WHERE id = ?`).run(id)
    normalizeRuleOrder(db)
    db.exec("COMMIT")
  } catch (error) { db.exec("ROLLBACK"); throw error }
}

function normalizeRuleOrder(db: Db): void {
  const ids = db.query(`SELECT id FROM rules_v2 ORDER BY sort_order, id`).all() as { id: number }[]
  const update = db.query(`UPDATE rules_v2 SET sort_order = ? WHERE id = ?`)
  ids.forEach((r, i) => update.run(i, r.id))
}

export function reorderRule(db: Db, id: number, index: number): void {
  const ids = (db.query(`SELECT id FROM rules_v2 ORDER BY sort_order, id`).all() as { id: number }[]).map((r) => r.id)
  const old = ids.indexOf(id)
  if (old < 0) throw new Error(`rule ${id} not found`)
  ids.splice(old, 1)
  ids.splice(Math.max(0, Math.min(index, ids.length)), 0, id)
  db.exec("BEGIN")
  try { const update = db.query(`UPDATE rules_v2 SET sort_order = ? WHERE id = ?`); ids.forEach((ruleId, i) => update.run(i, ruleId)); db.exec("COMMIT") } catch (error) { db.exec("ROLLBACK"); throw error }
}

export function toggleRule(db: Db, id: number, enabled: boolean): void {
  db.query(`UPDATE rules_v2 SET enabled = ? WHERE id = ?`).run(enabled ? 1 : 0, id)
}

export function loadTransactions(db: Db): Transaction[] {
  const rows = db
    .query(
      `SELECT
         t.id,
         t.date_raw AS dateRaw,
         t.date_iso AS dateISO,
         t.amount,
         t.description,
         t.category_id AS categoryId,
         COALESCE(c.name, 'Uncategorised') AS categoryName,
         COALESCE(c.color, '#7f849c') AS categoryColor,
         t.notes,
         t.import_id AS importId,
         t.account_id AS accountId,
         COALESCE(a.name, '') AS accountName,
         t.source,
         t.status,
         t.transfer_account_id AS transferAccountId,
         -- Internal: money moved to or from another tracked account. A transfer
         -- to an untracked account (e.g. a desynced joint account) is spending.
         (t.transfer_account_id IS NOT NULL AND COALESCE(ta.sync_enabled, 0) = 1) AS internal,
         COALESCE(c.not_spending, 0) AS notSpendingCategory
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       LEFT JOIN accounts a ON a.id = t.account_id
       LEFT JOIN accounts ta ON ta.id = t.transfer_account_id
       WHERE a.id IS NULL OR a.sync_enabled = 1
       ORDER BY t.date_iso DESC, t.id DESC`,
    )
    .all() as Array<Omit<Transaction, "tagNames" | "tagColors" | "tagIds">>

  const tagRows = db
    .query(
      `SELECT tt.transaction_id AS txnId, tg.id AS tagId, tg.name AS name, tg.color AS color
       FROM transaction_tags tt
       JOIN tags tg ON tg.id = tt.tag_id
       ORDER BY tg.sort_order, LOWER(tg.name), tg.id`,
    )
    .all() as Array<{ txnId: number; tagId: number; name: string; color: string }>

  const tagNameMap = new Map<number, string[]>()
  const tagColorMap = new Map<number, string[]>()
  const tagIdMap = new Map<number, number[]>()
  for (const tr of tagRows) {
    const names = tagNameMap.get(tr.txnId) ?? []
    const colors = tagColorMap.get(tr.txnId) ?? []
    const ids = tagIdMap.get(tr.txnId) ?? []
    names.push(tr.name)
    colors.push(tr.color || "#94e2d5")
    ids.push(tr.tagId)
    tagNameMap.set(tr.txnId, names)
    tagColorMap.set(tr.txnId, colors)
    tagIdMap.set(tr.txnId, ids)
  }

  return rows.map((r) => ({
    ...r,
    internal: !!r.internal,
    excluded: !!r.internal || !!(r as { notSpendingCategory?: number }).notSpendingCategory,
    tagNames: tagNameMap.get(r.id) ?? [],
    tagColors: tagColorMap.get(r.id) ?? [],
    tagIds: tagIdMap.get(r.id) ?? [],
  }))
}

export function loadImports(db: Db, limit = 12): ImportRecord[] {
  return db.query(`SELECT id, filename, row_count AS rowCount, imported_at AS importedAt FROM imports ORDER BY imported_at DESC, id DESC LIMIT ?`).all(limit) as ImportRecord[]
}

/** Legacy-compatible: classification data and accounts survive a clear. */
export function clearAllData(db: Db): void {
  db.transaction(() => {
    db.exec(`DELETE FROM transactions; DELETE FROM imports;`)
  })()
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

export function uncategorisedCategoryId(db: Db): number {
  const row = db
    .query(`SELECT id FROM categories WHERE is_default = 1 LIMIT 1`)
    .get() as { id: number } | null
  if (!row) throw new Error("Uncategorised category missing")
  return row.id
}

/** Set a transaction's category and who set it (see CATEGORY_SOURCE_COLUMN).
 * `provider` also records the provider's category ids after a push. */
export function setTransactionCategory(
  db: Db,
  txnId: number,
  categoryId: number,
  source: "user" | "rule" | "provider" | null,
  provider?: { extCategory: string | null; extParentCategory: string | null },
): void {
  if (provider) {
    db.query(`UPDATE transactions SET category_id = ?, category_source = ?, ext_category = ?, ext_parent_category = ? WHERE id = ?`)
      .run(categoryId, source, provider.extCategory, provider.extParentCategory, txnId)
  } else {
    db.query(`UPDATE transactions SET category_id = ?, category_source = ? WHERE id = ?`).run(categoryId, source, txnId)
  }
}

export function addTagToTransactions(
  db: Db,
  txnIds: number[],
  tagId: number,
): void {
  const ins = db.query(
    `INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)`,
  )
  for (const id of txnIds) ins.run(id, tagId)
}

export function removeTagFromTransactions(
  db: Db,
  txnIds: number[],
  tagId: number,
): void {
  const del = db.query(
    `DELETE FROM transaction_tags WHERE transaction_id = ? AND tag_id = ?`,
  )
  for (const id of txnIds) del.run(id, tagId)
}

export interface DbInfo {
  schemaVersion: number
  transactionCount: number
  categoryCount: number
  tagCount: number
  accountCount: number
  importCount: number
  ruleCount: number
  path: string
  /** Up sync bookkeeping from sync_state; null before the first attempt. */
  upLastSyncedAt: string | null
  upLastError: string | null
}

export function loadDbInfo(db: Db, path: string): DbInfo {
  const ver = (
    db.query(`SELECT version FROM schema_meta LIMIT 1`).get() as {
      version: number
    } | null
  )?.version ?? 0
  const count = (table: string) =>
    (db.query(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c
  const upSync = db.query(`SELECT last_synced_at, last_error FROM sync_state WHERE source = 'up'`).get() as
    | { last_synced_at: string | null; last_error: string | null }
    | null
  return {
    schemaVersion: ver,
    transactionCount: count("transactions"),
    categoryCount: count("categories"),
    tagCount: count("tags"),
    accountCount: count("accounts"),
    importCount: count("imports"),
    ruleCount: tableExists(db, "rules_v2") ? count("rules_v2") : 0,
    path,
    upLastSyncedAt: upSync?.last_synced_at ?? null,
    upLastError: upSync?.last_error ?? null,
  }
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
    return Number(db.query(`DELETE FROM transactions WHERE account_id = ?`).run(accountId).changes)
  })()
}

/** Everything the transaction detail view shows beyond the table row. */
export interface TransactionDetail {
  id: number
  source: string
  externalId: string | null
  status: string | null
  createdAt: string | null
  settledAt: string | null
  rawText: string | null
  message: string | null
  notes: string
  transferAccountName: string | null
  extCategory: string | null
  extParentCategory: string | null
  extTags: string[]
  extCategorizable: boolean | null
  transactionType: string | null
  cardMethod: string | null
  cardSuffix: string | null
  foreignAmount: string | null
  roundUp: number | null
  cashback: number | null
  importFilename: string | null
}

export function setTransactionNotes(db: Db, id: number, notes: string): void {
  db.query(`UPDATE transactions SET notes = ? WHERE id = ?`).run(notes, id)
}

export function loadTransactionDetail(db: Db, id: number): TransactionDetail | null {
  const row = db.query(`
    SELECT t.id, t.source, t.external_id AS externalId, t.status, t.external_created_at AS createdAt,
           t.settled_at AS settledAt, t.raw_text AS rawText, t.message, t.notes,
           ta.name AS transferAccountName, t.ext_category AS extCategory,
           t.ext_parent_category AS extParentCategory, t.ext_tags AS extTags,
           t.ext_categorizable AS extCategorizable, t.transaction_type AS transactionType,
           t.card_method AS cardMethod, t.card_suffix AS cardSuffix, t.foreign_amount AS foreignAmount,
           t.round_up AS roundUp, t.cashback, i.filename AS importFilename
    FROM transactions t
    LEFT JOIN accounts ta ON ta.id = t.transfer_account_id
    LEFT JOIN imports i ON i.id = t.import_id
    WHERE t.id = ?`).get(id) as (Omit<TransactionDetail, "extTags" | "extCategorizable"> & { extTags: string; extCategorizable: number | null }) | null
  if (!row) return null
  let extTags: string[] = []
  try { extTags = JSON.parse(row.extTags || "[]") } catch { /* malformed provider data: show none */ }
  return { ...row, extTags, extCategorizable: row.extCategorizable == null ? null : row.extCategorizable === 1 }
}
