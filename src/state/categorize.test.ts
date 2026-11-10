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
    assignProviderCategories(db)
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

    expect(await data.categorizeTransactions([a, c], id("Groceries"))).toContain("1 updated in Up")
    expect(calls).toEqual([{ url: "https://api.up.com.au/api/v1/transactions/a/relationships/category", method: "PATCH", body: '{"data":{"type":"categories","id":"groceries"}}' }])
    expect(row(a)).toEqual({ categoryId: id("Groceries"), source: "provider", ext: "groceries" })
    expect(row(c)).toEqual({ categoryId: id("Groceries"), source: "user", ext: null })

    calls.length = 0
    await data.categorizeTransactions([a], id("Uncategorised"))
    expect(calls[0]!.body).toBe('{"data":null}')
    expect(row(a)).toEqual({ categoryId: id("Uncategorised"), source: null, ext: null })

    calls.length = 0
    await data.categorizeTransactions([b], id("People"))
    expect(calls).toEqual([])
    expect(row(b)).toEqual({ categoryId: id("People"), source: "user", ext: null })

    const before = row(d)
    expect(await data.categorizeTransactions([d], id("Groceries"))).toContain("1 failed")
    expect(row(d)).toEqual(before)

    expect(assignProviderCategories(db)).toBe(0)
  } finally {
    fetchMock.mockRestore()
    db.close()
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

    expect(await data.categorizeTransactions([a, refused], id("Groceries"))).toContain("2 waiting for Up")
    expect(row(a)).toEqual({ categoryId: id("Groceries"), source: "pending", ext: null })
    expect(await data.retryPendingCategories()).toEqual({ pushed: 0, rejected: 0, waiting: 2 })
    expect(row(a)).toMatchObject({ source: "pending" })
    expect(assignProviderCategories(db)).toBe(0)
    db.query("UPDATE transactions SET category_id = ?, category_source = 'pending' WHERE id = ?").run(id("People"), local)

    upDown = false
    calls.length = 0
    expect(await data.retryPendingCategories()).toEqual({ pushed: 1, rejected: 1, waiting: 0 })
    expect(calls.some((u) => u.includes("/local/"))).toBe(false)
    expect(row(a)).toEqual({ categoryId: id("Groceries"), source: "provider", ext: "groceries" })
    expect(row(refused)).toEqual({ categoryId: id("Groceries"), source: "user", ext: null })
    expect(row(local)).toMatchObject({ categoryId: id("People"), source: "user" })
    calls.length = 0
    expect(await data.retryPendingCategories()).toEqual({ pushed: 0, rejected: 0, waiting: 0 })
    expect(calls).toEqual([])
  } finally {
    fetchMock.mockRestore()
  }
})
