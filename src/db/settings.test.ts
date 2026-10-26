import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import {
  createCategory,
  createRule,
  createTag,
  deleteCategory,
  deleteTag,
  ensureSchema,
  loadRules,
  reorderRule,
  clearAccountTransactions,
  clearAllData,
  ensureAccount,
  removeAccountWithTransactions,
} from "./client"

describe("OpenTUI settings database", () => {
  test("migrates the v7 subset additively", () => {
    const db = new Database(":memory:")
    db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE schema_meta (version INTEGER NOT NULL); INSERT INTO schema_meta VALUES (7);
      CREATE TABLE categories (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, color TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, is_default INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, color TEXT NOT NULL, category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL, sort_order INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE transactions (id INTEGER PRIMARY KEY, date_raw TEXT NOT NULL, date_iso TEXT NOT NULL, amount REAL NOT NULL, description TEXT NOT NULL, category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL, notes TEXT NOT NULL DEFAULT '', import_id INTEGER, account_id INTEGER, created_at TEXT NOT NULL DEFAULT '');
      CREATE TABLE transaction_tags (transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE, tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE, PRIMARY KEY(transaction_id, tag_id));
      CREATE TABLE accounts (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, type TEXT NOT NULL DEFAULT 'debit', sort_order INTEGER NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE account_selection (account_id INTEGER);
      CREATE TABLE imports (id INTEGER PRIMARY KEY, filename TEXT NOT NULL, row_count INTEGER NOT NULL, imported_at TEXT NOT NULL DEFAULT '');
      INSERT INTO categories VALUES (41, 'Preserved', '#ffffff', 1, 0);
      INSERT INTO transactions VALUES (7, 'x', '2026-01-01', -5, 'kept', 41, '', NULL, NULL, '');
    `)
    ensureSchema(db)
    expect(db.query("SELECT version FROM schema_meta").get()).toEqual({ version: 8 })
    expect(db.query("SELECT description FROM transactions WHERE id = 7").get()).toEqual({ description: "kept" })
    expect(db.query("SELECT name FROM categories WHERE id = 41").get()).toEqual({ name: "Preserved" })
    expect(db.query("SELECT 1 FROM sqlite_master WHERE name = 'rules_v2'").get()).toEqual({ 1: 1 })
  })

  test("taxonomy protections and ordered rules preserve foreign-key semantics", () => {
    const db = new Database(":memory:")
    db.exec("PRAGMA foreign_keys = ON")
    ensureSchema(db)
    const defaultCategory = db.query("SELECT id FROM categories WHERE is_default = 1").get() as { id: number }
    expect(() => deleteCategory(db, defaultCategory.id)).toThrow("default")
    const cat = createCategory(db, { name: "Disposable", color: "#ffffff" })
    const tag = createTag(db, { name: " scoped ", color: "#ffffff", categoryId: cat })
    deleteCategory(db, cat)
    expect(db.query("SELECT category_id AS categoryId FROM tags WHERE id = ?").get(tag)).toEqual({ categoryId: null })
    const ignore = db.query("SELECT id FROM tags WHERE name = 'IGNORE'").get() as { id: number }
    expect(() => deleteTag(db, ignore.id)).toThrow("mandatory")
    const first = createRule(db, { name: "one", savedFilterId: "filter-1", setCategoryId: null, addTagIds: [], enabled: true })
    const second = createRule(db, { name: "two", savedFilterId: "filter-2", setCategoryId: null, addTagIds: [], enabled: true })
    reorderRule(db, second, 0)
    expect(loadRules(db).map((rule) => rule.id)).toEqual([second, first])
  })

  test("clear and account cleanup keep their intended persistence boundaries", () => {
    const db = new Database(":memory:")
    db.exec("PRAGMA foreign_keys = ON")
    ensureSchema(db)
    const first = ensureAccount(db, "First", "debit")
    const second = ensureAccount(db, "Second", "credit")
    db.query(`INSERT INTO imports (filename, row_count) VALUES ('x.csv', 2)`).run()
    db.query(`INSERT INTO transactions (date_raw, date_iso, amount, description, account_id) VALUES ('x', '2026-01-01', -1, 'one', ?)`).run(first.id)
    db.query(`INSERT INTO transactions (date_raw, date_iso, amount, description, account_id) VALUES ('x', '2026-01-02', -2, 'two', ?)`).run(second.id)
    expect(clearAccountTransactions(db, first.id)).toBe(1)
    expect(db.query(`SELECT COUNT(*) AS count FROM imports`).get()).toEqual({ count: 1 })
    expect(removeAccountWithTransactions(db, second.id)).toBe(1)
    expect(() => removeAccountWithTransactions(db, first.id)).toThrow("last account")
    clearAllData(db)
    expect(db.query(`SELECT COUNT(*) AS count FROM transactions`).get()).toEqual({ count: 0 })
    expect(db.query(`SELECT COUNT(*) AS count FROM imports`).get()).toEqual({ count: 0 })
    expect(db.query(`SELECT COUNT(*) AS count FROM categories`).get() as { count: number }).not.toEqual({ count: 0 })
  })
})
