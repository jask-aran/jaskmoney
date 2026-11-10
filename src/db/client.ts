import { jaskmoneyHome } from "../storage/home"
import { Database } from "bun:sqlite"
import { chmodSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import {
  ACCOUNT_SYNC_COLUMNS_LIST,
  BUDGET_PAY_EARLY_COLUMN,
  BUDGET_SQL,
  BUDGET_HISTORY_SQL,
  CATEGORY_SUGGESTIONS_SQL,
  CATEGORY_SUGGESTIONS_V19_SQL,
  SUGGESTION_RANKED_COLUMN,
  TAG_SCOPE_COLUMN,
  SUGGESTION_DISMISSED_COLUMN,
  TAG_DISMISSALS_SQL,
  CATEGORY_CHOICES_SQL,
  ACTIVITY_LOG_SQL,
  ACTIVITY_LOG_TRANSACTION_INDEXES_SQL,
  RULE_DECLINES_SQL,
  TAG_PUSHES_SQL,
  RULE_TAG_DECLINES_SQL,
  MERCHANT_BREADTH_SQL,
  MERCHANT_NOTES_SQL,
  PURCHASE_LOOKUPS_SQL,
  SUGGESTION_KNEW_BOUGHT_COLUMN,
  TAG_CATEGORIES_SQL,
  TAG_ABOUT_COLUMN,
  CATEGORY_SOURCE_COLUMN,
  CATEGORY_INCOME_COLUMN,
  CATEGORY_BUDGET_IGNORED_COLUMN,
  CATEGORY_NOT_SPENDING_COLUMN,
  CATEGORY_TREE_COLUMNS_LIST,
  INCOME_CATEGORIES,
  TAG_EXT_COLUMN,
  DEFAULT_CATEGORIES,
  MANDATORY_TAGS,
  RULES_V2_TABLE,
  SCHEMA_SQL,
  SCHEMA_VERSION,
  SYNC_SQL,
  TRANSACTION_DETAIL_COLUMNS_LIST,
  TRANSACTION_SYNC_COLUMNS_LIST,
} from "./schema"
import type { Category } from "../domain/types"
import { assignTypeCategories } from "../up/categories"
import { categoryTerm } from "../domain/drill"
import { tableExists } from "./taxonomy"

export {
  loadAccounts, clearAccountTransactions, removeAccountWithTransactions,
  ensureAccount, setAccountSyncEnabled,
} from "./accounts"
export {
  loadCategories, loadTags, loadRules,
  createCategory, updateCategory, setCategoryBudgetIgnored,
  deleteCategory, type TagInput, createTag,
  updateTag, deleteTag, createRule,
  updateRule, deleteRule, reorderRule,
  toggleRule, uncategorisedCategoryId,
} from "./taxonomy"
export {
  loadTransactions, type PurchaseLookup, loadPurchaseLookups,
  savePurchaseLookups, loadImports, clearAllData,
  setTransactionCategory, type TransactionDetail, setTransactionNotes,
  loadTransactionDetail,
} from "./transactions"
export {
  loadSuggestions, saveSuggestions, type RuleDecline,
  declineRule, undeclineRule, loadRuleDeclines,
  recordCategoryChoices, unrecordCategoryChoices, type CategoryChoice,
  loadCategoryChoices, declineCategoryChoice, loadMerchantBreadth,
  saveMerchantBreadth, loadMerchantNotes, saveMerchantNote,
  loadDismissedSuggestionIds, dismissSuggestionRows, undismissSuggestionRows,
  loadTagDismissals, saveTagDismissals, deleteTagDismissals,
  deleteSuggestions,
} from "./suggestions"
export {
  type CategoryHow, type TagHow, logCategories,
  unlogCategory, logTags, unlogTag,
  type CategoryLogEntry, type TagLogEntry, loadCategoryLog,
  loadTagLog,
} from "./activity"
export {
  loadBudgets, loadBudgetHistory,
  recordBudget, loadBudgetCycle,
  saveBudgetCycle,
} from "./budgets"

export type Db = Database

export function defaultDbPath(): string {
  return join(jaskmoneyHome(), "transactions.db")
}

export function openDb(path: string = defaultDbPath()): Db {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  }
  const db = new Database(path, { create: true })
  if (path !== ":memory:") {
    try { chmodSync(path, 0o600) } catch {}
  }
  db.exec("PRAGMA foreign_keys = ON;")
  db.exec("PRAGMA journal_mode = WAL;")
  ensureSchema(db)
  return db
}

const MIGRATIONS: Record<number, (db: Db) => void> = {
  8: (db) => db.exec(`${RULES_V2_TABLE}
    CREATE INDEX IF NOT EXISTS idx_rules_v2_sort ON rules_v2(sort_order);`),
  9: (db) => {
    for (const column of ACCOUNT_SYNC_COLUMNS_LIST) {
      if (column.startsWith("sync_enabled")) continue
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
  25: (db) => db.exec(RULE_DECLINES_SQL),
  26: (db) => db.exec(TAG_PUSHES_SQL),
  27: (db) => db.exec(RULE_TAG_DECLINES_SQL),
  28: (db) => db.exec(MERCHANT_BREADTH_SQL),
  29: (db) => db.exec(MERCHANT_NOTES_SQL),
  31: (db) => db.exec(PURCHASE_LOOKUPS_SQL),
  32: (db) => {
    const columns = db.query<{ name: string }, []>("PRAGMA table_info(category_suggestions)").all().map((c) => c.name)
    if (!columns.includes("knew_bought")) db.exec(`ALTER TABLE category_suggestions ADD COLUMN ${SUGGESTION_KNEW_BOUGHT_COLUMN}`)
  },
  33: (db) => db.exec(`ALTER TABLE categories ADD COLUMN ${CATEGORY_BUDGET_IGNORED_COLUMN}`),
  34: (db) => {
    db.exec(BUDGET_HISTORY_SQL)
    db.exec(`INSERT INTO budget_history (scope_kind, target_id, amount, from_date)
      SELECT scope_kind, target_id, amount, NULL FROM budgets`)
  },
  35: (db) => db.exec(ACTIVITY_LOG_TRANSACTION_INDEXES_SQL),
  30: (db) => {
    db.exec(TAG_CATEGORIES_SQL)
    const columns = db.query<{ name: string }, []>("PRAGMA table_info(tags)").all().map((c) => c.name)
    if (!columns.includes("about")) db.exec(`ALTER TABLE tags ADD COLUMN ${TAG_ABOUT_COLUMN}`)
    const categories = db.query<{ id: number; name: string; parentId: number | null }, []>("SELECT id, name, parent_id AS parentId FROM categories").all()
    const link = db.query("INSERT OR IGNORE INTO tag_categories (tag_id, category_id) VALUES (?, ?)")
    for (const tag of db.query<{ id: number; scope: string }, []>("SELECT id, scope FROM tags WHERE TRIM(COALESCE(scope, '')) != ''").all()) {
      const names = [...tag.scope.matchAll(/\bcat:(?:"([^"]+)"|([^\s()]+))/gi)].map((m) => (m[1] ?? m[2]!).toLowerCase())
      const ids = new Set(names.flatMap((name) => categories.filter((c) => c.name.toLowerCase() === name).map((c) => c.id)))
      for (const id of ids) {
        const parent = categories.find((c) => c.id === id)?.parentId
        if (parent == null || !ids.has(parent)) link.run(tag.id, id)
      }
    }
    db.exec("UPDATE tags SET scope = NULL")
  },
  24: (db) => db.exec(ACTIVITY_LOG_SQL),
  23: (db) => {
    db.exec(CATEGORY_CHOICES_SQL)
    db.exec(`INSERT OR IGNORE INTO category_choices (description, category_id, times)
      SELECT lower(trim(description)), category_id, COUNT(*) FROM transactions
      WHERE category_source IN ('user', 'pending') AND category_id IS NOT NULL GROUP BY 1, 2`)
  },
  22: (db) => {
    const columns = db.query<{ name: string }, []>("PRAGMA table_info(category_suggestions)").all().map((c) => c.name)
    if (!columns.includes("dismissed")) db.exec(`ALTER TABLE category_suggestions ADD COLUMN ${SUGGESTION_DISMISSED_COLUMN}`)
    db.exec(TAG_DISMISSALS_SQL)
  },
  21: (db) => {
    const columns = db.query<{ name: string }, []>("PRAGMA table_info(tags)").all().map((c) => c.name)
    if (!columns.includes("scope")) db.exec(`ALTER TABLE tags ADD COLUMN ${TAG_SCOPE_COLUMN}`)
    const categories = db.query<{ id: number; name: string; parentId: number | null }, []>("SELECT id, name, parent_id AS parentId FROM categories").all()
    for (const tag of db.query<{ id: number; categoryId: number }, []>("SELECT id, category_id AS categoryId FROM tags WHERE category_id IS NOT NULL").all()) {
      const category = categories.find((c) => c.id === tag.categoryId)
      db.query("UPDATE tags SET scope = ?, category_id = NULL WHERE id = ?").run(category ? categoryTerm(category, categories as Category[]) : null, tag.id)
    }
  },
}

function ensureIncomeCategories(db: Db): number {
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
        throw new Error(`this jaskmoney is older than your data (schema v${row.version}, it knows v${SCHEMA_VERSION}); nothing was changed · rebuild it: bun run build`)
      }
      for (let version = row.version + 1; version <= SCHEMA_VERSION; version++) {
        const migrate = MIGRATIONS[version]
        if (!migrate) throw new Error(`no additive migration from v${version - 1} to v${version}`)
        migrate(db)
        db.query("UPDATE schema_meta SET version = ?").run(version)
      }
      if (!tableExists(db, "categories") || !tableExists(db, "transactions") || !tableExists(db, "tags")) {
        throw new Error("database schema is incomplete; database was left untouched")
      }
    }
    seedDefaults(db)
    db.exec("COMMIT")
  } catch (error) {
    try { db.exec("ROLLBACK") } catch {}
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

export interface DbInfo {
  schemaVersion: number
  transactionCount: number
  categoryCount: number
  tagCount: number
  accountCount: number
  importCount: number
  ruleCount: number
  path: string
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
