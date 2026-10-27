import { expect, onTestFinished, spyOn, test } from "bun:test"
import type { JevClient, JevQuestion } from "../ai/jev"
import { saveSuggestions } from "../db/client"
import { testEnv } from "../testing/scoped"
import { data } from "./dataStore"

/** CSV rows (so categorising never calls Up), no Jev key, no network. */
function setup() {
  testEnv("JASKMONEY_JEV_TOKEN", "")
  const network = spyOn(globalThis, "fetch").mockImplementation(Object.assign(() => { throw new Error("network is forbidden") }, { preconnect: globalThis.fetch.preconnect }))
  onTestFinished(() => {
    try { expect(network).not.toHaveBeenCalled() } finally { network.mockRestore() }
  })
  data.init(":memory:")
  const db = data.getDb()!
  db.query("INSERT INTO accounts (id, name, type, source) VALUES (100, 'Spending', 'debit', 'csv')").run()
  db.query("INSERT INTO categories (id, name, color) VALUES (100, 'Test food', '#fff'), (101, 'Test travel', '#fff')").run()
  const add = (id: number, description: string, categoryId: number | null = null) =>
    db.query(`INSERT INTO transactions (id, date_raw, date_iso, amount, description, category_id, account_id, source)
      VALUES (?, 'x', '2026-10-01', -5, ?, ?, 100, 'csv')`).run(id, description, categoryId)
  return { db, add }
}

const description = (q: JevQuestion) => (q.instructions as { transaction: { description: string; categorised_before?: string } }).transaction
/** A fake Jev picking `categoryId` at 0.9 for every row; `seen` records what it was shown. */
function fakeJev(categoryId: number, seen: Array<{ description: string; categorised_before?: string }> = [], gate?: Promise<void>): Pick<JevClient, "judge"> {
  return { async judge(questions) {
    if (gate) await gate
    const out: Awaited<ReturnType<JevClient["judge"]>> = {}
    for (const [id, q] of Object.entries(questions)) {
      seen.push(description(q))
      out[id] = { type: "choice", choice: `c${categoryId}`, confidence: 0.5, probabilities: { [`c${categoryId}`]: 0.9 } }
    }
    return out
  } }
}
const suggestion = (id: number) => data.state.suggestions[id] && { categoryId: data.state.suggestions[id]!.categoryId, source: data.state.suggestions[id]!.source }

test("categorising a row re-asks about the waiting rows with the same description, with the new history; others are left alone", async () => {
  const { db, add } = setup()
  add(1, "Corner Bar")
  add(2, " corner bar ")
  add(3, "Other")
  add(4, "Corner Bar") // dismissed earlier: no suggestion, so not re-suggested
  saveSuggestions(db, [1, 2, 3].map((id) => ({ transactionId: id, categoryId: 101, confidence: 0.6, source: "jev" as const })))
  data.refresh()
  await data.categorizeTransactions([1], 100)
  const seen: Array<{ description: string; categorised_before?: string }> = []
  expect(await data.resuggestLike([1], fakeJev(100, seen))).toBe(1)
  // Only row 2 was asked about, and Jev was told how row 1 went.
  expect(seen).toEqual([expect.objectContaining({ description: " corner bar ", categorised_before: "Test food ×1" })])
  expect(suggestion(2)).toEqual({ categoryId: 100, source: "jev" })
  expect(suggestion(3)).toEqual({ categoryId: 101, source: "jev" })
  expect(suggestion(4)).toBeUndefined()
  // Nothing alike waiting: nothing asked.
  expect(await data.resuggestLike([3], fakeJev(100, seen))).toBe(0)
})

test("once history settles the description, it replaces Jev's suggestion without asking Jev", async () => {
  const { db, add } = setup()
  for (const id of [1, 2, 3]) add(id, "Shop")
  add(4, "Shop")
  saveSuggestions(db, [4].map((id) => ({ transactionId: id, categoryId: 101, confidence: 0.6, source: "jev" as const })))
  data.refresh()
  await data.categorizeTransactions([1, 2, 3], 100)
  const seen: Array<{ description: string }> = []
  expect(await data.resuggestLike([1, 2, 3], fakeJev(101, seen))).toBe(1)
  expect(seen).toEqual([])
  expect(suggestion(4)).toEqual({ categoryId: 100, source: "history" })
})

test("a re-suggestion asked for while suggestions run waits its turn instead of failing", async () => {
  const { db, add } = setup()
  add(1, "Cafe")
  add(2, "Cafe")
  add(3, "Fresh")
  saveSuggestions(db, [{ transactionId: 2, categoryId: 101, confidence: 0.6, source: "jev" }])
  data.refresh()
  let open!: () => void
  const gate = new Promise<void>((resolve) => { open = resolve })
  const running = data.suggestCategories([3], fakeJev(101, [], gate))
  expect(data.state.suggesting).toBe(true)
  await data.categorizeTransactions([1], 100)
  const later = data.resuggestLike([1], fakeJev(100))
  open()
  await running
  expect(await later).toBe(1)
  expect(suggestion(2)).toEqual({ categoryId: 100, source: "jev" })
  expect(data.state.suggesting).toBe(false)
})
