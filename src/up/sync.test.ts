import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { createCategory, createTag, loadAccounts, loadTransactions, openDb, setAccountSyncEnabled, type Db } from "../db/client"
import { createUpClient } from "./client"
import { syncUp } from "./sync"
import { data } from "../state/dataStore"
import type { UpAccount, UpPage, UpTransaction } from "./types"

const categoryTree = [
  { id: "good-life", name: "Good Life", parentId: null },
  { id: "groceries", name: "Groceries", parentId: "good-life" },
]
const now = new Date("2026-03-01T00:00:00Z")
const money = (cents: number) => ({ currencyCode: "AUD", value: (cents / 100).toFixed(2), valueInBaseUnits: cents })
function account(id = "daily", displayName = "Daily", accountType: UpAccount["attributes"]["accountType"] = "TRANSACTIONAL"): UpAccount {
  return { type: "accounts", id, attributes: { displayName, accountType, ownershipType: "INDIVIDUAL", balance: money(12345), createdAt: "2026-01-01T00:00:00+11:00" } }
}
function txn(id = "t", status: UpTransaction["attributes"]["status"] = "HELD", createdAt = "2026-02-01T23:30:00+11:00", accountId = "daily"): UpTransaction {
  return { type: "transactions", id, attributes: { status, rawText: "RAW", description: "Merchant", message: "memo", amount: money(-1056), foreignAmount: null, createdAt, settledAt: status === "SETTLED" ? "2026-02-02T10:00:00+11:00" : null, transactionType: null, isCategorizable: true, roundUp: null, cashback: null, cardPurchaseMethod: null }, relationships: {
    account: { data: { type: "accounts", id: accountId } }, transferAccount: { data: { type: "accounts", id: "saver" } },
    category: { data: { type: "categories", id: "groceries" } }, parentCategory: { data: { type: "categories", id: "good-life" } }, tags: { data: [{ type: "tags", id: "up-tag" }] },
  } }
}
function response<T>(data: T[], next: string | null = null) { return Response.json({ data, links: { prev: null, next } } satisfies UpPage<T>) }
function client(transactions: UpTransaction[], accounts = [account(), account("saver", "Savings", "SAVER")], sinceValues: Array<string | undefined> = [], requests: URL[] = []) {
  return createUpClient({ token: "test-pat", fetch: async input => {
    const url = new URL(String(input))
    if (url.pathname.endsWith("/categories")) return response([])
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

  test("missing details force one full-history fetch per affected account, then restore incremental windows", async () => {
    const db = database()
    const rows = [txn("old", "SETTLED", "2020-01-01T00:00:00Z"),
      txn("new", "SETTLED", "2026-04-05T00:00:00Z"),
      txn("saver", "SETTLED", "2026-04-01T00:00:00Z", "saver")]
    await syncUp(db, client(rows), { now })
    db.query("UPDATE transactions SET ext_categorizable = NULL, card_suffix = NULL WHERE external_id = 'old'").run()
    rows[0]!.attributes.cardPurchaseMethod = { method: "CONTACTLESS", cardNumberSuffix: "1234" }
    const since: Array<string | undefined> = []
    expect((await syncUp(db, client(rows, undefined, since), { now })).updated).toBe(1)
    expect(since).toEqual([undefined, "2026-03-18T00:00:00.000Z"])
    expect(db.query("SELECT ext_categorizable, card_suffix FROM transactions WHERE external_id = 'old'").get())
      .toEqual({ ext_categorizable: 1, card_suffix: "1234" })
    since.length = 0
    expect((await syncUp(db, client(rows, undefined, since), { now })).updated).toBe(0)
    expect(since).toEqual(["2026-03-22T00:00:00.000Z", "2026-03-18T00:00:00.000Z"])
  })

  test("a detail-less settled row Up no longer returns is marked once, so full fetches do not repeat", async () => {
    const db = database()
    const rows = [txn("kept", "SETTLED", "2026-04-05T00:00:00Z"), txn("vanished", "SETTLED", "2026-04-01T00:00:00Z")]
    await syncUp(db, client(rows), { now })
    db.query("UPDATE transactions SET ext_categorizable = NULL WHERE external_id = 'vanished'").run()
    const since: Array<string | undefined> = []
    await syncUp(db, client([rows[0]!], [account()], since), { now })
    expect(since).toEqual([undefined])
    expect(db.query("SELECT status, ext_categorizable FROM transactions WHERE external_id = 'vanished'").get())
      .toEqual({ status: "SETTLED", ext_categorizable: 0 })
    since.length = 0
    await syncUp(db, client([rows[0]!], [account()], since), { now })
    expect(since[0]).not.toBeUndefined()
  })

  test("stored tag links outside the fetch window reconcile and count additions and removals", async () => {
    const db = database()
    const first = await syncUp(db, client([txn("old", "SETTLED")]), { now })
    const id = first.insertedIds[0]!
    db.query("UPDATE transactions SET ext_tags = '[\"New\",\"IGNORE\"]' WHERE id = ?").run(id)
    expect((await syncUp(db, client([]), { now })).updated).toBe(2)
    expect(loadTransactions(db)[0]?.tagNames).toEqual(["New"])
    expect((await syncUp(db, client([]), { now })).updated).toBe(0)
  })

  test("backfill clears the NULL marker even when Up omits isCategorizable", async () => {
    const db = database(), row = txn("old", "SETTLED")
    await syncUp(db, client([row], [account()]), { now })
    db.query("UPDATE transactions SET ext_categorizable = NULL WHERE external_id = 'old'").run()
    const attributes = Object.fromEntries(Object.entries(row.attributes).filter(([key]) => key !== "isCategorizable"))
    const since: Array<string | undefined> = []
    const missing = createUpClient({ token: "test-pat", fetch: async input => {
      const url = new URL(String(input))
      if (url.pathname.endsWith("/categories")) return response([])
      if (url.pathname.endsWith("/accounts")) return response([account()])
      since.push(url.searchParams.get("filter[since]") ?? undefined)
      return response([{ ...row, attributes }])
    } })
    expect((await syncUp(db, missing, { now })).updated).toBe(1)
    expect(db.query("SELECT ext_categorizable FROM transactions WHERE external_id = 'old'").get()).toEqual({ ext_categorizable: 1 })
    expect((await syncUp(db, missing, { now })).updated).toBe(0)
    expect(since).toEqual([undefined, "2026-01-18T12:30:00.000Z"])
  })

  test("insert maps child categories; missing, unknown and parent categories use the default with NULL source", async () => {
    const db = database()
    const rows = [txn("known"), txn("missing"), txn("unknown"), txn("parent")]
    rows[1]!.relationships.category.data = null
    rows[2]!.relationships.category.data = { type: "categories", id: "unknown" }
    rows[3]!.relationships.category.data = { type: "categories", id: "good-life" }
    const withTree = { ...client(rows), listCategories: async () => categoryTree }
    expect((await syncUp(db, withTree, { now })).inserted).toBe(4)
    const category = db.query<{ id: number }, []>("SELECT id FROM categories WHERE ext_id = 'groceries'").get()!
    const fallback = db.query<{ id: number }, []>("SELECT id FROM categories WHERE is_default = 1").get()!
    expect(db.query("SELECT external_id, category_id, category_source FROM transactions ORDER BY id").all()).toEqual([
      { external_id: "known", category_id: category.id, category_source: "provider" },
      ...["missing", "unknown", "parent"].map(external_id => ({ external_id, category_id: fallback.id, category_source: null })),
    ])
  })

  test.each([null, "provider", "user", "rule"])("update respects category source %s and counts category-only changes", async source => {
    const db = database(), row = txn()
    const withTree = { ...client([row]), listCategories: async () => categoryTree }
    const first = await syncUp(db, withTree, { now })
    const local = createCategory(db, { name: "Local choice", color: "#ffffff" })
    const tag = createTag(db, { name: "Local tag", color: "#ffffff", categoryId: null })
    db.query("UPDATE transactions SET category_id = ?, category_source = ?, notes = 'keep' WHERE id = ?").run(local, source, first.insertedIds[0]!)
    db.query("INSERT INTO transaction_tags VALUES (?, ?)").run(first.insertedIds[0]!, tag)
    const protectedChoice = source === "user" || source === "rule"
    expect((await syncUp(db, withTree, { now })).updated).toBe(protectedChoice ? 0 : 1)
    const provider = db.query<{ id: number }, []>("SELECT id FROM categories WHERE ext_id = 'groceries'").get()!
    expect(db.query("SELECT category_id, category_source, notes FROM transactions").get()).toEqual({
      category_id: protectedChoice ? local : provider.id, category_source: protectedChoice ? source : "provider", notes: "keep",
    })
    expect((await syncUp(db, withTree, { now })).updated).toBe(0)
    row.relationships.category.data = null
    expect((await syncUp(db, withTree, { now })).updated).toBe(1)
    const fallback = db.query<{ id: number }, []>("SELECT id FROM categories WHERE is_default = 1").get()!
    expect(db.query("SELECT category_id, category_source, notes FROM transactions").get()).toEqual({
      category_id: protectedChoice ? local : fallback.id, category_source: protectedChoice ? source : null, notes: "keep",
    })
    const providerTag = db.query<{ id: number }, []>("SELECT id FROM tags WHERE ext_id = 'up-tag'").get()!.id
    expect(db.query("SELECT * FROM transaction_tags ORDER BY tag_id").all()).toEqual([
      { transaction_id: first.insertedIds[0], tag_id: providerTag }, { transaction_id: first.insertedIds[0], tag_id: tag },
    ])
    expect((await syncUp(db, withTree, { now })).updated).toBe(0)
    row.relationships.category.data = { type: "categories", id: "groceries" }
    expect((await syncUp(db, withTree, { now })).updated).toBe(1)
    expect(db.query("SELECT category_id, category_source FROM transactions").get()).toEqual({
      category_id: protectedChoice ? local : provider.id, category_source: protectedChoice ? source : "provider",
    })
  })

  test("provider reassignment follows a different child and an unknown category clears it", async () => {
    const db = database(), row = txn()
    const withTree = { ...client([row]), listCategories: async () => [...categoryTree, { id: "cafes", name: "Cafes", parentId: "good-life" }] }
    await syncUp(db, withTree, { now })
    row.relationships.category.data = { type: "categories", id: "cafes" }
    expect((await syncUp(db, withTree, { now })).updated).toBe(1)
    const cafes = db.query<{ id: number }, []>("SELECT id FROM categories WHERE ext_id = 'cafes'").get()!
    expect(db.query("SELECT category_id, category_source FROM transactions").get()).toEqual({ category_id: cafes.id, category_source: "provider" })
    row.relationships.category.data = { type: "categories", id: "unknown" }
    expect((await syncUp(db, withTree, { now })).updated).toBe(1)
    expect(loadTransactions(db)[0]?.categoryName).toBe("Uncategorised")
    expect(db.query("SELECT category_source FROM transactions").get()).toEqual({ category_source: null })
  })

  test("listCategories failure writes only last_error", async () => {
    const db = database()
    await syncUp(db, client([txn()]), { now })
    const snapshot = () => ["categories", "accounts", "transactions", "transaction_tags"].map(table => db.query(`SELECT * FROM ${table}`).all())
    const before = snapshot()
    let fetchedAccounts = false
    const failing = { ...client([]), listCategories: async () => { throw new Error("Category fetch failed") },
      listAccounts: async () => { fetchedAccounts = true; return [] } }
    await expect(syncUp(db, failing, { now })).rejects.toThrow("Category fetch failed")
    expect(snapshot()).toEqual(before)
    expect(db.query("SELECT * FROM sync_state").get()).toEqual({ source: "up", last_synced_at: now.toISOString(), last_error: "Category fetch failed" })
    expect(fetchedAccounts).toBe(false)
  })

  test("first sync maps accounts, balances, local date, cents, transfer, and external fields", async () => {
    const db = database(), since: Array<string | undefined> = []
    const result = await syncUp(db, client([txn()], undefined, since), { now })
    expect(result).toEqual({ accounts: 2, inserted: 1, updated: 1, removedHeld: 0, insertedIds: [expect.any(Number)] })
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

  test("detail columns map every combination of optional objects on insert", async () => {
    const db = database()
    const rows = Array.from({ length: 16 }, (_, mask) => {
      const row = txn(`details-${mask}`)
      Object.assign(row.attributes, {
        isCategorizable: false, transactionType: "Purchase",
        cardPurchaseMethod: mask & 1 ? { method: "CONTACTLESS", cardNumberSuffix: "0123" } : null,
        foreignAmount: mask & 2 ? { currencyCode: "USD", value: "-12.00", valueInBaseUnits: -1200 } : null,
        roundUp: mask & 4 ? { amount: money(-44), boostPortion: money(-20) } : null,
        cashback: mask & 8 ? { description: "Reward", amount: money(125) } : null,
      })
      return row
    })
    expect((await syncUp(db, client(rows), { now })).inserted).toBe(16)
    for (let mask = 0; mask < 16; mask++) {
      expect(db.query("SELECT ext_categorizable, transaction_type, card_method, card_suffix, foreign_amount, round_up, cashback FROM transactions WHERE external_id = ?").get(`details-${mask}`)).toEqual({
        ext_categorizable: 0, transaction_type: "Purchase", card_method: mask & 1 ? "CONTACTLESS" : null,
        card_suffix: mask & 1 ? "0123" : null, foreign_amount: mask & 2 ? "USD -12.00" : null,
        round_up: mask & 4 ? -0.44 : null, cashback: mask & 8 ? 1.25 : null,
      })
    }
    expect((await syncUp(db, client(rows), { now })).updated).toBe(0)
  })

  test("missing new attributes default to categorizable and null details", async () => {
    const db = database(), row = txn()
    const attributes = Object.fromEntries(Object.entries(row.attributes).filter(([key]) => !["isCategorizable", "roundUp", "cashback", "cardPurchaseMethod"].includes(key)))
    const missing = createUpClient({ token: "test-pat", fetch: async input =>
      new URL(String(input)).pathname.endsWith("/categories") ? response([]) : new URL(String(input)).pathname.endsWith("/accounts") ? response([account()]) : response([{ ...row, attributes }]) })
    expect((await syncUp(db, missing, { now })).inserted).toBe(1)
    expect(db.query("SELECT ext_categorizable, transaction_type, card_method, card_suffix, foreign_amount, round_up, cashback FROM transactions").get()).toEqual({
      ext_categorizable: 1, transaction_type: null, card_method: null, card_suffix: null, foreign_amount: null, round_up: null, cashback: null,
    })
  })

  test("each detail column alone triggers an update and clearing preserves user data", async () => {
    const db = database(), row = txn()
    row.attributes.cardPurchaseMethod = { method: "CONTACTLESS", cardNumberSuffix: "0123" }
    const first = await syncUp(db, client([row]), { now })
    const category = createCategory(db, { name: "User", color: "#ffffff" })
    const tag = createTag(db, { name: "User", color: "#ffffff", categoryId: null })
    db.query("UPDATE transactions SET category_id = ?, category_source = 'user', notes = 'keep' WHERE id = ?").run(category, first.insertedIds[0]!)
    db.query("INSERT INTO transaction_tags VALUES (?, ?)").run(first.insertedIds[0]!, tag)
    const changes: Array<{ attributes: Partial<UpTransaction["attributes"]>; expected: Record<string, string | number | null> }> = [
      { attributes: { isCategorizable: false }, expected: { ext_categorizable: 0 } },
      { attributes: { transactionType: "Purchase" }, expected: { transaction_type: "Purchase" } },
      { attributes: { cardPurchaseMethod: { method: "CARD_ON_FILE", cardNumberSuffix: "0123" } }, expected: { card_method: "CARD_ON_FILE" } },
      { attributes: { cardPurchaseMethod: { method: "CONTACTLESS", cardNumberSuffix: "9876" } }, expected: { card_suffix: "9876" } },
      { attributes: { cardPurchaseMethod: { method: "CONTACTLESS", cardNumberSuffix: null } }, expected: { card_suffix: null } },
      { attributes: { foreignAmount: { currencyCode: "USD", value: "-12.00", valueInBaseUnits: -1200 } }, expected: { foreign_amount: "USD -12.00" } },
      { attributes: { roundUp: { amount: money(-44), boostPortion: null } }, expected: { round_up: -0.44 } },
      { attributes: { cashback: { description: "Reward", amount: money(125) } }, expected: { cashback: 1.25 } },
    ]
    for (const change of changes) {
      const changed = { ...row, attributes: { ...row.attributes, ...change.attributes } }
      expect(await syncUp(db, client([changed]), { now })).toMatchObject({ inserted: 0, updated: 1 })
      expect(db.query("SELECT * FROM transactions").get()).toMatchObject(change.expected)
      expect((await syncUp(db, client([changed]), { now })).updated).toBe(0)
      expect((await syncUp(db, client([row]), { now })).updated).toBe(1)
    }
    expect((await syncUp(db, client([txn()]), { now })).updated).toBe(1)
    expect(db.query("SELECT ext_categorizable, transaction_type, card_method, card_suffix, foreign_amount, round_up, cashback FROM transactions").get()).toEqual({
      ext_categorizable: 1, transaction_type: null, card_method: null, card_suffix: null, foreign_amount: null, round_up: null, cashback: null,
    })
    expect(loadTransactions(db)[0]).toMatchObject({ id: first.insertedIds[0], categoryId: category, notes: "keep", tagIds: [
      db.query<{ id: number }, []>("SELECT id FROM tags WHERE ext_id = 'up-tag'").get()!.id, tag,
    ] })
  })

  test("HELD becomes SETTLED in place and preserves user category, note, and tag", async () => {
    const db = database()
    const first = await syncUp(db, client([txn()]), { now })
    const category = createCategory(db, { name: "User", color: "#ffffff" })
    const tag = createTag(db, { name: "User", color: "#ffffff", categoryId: null })
    db.query("UPDATE transactions SET category_id = ?, category_source = 'user', notes = 'keep' WHERE id = ?").run(category, first.insertedIds[0]!)
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
    expect(await syncUp(db, client([settled]), { now })).toMatchObject({ inserted: 0, updated: 2, insertedIds: [] })
    expect(loadTransactions(db)[0]).toMatchObject({ id: first.insertedIds[0], status: "SETTLED", categoryId: category, notes: "keep", tagIds: [tag], amount: -12, description: "Final merchant", transferAccountId: null, internal: false, excluded: false })
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
    expect(db.query("SELECT * FROM transaction_tags").all()).toEqual([{
      transaction_id: first.insertedIds[1], tag_id: db.query<{ id: number }, []>("SELECT id FROM tags WHERE ext_id = 'up-tag'").get()!.id,
    }])
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
      if (new URL(String(input)).pathname.endsWith("/categories")) return response([])
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
      if (url.pathname.endsWith("/categories")) return response([])
      if (url.pathname.endsWith("/accounts")) return response([account(), renamed])
      requests.push(url.pathname)
      // Include both a new disabled side and an existing disabled side defensively.
      return response([txn("enabled"), txn("disabled-new", "HELD", undefined, "saver"), txn("disabled-held", "SETTLED", undefined, "saver")])
    } })
    expect(await syncUp(db, defensive, { now })).toMatchObject({ accounts: 2, inserted: 1, updated: 1, removedHeld: 0 })
    expect(requests).toEqual(["/api/v1/accounts/daily/transactions"])
    expect(db.query("SELECT * FROM transactions WHERE account_id = ?").all(saver.id)).toEqual(before)
    expect(db.query("SELECT name, external_kind, balance, sync_enabled FROM accounts WHERE id = ?").get(saver.id))
      .toEqual({ name: "Renamed savings", external_kind: "HOME_LOAN", balance: 987.65, sync_enabled: 0 })
    expect(loadTransactions(db)).toMatchObject([{ transferAccountId: saver.id, internal: false, excluded: false }])
    // A counterpart omitted from the account response must still resolve locally.
    await syncUp(db, client([txn("enabled")], [account()]), { now })
    expect(db.query("SELECT transfer_account_id FROM transactions WHERE external_id = 'enabled'").get()).toEqual({ transfer_account_id: saver.id })
  })

  test("re-enabled empty account gets full history while another account gets its own incremental window", async () => {
    const db = database()
    const rows = [txn("daily-new", "SETTLED", "2026-04-05T02:10:00+10:00"), txn("saver-old", "HELD", "2025-01-01T00:00:00Z", "saver")]
    await syncUp(db, client(rows), { now })
    const saver = loadAccounts(db).find(a => a.name === "Savings")!
    // SQLite reports the transaction plus its cascaded tag link.
    expect(setAccountSyncEnabled(db, saver.id, false)).toBe(2)
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
      if (url.pathname.endsWith("/categories")) return response([])
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
      if (url.pathname.endsWith("/categories")) return response([])
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
    const beforeCategories = db.query("SELECT * FROM categories").all()
    broken.relationships.account.data.id = "missing"
    const brokenClient = createUpClient({ token: "test-pat", fetch: async input =>
      new URL(String(input)).pathname.endsWith("/categories") ? response([]) : new URL(String(input)).pathname.endsWith("/accounts") ? response([account()]) : response([txn("valid"), broken]) })
    await expect(syncUp(db, brokenClient, { now })).rejects.toThrow("Up transaction account is missing")
    expect(db.query("SELECT * FROM categories").all()).toEqual(beforeCategories)
    expect(db.query("SELECT * FROM accounts WHERE source = 'up'").all()).toEqual([])
    expect(db.query("SELECT * FROM transactions").all()).toEqual([])
    expect(db.query("SELECT * FROM sync_state").get()).toEqual({ source: "up", last_synced_at: null, last_error: "Up transaction account is missing" })
  })

  test("JSON-escaped API errors cannot put the PAT in sync_state.last_error", async () => {
    const db = database(), token = "secret-test-pat"
    const escaped = Array.from(token, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`).join("")
    const failing = createUpClient({ token, fetch: async input => new URL(String(input)).pathname.endsWith("/categories") ? response([]) : new Response(JSON.stringify({ errors: [{ title: `Denied ${token}`, detail: token }] }).replaceAll(token, escaped), { status: 403 }) })
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
    fetchMock.mockImplementation(Object.assign(async (input: Parameters<typeof fetch>[0]) => new URL(String(input)).pathname.endsWith("/categories") ? response([]) : new URL(String(input)).pathname.endsWith("/accounts") ? response([account()]) : response([txn()]), { preconnect: globalThis.fetch.preconnect }))
    const pending = data.syncUp()
    expect(data.state.upSyncing).toBe(true)
    await expect(data.syncUp()).rejects.toThrow("Up sync is already running")
    expect(await pending).toBe("Up sync: 1 new, 1 updated, 0 pending removed · 1 rules applied")
    expect(data.state.upSyncing).toBe(false)
    const inserted = data.state.transactions[0]
    expect(inserted?.categoryId).toBe(category)
    db.query("UPDATE transactions SET category_id = ? WHERE id = ?").run(data.state.categories.find(c => c.isDefault)!.id, inserted!.id)
    fetchMock.mockImplementation(Object.assign(async (input: Parameters<typeof fetch>[0]) => new URL(String(input)).pathname.endsWith("/categories") ? response([]) : new URL(String(input)).pathname.endsWith("/accounts") ? response([account()]) : response([txn("t", "SETTLED")]), { preconnect: globalThis.fetch.preconnect }))
    expect(await data.syncUp()).toBe("Up sync: 0 new, 1 updated, 0 pending removed")
    expect(data.state.transactions[0]?.categoryName).toBe("Uncategorised")
    const lastSyncedAt = data.state.dbInfo?.upLastSyncedAt
    expect(lastSyncedAt).toBeTruthy()
    expect(data.state.dbInfo?.upLastError).toBeNull()
    fetchMock.mockRejectedValue(new Error("Offline"))
    await expect(data.syncUp()).rejects.toThrow("Offline")
    expect(data.state.upSyncing).toBe(false)
    expect(data.state.dbInfo?.upLastError).toBe("Offline")
    expect(data.state.dbInfo?.upLastSyncedAt).toBe(lastSyncedAt)
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
