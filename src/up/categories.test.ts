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
  test("imports parents in provider order, children alphabetically, after locals, with inherited colours", () => {
    const db = testDb()
    createCategory(db, { name: "Local", color: "#ffffff" })
    db.transaction(() => syncCategoryTree(db, tree))()
    const all = rows(db), imported = all.filter(c => c.ext_id !== null)
    expect(imported.map(c => c.ext_id)).toEqual(["food", "a", "z", "life"])
    expect(imported.map(c => c.color)).toEqual(["#fab387", "#fab387", "#fab387", "#cba6f7"])
    expect(imported.map(c => c.parent_id)).toEqual([null, imported[0]!.id, imported[0]!.id, null])
    expect(imported[0]!.sort_order).toBeGreaterThan(Math.max(...all.filter(c => c.ext_id === null).map(c => c.sort_order)))
    db.transaction(() => syncCategoryTree(db, [...tree].reverse()))()
    expect(rows(db)).toEqual(all)
  })

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

  test("clashes use numbered Up suffixes and remain stable on repeat imports", () => {
    const db = testDb()
    for (const name of ["Food", "Food (Up)", "Food (Up) 2"]) createCategory(db, { name, color: "#ffffff" })
    syncCategoryTree(db, tree)
    expect(rows(db).find(c => c.ext_id === "food")?.name).toBe("Food (Up) 3")
    const before = rows(db)
    syncCategoryTree(db, tree)
    expect(rows(db)).toEqual(before)
  })

  test("Up rename to a local name keeps identity and uses a stable numbered suffix", () => {
    const db = testDb()
    syncCategoryTree(db, tree)
    const before = rows(db).find(c => c.ext_id === "a")!
    for (const name of ["Clash", "Clash (Up)"]) createCategory(db, { name, color: "#ffffff" })
    const renamed = tree.map(c => c.id === "a" ? { ...c, name: "Clash" } : c)
    syncCategoryTree(db, renamed)
    expect(rows(db).find(c => c.ext_id === "a")).toEqual({ ...before, name: "Clash (Up) 2" })
    const after = rows(db)
    syncCategoryTree(db, renamed)
    expect(rows(db)).toEqual(after)
  })

  test("renamed defaults remain on first import", () => {
    const db = testDb()
    db.query("UPDATE categories SET name = 'My groceries' WHERE name = 'Groceries'").run()
    const before = rows(db).find(c => c.name === "My groceries")!
    syncCategoryTree(db, tree)
    expect(rows(db).find(c => c.id === before.id)).toEqual(before)
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

  test("parent palette continues on later imports and wraps after six parents", () => {
    const db = testDb()
    const parents = Array.from({ length: 7 }, (_, i) => ({ id: `p${i}`, name: `Parent ${i}`, parentId: null }))
    syncCategoryTree(db, parents.slice(0, 2))
    syncCategoryTree(db, parents)
    expect(rows(db).filter(c => c.ext_id).map(c => c.color)).toEqual(["#fab387", "#cba6f7", "#94e2d5", "#89b4fa", "#f5c2e7", "#a6e3a1", "#fab387"])
  })

  test("first cleanup checks transactions, rules and tags and always keeps the three required defaults", () => {
    const db = testDb()
    db.query(`INSERT INTO transactions (date_raw, date_iso, amount, description, category_id)
      SELECT '2026-01-01', '2026-01-01', -1, 'keep', id FROM categories WHERE name = 'Groceries'`).run()
    db.query(`INSERT INTO rules_v2 (name, saved_filter_id, set_category_id)
      SELECT 'keep', 'filter', id FROM categories WHERE name = 'Dining & Drinks'`).run()
    db.query(`INSERT INTO tags (name, category_id) SELECT 'keep', id FROM categories WHERE name = 'Transport'`).run()
    const before = rows(db)
    syncCategoryTree(db, tree)
    expect(rows(db).filter(c => !c.ext_id).map(c => c.name)).toEqual(["Income", "Groceries", "Dining & Drinks", "Transport", "Transfers", "Uncategorised", "People"])
    for (const name of ["Income", "Groceries", "Dining & Drinks", "Transport", "Transfers", "Uncategorised"]) {
      expect(rows(db).find(c => c.name === name)).toEqual(before.find(c => c.name === name))
    }
    db.query("UPDATE transactions SET category_id = NULL").run()
    db.query("UPDATE rules_v2 SET set_category_id = NULL").run()
    db.query("UPDATE tags SET category_id = NULL").run()
    createCategory(db, { name: "Health", color: "#ffffff" })
    const second = rows(db)
    syncCategoryTree(db, tree)
    expect(rows(db)).toEqual(second)
  })

  test("existing People stays local with its original colour and order", () => {
    const db = testDb()
    const id = createCategory(db, { name: "People", color: "#ffffff" })
    const before = rows(db).find(c => c.id === id)
    syncCategoryTree(db, tree)
    expect(rows(db).filter(c => c.name === "People")).toEqual([before!])
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
