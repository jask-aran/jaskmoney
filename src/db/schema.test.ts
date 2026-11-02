import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { ensureSchema } from "./client"
import { ACTIVITY_LOG_TRANSACTION_INDEXES_SQL, SCHEMA_SQL, SCHEMA_VERSION } from "./schema"
import { testDb } from "../testing/scoped"

function indexes(db: ReturnType<typeof testDb>) {
  return db.query<{ name: string; sql: string }, []>(`SELECT name, sql FROM sqlite_master
    WHERE type = 'index' AND name IN ('tag_log_transaction_tag', 'category_log_transaction_category') ORDER BY name`).all()
}

function plan(db: ReturnType<typeof testDb>, sql: string) {
  return db.query<{ detail: string }, []>(`EXPLAIN QUERY PLAN ${sql}`).all().map(row => row.detail).join("\n")
}

test.each([false, true])("v35 adds activity indexes and preserves data (indexes already present: %s)", alreadyPresent => {
  // Recreate only the schema in memory as v34, without the new index block.
  const legacy = SCHEMA_SQL.replace(ACTIVITY_LOG_TRANSACTION_INDEXES_SQL, "")
  using old = new Database(":memory:")
  old.exec("PRAGMA foreign_keys = ON")
  old.exec(legacy)
  old.exec(`INSERT INTO schema_meta VALUES (34);
    INSERT INTO categories (id, name, color) VALUES (100, 'Test category', '#fff');
    INSERT INTO tags (id, name) VALUES (100, 'Test tag');
    INSERT INTO transactions (id, date_raw, date_iso, amount, description)
      VALUES (100, 'x', '2026-01-01', -1, 'Invented shop');
    INSERT INTO tag_log VALUES (1, 100, 100, 1, 'picker', '2026-01-01');
    INSERT INTO category_log VALUES (1, 100, 100, NULL, 'choose', '2026-01-01');`)
  const tagQuery = "SELECT MAX(id) FROM tag_log WHERE transaction_id = 100 AND tag_id = 100"
  const categoryQuery = "SELECT MAX(id) FROM category_log WHERE transaction_id = 100 AND category_id = 100"
  expect(plan(old, tagQuery)).not.toContain("tag_log_transaction_tag")
  expect(plan(old, categoryQuery)).not.toContain("category_log_transaction_category")
  if (alreadyPresent) old.exec(ACTIVITY_LOG_TRANSACTION_INDEXES_SQL)
  ensureSchema(old)
  expect(old.query("SELECT version FROM schema_meta").get()).toEqual({ version: SCHEMA_VERSION })
  expect(indexes(old)).toHaveLength(2)
  expect(plan(old, tagQuery)).toContain("tag_log_transaction_tag")
  expect(plan(old, categoryQuery)).toContain("category_log_transaction_category")
  expect(plan(old, "SELECT rowid FROM tag_log WHERE transaction_id = 100")).toContain("tag_log_transaction_tag")
  expect(plan(old, "SELECT rowid FROM category_log WHERE transaction_id = 100")).toContain("category_log_transaction_category")
  expect(old.query(tagQuery).get()).toEqual({ "MAX(id)": 1 })
  expect(old.query(categoryQuery).get()).toEqual({ "MAX(id)": 1 })
  expect(old.query("SELECT description FROM transactions WHERE id = 100").get()).toEqual({ description: "Invented shop" })
  ensureSchema(old)
  expect(indexes(old)).toHaveLength(2)
})
