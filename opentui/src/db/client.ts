import { Database } from "bun:sqlite"
import { mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import {
  DEFAULT_CATEGORIES,
  MANDATORY_TAGS,
  SCHEMA_SQL,
  SCHEMA_VERSION,
} from "./schema"
import type { Account, Category, Tag, Transaction } from "../domain/types"

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

function ensureSchema(db: Db) {
  db.exec(SCHEMA_SQL)

  const row = db.query("SELECT version FROM schema_meta LIMIT 1").get() as
    | { version: number }
    | null
  if (!row) {
    db.query("INSERT INTO schema_meta (version) VALUES (?)").run(SCHEMA_VERSION)
  } else if (row.version !== SCHEMA_VERSION) {
    // MVP: recreate is acceptable for the rewrite DB path
    db.exec(`
      DROP TABLE IF EXISTS transaction_tags;
      DROP TABLE IF EXISTS transactions;
      DROP TABLE IF EXISTS imports;
      DROP TABLE IF EXISTS account_selection;
      DROP TABLE IF EXISTS accounts;
      DROP TABLE IF EXISTS tags;
      DROP TABLE IF EXISTS categories;
      DROP TABLE IF EXISTS schema_meta;
    `)
    db.exec(SCHEMA_SQL)
    db.query("INSERT INTO schema_meta (version) VALUES (?)").run(SCHEMA_VERSION)
  }

  seedDefaults(db)
}

function seedDefaults(db: Db) {
  const catCount = (
    db.query("SELECT COUNT(*) AS c FROM categories").get() as { c: number }
  ).c
  if (catCount === 0) {
    const ins = db.query(
      "INSERT INTO categories (name, color, sort_order, is_default) VALUES (?, ?, ?, ?)",
    )
    for (const c of DEFAULT_CATEGORIES) {
      ins.run(c.name, c.color, c.sortOrder, c.isDefault)
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

export function loadAccounts(db: Db): Account[] {
  const rows = db
    .query(
      `SELECT id, name, type, sort_order AS sortOrder, is_active AS isActive
       FROM accounts ORDER BY sort_order, id`,
    )
    .all() as Array<{
    id: number
    name: string
    type: "debit" | "credit"
    sortOrder: number
    isActive: number
  }>
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    sortOrder: r.sortOrder,
    isActive: r.isActive === 1,
  }))
}

export function loadCategories(db: Db): Category[] {
  const rows = db
    .query(
      `SELECT id, name, color, sort_order AS sortOrder, is_default AS isDefault
       FROM categories ORDER BY sort_order, id`,
    )
    .all() as Array<{
    id: number
    name: string
    color: string
    sortOrder: number
    isDefault: number
  }>
  return rows.map((r) => ({
    ...r,
    isDefault: r.isDefault === 1,
  }))
}

export function loadTags(db: Db): Tag[] {
  const rows = db
    .query(
      `SELECT id, name, color, category_id AS categoryId, sort_order AS sortOrder
       FROM tags ORDER BY sort_order, id`,
    )
    .all() as Array<{
    id: number
    name: string
    color: string
    categoryId: number | null
    sortOrder: number
  }>
  return rows
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
         COALESCE(a.name, '') AS accountName
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       LEFT JOIN accounts a ON a.id = t.account_id
       ORDER BY t.date_iso DESC, t.id DESC`,
    )
    .all() as Array<Omit<Transaction, "tagNames">>

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
    tagNames: tagNameMap.get(r.id) ?? [],
    tagColors: tagColorMap.get(r.id) ?? [],
    tagIds: tagIdMap.get(r.id) ?? [],
  }))
}

export function uncategorisedCategoryId(db: Db): number {
  const row = db
    .query(`SELECT id FROM categories WHERE is_default = 1 LIMIT 1`)
    .get() as { id: number } | null
  if (!row) throw new Error("Uncategorised category missing")
  return row.id
}

export function setTransactionCategory(
  db: Db,
  txnId: number,
  categoryId: number,
): void {
  db.query(`UPDATE transactions SET category_id = ? WHERE id = ?`).run(
    categoryId,
    txnId,
  )
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
  path: string
}

export function loadDbInfo(db: Db, path: string): DbInfo {
  const ver = (
    db.query(`SELECT version FROM schema_meta LIMIT 1`).get() as {
      version: number
    } | null
  )?.version ?? 0
  const count = (table: string) =>
    (db.query(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c
  return {
    schemaVersion: ver,
    transactionCount: count("transactions"),
    categoryCount: count("categories"),
    tagCount: count("tags"),
    accountCount: count("accounts"),
    importCount: count("imports"),
    path,
  }
}

export function ensureAccount(
  db: Db,
  name: string,
  type: "debit" | "credit",
): Account {
  const existing = db
    .query(`SELECT id, name, type, sort_order AS sortOrder, is_active AS isActive FROM accounts WHERE name = ?`)
    .get(name) as
    | {
        id: number
        name: string
        type: "debit" | "credit"
        sortOrder: number
        isActive: number
      }
    | null
  if (existing) {
    return {
      id: existing.id,
      name: existing.name,
      type: existing.type,
      sortOrder: existing.sortOrder,
      isActive: existing.isActive === 1,
    }
  }
  const info = db
    .query(
      `INSERT INTO accounts (name, type, sort_order, is_active) VALUES (?, ?, 1, 1)`,
    )
    .run(name, type)
  return {
    id: Number(info.lastInsertRowid),
    name,
    type,
    sortOrder: 1,
    isActive: true,
  }
}
