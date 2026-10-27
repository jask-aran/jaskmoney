import { expect, spyOn, test } from "bun:test"
import { data } from "./dataStore"
import { syncCategoryTree, assignProviderCategories } from "../up/categories"
import { testEnv } from "../testing/scoped"

test("categorising pushes Up subcategories and decategorisation, keeps local-only choices local, and survives sync", async () => {
  const fetchMock = spyOn(globalThis, "fetch")
  data.init(":memory:")
  const db = data.getDb()!
  try {
    testEnv("JASKMONEY_UP_TOKEN", "test-pat")
    db.transaction(() => syncCategoryTree(db, [
      { id: "home", name: "Home", parentId: null },
      { id: "groceries", name: "Groceries", parentId: "home" },
    ]))()
    const account = Number(db.query(`INSERT INTO accounts (name, source, external_id, external_kind) VALUES ('Spending', 'up', 'acc', 'TRANSACTIONAL')`).run().lastInsertRowid)
    const add = (ext: string, categorizable: number) => Number(db.query(`INSERT INTO transactions
      (date_raw, date_iso, amount, description, account_id, source, external_id, ext_categorizable)
      VALUES ('x', '2026-10-01', -5, ?, ?, 'up', ?, ?)`).run(ext, account, ext, categorizable).lastInsertRowid)
    const [a, b, c, d] = [add("a", 1), add("b", 1), add("transfer", 0), add("fails", 1)]
    assignProviderCategories(db) // as sync would: uncategorised rows get the default
    data.refresh()
    const id = (name: string) => data.state.categories.find((x) => x.name === name)!.id
    const calls: Array<{ url: string; method: string; body: string }> = []
    fetchMock.mockImplementation(Object.assign(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, method: init?.method ?? "GET", body: String(init?.body ?? "") })
      if (url.includes("/fails/")) return new Response(JSON.stringify({ errors: [{ status: "422", title: "Nope", detail: "rejected" }] }), { status: 422 })
      return new Response(null, { status: 204 })
    }, { preconnect: globalThis.fetch.preconnect }))
    const row = (txn: number) => db.query(`SELECT category_id AS categoryId, category_source AS source, ext_category AS ext FROM transactions WHERE id = ?`).get(txn)

    // Up subcategory → PATCH, then follows the provider.
    expect(await data.categorizeTransactions([a, c], id("Groceries"))).toBe("Categorized 2 → Groceries · 1 updated in Up")
    expect(calls).toEqual([{ url: "https://api.up.com.au/api/v1/transactions/a/relationships/category", method: "PATCH", body: '{"data":{"type":"categories","id":"groceries"}}' }])
    expect(row(a)).toEqual({ categoryId: id("Groceries"), source: "provider", ext: "groceries" })
    // A transfer Up cannot categorise stays local.
    expect(row(c)).toEqual({ categoryId: id("Groceries"), source: "user", ext: null })

    // Uncategorised → clear the category in Up.
    calls.length = 0
    await data.categorizeTransactions([a], id("Uncategorised"))
    expect(calls[0]!.body).toBe('{"data":null}')
    expect(row(a)).toEqual({ categoryId: id("Uncategorised"), source: null, ext: null })

    // A local-only category never calls Up.
    calls.length = 0
    await data.categorizeTransactions([b], id("People"))
    expect(calls).toEqual([])
    expect(row(b)).toEqual({ categoryId: id("People"), source: "user", ext: null })

    // A rejected push leaves the transaction unchanged and reports the error.
    const before = row(d)
    expect(await data.categorizeTransactions([d], id("Groceries"))).toBe("Categorized 0 → Groceries · 1 failed: Up API request failed (422): Nope: rejected")
    expect(row(d)).toEqual(before)

    // Sync's backfill keeps local choices and agrees with pushed ones.
    expect(assignProviderCategories(db)).toBe(0)
  } finally {
    fetchMock.mockRestore()
    db.close()
  }
})

test("every row takes its category before Up hears; pushes overlap; a rejected one is put back", async () => {
  const fetchMock = spyOn(globalThis, "fetch")
  data.init(":memory:")
  const db = data.getDb()!
  try {
    testEnv("JASKMONEY_UP_TOKEN", "test-pat")
    db.transaction(() => syncCategoryTree(db, [
      { id: "home", name: "Home", parentId: null },
      { id: "groceries", name: "Groceries", parentId: "home" },
    ]))()
    const account = Number(db.query(`INSERT INTO accounts (name, source, external_id, external_kind) VALUES ('Spending', 'up', 'acc', 'TRANSACTIONAL')`).run().lastInsertRowid)
    const ids = ["r1", "r2", "r3", "r4", "r5", "bad"].map((ext) => Number(db.query(`INSERT INTO transactions
      (date_raw, date_iso, amount, description, account_id, source, external_id, ext_categorizable)
      VALUES ('x', '2026-10-01', -5, ?, ?, 'up', ?, 1)`).run(ext, account, ext).lastInsertRowid))
    assignProviderCategories(db)
    data.refresh()
    const groceries = data.state.categories.find((c) => c.name === "Groceries")!.id
    const uncategorised = data.state.categories.find((c) => c.isDefault)!.id
    // Requests wait until released, so the test sees them in flight together.
    let inFlight = 0, most = 0
    const waiting: Array<() => void> = []
    fetchMock.mockImplementation(Object.assign(async (input: Parameters<typeof fetch>[0]) => {
      inFlight++; most = Math.max(most, inFlight)
      await new Promise<void>((resolve) => waiting.push(resolve))
      inFlight--
      if (String(input).includes("/bad/")) return new Response(JSON.stringify({ errors: [{ status: "422", title: "Nope", detail: "rejected" }] }), { status: 422 })
      return new Response(null, { status: 204 })
    }, { preconnect: globalThis.fetch.preconnect }))
    const row = (id: number) => db.query(`SELECT category_id AS categoryId, category_source AS source, ext_category AS ext FROM transactions WHERE id = ?`).get(id)
    const before = row(ids[5]!)
    const progress: string[] = []
    const pending = data.categorizeTransactions(ids, groceries, (pushed, total) => progress.push(`${pushed}/${total}`))
    // Shown at once, before any request is answered.
    expect(ids.every((id) => data.state.transactions.find((t) => t.id === id)?.categoryId === groceries)).toBe(true)
    expect(progress).toEqual(["0/6"])
    while (progress.length < 7) { await new Promise((r) => setTimeout(r, 0)); waiting.splice(0).forEach((release) => release()) }
    expect(await pending).toBe("Categorized 5 → Groceries · 5 updated in Up · 1 failed: Up API request failed (422): Nope: rejected")
    expect(most).toBe(4)
    expect(progress.at(-1)).toBe("6/6")
    // The rejected row is as it was; the others follow Up.
    expect(row(ids[5]!)).toEqual(before)
    expect(row(ids[0]!)).toEqual({ categoryId: groceries, source: "provider", ext: "groceries" })
    expect(data.state.transactions.find((t) => t.id === ids[5])?.categoryId).toBe(uncategorised)
  } finally {
    fetchMock.mockRestore()
  }
})

test("a categorisation Up didn't answer stays, marked pending, and goes again after the next sync; one Up refuses then stays here only", async () => {
  const fetchMock = spyOn(globalThis, "fetch")
  data.init(":memory:")
  const db = data.getDb()!
  try {
    testEnv("JASKMONEY_UP_TOKEN", "test-pat")
    db.transaction(() => syncCategoryTree(db, [
      { id: "home", name: "Home", parentId: null },
      { id: "groceries", name: "Groceries", parentId: "home" },
    ]))()
    const account = Number(db.query(`INSERT INTO accounts (name, source, external_id, external_kind) VALUES ('Spending', 'up', 'acc', 'TRANSACTIONAL')`).run().lastInsertRowid)
    const add = (ext: string) => Number(db.query(`INSERT INTO transactions
      (date_raw, date_iso, amount, description, account_id, source, external_id, ext_categorizable)
      VALUES ('x', '2026-10-01', -5, ?, ?, 'up', ?, 1)`).run(ext, account, ext).lastInsertRowid)
    const [a, refused, local] = [add("a"), add("refused"), add("local")]
    assignProviderCategories(db)
    data.refresh()
    const id = (name: string) => data.state.categories.find((x) => x.name === name)!.id
    const row = (txn: number) => db.query(`SELECT category_id AS categoryId, category_source AS source, ext_category AS ext FROM transactions WHERE id = ?`).get(txn)
    let upDown = true
    const calls: string[] = []
    fetchMock.mockImplementation(Object.assign(async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input)
      calls.push(url)
      if (upDown) return new Response("down", { status: 503 })
      if (url.includes("/refused/")) return new Response(JSON.stringify({ errors: [{ status: "422", title: "Nope", detail: "rejected" }] }), { status: 422 })
      return new Response(null, { status: 204 })
    }, { preconnect: globalThis.fetch.preconnect }))

    // Up is down: the rows keep their new category, waiting.
    expect(await data.categorizeTransactions([a, refused], id("Groceries"))).toStartWith("Categorized 2 → Groceries · 2 waiting for Up (sent on the next sync): ")
    expect(row(a)).toEqual({ categoryId: id("Groceries"), source: "pending", ext: null })
    // A retry while Up is still down keeps them waiting.
    expect(await data.retryPendingCategories()).toEqual({ pushed: 0, rejected: 0, waiting: 2 })
    expect(row(a)).toMatchObject({ source: "pending" })
    // Sync keeps a pending row's category (it doesn't follow Up's yet).
    expect(assignProviderCategories(db)).toBe(0)
    // A pending row whose category became local-only can't go to Up: it's the user's now.
    db.query("UPDATE transactions SET category_id = ?, category_source = 'pending' WHERE id = ?").run(id("People"), local)

    upDown = false
    calls.length = 0
    expect(await data.retryPendingCategories()).toEqual({ pushed: 1, rejected: 1, waiting: 0 })
    expect(calls.some((u) => u.includes("/local/"))).toBe(false)
    expect(row(a)).toEqual({ categoryId: id("Groceries"), source: "provider", ext: "groceries" })
    expect(row(refused)).toEqual({ categoryId: id("Groceries"), source: "user", ext: null })
    expect(row(local)).toMatchObject({ categoryId: id("People"), source: "user" })
    // Nothing left to send.
    calls.length = 0
    expect(await data.retryPendingCategories()).toEqual({ pushed: 0, rejected: 0, waiting: 0 })
    expect(calls).toEqual([])
  } finally {
    fetchMock.mockRestore()
  }
})
