import { SCHEMA_VERSION } from "../db/schema"
import { expect, onTestFinished, spyOn, test } from "bun:test"
import type { JevClient, JevQuestion } from "../ai/jev"
import { deleteSuggestions, ensureSchema, loadMerchantBreadth, loadMerchantNotes, saveMerchantNote, loadSuggestions, saveSuggestions } from "../db/client"
import type { Transaction } from "../domain/types"
import { account, category, transaction } from "../testing/fixtures"
import { testDb, testEnv } from "../testing/scoped"
import { data } from "./dataStore"
import { answeringMerchants } from "../testing/merchantFake"

function setup() {
  testEnv("JASKMONEY_JEV_TOKEN", "")
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

/** A fake Jev answering every question with one pick at 0.9; `seen` gets each row's description. */
function fakeJev(onRow: (description: string) => Promise<void> | void = () => {}, categoryId = 101): Pick<JevClient, "judge"> {
  return answeringMerchants({ async judge(questions) {
    const out: Awaited<ReturnType<JevClient["judge"]>> = {}
    for (const [id, q] of Object.entries(questions)) {
      await onRow(description(q))
      out[id] = { type: "choice", choice: `c${categoryId}`, confidence: 0.5, probabilities: { [`c${categoryId}`]: 0.9 } }
    }
    return out
  } })
}
const description = (q: JevQuestion) => (q.instructions as { transaction: { description: string } }).transaction.description

test("suggestions use history before Jev and never categorise or resend ineligible rows", async () => {
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
  const ai = fakeJev((d) => {
    expect(data.state.suggestions[2]?.source).toBe("history")
    expect(loadSuggestions(db).some((s) => s.transactionId === 2)).toBe(true)
    expect(data.state.suggesting).toBe(true)
    states.push(d)
  })
  expect(await data.suggestCategories([1, 2, 3, 4, 5, 6, 7, 8], ai)).toBe("Suggested 3: 1 from history, 2 from Jev")
  expect(states.sort()).toEqual(["Default category", "Unknown"])
  expect(data.state.suggestions[3]).toEqual({ transactionId: 3, categoryId: 101, confidence: 0.9, source: "jev", ranked: [{ categoryId: 101, confidence: 0.9 }] })
  expect(data.state.transactions.find((t) => t.id === 2)?.categoryId).toBeNull()
  expect(data.state.transactions.find((t) => t.id === 3)?.categoryId).toBeNull()
  expect(data.state.suggesting).toBe(false)
  expect(await data.suggestCategories([2, 3, 7, 8], ai)).toBe("Suggested 0: 0 from history, 0 from Jev")
  expect(states).toHaveLength(2)
})

test("a second run is refused while one runs; a failed request is reported with its rows", async () => {
  const { add } = setup()
  add({ id: 1, description: "First" })
  add({ id: 2, description: "Second" })
  data.refresh()
  let release = () => {}
  const pending = new Promise<void>((resolve) => { release = resolve })
  let arrived = () => {}
  const started = new Promise<void>((resolve) => { arrived = resolve })
  const ai = answeringMerchants({ async judge() {
    arrived()
    await pending
    throw new Error("fake unavailable")
  } })
  const running = data.suggestCategories(undefined, ai)
  try {
    await started
    await expect(data.suggestCategories(undefined, ai)).rejects.toThrow("Category suggestions are already running")
  } finally { release() }
  expect(await running).toBe("Suggested 0: 0 from history, 0 from Jev · 1 failed: 2 rows: fake unavailable")
  expect(data.state.suggesting).toBe(false)
  // Asking again works, and lands every row of the request.
  expect(await data.suggestCategories(undefined, fakeJev())).toBe("Suggested 2: 0 from history, 2 from Jev")
})

test("history works without Jev and reports missing setup", async () => {
  const { add } = setup()
  for (const id of [1, 4, 5]) add({ id, description: "Shop", categoryId: 100 })
  add({ id: 2, description: "Shop" })
  add({ id: 3, description: "Unknown" })
  data.refresh()
  expect(await data.suggestCategories()).toBe("Suggested 1: 1 from history, 0 from Jev · Jev is not set up (a TypeSafe key, or OpenRouter: Settings › AI models)")
  expect(data.state.suggestions[2]?.categoryId).toBe(100)
  expect(data.state.suggestions[3]).toBeUndefined()
})

test("accept groups categories, categorises CSV rows and deletes only accepted suggestions", async () => {
  const { db, add } = setup()
  for (const id of [1, 2, 3, 4, 5]) add({ id })
  saveSuggestions(db, [1, 2, 3, 4].map((id) => ({ transactionId: id, categoryId: id === 3 ? 101 : 100, confidence: 1, source: "history" })))
  data.refresh()
  expect(await data.acceptSuggestions([1, 2, 2, 3, 5, 999])).toBe("Accepted 3 suggestions")
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
  saveSuggestions(db, [{ transactionId: 1, categoryId: c.id, confidence: 0.9, source: "jev" }, { transactionId: 2, categoryId: c.id, confidence: 1, source: "history" }])
  expect(loadSuggestions(db)).toHaveLength(2)
  expect(loadSuggestions(db)[0]).toEqual({ transactionId: 1, categoryId: 100, confidence: 0.9, source: "jev" })
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

test("fresh schema includes suggestions and v18–v19 migrate a v17 database without losing rows", () => {
  const db = testDb()
  expect(db.query("SELECT version FROM schema_meta").get()).toEqual({ version: SCHEMA_VERSION })
  expect(db.query("SELECT * FROM category_suggestions").all()).toEqual([])
  expect(db.query("SELECT pay_early FROM budget_cycle").get()).toEqual({ pay_early: 0 })
  const t = transaction({ source: "csv" })
  db.query("INSERT INTO transactions (id, date_raw, date_iso, amount, description) VALUES (?, ?, ?, ?, ?)")
    .run(t.id, t.dateRaw, t.dateISO, t.amount, t.description)
  db.exec("DROP TABLE category_suggestions; UPDATE schema_meta SET version = 17;")
  ensureSchema(db)
  expect(db.query("SELECT version FROM schema_meta").get()).toEqual({ version: SCHEMA_VERSION })
  expect(db.query("SELECT description FROM transactions WHERE id = ?").get(t.id)).toEqual({ description: t.description })
  const c = db.query<{ id: number }, []>("SELECT id FROM categories WHERE name = 'Groceries'").get()!
  const suggestion = { transactionId: t.id, categoryId: c.id, confidence: 1, source: "history" } satisfies Parameters<typeof saveSuggestions>[1][number]
  saveSuggestions(db, [suggestion])
  expect(loadSuggestions(db)).toEqual([suggestion])
})

test("v19: suggestions come from Jev; history's are kept, Clef's dropped", () => {
  const db = testDb()
  const groceries = db.query<{ id: number }, []>("SELECT id FROM categories WHERE name = 'Groceries'").get()!.id
  for (const id of [1, 2]) db.query("INSERT INTO transactions (id, date_raw, date_iso, amount, description) VALUES (?, 'x', '2026-01-01', -1, 'x')").run(id)
  db.exec(`DROP TABLE category_suggestions;
    CREATE TABLE category_suggestions (transaction_id INTEGER PRIMARY KEY REFERENCES transactions(id) ON DELETE CASCADE,
      category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE, confidence REAL NOT NULL,
      source TEXT NOT NULL CHECK(source IN ('history','clef')), created_at TEXT NOT NULL DEFAULT (datetime('now')));
    INSERT INTO category_suggestions (transaction_id, category_id, confidence, source) VALUES (1, ${groceries}, 0.75, 'history'), (2, ${groceries}, 0.5, 'clef');
    UPDATE schema_meta SET version = 18;`)
  ensureSchema(db)
  expect(db.query("SELECT version FROM schema_meta").get()).toEqual({ version: SCHEMA_VERSION })
  expect(loadSuggestions(db)).toEqual([{ transactionId: 1, categoryId: groceries, confidence: 0.75, source: "history" }])
  saveSuggestions(db, [{ transactionId: 2, categoryId: groceries, confidence: 0.9, source: "jev" }])
  expect(loadSuggestions(db)).toHaveLength(2)
})

test("a run asks about each merchant once and lowers stored suggestions a marketplace can't support", async () => {
  const { db, add } = setup()
  add({ id: 1, description: "eBay" })
  add({ id: 2, description: "eBay" })
  add({ id: 3, description: "Corner Bar" })
  saveSuggestions(db, [1, 3].map((id) => ({ transactionId: id, categoryId: 100, confidence: 1, source: "jev" as const })))
  data.refresh()
  const asked: string[] = []
  const ai: Pick<JevClient, "judge"> = { async judge(questions) {
    const out: Awaited<ReturnType<JevClient["judge"]>> = {}
    for (const [id, q] of Object.entries(questions)) {
      const merchant = (q.instructions as { merchant?: { name: string } }).merchant
      if (merchant) asked.push(merchant.name)
      out[id] = merchant ? { type: "noul", noul: merchant.name === "eBay" ? 0.95 : 0.1 } : { type: "choice", choice: "c101", confidence: 0.5, probabilities: { c101: 0.99 } }
    }
    return out
  } }
  await data.suggestCategories(undefined, ai)
  expect(asked.sort()).toEqual(["Corner Bar", "eBay"])
  expect(data.state.suggestions[1]?.confidence).toBe(0.45)
  expect(data.state.suggestions[2]?.confidence).toBe(0.45)
  expect(data.state.suggestions[3]?.confidence).toBe(1)
  expect(loadSuggestions(db).find((s) => s.transactionId === 1)?.confidence).toBe(0.45)
  asked.length = 0
  deleteSuggestions(db, [2])
  data.refresh()
  await data.suggestCategories(undefined, ai)
  expect(asked).toEqual([])
})

test("merchant notes reload, invalidate breadth, and re-suggest only that merchant's suggested waiting rows", async () => {
  const { db, add } = setup()
  add({ id: 1, description: "eBay" })
  add({ id: 2, description: " EBAY " })
  add({ id: 3, description: "Other" })
  add({ id: 4, description: "eBay", categoryId: 100 })
  add({ id: 5, description: "eBay" })
  add({ id: 6, description: "eBay" })
  saveMerchantNote(db, " Other ", "always groceries for me")
  data.refresh()
  expect(data.state.merchantNotes).toEqual({ other: "always groceries for me" })
  const asked: JevQuestion[] = []
  const suggested: JevQuestion[] = []
  let pick = 100
  const ai: Pick<JevClient, "judge"> = { async judge(questions) {
    const out: Awaited<ReturnType<JevClient["judge"]>> = {}
    for (const [id, q] of Object.entries(questions)) {
      if (typeof q.instructions === "object" && "merchant" in q.instructions) {
        asked.push(q)
        out[id] = { type: "noul", noul: 0.9 }
      } else {
        suggested.push(q)
        out[id] = { type: "choice", choice: `c${pick}`, confidence: 0.9, probabilities: { [`c${pick}`]: 0.9 } }
      }
    }
    return out
  } }
  await data.suggestCategories([1, 2, 3, 6], ai)
  data.dismissSuggestions([6])
  expect(asked).toHaveLength(2)
  await data.suggestCategories([1, 2, 3], ai)
  expect(asked).toHaveLength(2)
  pick = 101
  suggested.length = 0
  const note = "varies: phone cases, homewares, gifts"
  expect(await data.setMerchantNote(" EBAY ", ` ${note} `, ai)).toBe(2)
  expect(data.state.merchantNotes).toEqual({ ebay: note, other: "always groceries for me" })
  expect(loadMerchantNotes(db).get("ebay")).toBe(note)
  expect(asked).toHaveLength(3)
  expect(asked[2]?.instructions).toMatchObject({ merchant: { name: "eBay", note } })
  expect(suggested).toHaveLength(2)
  for (const q of suggested) expect(q.instructions).toMatchObject({ transaction: { merchant_note: note } })
  expect(data.state.suggestions[1]?.categoryId).toBe(101)
  expect(data.state.suggestions[2]?.categoryId).toBe(101)
  expect(data.state.suggestions[3]?.categoryId).toBe(100)
  expect(data.state.suggestions[5]).toBeUndefined()
  expect(data.state.suggestions[6]).toBeUndefined()
  expect(await data.setMerchantNote("eBay", "always groceries for me", ai)).toBe(2)
  expect(asked).toHaveLength(4)
  suggested.length = 0
  expect(await data.setMerchantNote("eBay", "  ", ai)).toBe(2)
  expect(asked).toHaveLength(5)
  expect(JSON.stringify(asked[4])).not.toContain('"note"')
  expect(JSON.stringify(suggested)).not.toContain("merchant_note")
  expect(data.state.merchantNotes).toEqual({ other: "always groceries for me" })
  expect(loadMerchantNotes(db).has("ebay")).toBe(false)
  // Without Jev, save and clear the breadth cache but leave suggestions alone.
  expect(await data.setMerchantNote("eBay", note)).toBe(0)
  expect(loadMerchantBreadth(db).has("ebay")).toBe(false)
  expect(data.state.merchantNotes.ebay).toBe(note)
  expect(data.state.suggestions[1]?.categoryId).toBe(101)
})

test("setting a merchant note waits for a suggestion pass before invalidating its breadth", async () => {
  const { db, add } = setup()
  add({ id: 1, description: "eBay" })
  data.refresh()
  let release = () => {}
  const gate = new Promise<void>((resolve) => { release = resolve })
  let arrive = () => {}
  const started = new Promise<void>((resolve) => { arrive = resolve })
  const running = data.suggestCategories(undefined, { async judge(questions) {
    arrive()
    await gate
    return Object.fromEntries(Object.entries(questions).map(([id, q]) => [id, q.type === "noul"
      ? { type: "noul", noul: 0.9 }
      : { type: "choice", choice: "c100", confidence: 0.9, probabilities: { c100: 0.9 } }]))
  } })
  await started
  const seen: JevQuestion[] = []
  const ai = fakeJev()
  const later = data.setMerchantNote("eBay", "always groceries for me", { async judge(questions, state) {
    seen.push(...Object.values(questions))
    return ai.judge(questions, state)
  } })
  release()
  await running
  expect(await later).toBe(1)
  expect(loadMerchantBreadth(db).has("ebay")).toBe(true)
  expect(seen.filter((q) => typeof q.instructions === "object" && "merchant" in q.instructions)).toEqual([
    expect.objectContaining({ instructions: expect.objectContaining({ merchant: { name: "eBay", note: "always groceries for me" } }) }),
  ])
  expect(data.state.suggestions[1]?.categoryId).toBe(101)
  expect(data.state.suggesting).toBe(false)
})


test("a database swap reloads merchant notes and cancels a note change waiting for suggestions", async () => {
  const { db, add } = setup()
  add({ id: 1, description: "eBay" })
  saveMerchantNote(db, "eBay", "original note")
  data.refresh()
  let release = () => {}
  const gate = new Promise<void>((resolve) => { release = resolve })
  let arrive = () => {}
  const started = new Promise<void>((resolve) => { arrive = resolve })
  const running = data.suggestCategories(undefined, fakeJev(async () => {
    arrive()
    await gate
  }))
  await started
  const later = data.setMerchantNote("eBay", "replacement note", fakeJev())
  try {
    data.init(":memory:")
    const next = data.getDb()!
    onTestFinished(() => next.close())
    expect(data.state.merchantNotes).toEqual({})
    expect(data.state.suggestions).toEqual({})
  } finally { release() }
  await running
  expect(await later).toBe(0)
  expect(loadMerchantNotes(db).get("ebay")).toBe("original note")
  expect(data.state.merchantNotes).toEqual({})
  saveMerchantNote(data.getDb()!, "Cafe", "new database note")
  data.refresh()
  expect(data.state.merchantNotes).toEqual({ cafe: "new database note" })
})
