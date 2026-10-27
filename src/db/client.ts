import { Database } from "bun:sqlite"
import { mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { addTagLink, decodeStoredTags, removeTagLink } from "./tagLinks"
import {
  ACCOUNT_SYNC_COLUMNS_LIST,
  BUDGET_PAY_EARLY_COLUMN,
  BUDGET_SQL,
  CATEGORY_SUGGESTIONS_SQL,
  CATEGORY_SUGGESTIONS_V19_SQL,
  SUGGESTION_RANKED_COLUMN,
  TAG_SCOPE_COLUMN,
  SUGGESTION_DISMISSED_COLUMN,
  TAG_DISMISSALS_SQL,
  CATEGORY_CHOICES_SQL,
  CATEGORY_SOURCE_COLUMN,
  CATEGORY_INCOME_COLUMN,
  CATEGORY_NOT_SPENDING_COLUMN,
  CATEGORY_TREE_COLUMNS_LIST,
  INCOME_CATEGORIES,
  TAG_EXT_COLUMN,
  DEFAULT_CATEGORIES,
  MANDATORY_TAGS,
  SCHEMA_SQL,
  SCHEMA_VERSION,
  SYNC_SQL,
  TRANSACTION_DETAIL_COLUMNS_LIST,
  TRANSACTION_SYNC_COLUMNS_LIST,
} from "./schema"
import type { Account, Category, CategorySuggestion, ImportRecord, Rule, Tag, Transaction } from "../domain/types"
import { assignTypeCategories } from "../up/categories"
import { categoryTerm } from "../domain/drill"
import type { Budget, BudgetScope, CycleConfig } from "../domain/budget"

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
  15: (db) => db.exec(BUDGET_SQL),
  16: (db) => {
    db.exec(`ALTER TABLE categories ADD COLUMN ${CATEGORY_INCOME_COLUMN}`)
    const group = ensureIncomeCategories(db)
    // Income is a group now, which nothing is assigned to directly: its rows
    // go to Salary when Up says so, else Other income, and rules and tags
    // that set it follow.
    const id = (name: string) => db.query<{ id: number }, [string, number]>("SELECT id FROM categories WHERE name = ? AND parent_id = ?").get(name, group)!.id
    const salary = id("Salary"), other = id("Other income")
    db.query("UPDATE transactions SET category_id = CASE WHEN transaction_type = 'Salary' THEN ? ELSE ? END WHERE category_id = ?").run(salary, other, group)
    db.query("UPDATE rules_v2 SET set_category_id = ? WHERE set_category_id = ?").run(other, group)
    db.query("UPDATE tags SET category_id = ? WHERE category_id = ?").run(other, group)
    assignTypeCategories(db)
  },
  17: (db) => db.exec(`ALTER TABLE budget_cycle ADD COLUMN ${BUDGET_PAY_EARLY_COLUMN}`),
  18: (db) => db.exec(CATEGORY_SUGGESTIONS_SQL),
  19: (db) => db.exec(CATEGORY_SUGGESTIONS_V19_SQL),
  20: (db) => db.exec(`ALTER TABLE category_suggestions ADD COLUMN ${SUGGESTION_RANKED_COLUMN}`),
  23: (db) => {
    db.exec(CATEGORY_CHOICES_SQL)
    // Rows you categorised that Up couldn't take still say so.
    db.exec(`INSERT OR IGNORE INTO category_choices (description, category_id, times)
      SELECT lower(trim(description)), category_id, COUNT(*) FROM transactions
      WHERE category_source IN ('user', 'pending') AND category_id IS NOT NULL GROUP BY 1, 2`)
  },
  22: (db) => {
    // Tests wind a fresh schema back to older versions: add only if missing.
    const columns = db.query<{ name: string }, []>("PRAGMA table_info(category_suggestions)").all().map((c) => c.name)
    if (!columns.includes("dismissed")) db.exec(`ALTER TABLE category_suggestions ADD COLUMN ${SUGGESTION_DISMISSED_COLUMN}`)
    db.exec(TAG_DISMISSALS_SQL)
  },
  21: (db) => {
    // Tests wind a fresh (scoped) schema back to older versions: add only if missing.
    const columns = db.query<{ name: string }, []>("PRAGMA table_info(tags)").all().map((c) => c.name)
    if (!columns.includes("scope")) db.exec(`ALTER TABLE tags ADD COLUMN ${TAG_SCOPE_COLUMN}`)
    // Each category scope becomes its cat: term (a group's takes its children too).
    const categories = db.query<{ id: number; name: string; parentId: number | null }, []>("SELECT id, name, parent_id AS parentId FROM categories").all()
    for (const tag of db.query<{ id: number; categoryId: number }, []>("SELECT id, category_id AS categoryId FROM tags WHERE category_id IS NOT NULL").all()) {
      const category = categories.find((c) => c.id === tag.categoryId)
      db.query("UPDATE tags SET scope = ?, category_id = NULL WHERE id = ?").run(category ? categoryTerm(category, categories as Category[]) : null, tag.id)
    }
  },
}

/**
 * The income group: the local top-level Income category, marked income, with
 * INCOME_CATEGORIES under it. Adds what is missing (a local category of the
 * same name moves under the group); renames nothing. Returns the group's id.
 */
export function ensureIncomeCategories(db: Db): number {
  const local = (where: string) => db.query<{ id: number }, []>(`SELECT id FROM categories WHERE ext_id IS NULL AND parent_id IS NULL AND ${where} ORDER BY id LIMIT 1`).get()?.id
  let group = local("income = 1") ?? local("name = 'Income'")
  if (group === undefined) {
    group = Number(db.query(`INSERT INTO categories (name, color, sort_order, income)
      VALUES ('Income', '#a6e3a1', (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM categories), 1)`).run().lastInsertRowid)
  }
  db.query("UPDATE categories SET income = 1 WHERE id = ?").run(group)
  for (const category of INCOME_CATEGORIES) {
    db.query(`INSERT OR IGNORE INTO categories (name, color, sort_order, parent_id)
      VALUES (?, ?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM categories), ?)`).run(category.name, category.color, group)
    db.query("UPDATE categories SET parent_id = ? WHERE name = ? AND ext_id IS NULL AND parent_id IS NULL AND id != ?").run(group, category.name, group)
  }
  return group
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
    ensureIncomeCategories(db)
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
              parent_id AS parentId, ext_id AS extId, not_spending AS notSpending, income
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
  }>
  return rows.map((r) => ({
    ...r,
    isDefault: r.isDefault === 1,
    notSpending: r.notSpending === 1,
    income: r.income === 1,
  }))
}

export function loadTags(db: Db): Tag[] {
  const rows = db
    .query(
      `SELECT id, name, color, scope, sort_order AS sortOrder, ext_id AS extId
       FROM tags ORDER BY sort_order, id`,
    )
    .all() as Array<{
    id: number
    name: string
    color: string
    scope: string | null
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

export function createCategory(db: Db, input: Pick<Category, "name" | "color"> & { notSpending?: boolean }): number {
  const name = input.name.trim()
  if (!name) throw new Error("category name is required")
  return Number(db.query(`INSERT INTO categories (name, color, sort_order, not_spending) VALUES (?, ?, ?, ?)`)
    .run(name, input.color, nextOrder(db, "categories"), input.notSpending ? 1 : 0).lastInsertRowid)
}

/** `notSpending` is left unchanged when omitted. */
export function updateCategory(db: Db, id: number, input: Pick<Category, "name" | "color"> & { notSpending?: boolean }): void {
  const name = input.name.trim()
  if (!name) throw new Error("category name is required")
  if (input.notSpending === undefined) db.query(`UPDATE categories SET name = ?, color = ? WHERE id = ?`).run(name, input.color, id)
  else db.query(`UPDATE categories SET name = ?, color = ?, not_spending = ? WHERE id = ?`).run(name, input.color, input.notSpending ? 1 : 0, id)
}

export function deleteCategory(db: Db, id: number): void {
  const row = db.query(`SELECT is_default AS isDefault FROM categories WHERE id = ?`).get(id) as { isDefault: number } | null
  if (!row) throw new Error("category not found")
  if (row.isDefault) throw new Error("cannot delete the default category")
  db.query(`DELETE FROM categories WHERE id = ?`).run(id)
}

export function createTag(db: Db, input: Pick<Tag, "name" | "color" | "scope">): number {
  const name = input.name.trim().toUpperCase()
  if (!name) throw new Error("tag name is required")
  return Number(db.query(`INSERT INTO tags (name, color, scope, sort_order) VALUES (?, ?, ?, ?)`).run(name, input.color, input.scope, nextOrder(db, "tags")).lastInsertRowid)
}

export function updateTag(db: Db, id: number, input: Pick<Tag, "name" | "color" | "scope">): void {
  const name = input.name.trim().toUpperCase()
  if (!name) throw new Error("tag name is required")
  db.query(`UPDATE tags SET name = ?, color = ?, scope = ? WHERE id = ?`).run(name, input.color, input.scope, id)
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
         t.transaction_type AS transactionType,
         NULLIF(TRIM(t.message), '') AS message,
         NULLIF(TRIM(t.raw_text), '') AS rawText,
         NULLIF(TRIM(t.foreign_amount), '') AS foreignAmount,
         NULLIF(TRIM(t.card_method), '') AS cardMethod,
         t.transfer_account_id AS transferAccountId,
         -- Internal: money moved to or from another tracked account. A transfer
         -- to an untracked account (e.g. a desynced joint account) is spending.
         (t.transfer_account_id IS NOT NULL AND COALESCE(ta.sync_enabled, 0) = 1) AS internal,
         COALESCE(c.not_spending, 0) AS notSpendingCategory,
         (COALESCE(c.income, 0) = 1 OR COALESCE(pc.income, 0) = 1) AS income
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       LEFT JOIN categories pc ON pc.id = c.parent_id
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
    income: !!r.income,
    tagNames: tagNameMap.get(r.id) ?? [],
    tagColors: tagColorMap.get(r.id) ?? [],
    tagIds: tagIdMap.get(r.id) ?? [],
  }))
}

export function loadSuggestions(db: Db): CategorySuggestion[] {
  return db.query<Omit<CategorySuggestion, "ranked"> & { ranked: string | null }, []>(`SELECT s.transaction_id AS transactionId,
    s.category_id AS categoryId, s.confidence, s.source, s.ranked
    FROM category_suggestions s
    JOIN transactions t ON t.id = s.transaction_id
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE s.dismissed = 0 AND (t.category_id IS NULL OR c.is_default = 1)`).all().map(({ ranked, ...s }) => {
      const list = parseRanked(ranked)
      return list ? { ...s, ranked: list } : s
    })
}

/** A stored ranking, or undefined when absent or unreadable. */
function parseRanked(raw: string | null): CategorySuggestion["ranked"] {
  if (!raw) return undefined
  try {
    const value = JSON.parse(raw) as unknown
    if (!Array.isArray(value)) return undefined
    const list = value.filter((e): e is [number, number] => Array.isArray(e) && typeof e[0] === "number" && typeof e[1] === "number")
    return list.length ? list.map(([categoryId, confidence]) => ({ categoryId, confidence })) : undefined
  } catch {
    return undefined
  }
}

export function saveSuggestions(db: Db, list: CategorySuggestion[]): void {
  const save = db.query(`INSERT INTO category_suggestions (transaction_id, category_id, confidence, source, ranked)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT(transaction_id) DO UPDATE SET
    category_id = excluded.category_id, confidence = excluded.confidence,
    source = excluded.source, ranked = excluded.ranked, created_at = datetime('now')`)
  db.transaction(() => {
    for (const s of list) save.run(s.transactionId, s.categoryId, s.confidence, s.source, s.ranked?.length ? JSON.stringify(s.ranked.map((r) => [r.categoryId, r.confidence])) : null)
  })()
}

/** A categorisation you made: `times` rows of `description` into the category. */
export function recordCategoryChoices(db: Db, choices: { description: string; categoryId: number; times: number }[]): void {
  const add = db.query(`INSERT INTO category_choices (description, category_id, times) VALUES (?, ?, ?)
    ON CONFLICT (description, category_id) DO UPDATE SET times = times + excluded.times`)
  db.transaction(() => { for (const c of choices) add.run(c.description.trim().toLowerCase(), c.categoryId, c.times) })()
}

export interface CategoryChoice { description: string; categoryId: number; times: number; declined: boolean }

export function loadCategoryChoices(db: Db): CategoryChoice[] {
  return db.query<{ description: string; categoryId: number; times: number; declined: number }, []>(
    "SELECT description, category_id AS categoryId, times, declined FROM category_choices").all()
    .map((c) => ({ ...c, declined: c.declined === 1 }))
}

export function declineCategoryChoice(db: Db, description: string, categoryId: number): void {
  db.query("UPDATE category_choices SET declined = 1 WHERE description = ? AND category_id = ?").run(description.trim().toLowerCase(), categoryId)
}

/** Rows whose suggestion was dismissed: not suggested for again. */
export function loadDismissedSuggestionIds(db: Db): Set<number> {
  return new Set(db.query<{ id: number }, []>("SELECT transaction_id AS id FROM category_suggestions WHERE dismissed = 1").all().map((r) => r.id))
}

/** Dismiss suggestions: kept, marked, so they are not made again. */
export function dismissSuggestionRows(db: Db, transactionIds: number[]): void {
  const dismiss = db.query("UPDATE category_suggestions SET dismissed = 1 WHERE transaction_id = ?")
  db.transaction(() => { for (const id of transactionIds) dismiss.run(id) })()
}

/** Rows dismissed for a tag (by its upper-case name). */
export function loadTagDismissals(db: Db, tagName: string): Set<number> {
  return new Set(db.query<{ id: number }, [string]>("SELECT transaction_id AS id FROM tag_dismissals WHERE tag_name = ?").all(tagName.toUpperCase()).map((r) => r.id))
}

export function saveTagDismissals(db: Db, tagName: string, transactionIds: number[]): void {
  const save = db.query("INSERT OR IGNORE INTO tag_dismissals (tag_name, transaction_id) VALUES (?, ?)")
  db.transaction(() => { for (const id of transactionIds) save.run(tagName.toUpperCase(), id) })()
}

export function deleteSuggestions(db: Db, transactionIds: number[]): void {
  const remove = db.query(`DELETE FROM category_suggestions WHERE transaction_id = ?`)
  db.transaction(() => {
    for (const id of transactionIds) remove.run(id)
  })()
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
  source: "user" | "pending" | "rule" | "provider" | null,
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
  db.transaction(() => {
    for (const id of txnIds) addTagLink(db, id, tagId)
  })()
}

export function removeTagFromTransactions(
  db: Db,
  txnIds: number[],
  tagId: number,
): void {
  db.transaction(() => {
    for (const id of txnIds) removeTagLink(db, id, tagId)
  })()
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
  try { extTags = decodeStoredTags(row.extTags || "[]") } catch { /* malformed provider data: show none */ }
  return { ...row, extTags, extCategorizable: row.extCategorizable == null ? null : row.extCategorizable === 1 }
}

export function loadBudgets(db: Db): Budget[] {
  const rows = db.query(`SELECT id, scope_kind AS kind, target_id AS targetId, amount FROM budgets ORDER BY sort_order, id`)
    .all() as Array<{ id: number; kind: "overall" | "account" | "category"; targetId: number | null; amount: number }>
  return rows.map((r) => ({
    id: r.id,
    amount: r.amount,
    scope: r.kind === "overall" ? { kind: "overall" } : r.kind === "account" ? { kind: "account", accountId: r.targetId! } : { kind: "category", categoryId: r.targetId! },
  }))
}

/** Insert or replace the budget for a scope; returns its id. */
export function saveBudget(db: Db, scope: BudgetScope, amount: number): number {
  if (!Number.isFinite(amount) || amount < 0) throw new Error("budget amount must be a positive number")
  const target = scope.kind === "overall" ? null : scope.kind === "account" ? scope.accountId : scope.categoryId
  const existing = db.query(`SELECT id FROM budgets WHERE scope_kind = ? AND COALESCE(target_id, 0) = COALESCE(?, 0)`).get(scope.kind, target) as { id: number } | null
  if (existing) {
    db.query(`UPDATE budgets SET amount = ? WHERE id = ?`).run(amount, existing.id)
    return existing.id
  }
  const order = (db.query(`SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM budgets`).get() as { n: number }).n
  return Number(db.query(`INSERT INTO budgets (scope_kind, target_id, amount, sort_order) VALUES (?, ?, ?, ?)`).run(scope.kind, target, amount, order).lastInsertRowid)
}

export function deleteBudget(db: Db, id: number): void {
  db.query(`DELETE FROM budgets WHERE id = ?`).run(id)
}

export function loadBudgetCycle(db: Db): CycleConfig {
  const row = db.query(`SELECT unit, anchor, anchor_date AS anchorDate, pay_early AS payEarly FROM budget_cycle WHERE id = 1`)
    .get() as (Omit<CycleConfig, "payEarly"> & { payEarly: number }) | null
  return row ? { ...row, payEarly: row.payEarly === 1 } : { unit: "month", anchor: "calendar", anchorDate: null, payEarly: false }
}

export function saveBudgetCycle(db: Db, config: CycleConfig): void {
  if (config.anchor !== "calendar" && !/^\d{4}-\d{2}-\d{2}$/.test(config.anchorDate ?? "")) throw new Error("enter the cycle date as YYYY-MM-DD")
  db.query(`INSERT INTO budget_cycle (id, unit, anchor, anchor_date, pay_early) VALUES (1, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET unit = excluded.unit, anchor = excluded.anchor, anchor_date = excluded.anchor_date, pay_early = excluded.pay_early`)
    .run(config.unit, config.anchor, config.anchor === "calendar" ? null : config.anchorDate, config.payEarly ? 1 : 0)
}
