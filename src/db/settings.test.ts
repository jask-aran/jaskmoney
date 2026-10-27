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
    expect(db.query("SELECT version FROM schema_meta").get()).toEqual({ version: 20 })
    expect(db.query("SELECT description FROM transactions WHERE id = 7").get()).toEqual({ description: "kept" })
    expect(db.query("SELECT name FROM categories WHERE id = 41").get()).toEqual({ name: "Preserved" })
    expect(db.query("SELECT 1 FROM sqlite_master WHERE name = 'rules_v2'").get()).toEqual({ 1: 1 })
  })

  test("v16 makes Income a group: rows, rules and tags on it move under it; Salary from Up's type", () => {
    const db = new Database(":memory:")
    db.exec("PRAGMA foreign_keys = ON")
    ensureSchema(db)
    const id = (name: string) => (db.query("SELECT id FROM categories WHERE name = ?").get(name) as { id: number }).id
    const income = id("Income")
    // Rewind to v15: no income column and no income categories.
    db.exec(`DELETE FROM categories WHERE parent_id = ${income}; ALTER TABLE categories DROP COLUMN income; ALTER TABLE budget_cycle DROP COLUMN pay_early; DROP TABLE category_suggestions; UPDATE schema_meta SET version = 15;`)
    const add = db.query(`INSERT INTO transactions (date_raw, date_iso, amount, description, category_id, category_source, source, external_id, transaction_type)
      VALUES ('x', '2026-10-14', ?, ?, ?, ?, 'up', ?, ?)`)
    add.run(5000, "Employer", income, "user", "a", "Salary")
    add.run(250, "Friend", income, "user", "b", "Osko Payment Received")
    add.run(4900, "Employer", id("Uncategorised"), null, "c", "Salary")
    add.run(1, "Bank", id("Uncategorised"), null, "d", "Interest")
    add.run(4800, "Employer", id("Groceries"), "user", "e", "Salary")
    db.query("INSERT INTO rules_v2 (name, saved_filter_id, set_category_id) VALUES ('pay', 'pay', ?)").run(income)
    ensureSchema(db)
    expect(db.query("SELECT version FROM schema_meta").get()).toEqual({ version: 20 })
    expect(db.query("SELECT income FROM categories WHERE id = ?").get(income)).toEqual({ income: 1 })
    expect(db.query("SELECT name FROM categories WHERE parent_id = ? ORDER BY sort_order").all(income).map((c) => (c as { name: string }).name))
      .toEqual(["Salary", "Interest", "Other income"])
    const category = (externalId: string) => db.query(`SELECT c.name, t.category_source AS source FROM transactions t
      JOIN categories c ON c.id = t.category_id WHERE t.external_id = ?`).get(externalId)
    expect(category("a")).toEqual({ name: "Salary", source: "user" })
    expect(category("b")).toEqual({ name: "Other income", source: "user" })
    expect(category("c")).toEqual({ name: "Salary", source: "type" })
    expect(category("d")).toEqual({ name: "Interest", source: "type" })
    // A category you chose is kept, even on a Salary row.
    expect(category("e")).toEqual({ name: "Groceries", source: "user" })
    expect(db.query("SELECT c.name FROM rules_v2 r JOIN categories c ON c.id = r.set_category_id").get()).toEqual({ name: "Other income" })
  })

  test("v9 and v10 add sync identity to existing rows without changing them", () => {
    const db = new Database(":memory:")
    db.exec("PRAGMA foreign_keys = ON")
    ensureSchema(db)
    const account = ensureAccount(db, "ANZ CREDIT", "credit")
    db.query(`INSERT INTO transactions (date_raw, date_iso, amount, description, account_id) VALUES ('x', '2026-01-01', -5, 'kept', ?)`).run(account.id)
    // Rewind to a v8 profile: drop the v9 columns and objects.
    db.exec(`
      DROP INDEX idx_accounts_external; DROP INDEX idx_transactions_external; DROP INDEX idx_transactions_status;
      DROP TABLE sync_state;
      ALTER TABLE accounts DROP COLUMN source; ALTER TABLE accounts DROP COLUMN external_id; ALTER TABLE accounts DROP COLUMN external_kind;
      ALTER TABLE accounts DROP COLUMN balance; ALTER TABLE accounts DROP COLUMN balance_at; ALTER TABLE accounts DROP COLUMN sync_enabled;
      ALTER TABLE transactions DROP COLUMN source; ALTER TABLE transactions DROP COLUMN external_id; ALTER TABLE transactions DROP COLUMN status;
      ALTER TABLE transactions DROP COLUMN external_created_at; ALTER TABLE transactions DROP COLUMN settled_at; ALTER TABLE transactions DROP COLUMN raw_text;
      ALTER TABLE transactions DROP COLUMN message; ALTER TABLE transactions DROP COLUMN transfer_account_id; ALTER TABLE transactions DROP COLUMN ext_category;
      ALTER TABLE transactions DROP COLUMN ext_parent_category; ALTER TABLE transactions DROP COLUMN ext_tags;
      ALTER TABLE transactions DROP COLUMN ext_categorizable; ALTER TABLE transactions DROP COLUMN transaction_type;
      ALTER TABLE transactions DROP COLUMN card_method; ALTER TABLE transactions DROP COLUMN card_suffix;
      ALTER TABLE transactions DROP COLUMN foreign_amount; ALTER TABLE transactions DROP COLUMN round_up; ALTER TABLE transactions DROP COLUMN cashback;
      DROP INDEX idx_categories_ext; ALTER TABLE categories DROP COLUMN parent_id; ALTER TABLE categories DROP COLUMN ext_id;
      ALTER TABLE transactions DROP COLUMN category_source;
      DROP INDEX idx_tags_ext; ALTER TABLE tags DROP COLUMN ext_id; ALTER TABLE categories DROP COLUMN not_spending; ALTER TABLE categories DROP COLUMN income;
      DROP TABLE budgets; DROP TABLE budget_cycle; DROP TABLE category_suggestions;
      UPDATE schema_meta SET version = 8;
    `)
    ensureSchema(db)
    expect(db.query("SELECT version FROM schema_meta").get()).toEqual({ version: 20 })
    expect(db.query("SELECT description, source, external_id AS externalId, status, ext_tags AS extTags FROM transactions").get())
      .toEqual({ description: "kept", source: "csv", externalId: null, status: null, extTags: "[]" })
    expect(db.query("SELECT name, source, sync_enabled AS syncEnabled FROM accounts WHERE id = ?").get(account.id)).toEqual({ name: "ANZ CREDIT", source: "csv", syncEnabled: 1 })
    db.query(`INSERT INTO transactions (date_raw, date_iso, amount, description, source, external_id) VALUES ('x', '2026-01-02', -1, 'a', 'up', 'u1')`).run()
    expect(() => db.query(`INSERT INTO transactions (date_raw, date_iso, amount, description, source, external_id) VALUES ('x', '2026-01-02', -1, 'b', 'up', 'u1')`).run()).toThrow()
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
