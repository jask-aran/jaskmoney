import { describe, expect, test } from "bun:test"
import type { Db } from "../db/client"
import { pushTagChange, syncTagLinks } from "./tags"
import { createUpClient } from "./client"
import { testDb } from "../testing/scoped"

/** A test database with one synced Up account. */
function database() {
  const db = testDb()
  db.query("INSERT INTO accounts (name, type, source, sync_enabled) VALUES ('Up', 'debit', 'up', 1)").run()
  return db
}
function tag(db: Db, name: string, extId: string | null = null) {
  return Number(db.query("INSERT INTO tags (name, ext_id, color, sort_order) VALUES (?, ?, '#ffffff', 8)").run(name, extId).lastInsertRowid)
}
function row(db: Db, tags: string[] = [], source = "up", externalId: string | null = "remote") {
  return Number(db.query(`INSERT INTO transactions (date_raw, date_iso, amount, description, source, external_id, account_id, ext_tags)
    VALUES ('2026-01-01', '2026-01-01', -1, 'Test', ?, ?, (SELECT id FROM accounts WHERE name = 'Up'), ?)`)
    .run(source, externalId, JSON.stringify(tags)).lastInsertRowid)
}
function link(db: Db, id: number, tagId: number) { db.query("INSERT INTO transaction_tags VALUES (?, ?)").run(id, tagId) }
function links(db: Db, id: number) {
  return db.query<{ tag_id: number }, [number]>("SELECT tag_id FROM transaction_tags WHERE transaction_id = ? ORDER BY tag_id").all(id).map(t => t.tag_id)
}
function stored(db: Db, id: number) { return db.query("SELECT * FROM transactions WHERE id = ?").get(id) }
function mockClient() {
  const calls: Array<{ add: boolean; id: string; tags: string[] }> = []
  return { calls, client: {
    addTransactionTags: async (id: string, tags: string[]) => { calls.push({ add: true, id, tags }) },
    removeTransactionTags: async (id: string, tags: string[]) => { calls.push({ add: false, id, tags }) },
  } }
}

describe("syncTagLinks", () => {
  test("writes only link differences and keeps pending pushes", () => {
    const db = database()
    const food = tag(db, "Food", "Food"), old = tag(db, "Old", "Old"), local = tag(db, "Local")
    const unchanged = row(db, ["Food"], "up", "unchanged")
    const changed = row(db, ["Food"], "up", "changed")
    link(db, unchanged, food)
    link(db, changed, old)
    db.query("INSERT INTO tag_pushes VALUES (?, ?, 'add')").run(changed, local)
    db.query("INSERT INTO tag_pushes VALUES (?, ?, 'remove')").run(unchanged, old)
    expect(syncTagLinks(db)).toEqual({ tagsCreated: 0, linksAdded: 2, linksRemoved: 1 })
    expect(links(db, unchanged)).toEqual([food])
    expect(links(db, changed)).toEqual([food, local])
    expect(syncTagLinks(db)).toEqual({ tagsCreated: 0, linksAdded: 0, linksRemoved: 0 })
  })
})

describe("pushTagChange", () => {
  test("provider writes wait for 204 and reject 200 without local changes", async () => {
    for (const add of [true, false]) {
      const db = database(), local = tag(db, "Local"), id = row(db, ["Food"])
      if (!add) link(db, id, local)
      const before = stored(db, id), beforeLinks = links(db, id)
      const beforeTag = db.query("SELECT * FROM tags WHERE id = ?").get(local)
      let status = 200, calls = 0
      const client = createUpClient({ token: "test-pat", fetch: async () => {
        calls++
        expect(stored(db, id)).toEqual(before)
        expect(links(db, id)).toEqual(beforeLinks)
        expect(db.query("SELECT * FROM tags WHERE id = ?").get(local)).toEqual(beforeTag)
        return new Response(null, { status })
      } })
      expect(await pushTagChange(db, client, [id], local, add)).toMatchObject({ changed: 0, pushed: 0, failures: [expect.any(String)] })
      expect(stored(db, id)).toEqual(before)
      expect(links(db, id)).toEqual(beforeLinks)
      expect(db.query("SELECT * FROM tags WHERE id = ?").get(local)).toEqual(beforeTag)
      status = 204
      expect(await pushTagChange(db, client, [id], local, add)).toMatchObject({ changed: 1, pushed: 1, failures: [] })
      expect(calls).toBe(2)
      expect(links(db, id)).toEqual(add ? [local] : [])
      expect(stored(db, id)).toMatchObject({ ext_tags: add ? '["Food","Local"]' : '["Food"]' })
      expect(db.query("SELECT ext_id FROM tags WHERE id = ?").get(local)).toEqual({ ext_id: "Local" })
    }
  })

  test("acknowledgement rolls back the link and stored tags if provider identity conflicts", async () => {
    const db = database(), local = tag(db, "Local"), id = row(db, ["Food"])
    tag(db, "Other", "Local")
    const before = stored(db, id), beforeTag = db.query("SELECT * FROM tags WHERE id = ?").get(local)
    const { client, calls } = mockClient()
    const result = await pushTagChange(db, client, [id, id], local, true)
    expect(result).toMatchObject({ changed: 0, pushed: 0 })
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]).toContain("UNIQUE constraint failed")
    expect(calls).toHaveLength(1)
    expect(stored(db, id)).toEqual(before)
    expect(links(db, id)).toEqual([])
    expect(db.query("SELECT * FROM tags WHERE id = ?").get(local)).toEqual(beforeTag)
  })

  test("add and remove update Up, local links, stored tags, and provider identity", async () => {
    const db = database(), local = tag(db, "HOLIDAY"), id = row(db, ["Food"])
    const { client, calls } = mockClient()
    expect(await pushTagChange(db, client, [id], local, true)).toMatchObject({ changed: 1, pushed: 1, failures: [] })
    expect(links(db, id)).toEqual([local])
    expect(stored(db, id)).toMatchObject({ ext_tags: '["Food","HOLIDAY"]' })
    expect(db.query("SELECT ext_id FROM tags WHERE id = ?").get(local)).toEqual({ ext_id: "HOLIDAY" })
    db.query("UPDATE tags SET name = 'Renamed' WHERE id = ?").run(local)
    expect(await pushTagChange(db, client, [id], local, false)).toMatchObject({ changed: 1, pushed: 1, failures: [] })
    expect(links(db, id)).toEqual([])
    expect(stored(db, id)).toMatchObject({ ext_tags: '["Food"]' })
    expect(calls).toEqual([{ add: true, id: "remote", tags: ["HOLIDAY"] }, { add: false, id: "remote", tags: ["HOLIDAY"] }])
  })

  test("six-tag limit uses stored Up tags, permits duplicates and removals, and continues other rows", async () => {
    const db = database(), local = tag(db, "New")
    const full = row(db, ["1", "2", "3", "4", "5", "IGNORE"], "up", "full")
    const room = row(db, ["1", "2", "3", "4", "5"], "up", "room")
    const { client, calls } = mockClient(), before = stored(db, full)
    expect(await pushTagChange(db, client, [full, room], local, true)).toMatchObject({ changed: 1, pushed: 1, failures: ["Up allows at most 6 tags"] })
    expect(stored(db, full)).toEqual(before); expect(links(db, full)).toEqual([])
    expect(calls.map(c => c.id)).toEqual(["room"])
    expect(await pushTagChange(db, client, [room], local, true)).toMatchObject({ changed: 0, pushed: 1, failures: [] })
    expect(await pushTagChange(db, client, [room], local, false)).toMatchObject({ changed: 1, pushed: 1, failures: [] })
  })
})
