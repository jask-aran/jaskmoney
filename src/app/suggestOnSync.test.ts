import { expect, onTestFinished, spyOn, test } from "bun:test"
import { join } from "node:path"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { saveSuggestions } from "../db/client"
import { data } from "../state/dataStore"
import { ui } from "../state/uiStore"
import { testEnv } from "../testing/scoped"
import { newSuggestionsNote, suggestNew } from "./suggest"
import { runSync } from "./sync"

function setup() {
  testEnv("JASKMONEY_JEV_TOKEN", "")
  testEnv("JASKMONEY_UP_TOKEN", "")
  const network = spyOn(globalThis, "fetch").mockImplementation(Object.assign(() => { throw new Error("network is forbidden") }, { preconnect: globalThis.fetch.preconnect }))
  onTestFinished(() => { try { expect(network).not.toHaveBeenCalled() } finally { network.mockRestore() } })
  const path = join(mkdtempSync(join(tmpdir(), "jm-")), "t.db")
  data.init(path)
  const db = data.getDb()!
  db.query("INSERT INTO accounts (id, name, type, source) VALUES (100, 'Spending', 'debit', 'csv')").run()
  db.query("INSERT INTO categories (id, name, color) VALUES (100, 'Test food', '#fff')").run()
  const add = (id: number, description: string, categoryId: number | null = null) =>
    db.query("INSERT INTO transactions (id, date_raw, date_iso, amount, description, category_id, account_id, source) VALUES (?, 'x', '2026-10-01', -5, ?, ?, 100, 'csv')").run(id, description, categoryId)
  add(1, "Shop", 100); add(2, "Shop", 100); add(3, "Shop", 100)
  add(4, "Shop"); add(5, "Shop")
  data.refresh()
  onTestFinished(() => { data.setUncategorisedOnly(false); data.init(":memory:") })
  return { db, add, path }
}

test("a dismissed suggestion stays dismissed: not loaded, not made again by i or a sync, after a restart too", async () => {
  const { path } = setup()
  expect(await data.suggestCategories([4, 5])).toStartWith("Suggested 2")
  await data.dismissSuggestions([4])
  expect(data.state.suggestions[4]).toBeUndefined()
  data.init(path)
  expect(data.state.suggestions[4]).toBeUndefined()
  expect(data.state.suggestions[5]).toBeDefined()
  expect(await data.suggestCategories([4, 5])).toStartWith("Suggested 0")
  expect(data.state.suggestions[4]).toBeUndefined()
})

test("a dismissed tag candidate stays dismissed for that tag, after a restart too", async () => {
  const { path } = setup()
  const ai = { judge: async (qs: Record<string, unknown>) => Object.fromEntries(Object.keys(qs).map((id) => [id, { type: "noul" as const, noul: 0.9 }])) }
  await data.openTagReview({ tagId: null, name: "shop runs", categoryIds: [], about: null }, ai)
  expect(Object.keys(data.state.tagReview!.candidates)).toHaveLength(5)
  await data.dismissTagCandidates([4])
  data.closeTagReview()
  data.init(path)
  await data.openTagReview({ tagId: null, name: "SHOP RUNS", categoryIds: [], about: null }, ai)
  expect(data.state.tagReview!.candidates[4]).toBeUndefined()
  expect(Object.keys(data.state.tagReview!.candidates)).toHaveLength(4)
  await data.openTagReview({ tagId: null, name: "other", categoryIds: [], about: null }, ai)
  expect(data.state.tagReview!.candidates[4]).toBeDefined()
  data.closeTagReview()
})

test("in the background, only new waiting rows are suggested, each once a session; the sync's status says so", async () => {
  const { db, add } = setup()
  saveSuggestions(db, [{ transactionId: 4, categoryId: 100, confidence: 0.9, source: "jev" }])
  data.refresh()
  expect(await suggestNew(data)).toBe(1)
  expect(await suggestNew(data)).toBe(0)
  add(6, "Shop")
  data.refresh()
  await runSync(ui, data, { manual: false })
  expect(data.state.suggestions[6]).toMatchObject({ categoryId: 100, source: "history" })
  expect(ui.state.status).toBe("1 new suggestion (i to review)")
  expect(newSuggestionsNote(3)).toBe(" · 3 new suggestions (i to review)")
})

