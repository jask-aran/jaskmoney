import { describe, expect, test } from "bun:test"
import { createCategory, type Db } from "../db/client"
import { assignProviderCategories, syncCategoryTree } from "./categories"
import { testDb } from "../testing/scoped"

function rows(db: Db) {
  return db.query<{ id: number; name: string; color: string; sort_order: number; parent_id: number | null; ext_id: string | null }, []>(
    "SELECT id, name, color, sort_order, parent_id, ext_id FROM categories ORDER BY sort_order, id").all()
}
const tree = [
  { id: "z", name: "Zebra", parentId: "food" },
  { id: "food", name: "Food", parentId: null },
  { id: "a", name: "Apple", parentId: "food" },
  { id: "life", name: "Life", parentId: null },
]

describe("Up category tree", () => {

  test("renames and reparents without changing identity, colour or order; absent categories remain", () => {
    const db = testDb()
    syncCategoryTree(db, tree)
    const before = rows(db), apple = before.find(c => c.ext_id === "a")!, life = before.find(c => c.ext_id === "life")!
    db.query("UPDATE categories SET color = '#123456' WHERE id = ?").run(apple.id)
    syncCategoryTree(db, [tree[1]!, tree[3]!, { id: "a", name: "Renamed", parentId: "life" }, { id: "new", name: "New", parentId: "life" }])
    expect(rows(db).find(c => c.ext_id === "a")).toEqual({ ...apple, name: "Renamed", parent_id: life.id, color: "#123456" })
    expect(rows(db).find(c => c.ext_id === "z")).toEqual(before.find(c => c.ext_id === "z"))
    expect(rows(db).find(c => c.ext_id === "new")).toMatchObject({ color: life.color, parent_id: life.id })
    expect(rows(db).find(c => c.ext_id === "new")!.sort_order).toBeGreaterThan(Math.max(...before.map(c => c.sort_order)))
  })

  test("unknown parents, cycles and duplicate IDs reject the tree and roll back cleanup", () => {
    const db = testDb(), before = rows(db)
    const invalidTrees = [
      [...tree, { id: "orphan", name: "Orphan", parentId: "missing" }],
      [{ id: "a", name: "A", parentId: "b" }, { id: "b", name: "B", parentId: "a" }],
      [...tree, tree[1]!],
    ]
    for (const invalid of invalidTrees) {
      expect(() => db.transaction(() => syncCategoryTree(db, invalid))()).toThrow("Invalid Up category tree")
      expect(rows(db)).toEqual(before)
    }
  })
})

describe("provider category backfill", () => {
  test("rows following the provider take its stored category; user and rule rows and CSV rows do not", () => {
    const db = testDb()
    db.transaction(() => syncCategoryTree(db, tree))()
    const id = (ext: string) => db.query<{ id: number }, [string]>("SELECT id FROM categories WHERE ext_id = ?").get(ext)!.id
    const uncat = db.query<{ id: number }, []>("SELECT id FROM categories WHERE is_default = 1").get()!.id
    const local = createCategory(db, { name: "Mine", color: "#ffffff" })
    const insert = db.query(`INSERT INTO transactions (date_raw, date_iso, amount, description, category_id, source, ext_category, category_source)
      VALUES ('x', '2026-01-01', -1, ?, ?, ?, ?, ?)`)
    insert.run("old", uncat, "up", "a", null)             // outside the sync window, never mapped
    insert.run("stale", id("z"), "up", "a", "provider")   // Up changed its category
    insert.run("gone", id("a"), "up", null, "provider")   // Up removed its category
    insert.run("unknown", uncat, "up", "nope", null)      // category not in the tree
    insert.run("mine", local, "up", "a", "user")
    insert.run("ruled", local, "up", "a", "rule")
    insert.run("csv", local, "csv", null, null)
    expect(assignProviderCategories(db)).toBe(2 + 1)
    const got = Object.fromEntries(db.query<{ description: string; category_id: number; category_source: string | null }, []>(
      "SELECT description, category_id, category_source FROM transactions").all().map(r => [r.description, [r.category_id, r.category_source]]))
    expect(got).toEqual({
      old: [id("a"), "provider"], stale: [id("a"), "provider"], gone: [uncat, null], unknown: [uncat, null],
      mine: [local, "user"], ruled: [local, "rule"], csv: [local, null],
    })
    expect(assignProviderCategories(db)).toBe(0)
  })
})
