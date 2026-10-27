import { expect, test } from "bun:test"
import type { JevClient } from "../ai/jev"
import { loadSuggestions, saveSuggestions } from "../db/client"
import { category, transaction } from "../testing/fixtures"
import { testDb } from "../testing/scoped"
import { categoryPickerRows, pickerSuggestions } from "./categoryOptions"
import { RANKED_MIN, SUGGESTION_RANKED } from "./questions"
import { historySuggestions, jevSuggestions } from "./suggest"
import type { CategorySuggestion } from "./types"

const categories = [
  category({ id: 1, name: "One" }), category({ id: 2, name: "Two" }), category({ id: 3, name: "Three" }),
  category({ id: 4, name: "Four" }), category({ id: 5, name: "Five" }), category({ id: 6, name: "Six" }), category({ id: 7, name: "Seven" }),
  category({ id: 9, isDefault: true, name: "Uncategorised" }),
]

test("Jev's suggestion keeps the categories it weighed: its pick first, then most likely, at most SUGGESTION_RANKED, none under RANKED_MIN", async () => {
  expect([SUGGESTION_RANKED, RANKED_MIN]).toEqual([5, 0.03])
  const probabilities = { c1: 0.05, c2: 0.5, c3: 0.2, c4: 0.1, c5: 0.06, c6: 0.04, c7: 0.02, c9: 0.03 }
  const jev: Pick<JevClient, "judge"> = { async judge(qs) {
    return Object.fromEntries(Object.keys(qs).map((id) => [id, { type: "choice" as const, choice: "c3", confidence: 0.4, probabilities }]))
  } }
  const [s] = await jevSuggestions(jev, [transaction({ id: 10, description: "Shop" })], categories)
  // The pick (c3) leads even though c2 is likelier; Uncategorised (c9) is never offered; c7 is under the floor.
  expect(s!.ranked).toEqual([
    { categoryId: 3, confidence: 0.2 }, { categoryId: 2, confidence: 0.5 }, { categoryId: 4, confidence: 0.1 },
    { categoryId: 5, confidence: 0.06 }, { categoryId: 1, confidence: 0.05 },
  ])
})

test("history's suggestion ranks the categories the same description went to", () => {
  const rows = [
    ...Array.from({ length: 10 }, (_, i) => transaction({ id: 20 + i, description: "Shop", categoryId: 1, categoryName: "One" })),
    transaction({ id: 40, description: "Shop", categoryId: 2, categoryName: "Two" }),
    transaction({ id: 10, description: "Shop" }),
  ]
  expect(historySuggestions(rows, categories)).toEqual([{
    transactionId: 10, categoryId: 1, confidence: 10 / 12, source: "history",
    ranked: [{ categoryId: 1, confidence: 10 / 12 }, { categoryId: 2, confidence: 1 / 12 }],
  }])
})

test("the picker's suggestions: one row's ranking with confidences; several rows' picks by how many share them", () => {
  const s = (transactionId: number, categoryId: number, ranked?: CategorySuggestion["ranked"]): CategorySuggestion => ({ transactionId, categoryId, confidence: 0.7, source: "jev", ...(ranked ? { ranked } : {}) })
  const suggestions = { 1: s(1, 3, [{ categoryId: 3, confidence: 0.7 }, { categoryId: 2, confidence: 0.2 }]), 2: s(2, 4), 3: s(3, 4), 4: s(4, 3) }
  expect(pickerSuggestions([1], suggestions)).toEqual([{ categoryId: 3, confidence: 0.7 }, { categoryId: 2, confidence: 0.2 }])
  // Saved before rankings: just the pick, with its confidence.
  expect(pickerSuggestions([2], suggestions)).toEqual([{ categoryId: 4, confidence: 0.7 }])
  expect(pickerSuggestions([1, 2, 3], suggestions)).toEqual([{ categoryId: 4 }, { categoryId: 3 }])
  expect(pickerSuggestions([99], suggestions)).toEqual([])
})

test("the picker lists suggestions first, in order, carrying their confidence; a query hides them", () => {
  const rows = categoryPickerRows(categories, "", true, [{ categoryId: 3, confidence: 0.7 }, { categoryId: 2, confidence: 0.2 }, { categoryId: 9 }])
  expect(rows.slice(0, 4)).toEqual([
    { kind: "heading", label: "Suggested" },
    { kind: "category", category: categories[2], index: 0, confidence: 0.7 },
    { kind: "category", category: categories[1], index: 1, confidence: 0.2 },
    { kind: "category", category: categories[7], index: 2 },
  ])
  // The full list follows, without confidences.
  expect(rows.slice(4).every((r) => r.kind === "heading" || r.confidence === undefined)).toBe(true)
  expect(categoryPickerRows(categories, "two", true, [{ categoryId: 3, confidence: 0.7 }]).some((r) => r.kind === "heading" && r.label === "Suggested")).toBe(false)
})

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
