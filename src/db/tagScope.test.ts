import { SCHEMA_VERSION } from "./schema"
import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { ensureSchema, loadTags } from "./client"

test("a v20 category scope comes through v21's expression back to its categories (a group whole); about starts empty", () => {
  const db = new Database(":memory:")
  ensureSchema(db)
  // Back to v20's layout: no scope column, category scopes.
  db.exec("ALTER TABLE tags DROP COLUMN scope; ALTER TABLE categories DROP COLUMN budget_ignored; UPDATE schema_meta SET version = 20")
  const group = Number(db.query("INSERT INTO categories (name, color) VALUES ('Motoring', '#fff')").run().lastInsertRowid)
  db.query("INSERT INTO categories (name, color, parent_id) VALUES ('Petrol', '#fff', ?), ('Road tolls', '#fff', ?)").run(group, group)
  const travel = Number(db.query("INSERT INTO categories (name, color) VALUES ('Trips abroad', '#fff')").run().lastInsertRowid)
  db.query("INSERT INTO tags (name, color, category_id) VALUES ('TRIP', '#fff', ?), ('CAR', '#fff', ?), ('ANY', '#fff', NULL)").run(travel, group)
  ensureSchema(db)
  expect(db.query("SELECT version FROM schema_meta").get()).toEqual({ version: SCHEMA_VERSION })
  const tags = Object.fromEntries(loadTags(db).map((t) => [t.name, t]))
  expect(tags.TRIP).toMatchObject({ categoryIds: [travel], about: null })
  expect(tags.CAR).toMatchObject({ categoryIds: [group] })
  expect(tags.ANY).toMatchObject({ categoryIds: [] })
  expect(db.query("SELECT COUNT(*) AS n FROM tags WHERE category_id IS NOT NULL OR scope IS NOT NULL").get()).toEqual({ n: 0 })
})

test("v30 keeps an expression's categories and drops the rest (a trip's dates, other terms)", () => {
  const db = new Database(":memory:")
  ensureSchema(db)
  db.exec("ALTER TABLE categories DROP COLUMN budget_ignored; UPDATE schema_meta SET version = 29; DROP TABLE tag_categories")
  const food = Number(db.query("INSERT INTO categories (name, color) VALUES ('Eating Out', '#fff')").run().lastInsertRowid)
  db.query(`INSERT INTO tags (name, color, scope) VALUES ('TRIP', '#fff', 'date:2026-05-19..2026-06-08'),
    ('DINNERS', '#fff', 'cat:"eating out" AND amount:>20'), ('BROKEN', '#fff', 'cat:Nowhere')`).run()
  ensureSchema(db)
  const tags = Object.fromEntries(loadTags(db).map((t) => [t.name, t.categoryIds]))
  expect(tags).toMatchObject({ TRIP: [], DINNERS: [food], BROKEN: [] })
})
