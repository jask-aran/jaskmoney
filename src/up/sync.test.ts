import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { createCategory, createTag, loadAccounts, loadTransactions, openDb, setAccountSyncEnabled, type Db } from "../db/client"
import { createUpClient } from "./client"
import { syncUp } from "./sync"
import { data } from "../state/dataStore"
import type { UpAccount, UpPage, UpTransaction } from "./types"

const now = new Date("2026-03-01T00:00:00Z")
const money = (cents: number) => ({ currencyCode: "AUD", value: (cents / 100).toFixed(2), valueInBaseUnits: cents })
function account(id = "daily", displayName = "Daily", accountType: UpAccount["attributes"]["accountType"] = "TRANSACTIONAL"): UpAccount {
  return { type: "accounts", id, attributes: { displayName, accountType, ownershipType: "INDIVIDUAL", balance: money(12345), createdAt: "2026-01-01T00:00:00+11:00" } }
}
function txn(id = "t", status: UpTransaction["attributes"]["status"] = "HELD", createdAt = "2026-02-01T23:30:00+11:00", accountId = "daily"): UpTransaction {
  return { type: "transactions", id, attributes: { status, rawText: "RAW", description: "Merchant", message: "memo", amount: money(-1056), foreignAmount: null, createdAt, settledAt: status === "SETTLED" ? "2026-02-02T10:00:00+11:00" : null, transactionType: null }, relationships: {
    account: { data: { type: "accounts", id: accountId } }, transferAccount: { data: { type: "accounts", id: "saver" } },
    category: { data: { type: "categories", id: "groceries" } }, parentCategory: { data: { type: "categories", id: "good-life" } }, tags: { data: [{ type: "tags", id: "up-tag" }] },
  } }
}
function response<T>(data: T[], next: string | null = null) { return Response.json({ data, links: { prev: null, next } } satisfies UpPage<T>) }
function client(transactions: UpTransaction[], accounts = [account(), account("saver", "Savings", "SAVER")], sinceValues: Array<string | undefined> = [], requests: URL[] = []) {
  return createUpClient({ token: "test-pat", fetch: async input => {
    const url = new URL(String(input))
    if (url.pathname.endsWith("/accounts")) return response(accounts)
    requests.push(url)
    const accountId = decodeURIComponent(url.pathname.split("/").at(-2) ?? "")
    expect(url.pathname).toBe(`/api/v1/accounts/${encodeURIComponent(accountId)}/transactions`)
    sinceValues.push(url.searchParams.get("filter[since]") ?? undefined)
    return response(transactions.filter(t => t.relationships.account.data.id === accountId))
  } })
}
const databases: Db[] = []
function database() { const db = openDb(":memory:"); databases.push(db); return db }
afterEach(() => { for (const db of databases.splice(0)) db.close() })

describe("Up sync", () => {
  test("first sync maps accounts, balances, local date, cents, transfer, and external fields", async () => {
    const db = database(), since: Array<string | undefined> = []
    const result = await syncUp(db, client([txn()], undefined, since), { now })
    expect(result).toEqual({ accounts: 2, inserted: 1, updated: 0, removedHeld: 0, insertedIds: [expect.any(Number)] })
    expect(since).toEqual([undefined, undefined])
    const daily = loadAccounts(db).find(a => a.name === "Daily")
    const saver = loadAccounts(db).find(a => a.name === "Savings")
    expect(daily).toMatchObject({ type: "debit", source: "up", externalKind: "TRANSACTIONAL", balance: 123.45, isActive: true, syncEnabled: true })
    const row = db.query("SELECT * FROM transactions").get()
    expect(row).toMatchObject({ id: result.insertedIds[0], source: "up", external_id: "t", status: "HELD", date_raw: "2026-02-01T23:30:00+11:00", date_iso: "2026-02-01", amount: -10.56, description: "Merchant", notes: "", import_id: null, account_id: daily?.id, transfer_account_id: saver?.id, external_created_at: "2026-02-01T23:30:00+11:00", settled_at: null, raw_text: "RAW", message: "memo", ext_category: "groceries", ext_parent_category: "good-life", ext_tags: '["up-tag"]' })
    expect(loadTransactions(db)[0]?.categoryName).toBe("Uncategorised")
    expect(db.query("SELECT balance_at FROM accounts WHERE source = 'up'").all()).toEqual([{ balance_at: now.toISOString() }, { balance_at: now.toISOString() }])
    expect(db.query("SELECT * FROM sync_state").get()).toEqual({ source: "up", last_synced_at: now.toISOString(), last_error: null })
    expect((await syncUp(db, client([txn()]), { now })).updated).toBe(0)
  })

  test("HELD becomes SETTLED in place and preserves user category, note, and tag", async () => {
    const db = database()
    const first = await syncUp(db, client([txn()]), { now })
    const category = createCategory(db, { name: "User", color: "#ffffff" })
    const tag = createTag(db, { name: "User", color: "#ffffff", categoryId: null })
    db.query("UPDATE transactions SET category_id = ?, notes = 'keep' WHERE id = ?").run(category, first.insertedIds[0]!)
    db.query("INSERT INTO transaction_tags VALUES (?, ?)").run(first.insertedIds[0]!, tag)
    const settled = txn("t", "SETTLED")
    settled.attributes.amount = money(-1200)
    settled.attributes.description = "Final merchant"
    settled.attributes.rawText = null
    settled.attributes.message = null
    settled.relationships.transferAccount.data = { type: "accounts", id: "unknown" }
    settled.relationships.category.data = null
    settled.relationships.parentCategory.data = null
    settled.relationships.tags.data = []
    expect(await syncUp(db, client([settled]), { now })).toMatchObject({ inserted: 0, updated: 1, insertedIds: [] })
    expect(loadTransactions(db)[0]).toMatchObject({ id: first.insertedIds[0], status: "SETTLED", categoryId: category, notes: "keep", tagIds: [tag], amount: -12, description: "Final merchant", transferAccountId: null, internal: false })
    expect(db.query("SELECT settled_at, raw_text, message, ext_category, ext_parent_category, ext_tags FROM transactions").get()).toEqual({ settled_at: settled.attributes.settledAt, raw_text: null, message: null, ext_category: null, ext_parent_category: null, ext_tags: "[]" })
    expect((await syncUp(db, client([settled]), { now })).updated).toBe(0)
  })

  test("vanished HELD is removed with tags; vanished SETTLED and CSV rows survive", async () => {
    const db = database()
    const first = await syncUp(db, client([txn("hold"), txn("settled", "SETTLED")]), { now })
    db.query("INSERT INTO transaction_tags SELECT ?, id FROM tags LIMIT 1").run(first.insertedIds[0]!)
    db.query("INSERT INTO transactions (date_raw, date_iso, amount, description, status) VALUES ('2026-01-01', '2026-01-01', 1, 'CSV', 'HELD')").run()
    expect((await syncUp(db, client([]), { now })).removedHeld).toBe(1)
    expect(db.query("SELECT external_id, source FROM transactions ORDER BY id").all()).toEqual([{ external_id: "settled", source: "up" }, { external_id: null, source: "csv" }])
    expect(db.query("SELECT * FROM transaction_tags").all()).toEqual([])
  })

  test("incremental window uses instants for newest and oldest HELD across offsets", async () => {
    const db = database(), since: Array<string | undefined> = []
    const rows = [txn("a", "SETTLED", "2026-04-05T02:50:00+11:00"), txn("b", "SETTLED", "2026-04-05T02:10:00+10:00")]
    await syncUp(db, client(rows), { now })
    await syncUp(db, client(rows, undefined, since), { now })
    expect(since.splice(0)).toEqual(["2026-03-21T16:10:00.000Z", undefined])
    const holds = [txn("c", "HELD", "2026-03-01T02:10:00+10:00"), txn("d", "HELD", "2026-03-01T02:50:00+11:00")]
    await syncUp(db, client([...rows, ...holds]), { now })
    await syncUp(db, client([...rows, ...holds], undefined, since), { now })
    expect(since).toEqual(["2026-02-28T15:50:00.000Z", undefined])
  })

  test("mid-pagination failure writes only last_error and preserves last successful timestamp", async () => {
    const db = database()
    await syncUp(db, client([txn()]), { now })
    const beforeAccounts = db.query("SELECT * FROM accounts").all()
    const beforeTransactions = db.query("SELECT * FROM transactions").all()
    let pages = 0
    const failing = createUpClient({ token: "test-pat", fetch: async input => {
      if (new URL(String(input)).pathname.endsWith("/accounts")) return response([account("new", "New")])
      if (++pages === 1) return response([txn("new")], "https://api.up.com.au/api/v1/accounts/new/transactions?page[after]=new")
      return Response.json({ errors: [{ title: "Unavailable", detail: "Try later" }] }, { status: 503 })
    } })
    await expect(syncUp(db, failing, { now: new Date("2026-04-01") })).rejects.toThrow("Unavailable: Try later")
    expect(db.query("SELECT * FROM accounts").all()).toEqual(beforeAccounts)
    expect(db.query("SELECT * FROM transactions").all()).toEqual(beforeTransactions)
    expect(db.query("SELECT * FROM sync_state").get()).toEqual({ source: "up", last_synced_at: now.toISOString(), last_error: "Up API request failed (503): Unavailable: Try later" })
    await syncUp(db, client([txn()]), { now })
    expect(db.query("SELECT last_error FROM sync_state").get()).toEqual({ last_error: null })
  })

  test("disabled account skips requests and preserves rows and flag while metadata and transfer links update", async () => {
    const db = database()
    await syncUp(db, client([txn("disabled-held", "HELD", undefined, "saver"), txn("disabled-settled", "SETTLED", undefined, "saver")]), { now })
    // Retain rows deliberately to prove sync does not alter disabled account data.
    db.query("UPDATE accounts SET sync_enabled = 0 WHERE external_id = 'saver'").run()
    const before = db.query("SELECT * FROM transactions").all()
    const saver = db.query<{ id: number }, []>("SELECT id FROM accounts WHERE external_id = 'saver'").get()!
    const renamed = account("saver", "Renamed savings", "HOME_LOAN")
    renamed.attributes.balance = money(98765)
    const requests: string[] = []
    const defensive = createUpClient({ token: "test-pat", fetch: async input => {
      const url = new URL(String(input))
      if (url.pathname.endsWith("/accounts")) return response([account(), renamed])
      requests.push(url.pathname)
      // Include both a new disabled side and an existing disabled side defensively.
      return response([txn("enabled"), txn("disabled-new", "HELD", undefined, "saver"), txn("disabled-held", "SETTLED", undefined, "saver")])
    } })
    expect(await syncUp(db, defensive, { now })).toMatchObject({ accounts: 2, inserted: 1, updated: 0, removedHeld: 0 })
    expect(requests).toEqual(["/api/v1/accounts/daily/transactions"])
    expect(db.query("SELECT * FROM transactions WHERE account_id = ?").all(saver.id)).toEqual(before)
    expect(db.query("SELECT name, external_kind, balance, sync_enabled FROM accounts WHERE id = ?").get(saver.id))
      .toEqual({ name: "Renamed savings", external_kind: "HOME_LOAN", balance: 987.65, sync_enabled: 0 })
    expect(loadTransactions(db)).toMatchObject([{ transferAccountId: saver.id, internal: false }])
    // A counterpart omitted from the account response must still resolve locally.
    await syncUp(db, client([txn("enabled")], [account()]), { now })
    expect(db.query("SELECT transfer_account_id FROM transactions WHERE external_id = 'enabled'").get()).toEqual({ transfer_account_id: saver.id })
  })

  test("re-enabled empty account gets full history while another account gets its own incremental window", async () => {
    const db = database()
    const rows = [txn("daily-new", "SETTLED", "2026-04-05T02:10:00+10:00"), txn("saver-old", "HELD", "2025-01-01T00:00:00Z", "saver")]
    await syncUp(db, client(rows), { now })
    const saver = loadAccounts(db).find(a => a.name === "Savings")!
    expect(setAccountSyncEnabled(db, saver.id, false)).toBe(1)
    setAccountSyncEnabled(db, saver.id, true)
    const since: Array<string | undefined> = [], requests: URL[] = []
    expect((await syncUp(db, client(rows, undefined, since, requests), { now })).inserted).toBe(1)
    expect(requests.map(url => url.pathname)).toEqual(["/api/v1/accounts/daily/transactions", "/api/v1/accounts/saver/transactions"])
    expect(since).toEqual(["2026-03-21T16:10:00.000Z", undefined])
    expect(db.query("SELECT sync_enabled FROM accounts WHERE id = ?").get(saver.id)).toEqual({ sync_enabled: 1 })
  })

  test("switching off during fetch prevents restored rows and skips later disabled account requests", async () => {
    const db = database()
    await syncUp(db, client([txn()]), { now })
    const accounts = loadAccounts(db)
    const requests: string[] = []
    const switching = createUpClient({ token: "test-pat", fetch: async input => {
      const url = new URL(String(input))
      if (url.pathname.endsWith("/accounts")) return response([account(), account("saver", "Savings", "SAVER")])
      requests.push(url.pathname)
      for (const a of accounts) setAccountSyncEnabled(db, a.id, false)
      return response([txn(), txn("new")])
    } })
    expect(await syncUp(db, switching, { now })).toMatchObject({ accounts: 2, inserted: 0, updated: 0, removedHeld: 0, insertedIds: [] })
    expect(requests).toEqual(["/api/v1/accounts/daily/transactions"])
    expect(db.query("SELECT * FROM transactions").all()).toEqual([])
    expect(db.query("SELECT sync_enabled FROM accounts WHERE source = 'up'").all()).toEqual([{ sync_enabled: 0 }, { sync_enabled: 0 }])
  })

  test("HELD reconciliation uses each account window and preserves returned HELD and all SETTLED rows", async () => {
    const db = database()
    const daily = [txn("daily-held", "HELD", "2026-01-01T00:00:00Z"), txn("daily-settled", "SETTLED", "2026-04-01T00:00:00Z")]
    const saver = [txn("saver-held", "HELD", "2026-03-25T00:00:00Z", "saver"), txn("saver-missing", "HELD", "2026-03-26T00:00:00Z", "saver"), txn("saver-settled", "SETTLED", "2026-04-05T00:00:00Z", "saver")]
    await syncUp(db, client([...daily, ...saver]), { now })
    const since: Array<string | undefined> = []
    expect((await syncUp(db, client([saver[0]!], undefined, since), { now })).removedHeld).toBe(2)
    expect(since).toEqual(["2026-01-01T00:00:00.000Z", "2026-03-22T00:00:00.000Z"])
    expect(db.query("SELECT external_id FROM transactions ORDER BY id").all()).toEqual([
      { external_id: "daily-settled" }, { external_id: "saver-held" }, { external_id: "saver-settled" },
    ])
  })

  test("failure on a later account discards earlier account fetches and metadata changes", async () => {
    const db = database()
    await syncUp(db, client([txn()]), { now })
    const beforeAccounts = db.query("SELECT * FROM accounts").all()
    const beforeTransactions = db.query("SELECT * FROM transactions").all()
    const requests: string[] = []
    const failing = createUpClient({ token: "test-pat", fetch: async input => {
      const url = new URL(String(input))
      if (url.pathname.endsWith("/accounts")) return response([account("daily", "Renamed"), account("saver", "Savings", "SAVER")])
      requests.push(url.pathname)
      if (url.pathname.endsWith("/daily/transactions")) return response([txn("new")])
      return Response.json({ errors: [{ title: "Unavailable" }] }, { status: 503 })
    } })
    await expect(syncUp(db, failing, { now: new Date("2026-04-01") })).rejects.toThrow("Up API request failed (503): Unavailable")
    expect(requests).toEqual(["/api/v1/accounts/daily/transactions", "/api/v1/accounts/saver/transactions"])
    expect(db.query("SELECT * FROM accounts").all()).toEqual(beforeAccounts)
    expect(db.query("SELECT * FROM transactions").all()).toEqual(beforeTransactions)
    expect(db.query("SELECT * FROM sync_state").get()).toEqual({ source: "up", last_synced_at: now.toISOString(), last_error: "Up API request failed (503): Unavailable" })
  })

  test("write failure rolls back accounts and transactions, then records error", async () => {
    const db = database(), broken = txn()
    broken.relationships.account.data.id = "missing"
    const brokenClient = createUpClient({ token: "test-pat", fetch: async input =>
      new URL(String(input)).pathname.endsWith("/accounts") ? response([account()]) : response([txn("valid"), broken]) })
    await expect(syncUp(db, brokenClient, { now })).rejects.toThrow("Up transaction account is missing")
    expect(db.query("SELECT * FROM accounts WHERE source = 'up'").all()).toEqual([])
    expect(db.query("SELECT * FROM transactions").all()).toEqual([])
    expect(db.query("SELECT * FROM sync_state").get()).toEqual({ source: "up", last_synced_at: null, last_error: "Up transaction account is missing" })
  })

  test("JSON-escaped API errors cannot put the PAT in sync_state.last_error", async () => {
    const db = database(), token = "secret-test-pat"
    const escaped = Array.from(token, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`).join("")
    const failing = createUpClient({ token, fetch: async () => new Response(JSON.stringify({ errors: [{ title: `Denied ${token}`, detail: token }] }).replaceAll(token, escaped), { status: 403 }) })
    await expect(syncUp(db, failing, { now })).rejects.toThrow("Denied [redacted]")
    const state = db.query<{ last_error: string }, []>("SELECT last_error FROM sync_state WHERE source = 'up'").get()
    expect(state?.last_error).toBe("Up API request failed (403): Denied [redacted]: [redacted]")
    expect(state?.last_error).not.toContain(token)
  })

  test("account collision suffixes and rename preserve local identity, sort order, active flag", async () => {
    const db = database()
    for (const name of ["Daily", "Daily (Up)", "Daily (Up) 2"]) db.query("INSERT INTO accounts (name, sort_order) VALUES (?, 20)").run(name)
    await syncUp(db, client([], [account()]), { now })
    const first = loadAccounts(db).find(a => a.source === "up")
    expect(first).toMatchObject({ name: "Daily (Up) 3", sortOrder: 21 })
    db.query("UPDATE accounts SET is_active = 0 WHERE id = ?").run(first!.id)
    db.query("INSERT INTO accounts (name, sort_order) VALUES ('Renamed', 22)").run()
    await syncUp(db, client([], [account("daily", "Renamed")]), { now })
    expect(loadAccounts(db).find(a => a.source === "up")).toMatchObject({ id: first?.id, name: "Renamed (Up)", sortOrder: 21, isActive: false })
    await syncUp(db, client([], [account("daily", "Renamed")]), { now })
    expect(loadAccounts(db).filter(a => a.source === "up")).toHaveLength(1)
  })
})


test("store sync locks concurrent calls, refreshes, applies rules only to inserts, and resets after errors", async () => {
  const previousToken = process.env.JASKMONEY_UP_TOKEN
  const fetchMock = spyOn(globalThis, "fetch")
  data.init(":memory:")
  const db = data.getDb()
  if (!db) throw new Error("db not open")
  try {
    process.env.JASKMONEY_UP_TOKEN = "test-pat"
    const category = createCategory(db, { name: "Rule category", color: "#ffffff" })
    data.setState({ savedFilters: [{ id: "merchant", name: "Merchant", expr: "desc:Merchant" }] })
    data.createSettingsRule({ name: "Merchant", savedFilterId: "merchant", setCategoryId: category, addTagIds: [], enabled: true })
    fetchMock.mockImplementation(Object.assign(async (input: Parameters<typeof fetch>[0]) => new URL(String(input)).pathname.endsWith("/accounts") ? response([account()]) : response([txn()]), { preconnect: globalThis.fetch.preconnect }))
    const pending = data.syncUp()
    expect(data.state.upSyncing).toBe(true)
    await expect(data.syncUp()).rejects.toThrow("Up sync is already running")
    expect(await pending).toBe("Up sync: 1 new, 0 updated, 0 pending removed · 1 rules applied")
    expect(data.state.upSyncing).toBe(false)
    const inserted = data.state.transactions[0]
    expect(inserted?.categoryId).toBe(category)
    db.query("UPDATE transactions SET category_id = ? WHERE id = ?").run(data.state.categories.find(c => c.isDefault)!.id, inserted!.id)
    fetchMock.mockImplementation(Object.assign(async (input: Parameters<typeof fetch>[0]) => new URL(String(input)).pathname.endsWith("/accounts") ? response([account()]) : response([txn("t", "SETTLED")]), { preconnect: globalThis.fetch.preconnect }))
    expect(await data.syncUp()).toBe("Up sync: 0 new, 1 updated, 0 pending removed")
    expect(data.state.transactions[0]?.categoryName).toBe("Uncategorised")
    fetchMock.mockRejectedValue(new Error("Offline"))
    await expect(data.syncUp()).rejects.toThrow("Offline")
    expect(data.state.upSyncing).toBe(false)
    delete process.env.JASKMONEY_UP_TOKEN
    await expect(data.syncUp()).rejects.toThrow("Set JASKMONEY_UP_TOKEN")
    expect(data.state.upSyncing).toBe(false)
  } finally {
    fetchMock.mockRestore()
    if (previousToken === undefined) delete process.env.JASKMONEY_UP_TOKEN
    else process.env.JASKMONEY_UP_TOKEN = previousToken
    data.setState({ savedFilters: [] })
    db.close()
  }
})
