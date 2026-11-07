import { expect, test } from "bun:test"
import { loadSuggestions, saveSuggestions } from "../db/client"
import { testDb } from "../testing/scoped"

test("rankings are saved and loaded with the suggestion (v20); older suggestions have none", () => {
  const db = testDb()
  db.query("INSERT INTO accounts (id, name, type, source) VALUES (100, 'A', 'debit', 'csv')").run()
  for (const id of [1, 2]) db.query("INSERT INTO transactions (id, date_raw, date_iso, amount, description, account_id, source) VALUES (?, 'x', '2026-10-01', -5, 'Shop', 100, 'csv')").run(id)
  const cat = (db.query("SELECT id FROM categories WHERE is_default = 0 LIMIT 2").all() as { id: number }[]).map((r) => r.id)
  saveSuggestions(db, [
    { transactionId: 1, categoryId: cat[0]!, confidence: 0.7, source: "jev", ranked: [{ categoryId: cat[0]!, confidence: 0.7 }, { categoryId: cat[1]!, confidence: 0.2 }] },
    { transactionId: 2, categoryId: cat[1]!, confidence: 0.5, source: "history" },
  ])
  expect(loadSuggestions(db)).toEqual([
    { transactionId: 1, categoryId: cat[0]!, confidence: 0.7, source: "jev", ranked: [{ categoryId: cat[0]!, confidence: 0.7 }, { categoryId: cat[1]!, confidence: 0.2 }] },
    { transactionId: 2, categoryId: cat[1]!, confidence: 0.5, source: "history" },
  ])
})
