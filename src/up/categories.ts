import type { Db } from "../db/client"
import type { createUpClient } from "./client"

type CategoryTree = Awaited<ReturnType<ReturnType<typeof createUpClient>["listCategories"]>>
const palette = ["#fab387", "#cba6f7", "#94e2d5", "#89b4fa", "#f5c2e7", "#a6e3a1"]
const unusedDefaults = ["Groceries", "Dining & Drinks", "Transport", "Bills & Utilities", "Entertainment", "Shopping", "Health"]

// The caller owns the write transaction. Up owns names and parents, but local
// identity, colours and order survive every later import.
export function syncCategoryTree(db: Db, tree: CategoryTree): void {
  const firstImport = !db.query("SELECT 1 FROM categories WHERE ext_id IS NOT NULL LIMIT 1").get()
  if (firstImport) {
    const remove = db.query(`DELETE FROM categories WHERE name = ? AND ext_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM transactions WHERE category_id = categories.id)
      AND NOT EXISTS (SELECT 1 FROM rules_v2 WHERE set_category_id = categories.id)
      AND NOT EXISTS (SELECT 1 FROM tags WHERE category_id = categories.id)`)
    for (const name of unusedDefaults) remove.run(name)
    db.query(`INSERT INTO categories (name, color, sort_order)
      SELECT 'People', '#f5c2e7', COALESCE(MAX(sort_order), -1) + 1 FROM categories
      HAVING NOT EXISTS (SELECT 1 FROM categories WHERE name = 'People')`).run()
  }
  let sortOrder = db.query<{ n: number }, []>("SELECT COALESCE(MAX(sort_order), -1) AS n FROM categories").get()!.n
  let parentCount = db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM categories WHERE ext_id IS NOT NULL AND parent_id IS NULL").get()!.n
  const visited = new Set<string>()
  function upsert(category: CategoryTree[number], parent: { id: number; color: string } | null): void {
    if (visited.has(category.id)) throw new Error("Invalid Up category tree")
    visited.add(category.id)
    const existing = db.query<{ id: number; color: string }, [string]>("SELECT id, color FROM categories WHERE ext_id = ?").get(category.id)
    const conflicts = (name: string) => {
      const row = db.query<{ id: number }, [string]>("SELECT id FROM categories WHERE name = ?").get(name)
      return row !== null && row.id !== existing?.id
    }
    let name = category.name
    if (conflicts(name)) {
      const qualified = `${name} (Up)`
      name = qualified
      for (let n = 2; conflicts(name); n++) name = `${qualified} ${n}`
    }
    let local: { id: number; color: string }
    if (existing) {
      db.query("UPDATE categories SET name = ?, parent_id = ? WHERE id = ?").run(name, parent?.id ?? null, existing.id)
      local = existing
    } else {
      const color = parent?.color ?? palette[parentCount++ % palette.length]!
      const result = db.query("INSERT INTO categories (name, color, sort_order, ext_id, parent_id) VALUES (?, ?, ?, ?, ?)")
        .run(name, color, ++sortOrder, category.id, parent?.id ?? null)
      local = { id: Number(result.lastInsertRowid), color }
    }
    for (const child of tree.filter(c => c.parentId === category.id).sort((a, b) => a.name.localeCompare(b.name))) upsert(child, local)
  }
  for (const parent of tree.filter(c => c.parentId === null)) upsert(parent, null)
  if (visited.size !== tree.length) throw new Error("Invalid Up category tree")
}

/**
 * Bring every provider-following row (category_source NULL or 'provider') in
 * line with its stored provider category: the local subcategory with that ext_id
 * (groups are never assigned, as in sync),
 * else the default (Uncategorised) with source NULL. Rows the user or a rule
 * categorised are untouched. Needs no API data, so it also covers rows outside
 * the incremental sync window. Returns the number of rows changed.
 */
export function assignProviderCategories(db: Db): number {
  const fallback = db.query<{ id: number }, []>("SELECT id FROM categories WHERE is_default = 1 ORDER BY id LIMIT 1").get()?.id ?? null
  const result = db.query(`
    UPDATE transactions SET
      category_id = COALESCE((SELECT c.id FROM categories c WHERE c.ext_id = transactions.ext_category AND c.parent_id IS NOT NULL), ?),
      category_source = CASE WHEN EXISTS (SELECT 1 FROM categories c WHERE c.ext_id = transactions.ext_category AND c.parent_id IS NOT NULL) THEN 'provider' ELSE NULL END
    WHERE source != 'csv'
      AND (category_source IS NULL OR category_source = 'provider')
      AND NOT (
        category_id IS COALESCE((SELECT c.id FROM categories c WHERE c.ext_id = transactions.ext_category AND c.parent_id IS NOT NULL), ?)
        AND category_source IS (CASE WHEN EXISTS (SELECT 1 FROM categories c WHERE c.ext_id = transactions.ext_category AND c.parent_id IS NOT NULL) THEN 'provider' ELSE NULL END)
      )`).run(fallback, fallback)
  return Number(result.changes)
}
