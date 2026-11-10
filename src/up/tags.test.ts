import { describe, expect, test } from "bun:test"
import type { Db } from "../db/client"
import { syncTagLinks } from "./tags"
import { testDb } from "../testing/scoped"

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
