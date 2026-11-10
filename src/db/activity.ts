import type { Db } from "./client"

export type CategoryHow = "accept" | "choose" | "rule" | "undo"
export type TagHow = "picker" | "review" | "rule" | "undo"

export function logCategories(db: Db, entries: { transactionId: number; categoryId: number; previousCategoryId: number | null }[], how: CategoryHow, at: string): void {
  const add = db.query("INSERT INTO category_log (transaction_id, category_id, previous_category_id, how, at) VALUES (?, ?, ?, ?, ?)")
  db.transaction(() => { for (const e of entries) add.run(e.transactionId, e.categoryId, e.previousCategoryId, how, at) })()
}

export function unlogCategory(db: Db, transactionId: number, categoryId: number): void {
  db.query("DELETE FROM category_log WHERE id = (SELECT MAX(id) FROM category_log WHERE transaction_id = ? AND category_id = ?)").run(transactionId, categoryId)
}

export function logTags(db: Db, transactionIds: number[], tagId: number, added: boolean, how: TagHow, at: string): void {
  const add = db.query("INSERT INTO tag_log (transaction_id, tag_id, added, how, at) VALUES (?, ?, ?, ?, ?)")
  db.transaction(() => { for (const id of transactionIds) add.run(id, tagId, added ? 1 : 0, how, at) })()
}

export function unlogTag(db: Db, logId: number | null): void {
  db.query("DELETE FROM tag_log WHERE id = ?").run(logId)
}

export interface CategoryLogEntry { transactionId: number; categoryId: number | null; previousCategoryId: number | null; how: CategoryHow; at: string }
export interface TagLogEntry { transactionId: number; tagId: number; added: boolean; how: TagHow; at: string }

export function loadCategoryLog(db: Db): CategoryLogEntry[] {
  return db.query<CategoryLogEntry, []>(`SELECT transaction_id AS transactionId, category_id AS categoryId, previous_category_id AS previousCategoryId, how, at
    FROM category_log ORDER BY at DESC, id DESC`).all()
}

export function loadTagLog(db: Db): TagLogEntry[] {
  return db.query<{ transactionId: number; tagId: number; added: number; how: TagHow; at: string }, []>(`SELECT transaction_id AS transactionId, tag_id AS tagId, added, how, at
    FROM tag_log ORDER BY at DESC, id DESC`).all().map((e) => ({ ...e, added: e.added === 1 }))
}
