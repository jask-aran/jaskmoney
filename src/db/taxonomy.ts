import type { Category, Rule, Tag } from "../domain/types"
import type { Db } from "./client"

export function tableExists(db: Db, name: string): boolean {
  return !!db.query(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name)
}

export function loadCategories(db: Db): Category[] {
  const rows = db
    .query(
      `SELECT id, name, color, sort_order AS sortOrder, is_default AS isDefault,
              parent_id AS parentId, ext_id AS extId, not_spending AS notSpending, income, budget_ignored AS budgetIgnored
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
    income: number
    budgetIgnored: number
  }>
  return rows.map((r) => ({
    ...r,
    isDefault: r.isDefault === 1,
    notSpending: r.notSpending === 1,
    income: r.income === 1,
    budgetIgnored: r.budgetIgnored === 1,
  }))
}

export function loadTags(db: Db): Tag[] {
  const rows = db
    .query(
      `SELECT id, name, color, NULLIF(TRIM(about), '') AS about, sort_order AS sortOrder, ext_id AS extId
       FROM tags ORDER BY sort_order, id`,
    )
    .all() as Array<Omit<Tag, "categoryIds">>
  const links = db.query<{ tagId: number; categoryId: number }, []>("SELECT tag_id AS tagId, category_id AS categoryId FROM tag_categories ORDER BY category_id").all()
  return rows.map((r) => ({ ...r, categoryIds: links.filter((l) => l.tagId === r.id).map((l) => l.categoryId) }))
}

function setTagCategories(db: Db, id: number, categoryIds: number[]): void {
  db.query("DELETE FROM tag_categories WHERE tag_id = ?").run(id)
  const link = db.query("INSERT OR IGNORE INTO tag_categories (tag_id, category_id) VALUES (?, ?)")
  for (const categoryId of categoryIds) link.run(id, categoryId)
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
    } catch {}
    return { ...r, addTagIds, enabled: r.enabled === 1 }
  })
}

function nextOrder(db: Db, table: "categories" | "tags" | "rules_v2"): number {
  return Number((db.query(`SELECT COALESCE(MAX(sort_order), -1) AS n FROM ${table}`).get() as { n: number }).n) + 1
}

export function createCategory(db: Db, input: Pick<Category, "name" | "color"> & { notSpending?: boolean }): number {
  const name = input.name.trim()
  if (!name) throw new Error("category name is required")
  return Number(db.query(`INSERT INTO categories (name, color, sort_order, not_spending) VALUES (?, ?, ?, ?)`)
    .run(name, input.color, nextOrder(db, "categories"), input.notSpending ? 1 : 0).lastInsertRowid)
}

export function updateCategory(db: Db, id: number, input: Pick<Category, "name" | "color"> & { notSpending?: boolean }): void {
  const name = input.name.trim()
  if (!name) throw new Error("category name is required")
  if (input.notSpending === undefined) db.query(`UPDATE categories SET name = ?, color = ? WHERE id = ?`).run(name, input.color, id)
  else db.query(`UPDATE categories SET name = ?, color = ?, not_spending = ? WHERE id = ?`).run(name, input.color, input.notSpending ? 1 : 0, id)
}

export function setCategoryBudgetIgnored(db: Db, id: number, ignored: boolean): void {
  db.query("UPDATE categories SET budget_ignored = ? WHERE id = ?").run(ignored ? 1 : 0, id)
}

export function deleteCategory(db: Db, id: number): void {
  const row = db.query(`SELECT is_default AS isDefault FROM categories WHERE id = ?`).get(id) as { isDefault: number } | null
  if (!row) throw new Error("category not found")
  if (row.isDefault) throw new Error("cannot delete the default category")
  db.transaction(() => {
    db.query(`UPDATE transactions SET category_id = NULL, category_source = NULL WHERE category_id = ?`).run(id)
    db.query(`DELETE FROM categories WHERE id = ?`).run(id)
  })()
}

export type TagInput = Pick<Tag, "name" | "color"> & Partial<Pick<Tag, "categoryIds" | "about">>

export function createTag(db: Db, input: TagInput): number {
  const name = input.name.trim().toUpperCase()
  if (!name) throw new Error("tag name is required")
  return db.transaction(() => {
    const id = Number(db.query(`INSERT INTO tags (name, color, about, sort_order) VALUES (?, ?, ?, ?)`).run(name, input.color, input.about?.trim() || null, nextOrder(db, "tags")).lastInsertRowid)
    setTagCategories(db, id, input.categoryIds ?? [])
    return id
  })()
}

export function updateTag(db: Db, id: number, input: TagInput): void {
  const name = input.name.trim().toUpperCase()
  if (!name) throw new Error("tag name is required")
  db.transaction(() => {
    db.query(`UPDATE tags SET name = ?, color = ? WHERE id = ?`).run(name, input.color, id)
    if (input.about !== undefined) db.query(`UPDATE tags SET about = ? WHERE id = ?`).run(input.about?.trim() || null, id)
    if (input.categoryIds) setTagCategories(db, id, input.categoryIds)
  })()
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

function orderedRuleIds(db: Db): number[] {
  return (db.query(`SELECT id FROM rules_v2 ORDER BY sort_order, id`).all() as { id: number }[]).map((r) => r.id)
}

function writeRuleOrder(db: Db, ids: number[]): void {
  const update = db.query(`UPDATE rules_v2 SET sort_order = ? WHERE id = ?`)
  ids.forEach((id, i) => update.run(i, id))
}

function normalizeRuleOrder(db: Db): void {
  writeRuleOrder(db, orderedRuleIds(db))
}

export function reorderRule(db: Db, id: number, index: number): void {
  const ids = orderedRuleIds(db)
  const old = ids.indexOf(id)
  if (old < 0) throw new Error(`rule ${id} not found`)
  ids.splice(old, 1)
  ids.splice(Math.max(0, Math.min(index, ids.length)), 0, id)
  db.exec("BEGIN")
  try { writeRuleOrder(db, ids); db.exec("COMMIT") } catch (error) { db.exec("ROLLBACK"); throw error }
}

export function toggleRule(db: Db, id: number, enabled: boolean): void {
  db.query(`UPDATE rules_v2 SET enabled = ? WHERE id = ?`).run(enabled ? 1 : 0, id)
}

export function uncategorisedCategoryId(db: Db): number {
  const row = db
    .query(`SELECT id FROM categories WHERE is_default = 1 LIMIT 1`)
    .get() as { id: number } | null
  if (!row) throw new Error("Uncategorised category missing")
  return row.id
}
