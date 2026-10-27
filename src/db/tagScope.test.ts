import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { ensureSchema, loadTags } from "./client"
import { inTagScope, parseTagScope } from "../domain/tagScope"
import { transaction } from "../testing/fixtures"

test("v21 turns each tag's category scope into its cat: term (a group's with its children) and clears category_id", () => {
  const db = new Database(":memory:")
  ensureSchema(db)
  // Back to v20's layout: no scope column, category scopes.
  db.exec("ALTER TABLE tags DROP COLUMN scope; UPDATE schema_meta SET version = 20")
  const group = Number(db.query("INSERT INTO categories (name, color) VALUES ('Motoring', '#fff')").run().lastInsertRowid)
  db.query("INSERT INTO categories (name, color, parent_id) VALUES ('Petrol', '#fff', ?), ('Road tolls', '#fff', ?)").run(group, group)
  const travel = Number(db.query("INSERT INTO categories (name, color) VALUES ('Trips abroad', '#fff')").run().lastInsertRowid)
  db.query("INSERT INTO tags (name, color, category_id) VALUES ('TRIP', '#fff', ?), ('CAR', '#fff', ?), ('ANY', '#fff', NULL)").run(travel, group)
  ensureSchema(db)
  expect(db.query("SELECT version FROM schema_meta").get()).toEqual({ version: 22 })
  const scopes = Object.fromEntries(loadTags(db).map((t) => [t.name, t.scope]))
  expect(scopes).toMatchObject({ TRIP: 'cat:"Trips abroad"', CAR: '(cat:"Motoring" OR cat:"Petrol" OR cat:"Road tolls")', ANY: null })
  expect(db.query("SELECT COUNT(*) AS n FROM tags WHERE category_id IS NOT NULL").get()).toEqual({ n: 0 })
})

test("a scope is any filter but ask:; a tag without one goes anywhere; a broken one nowhere", () => {
  expect(parseTagScope("")).toEqual({ node: null })
  expect(parseTagScope("date:2026-05-19..2026-06-08").error).toBeUndefined()
  expect(parseTagScope('ask:"dinner"').error).toBe("ask: can't be used in a tag scope")
  expect(parseTagScope("cat:(").error).toBeDefined()
  const row = transaction({ dateISO: "2026-05-22", categoryName: "Takeaway" })
  expect(inTagScope({ scope: null }, row)).toBe(true)
  expect(inTagScope({ scope: "date:2026-05-19..2026-06-08" }, row)).toBe(true)
  expect(inTagScope({ scope: "cat:Groceries" }, row)).toBe(false)
  expect(inTagScope({ scope: "cat:(" }, row)).toBe(false)
})
