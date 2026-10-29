import { expect, test } from "bun:test"
import { loadTransactions, openDb } from "../db/client"
import { chronological, newestFirst } from "./chronology"

const row = (id: number, dateISO: string, created: string | null) => ({ id, dateISO, createdMs: created ? Date.parse(created) : null })

test("a day's rows go by the provider's time, not the order they were saved; across offsets, one clock", () => {
  // A sync saves Up's newest first: the evening purchase got the lowest id.
  const ebay = row(1629, "2026-10-29", "2026-10-29T19:08:03+11:00")
  const coffee = row(1632, "2026-10-29", "2026-10-29T09:56:48+11:00")
  const hosting = row(1633, "2026-10-29", "2026-10-29T00:31:19+11:00")
  const yesterday = row(1700, "2026-10-28", "2026-10-28T23:59:00+11:00")
  expect([coffee, yesterday, hosting, ebay].sort(newestFirst).map((r) => r.id)).toEqual([1629, 1632, 1633, 1700])
  // 18:00 in Singapore (+08:00) is 21:00 in Melbourne: after 19:08 there.
  const abroad = row(1, "2026-05-22", "2026-05-22T18:00:00+08:00")
  const home = row(2, "2026-05-22", "2026-05-22T19:08:00+11:00")
  expect(chronological(abroad, home)).toBeGreaterThan(0)
  // Without a time (CSV), saved order.
  expect([row(5, "2026-01-01", null), row(4, "2026-01-01", null)].sort(chronological).map((r) => r.id)).toEqual([4, 5])
})

test("loaded transactions come newest first by time", () => {
  const db = openDb(":memory:")
  db.query("INSERT INTO accounts (id, name, type, source) VALUES (1, 'Spending', 'debit', 'up')").run()
  const add = (id: number, created: string, description: string) => db.query(`INSERT INTO transactions (id, date_raw, date_iso, amount, description, account_id, source, external_created_at)
    VALUES (?, 'x', '2026-10-29', -5, ?, 1, 'up', ?)`).run(id, description, created)
  add(1629, "2026-10-29T19:08:03+11:00", "eBay")
  add(1630, "2026-10-29T14:29:07+11:00", "7-Eleven")
  add(1632, "2026-10-29T09:56:48+11:00", "Empire Coffee")
  expect(loadTransactions(db).map((t) => t.description)).toEqual(["eBay", "7-Eleven", "Empire Coffee"])
})
