import { expect, test } from "bun:test"
import { addTagToTransactions, loadTransactionDetail, openDb, removeTagFromTransactions } from "./client"
import { addTagLink, decodeStoredTags, removeTagLink } from "./tagLinks"

function transaction(db: ReturnType<typeof openDb>) {
  return Number(db.query(`INSERT INTO transactions (date_raw, date_iso, amount, description)
    VALUES ('2026-01-01', '2026-01-01', -1, 'Test')`).run().lastInsertRowid)
}

test("tag links count changes and local add rolls back earlier links on failure", () => {
  const db = openDb(":memory:")
  try {
    const id = transaction(db)
    const tag = db.query<{ id: number }, []>("SELECT id FROM tags LIMIT 1").get()!.id
    expect(() => addTagToTransactions(db, [id, id + 1], tag)).toThrow("FOREIGN KEY constraint failed")
    expect(db.query("SELECT * FROM transaction_tags").all()).toEqual([])
    expect(addTagLink(db, id, tag)).toBe(1)
    expect(addTagLink(db, id, tag)).toBe(0)
    removeTagFromTransactions(db, [id, id], tag)
    expect(removeTagLink(db, id, tag)).toBe(0)
  } finally { db.close() }
})

test("stored tags reject invalid shapes strictly and detail falls back to an empty array", () => {
  const db = openDb(":memory:")
  try {
    const id = transaction(db)
    for (const json of ["123", "null", "{}", '["ok", 1]', "invalid"]) {
      expect(() => decodeStoredTags(json)).toThrow()
      db.query("UPDATE transactions SET ext_tags = ? WHERE id = ?").run(json, id)
      expect(loadTransactionDetail(db, id)?.extTags).toEqual([])
    }
    // Detail preserves valid stored order and duplicates; sync uses sets.
    const json = '["Food","Food","Work"]'
    expect(decodeStoredTags(json)).toEqual(["Food", "Food", "Work"])
    db.query("UPDATE transactions SET ext_tags = ? WHERE id = ?").run(json, id)
    expect(loadTransactionDetail(db, id)?.extTags).toEqual(["Food", "Food", "Work"])
  } finally { db.close() }
})
