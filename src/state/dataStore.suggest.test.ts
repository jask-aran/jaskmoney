import { expect, onTestFinished, spyOn, test } from "bun:test"
import type { WorkersAiClient } from "../ai/workersAi"
import { deleteSuggestions, ensureSchema, loadSuggestions, saveSuggestions } from "../db/client"
import type { Transaction } from "../domain/types"
import { account, category, transaction } from "../testing/fixtures"
import { testDb, testEnv } from "../testing/scoped"
import { data } from "./dataStore"

function setup() {
  testEnv("JASKMONEY_CF_TOKEN", "")
  testEnv("JASKMONEY_CF_ACCOUNT_ID", "")
  const network = spyOn(globalThis, "fetch").mockImplementation(Object.assign(() => { throw new Error("network is forbidden") }, { preconnect: globalThis.fetch.preconnect }))
  onTestFinished(() => {
    try { expect(network).not.toHaveBeenCalled() } finally { network.mockRestore() }
  })
  data.init(":memory:")
  const db = data.getDb()!
  onTestFinished(() => db.close())
  const a = account({ id: 100, name: "Spending", source: "csv" })
  db.query("INSERT INTO accounts (id, name, type, source) VALUES (?, ?, ?, ?)").run(a.id, a.name, a.type, a.source)
  for (const c of [category({ id: 100, name: "Test food" }), category({ id: 101, name: "Test travel" })]) {
    db.query("INSERT INTO categories (id, name, color) VALUES (?, ?, ?)").run(c.id, c.name, c.color)
  }
  function add(overrides: Partial<Transaction> = {}) {
    const t = transaction({ source: "csv", accountId: a.id, ...overrides })
    db.query(`INSERT INTO transactions (id, date_raw, date_iso, amount, description, category_id, account_id, source, transaction_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(t.id, t.dateRaw, t.dateISO, t.amount, t.description, t.categoryId, t.accountId, t.source, t.transactionType)
    return t.id
  }
  return { db, add }
}

const answer = (categoryId = 101): Awaited<ReturnType<WorkersAiClient["clef"]>> => ({
  category: { type: "choice", choice: `c${categoryId}`, confidence: 0.9, probabilities: {} },
})

test("suggestions use history before Clef and never categorise or resend ineligible rows", async () => {
  const { db, add } = setup()
  add({ id: 1, description: "Shop", categoryId: 100 })
  add({ id: 2, description: " SHOP " })
  add({ id: 3, description: "Unknown", transactionType: "Purchase" })
  add({ id: 10, description: "Shop", categoryId: 100 })
  add({ id: 11, description: "Shop", categoryId: 100 })
  add({ id: 4, description: "Categorised", categoryId: 101 })
  add({ id: 5, description: "Excluded", categoryId: data.state.categories.find((c) => c.name === "Transfers")!.id })
  add({ id: 6, description: "Ignored" })
  db.query("INSERT INTO transaction_tags (transaction_id, tag_id) SELECT 6, id FROM tags WHERE name = 'IGNORE'").run()
  add({ id: 7, description: "Already suggested" })
  saveSuggestions(db, [{ transactionId: 7, categoryId: 100, source: "history", confidence: 1 }])
  const defaultId = data.state.categories.find((c) => c.isDefault)!.id
  add({ id: 8, description: "Default category", categoryId: defaultId })
  add({ id: 9, description: "Outside targets" })
  data.refresh()
  const states: string[] = []
  const ai: Pick<WorkersAiClient, "clef"> = { async clef(_questions, state) {
    expect(data.state.suggestions[2]?.source).toBe("history")
    expect(loadSuggestions(db).some((s) => s.transactionId === 2)).toBe(true)
    expect(data.state.suggesting).toBe(true)
    states.push(state)
    return answer()
  } }
  expect(await data.suggestCategories([1, 2, 3, 4, 5, 6, 7, 8], ai)).toBe("Suggested 3: 1 from history, 2 from Clef")
  expect(states).toHaveLength(2)
  expect(states.some((s) => s.startsWith("Description: Unknown\n") && s.includes("Type: Purchase"))).toBe(true)
  expect(states.some((s) => s.startsWith("Description: Default category\n"))).toBe(true)
  expect(data.state.suggestions[3]).toEqual({ transactionId: 3, categoryId: 101, confidence: 0.9, source: "clef" })
  expect(data.state.transactions.find((t) => t.id === 2)?.categoryId).toBeNull()
  expect(data.state.transactions.find((t) => t.id === 3)?.categoryId).toBeNull()
  expect(data.state.suggesting).toBe(false)
  expect(await data.suggestCategories([2, 3, 7, 8], ai)).toBe("Suggested 0: 0 from history, 0 from Clef")
  expect(states).toHaveLength(2)
})

test("suggestions persist progressively, reject a second run, and report AI failures", async () => {
  const { db, add } = setup()
  add({ id: 1, description: "First" })
  add({ id: 2, description: "Second" })
  add({ id: 3, description: "Fails" })
  data.refresh()
  let release = () => {}
  const pending = new Promise<void>((resolve) => { release = resolve })
  let arrived = () => {}
  const started = new Promise<void>((resolve) => { arrived = resolve })
  const ai: Pick<WorkersAiClient, "clef"> = { async clef(_questions, state) {
    if (state.startsWith("Description: First\n")) return answer()
    if (state.startsWith("Description: Fails\n")) throw new Error("fake unavailable")
    arrived()
    await pending
    expect(data.state.suggestions[1]?.source).toBe("clef")
    expect(loadSuggestions(db).some((s) => s.transactionId === 1)).toBe(true)
    return answer()
  } }
  const running = data.suggestCategories(undefined, ai)
  try {
    await started
    await expect(data.suggestCategories(undefined, ai)).rejects.toThrow("Category suggestions are already running")
  } finally { release() }
  expect(await running).toBe("Suggested 2: 0 from history, 2 from Clef · 1 failed: fake unavailable")
  expect(data.state.suggesting).toBe(false)
})

test("history works without Workers AI and reports missing setup", async () => {
  const { add } = setup()
  for (const id of [1, 4, 5]) add({ id, description: "Shop", categoryId: 100 })
  add({ id: 2, description: "Shop" })
  add({ id: 3, description: "Unknown" })
  data.refresh()
  expect(await data.suggestCategories()).toBe("Suggested 1: 1 from history, 0 from Clef · Workers AI is not set up")
  expect(data.state.suggestions[2]?.categoryId).toBe(100)
  expect(data.state.suggestions[3]).toBeUndefined()
})

test("accept groups categories, categorises CSV rows and deletes only accepted suggestions", async () => {
  const { db, add } = setup()
  for (const id of [1, 2, 3, 4, 5]) add({ id })
  saveSuggestions(db, [1, 2, 3, 4].map((id) => ({ transactionId: id, categoryId: id === 3 ? 101 : 100, confidence: 1, source: "history" })))
  data.refresh()
  expect(await data.acceptSuggestions([1, 2, 2, 3, 5, 999])).toBe("Categorized 2 → Test food · Categorized 1 → Test travel")
  expect(data.state.transactions.filter((t) => [1, 2].includes(t.id)).every((t) => t.categoryId === 100)).toBe(true)
  expect(data.state.transactions.find((t) => t.id === 3)?.categoryId).toBe(101)
  expect(Object.keys(data.state.suggestions)).toEqual(["4"])
  expect(loadSuggestions(db).map((s) => s.transactionId)).toEqual([4])
  expect(db.query("SELECT transaction_id FROM category_suggestions ORDER BY transaction_id").all()).toEqual([{ transaction_id: 4 }])
  expect(data.state.transactions.find((t) => t.id === 5)?.categoryId).toBeNull()
  expect(await data.acceptSuggestions([999])).toBe("No suggestions accepted")
})

test("dismiss deletes suggestions without setting a category; refresh removes stale suggestions", async () => {
  const { db, add } = setup()
  for (const id of [1, 2, 3]) add({ id })
  saveSuggestions(db, [1, 2, 3].map((id) => ({ transactionId: id, categoryId: 100, confidence: 1, source: "history" })))
  data.refresh()
  data.dismissSuggestions([1, 999])
  expect(data.state.suggestions[1]).toBeUndefined()
  expect(data.state.transactions.find((t) => t.id === 1)?.categoryId).toBeNull()
  db.query("UPDATE transactions SET category_id = 101 WHERE id = 2").run()
  data.refresh()
  expect(Object.keys(data.state.suggestions)).toEqual(["3"])
  expect(loadSuggestions(db).map((s) => s.transactionId)).toEqual([3])
  expect(await data.acceptSuggestions([2])).toBe("No suggestions accepted")
  expect(data.state.transactions.find((t) => t.id === 2)?.categoryId).toBe(101)
})

test("storage upserts suggestions, filters default categories, and cascades deletion", () => {
  const db = testDb()
  const defaultId = db.query<{ id: number }, []>("SELECT id FROM categories WHERE is_default = 1").get()!.id
  const c = category({ id: 100, name: "Test category" })
  db.query("INSERT INTO categories (id, name, color) VALUES (?, ?, ?)").run(c.id, c.name, c.color)
  for (const id of [1, 2]) db.query("INSERT INTO transactions (id, date_raw, date_iso, amount, description, category_id) VALUES (?, 'x', '2026-01-01', -1, 'x', ?)").run(id, defaultId)
  saveSuggestions(db, [{ transactionId: 1, categoryId: c.id, confidence: 0.5, source: "history" }])
  saveSuggestions(db, [{ transactionId: 1, categoryId: c.id, confidence: 0.9, source: "clef" }, { transactionId: 2, categoryId: c.id, confidence: 1, source: "history" }])
  expect(loadSuggestions(db)).toHaveLength(2)
  expect(loadSuggestions(db)[0]).toEqual({ transactionId: 1, categoryId: 100, confidence: 0.9, source: "clef" })
  deleteSuggestions(db, [])
  db.query("DELETE FROM transactions WHERE id = ?").run(1)
  expect(loadSuggestions(db).map((s) => s.transactionId)).toEqual([2])
  db.query("DELETE FROM categories WHERE id = ?").run(c.id)
  expect(loadSuggestions(db)).toEqual([])
})


test("suggesting clears even when the database write and final refresh fail", async () => {
  const { db, add } = setup()
  add()
  data.refresh()
  const queryMock = spyOn(db, "query").mockImplementation(() => { throw new Error("test database failure") })
  try {
    await expect(data.suggestCategories()).rejects.toThrow("test database failure")
    expect(data.state.suggesting).toBe(false)
  } finally { queryMock.mockRestore() }
})

test("fresh schema includes suggestions and v18 migrates a v17 database without losing rows", () => {
  const db = testDb()
  expect(db.query("SELECT version FROM schema_meta").get()).toEqual({ version: 18 })
  expect(db.query("SELECT * FROM category_suggestions").all()).toEqual([])
  expect(db.query("SELECT pay_early FROM budget_cycle").get()).toEqual({ pay_early: 0 })
  const t = transaction({ source: "csv" })
  db.query("INSERT INTO transactions (id, date_raw, date_iso, amount, description) VALUES (?, ?, ?, ?, ?)")
    .run(t.id, t.dateRaw, t.dateISO, t.amount, t.description)
  db.exec("DROP TABLE category_suggestions; UPDATE schema_meta SET version = 17;")
  ensureSchema(db)
  expect(db.query("SELECT version FROM schema_meta").get()).toEqual({ version: 18 })
  expect(db.query("SELECT description FROM transactions WHERE id = ?").get(t.id)).toEqual({ description: t.description })
  const c = db.query<{ id: number }, []>("SELECT id FROM categories WHERE name = 'Groceries'").get()!
  const suggestion = { transactionId: t.id, categoryId: c.id, confidence: 1, source: "history" } satisfies Parameters<typeof saveSuggestions>[1][number]
  saveSuggestions(db, [suggestion])
  expect(loadSuggestions(db)).toEqual([suggestion])
})
