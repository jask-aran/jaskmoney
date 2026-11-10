import { afterEach, expect, test } from "bun:test"
import { LOOKUP_RETRY_HOURS, matchOrders, readShipment, type Purchase } from "../ai/orderEmails"
import { lookUpPurchases, purchaseSources, purchasesNote } from "./purchases"
import { data } from "../state/dataStore"

const NOW = Date.parse("2026-10-30T00:00:00Z")
const DAY = 86_400_000
const p = (id: number, daysAgo: number, amount = -9.32, description = "Amazon", rawText: string | null = "AMAZON AU MARKETPLACE"): Purchase =>
  ({ id, dateISO: new Date(NOW - daysAgo * DAY).toISOString().slice(0, 10), createdMs: NOW - daysAgo * DAY, amount, description, rawText })

test("matching after earlier rounds: an email another row took is skipped; a refund takes a stored charge's items", () => {
  const shipped = (at: string, total: string, item: string) => readShipment(at, `Order #\n250-9\n* ${item}\nQuantity: 1\n${total}\nTotal\n${total}`)
  const taken = shipped("2026-10-28T00:00:00.000Z", "9.32 AUD", "Taken")
  const free = shipped("2026-10-27T00:00:00Z", "9.32 AUD", "Free")
  const charge = p(10, 30, -25.14)
  const found = matchOrders([p(1, 1), p(2, 0.5, 25.14)], [taken, free], [], {
    rows: [charge],
    found: [{ transactionId: 10, source: "amazon", order: "250-0", items: [{ name: "Tape", quantity: 1, price: 25.14 }], emailAt: null }],
    usedEmails: new Set(["amazon:250-9:2026-10-28T00:00:00.000Z"]),
  })
  expect(found.find((f) => f.transactionId === 1)?.items.map((i) => i.name)).toEqual(["Free"])
  expect(found.find((f) => f.transactionId === 2)).toMatchObject({ items: [{ name: "Tape" }], refundOf: 10 })
})

const saved = { ...purchaseSources }
afterEach(() => Object.assign(purchaseSources, saved))

test("a round after sync: one program for the due rows; found rows keep their items and aren't looked up again; the rest wait", async () => {
  data.init(":memory:")
  const db = data.getDb()!
  db.query("INSERT INTO accounts (id, name, type, source) VALUES (1, 'Spending', 'debit', 'up')").run()
  const insert = db.query("INSERT INTO transactions (id, date_raw, date_iso, amount, description, raw_text, account_id, source, external_created_at) VALUES (?, ?, ?, ?, ?, ?, 1, 'up', ?)")
  insert.run(1, "2026-10-29", "2026-10-29", -9.32, "Amazon", "AMAZON AU MARKETPLACE, SYDNEY", "2026-10-29T10:00:00+10:00")
  insert.run(2, "2026-10-29", "2026-10-29", -48.49, "eBay", "eBay O*20-12345-67890  Sydney", "2026-10-29T19:00:00+10:00")
  insert.run(3, "2026-10-28", "2026-10-28", -18.9, "Amazon", "AMAZON AU RETAIL, SYDNEY", "2026-10-28T12:00:00+10:00")
  insert.run(4, "2026-10-28", "2026-10-28", -5, "Coles", "COLES", "2026-10-28T12:00:00+10:00")
  data.refresh()
  const programs: string[] = []
  const body = Buffer.from("Order #\n250-1\n* Backflush Insert\nQuantity: 1\n9.32 AUD\nTotal\n9.32 AUD").toString("base64url")
  Object.assign(purchaseSources, {
    signedIn: () => true,
    accounts: async () => [{ accountId: "acc_x", label: "me", tools: "tools.gmail.api.users" }],
    run: async (code: string) => { programs.push(code); return { shipments: [{ at: "2026-10-28T23:00:00Z", mime: "text/plain", data: body }], ebay: [{ order: "20-12345-67890", emails: [{ at: "2026-10-29T09:00:00Z", subject: "Order confirmed: Bean Keeper" }] }] } },
    now: () => NOW,
  })
  const first = await lookUpPurchases(data)
  expect(first).toEqual({ looked: 3, found: 2, resuggested: 0, error: null })
  expect(purchasesNote(first)).toBe(" · 2 purchases found in email")
  expect(programs).toHaveLength(1)
  expect(programs[0]).toContain('["20-12345-67890"]')
  const byId = new Map(data.state.transactions.map((t) => [t.id, t]))
  expect(byId.get(1)?.bought).toEqual([{ name: "Backflush Insert", quantity: 1, price: 9.32 }])
  expect(byId.get(2)?.bought).toEqual([{ name: "Bean Keeper", quantity: 1, price: 48.49 }])
  expect(byId.get(3)?.bought).toBeUndefined()
  expect(data.purchaseLookups().get(3)).toMatchObject({ status: "waiting", checks: 1 })
  expect(await lookUpPurchases(data)).toEqual({ looked: 0, found: 0, resuggested: 0, error: null })
  expect(programs).toHaveLength(1)
  const late = Buffer.from("Order #\n250-2\n* Residue Cleaner\nQuantity: 1\n18.9 AUD\nTotal\n18.9 AUD").toString("base64url")
  Object.assign(purchaseSources, { now: () => NOW + LOOKUP_RETRY_HOURS * 3_600_000, run: async (code: string) => { programs.push(code); return { shipments: [{ at: "2026-10-30T02:00:00Z", mime: "text/plain", data: late }], ebay: [] } } })
  expect(await lookUpPurchases(data)).toMatchObject({ looked: 1, found: 1 })
  expect(programs[1]).not.toContain("20-12345-67890")
  expect(data.state.transactions.find((t) => t.id === 3)?.bought?.map((i) => i.name)).toEqual(["Residue Cleaner"])
})

test("no lookups in demo mode or without Executor; a failure leaves rows waiting for the next sync", async () => {
  data.init(":memory:")
  const db = data.getDb()!
  db.query("INSERT INTO accounts (id, name, type, source) VALUES (1, 'Spending', 'debit', 'up')").run()
  db.query("INSERT INTO transactions (id, date_raw, date_iso, amount, description, account_id, source) VALUES (1, 'x', '2026-10-29', -9.32, 'Amazon', 1, 'up')").run()
  data.refresh()
  expect(await lookUpPurchases(data)).toMatchObject({ looked: 0 })
  Object.assign(purchaseSources, { signedIn: () => true, accounts: async () => [{ accountId: "acc_x", label: "me", tools: "tools.gmail.api.users" }], run: async () => { throw new Error("offline") }, now: () => NOW })
  expect(await lookUpPurchases(data)).toMatchObject({ looked: 1, found: 0, error: "offline" })
  expect(data.purchaseLookups().size).toBe(0)
})

test("a waiting row suggested before its purchase was known is asked again, once, with what it bought", async () => {
  data.init(":memory:")
  const db = data.getDb()!
  db.query("INSERT INTO accounts (id, name, type, source) VALUES (1, 'Spending', 'debit', 'up')").run()
  db.query("INSERT INTO transactions (id, date_raw, date_iso, amount, description, raw_text, account_id, source) VALUES (1, 'x', '2026-10-29', -69.99, 'Amazon', 'AMAZON AU RETAIL', 1, 'up')").run()
  const tech = Number(db.query("INSERT INTO categories (name, color, sort_order) VALUES ('Technology', '#fff', 90)").run().lastInsertRowid)
  const health = Number(db.query("INSERT INTO categories (name, color, sort_order) VALUES ('Health & Medical', '#fff', 91)").run().lastInsertRowid)
  db.query("INSERT INTO category_suggestions (transaction_id, category_id, confidence, source) VALUES (1, ?, 0.45, 'jev')").run(tech)
  db.query("INSERT INTO purchase_lookups (transaction_id, status, source, items, checks, checked_at) VALUES (1, 'found', 'amazon', '[{\"name\":\"Electric Toothbrush\",\"quantity\":1,\"price\":69.99}]', 1, '2026-10-29T00:00:00Z')").run()
  data.refresh()
  const sent: string[] = []
  const ai = { async judge(questions: Record<string, unknown>) {
    sent.push(JSON.stringify(questions))
    return Object.fromEntries(Object.keys(questions).map((id) => [id, (questions[id] as { type?: string }).type === "choice"
      ? { type: "choice" as const, choice: `c${health}`, confidence: 0.9, probabilities: { [`c${health}`]: 0.9 } }
      : { type: "noul" as const, noul: 0.1 }]))
  } }
  expect(await data.recordPurchases([], ai)).toBe(1)
  expect(sent.some((q) => q.includes("Electric Toothbrush"))).toBe(true)
  expect(data.state.suggestions[1]).toMatchObject({ categoryId: health, knewBought: true })
  expect(await data.recordPurchases([], ai)).toBe(0)
})

test("a lookup found before prices were kept is redone with its own email; if that's gone, it keeps its items", async () => {
  data.init(":memory:")
  const db = data.getDb()!
  db.query("INSERT INTO accounts (id, name, type, source) VALUES (1, 'Spending', 'debit', 'up')").run()
  db.query("INSERT INTO transactions (id, date_raw, date_iso, amount, description, raw_text, account_id, source, external_created_at) VALUES (1, 'x', '2026-10-29', -18.9, 'Amazon', 'AMAZON AU RETAIL', 1, 'up', '2026-10-29T10:00:00+10:00')").run()
  db.query("INSERT INTO purchase_lookups (transaction_id, status, source, order_ref, items, email_key, checks, checked_at) VALUES (1, 'found', 'amazon', '250-2', '[\"2× Residue Cleaner\"]', 'amazon:250-2:2026-10-29T02:00:00.000Z', 1, '2026-10-29T03:00:00Z')").run()
  data.refresh()
  const body = Buffer.from("Order #\n250-2\n* Residue Cleaner\nQuantity: 2\n9.45 AUD\nTotal\n18.9 AUD").toString("base64url")
  Object.assign(purchaseSources, { signedIn: () => true, accounts: async () => [{ accountId: "acc_x", label: "me", tools: "tools.gmail.api.users" }], now: () => NOW,
    run: async () => ({ shipments: [{ at: "2026-10-29T02:00:00.000Z", mime: "text/plain", data: body }], ebay: [] }) })
  expect(await lookUpPurchases(data)).toMatchObject({ looked: 1, found: 0 })
  expect(data.state.transactions[0]?.bought).toEqual([{ name: "Residue Cleaner", quantity: 2, price: 9.45 }])
  expect(data.purchaseLookups().get(1)?.legacy).toBeUndefined()
  db.query("UPDATE purchase_lookups SET items = '[\"2× Residue Cleaner\"]' WHERE transaction_id = 1").run()
  data.refresh()
  Object.assign(purchaseSources, { run: async () => ({ shipments: [], ebay: [] }) })
  expect(await lookUpPurchases(data)).toMatchObject({ looked: 1 })
  expect(data.purchaseLookups().get(1)).toMatchObject({ status: "found", items: [{ name: "2× Residue Cleaner" }] })
  expect(data.purchaseLookups().get(1)?.legacy).toBeUndefined()
})

test("saving a note on a waiting row asks its suggestion again, with the note; clearing it doesn't", async () => {
  data.init(":memory:")
  const db = data.getDb()!
  db.query("INSERT INTO accounts (id, name, type, source) VALUES (1, 'Spending', 'debit', 'up')").run()
  db.query("INSERT INTO transactions (id, date_raw, date_iso, amount, description, account_id, source) VALUES (1, 'x', '2026-10-29', -79.96, 'Amazon', 1, 'up')").run()
  const home = Number(db.query("INSERT INTO categories (name, color, sort_order) VALUES ('Homeware', '#fff', 90)").run().lastInsertRowid)
  const gifts = Number(db.query("INSERT INTO categories (name, color, sort_order) VALUES ('Gifts & Charity', '#fff', 91)").run().lastInsertRowid)
  db.query("INSERT INTO category_suggestions (transaction_id, category_id, confidence, source) VALUES (1, ?, 0.92, 'jev')").run(home)
  data.refresh()
  const sent: string[] = []
  const ai = { async judge(questions: Record<string, unknown>) {
    sent.push(JSON.stringify(questions))
    return Object.fromEntries(Object.keys(questions).map((id) => [id, (questions[id] as { type?: string }).type === "choice"
      ? { type: "choice" as const, choice: `c${gifts}`, confidence: 0.9, probabilities: { [`c${gifts}`]: 0.9 } }
      : { type: "noul" as const, noul: 0.1 }]))
  } }
  expect(await data.updateTransactionNotes(1, "Gift for Sam", ai)).toBe(true)
  expect(sent.some((q) => q.includes("Gift for Sam"))).toBe(true)
  expect(data.state.suggestions[1]?.categoryId).toBe(gifts)
  expect(await data.updateTransactionNotes(1, "", ai)).toBe(false)
})
