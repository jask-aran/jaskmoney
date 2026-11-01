import { expect, test } from "bun:test"
import { createCategory, deleteCategory } from "./client"
import { assignProviderCategories, syncCategoryTree } from "../up/categories"
import { testDb } from "../testing/scoped"

test("category deletion clears each source with the category, then provider assignment resumes", () => {
  const db = testDb()
  db.query("INSERT INTO accounts (id, name, type, source) VALUES (100, 'Test', 'debit', 'up')").run()
  syncCategoryTree(db, [{ id: "home", name: "Home", parentId: null }, { id: "provider", name: "Provider", parentId: "home" }])
  const provider = db.query<{ id: number }, []>("SELECT id FROM categories WHERE ext_id = 'provider'").get()!.id
  const category = createCategory(db, { name: "Local override", color: "#fff" })
  for (const source of [null, "provider", "pending", "user", "rule", "type"]) {
    const id = source == null ? 2 : ["provider", "pending", "user", "rule", "type"].indexOf(source) + 3
    db.query(`INSERT INTO transactions (id, date_raw, date_iso, amount, description, account_id, source, category_id, category_source, ext_category)
      VALUES (?, 'x', '2026-10-01', -5, 'Shop', 100, 'up', ?, ?, 'provider')`).run(id, category, source)
  }
  deleteCategory(db, category)
  expect(db.query("SELECT category_id, category_source FROM transactions WHERE id > 1").all()).toEqual(
    Array.from({ length: 6 }, () => ({ category_id: null, category_source: null })),
  )
  assignProviderCategories(db)
  expect(db.query("SELECT DISTINCT category_id, category_source FROM transactions WHERE id > 1").all()).toEqual([{ category_id: provider, category_source: "provider" }])
})

