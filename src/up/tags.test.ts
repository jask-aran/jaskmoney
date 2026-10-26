import { afterEach, describe, expect, test } from "bun:test"
import { openDb, type Db } from "../db/client"
import { pushTagChange, syncTagLinks } from "./tags"
import { createUpClient } from "./client"

const databases: Db[] = []
function database() {
  const db = openDb(":memory:")
  databases.push(db)
  db.query("INSERT INTO accounts (name, type, source, sync_enabled) VALUES ('Up', 'debit', 'up', 1)").run()
  return db
}
afterEach(() => { for (const db of databases.splice(0)) db.close() })
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
  test.each(["123", "null", '["ok", 1]', "invalid"])("rejects malformed stored tags before writing: %s", json => {
    const db = database(), id = row(db)
    db.query("UPDATE transactions SET ext_tags = ? WHERE id = ?").run(json, id)
    const before = db.query("SELECT * FROM tags").all()
    expect(() => syncTagLinks(db)).toThrow()
    expect(db.query("SELECT * FROM tags").all()).toEqual(before)
    expect(links(db, id)).toEqual([])
  })

  test("creates tags, links names without changing style, follows ext_id, removes extras, and is idempotent", () => {
    const db = database()
    const matched = tag(db, "HOLIDAY"), existing = tag(db, "Renamed", "Food"), extra = tag(db, "Old", "Old")
    const local = tag(db, "Local"), id = row(db, ["Holiday", "Food", "New", "New"])
    link(db, id, extra); link(db, id, local)
    expect(syncTagLinks(db)).toEqual({ tagsCreated: 1, linksAdded: 3, linksRemoved: 1 })
    const created = db.query<{ id: number }, []>("SELECT id FROM tags WHERE ext_id = 'New'").get()!
    expect(links(db, id)).toEqual([matched, existing, local, created.id].sort((a, b) => a - b))
    expect(db.query("SELECT name, color, sort_order, ext_id FROM tags WHERE id = ?").get(matched))
      .toEqual({ name: "HOLIDAY", color: "#ffffff", sort_order: 8, ext_id: "Holiday" })
    expect(db.query("SELECT name, color, sort_order FROM tags WHERE id = ?").get(created.id))
      .toEqual({ name: "New", color: "#94e2d5", sort_order: 9 })
    expect(syncTagLinks(db)).toEqual({ tagsCreated: 0, linksAdded: 0, linksRemoved: 0 })
  })

  test("IGNORE names and provider IDs are never linked or touched, including incorrect stored links", () => {
    const db = database()
    const mandatory = db.query<{ id: number }, []>("SELECT id FROM tags WHERE name = 'IGNORE'").get()!.id
    const mixed = tag(db, "iGnOrE", "remote-ignore"), alias = tag(db, "Alias", "IgNoRe")
    const first = row(db, ["IGNORE", "ignore", "IgNoRe", "remote-ignore"], "up", "first")
    const second = row(db, [], "up", "second")
    for (const tagId of [mandatory, mixed, alias]) link(db, second, tagId)
    const before = db.query("SELECT * FROM tags").all()
    expect(syncTagLinks(db)).toEqual({ tagsCreated: 0, linksAdded: 0, linksRemoved: 0 })
    expect(links(db, first)).toEqual([])
    expect(links(db, second)).toEqual([mandatory, mixed, alias])
    expect(db.query("SELECT * FROM tags").all()).toEqual(before)
  })

  test("skips disabled accounts and CSV rows", () => {
    const db = database(), provider = tag(db, "Old", "Old")
    const disabled = row(db, ["Disabled"]), csv = row(db, ["CSV"], "csv", null)
    link(db, disabled, provider); link(db, csv, provider)
    db.query("UPDATE accounts SET sync_enabled = 0 WHERE name = 'Up'").run()
    expect(syncTagLinks(db)).toEqual({ tagsCreated: 0, linksAdded: 0, linksRemoved: 0 })
    expect(links(db, disabled)).toEqual([provider]); expect(links(db, csv)).toEqual([provider])
    expect(db.query("SELECT id FROM tags WHERE name IN ('Disabled', 'CSV')").all()).toEqual([])
  })

  test("resolves names before removing stale links on earlier rows", () => {
    const db = database(), local = tag(db, "HOLIDAY")
    const first = row(db, [], "up", "first")
    row(db, ["Holiday"], "up", "second")
    link(db, first, local)
    expect(syncTagLinks(db)).toEqual({ tagsCreated: 0, linksAdded: 1, linksRemoved: 1 })
    expect(links(db, first)).toEqual([])
  })
})

describe("pushTagChange", () => {
  test.each([true, false])("provider writes wait for 204 and reject 200 without local changes (add=%s)", async add => {
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
    expect(await pushTagChange(db, client, [id], local, add)).toEqual({
      changed: 0, pushed: 0, failures: ["Unexpected Up API response status (200); expected 204"],
    })
    expect(stored(db, id)).toEqual(before)
    expect(links(db, id)).toEqual(beforeLinks)
    expect(db.query("SELECT * FROM tags WHERE id = ?").get(local)).toEqual(beforeTag)
    status = 204
    expect(await pushTagChange(db, client, [id], local, add)).toEqual({ changed: 1, pushed: 1, failures: [] })
    expect(calls).toBe(2)
    expect(links(db, id)).toEqual(add ? [local] : [])
    expect(stored(db, id)).toMatchObject({ ext_tags: add ? '["Food","Local"]' : '["Food"]' })
    expect(db.query("SELECT ext_id FROM tags WHERE id = ?").get(local)).toEqual({ ext_id: "Local" })
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
    expect(await pushTagChange(db, client, [id], local, true)).toEqual({ changed: 1, pushed: 1, failures: [] })
    expect(links(db, id)).toEqual([local])
    expect(stored(db, id)).toMatchObject({ ext_tags: '["Food","HOLIDAY"]' })
    expect(db.query("SELECT ext_id FROM tags WHERE id = ?").get(local)).toEqual({ ext_id: "HOLIDAY" })
    db.query("UPDATE tags SET name = 'Renamed' WHERE id = ?").run(local)
    expect(await pushTagChange(db, client, [id], local, false)).toEqual({ changed: 1, pushed: 1, failures: [] })
    expect(links(db, id)).toEqual([])
    expect(stored(db, id)).toMatchObject({ ext_tags: '["Food"]' })
    expect(calls).toEqual([{ add: true, id: "remote", tags: ["HOLIDAY"] }, { add: false, id: "remote", tags: ["HOLIDAY"] }])
  })

  test("remove also sets a previously local tag's provider identity", async () => {
    const db = database(), local = tag(db, "HOLIDAY"), id = row(db, ["HOLIDAY"])
    link(db, id, local)
    expect(await pushTagChange(db, mockClient().client, [id], local, false)).toEqual({ changed: 1, pushed: 1, failures: [] })
    expect(db.query("SELECT ext_id FROM tags WHERE id = ?").get(local)).toEqual({ ext_id: "HOLIDAY" })
    expect(stored(db, id)).toMatchObject({ ext_tags: "[]" })
  })

  test("IGNORE is local only regardless of case or stored provider identity", async () => {
    const db = database(), id = row(db, ["Food"])
    const { client, calls } = mockClient()
    const ids = [db.query<{ id: number }, []>("SELECT id FROM tags WHERE name = 'IGNORE'").get()!.id,
      tag(db, "iGnOrE", "remote"), tag(db, "Alias", "ignore")]
    const before = stored(db, id), beforeTags = db.query("SELECT * FROM tags").all()
    for (const local of ids) {
      expect(await pushTagChange(db, client, [id], local, true)).toEqual({ changed: 1, pushed: 0, failures: [] })
      expect(await pushTagChange(db, client, [id], local, false)).toEqual({ changed: 1, pushed: 0, failures: [] })
    }
    expect(calls).toEqual([])
    expect(stored(db, id)).toEqual(before)
    expect(db.query("SELECT * FROM tags").all()).toEqual(beforeTags)
  })

  test("CSV and Up rows without an external ID change locally", async () => {
    const db = database(), local = tag(db, "Local")
    const ids = [row(db, [], "csv", null), row(db, [], "up", null)]
    const { client, calls } = mockClient()
    expect(await pushTagChange(db, client, ids, local, true)).toEqual({ changed: 2, pushed: 0, failures: [] })
    for (const id of ids) expect(links(db, id)).toEqual([local])
    expect(await pushTagChange(db, client, ids, local, false)).toEqual({ changed: 2, pushed: 0, failures: [] })
    expect(calls).toEqual([])
    expect(db.query("SELECT ext_id FROM tags WHERE id = ?").get(local)).toEqual({ ext_id: null })
  })

  test.each([true, false])("failure leaves the transaction and tag unchanged (add=%s)", async add => {
    const db = database(), local = tag(db, "Local"), id = row(db, ["Food"])
    if (!add) link(db, id, local)
    const before = stored(db, id), beforeLinks = links(db, id), beforeTag = db.query("SELECT * FROM tags WHERE id = ?").get(local)
    const fail = async () => { throw new Error("Denied") }
    expect(await pushTagChange(db, { addTransactionTags: fail, removeTransactionTags: fail }, [id], local, add))
      .toEqual({ changed: 0, pushed: 0, failures: ["Denied"] })
    expect(stored(db, id)).toEqual(before); expect(links(db, id)).toEqual(beforeLinks)
    expect(db.query("SELECT * FROM tags WHERE id = ?").get(local)).toEqual(beforeTag)
  })

  test("six-tag limit uses stored Up tags, permits duplicates and removals, and continues other rows", async () => {
    const db = database(), local = tag(db, "New")
    const full = row(db, ["1", "2", "3", "4", "5", "IGNORE"], "up", "full")
    const room = row(db, ["1", "2", "3", "4", "5"], "up", "room")
    const { client, calls } = mockClient(), before = stored(db, full)
    expect(await pushTagChange(db, client, [full, room], local, true)).toEqual({ changed: 1, pushed: 1, failures: ["Up allows at most 6 tags"] })
    expect(stored(db, full)).toEqual(before); expect(links(db, full)).toEqual([])
    expect(calls.map(c => c.id)).toEqual(["room"])
    expect(await pushTagChange(db, client, [room], local, true)).toEqual({ changed: 0, pushed: 1, failures: [] })
    expect(await pushTagChange(db, client, [room], local, false)).toEqual({ changed: 1, pushed: 1, failures: [] })
  })

  test("requests run sequentially and continue after an error", async () => {
    const db = database(), local = tag(db, "Local")
    const ids = [row(db, [], "up", "bad"), row(db, [], "up", "good")]
    const events: string[] = []
    let active = false
    const addTransactionTags = async (id: string) => {
      expect(active).toBe(false)
      active = true; events.push(id)
      await Promise.resolve()
      active = false
      if (id === "bad") throw new Error("Failed bad")
    }
    expect(await pushTagChange(db, { ...mockClient().client, addTransactionTags }, ids, local, true))
      .toEqual({ changed: 1, pushed: 1, failures: ["Failed bad"] })
    expect(events).toEqual(["bad", "good"])
    expect(links(db, ids[0]!)).toEqual([]); expect(links(db, ids[1]!)).toEqual([local])
  })
})
