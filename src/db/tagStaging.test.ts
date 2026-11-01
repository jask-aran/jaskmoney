import { expect, test } from "bun:test"
import { createTag } from "./client"
import * as tagLinks from "./tagLinks"
import { testDb } from "../testing/scoped"

const stageTagChange = tagLinks.stageTagChange

function fixture() {
  const db = testDb()
  db.query("INSERT INTO accounts (id, name, type, source) VALUES (100, 'Test', 'debit', 'up')").run()
  db.query(`INSERT INTO transactions (id, date_raw, date_iso, amount, description, account_id, source, external_id, ext_tags)
    VALUES (1, 'x', '2026-10-01', -5, 'Shop', 100, 'up', 'remote', '["a","b","c","d","e","f"]')`).run()
  return db
}

test("staging refuses a seventh remote tag with no link, log, or queued intent", () => {
  const db = fixture()
  const tagId = createTag(db, { name: "Seventh", color: "#fff" })
  expect(stageTagChange(db, { transactionId: 1, tagId, action: "add", how: "rule", at: "now" })).toEqual({ kind: "refused", reason: "Up allows at most 6 tags" })
  for (const table of ["transaction_tags", "tag_log", "tag_pushes"]) expect(db.query(`SELECT COUNT(*) AS n FROM ${table}`).get()).toEqual({ n: 0 })
})

test("staging overlays pending removals for the six-tag limit and logs only changes", () => {
  const db = fixture()
  const old = createTag(db, { name: "A", color: "#fff" })
  db.query("UPDATE tags SET ext_id = 'a' WHERE id = ?").run(old)
  db.query("INSERT INTO transaction_tags (transaction_id, tag_id) VALUES (1, ?)").run(old)
  expect(stageTagChange(db, { transactionId: 1, tagId: old, action: "remove", how: "picker", at: "first" })).toEqual({ kind: "changed", queued: true })
  const tagId = createTag(db, { name: "New", color: "#fff" })
  const change = { transactionId: 1, tagId, action: "add", how: "rule", at: "second" } satisfies Parameters<typeof stageTagChange>[1]
  expect(stageTagChange(db, change)).toEqual({ kind: "changed", queued: true })
  expect(stageTagChange(db, change)).toEqual({ kind: "unchanged" })
  expect(db.query("SELECT tag_id, added, how, at FROM tag_log ORDER BY id").all()).toEqual([
    { tag_id: old, added: 0, how: "picker", at: "first" }, { tag_id: tagId, added: 1, how: "rule", at: "second" },
  ])
  expect(db.query("SELECT tag_id, action FROM tag_pushes ORDER BY tag_id").all()).toEqual([{ tag_id: old, action: "remove" }, { tag_id: tagId, action: "add" }])
})

test("IGNORE by either identity, CSV rows, and Up rows without an id stage locally", () => {
  const db = fixture()
  const ignore = db.query<{ id: number }, []>("SELECT id FROM tags WHERE name = 'IGNORE'").get()!.id
  const alias = createTag(db, { name: "Alias", color: "#fff" })
  db.query("UPDATE tags SET ext_id = 'iGnOrE' WHERE id = ?").run(alias)
  for (const tagId of [ignore, alias]) expect(stageTagChange(db, { transactionId: 1, tagId, action: "add", how: "rule", at: "now" })).toEqual({ kind: "changed", queued: false })
  const csv = createTag(db, { name: "CSV", color: "#fff" })
  db.query("UPDATE transactions SET source = 'csv' WHERE id = 1").run()
  expect(stageTagChange(db, { transactionId: 1, tagId: csv, action: "add", how: "picker", at: "now" })).toEqual({ kind: "changed", queued: false })
  db.query("UPDATE transactions SET source = 'up', external_id = NULL WHERE id = 1").run()
  const local = createTag(db, { name: "Local", color: "#fff" })
  expect(stageTagChange(db, { transactionId: 1, tagId: local, action: "add", how: "undo", at: "now" })).toEqual({ kind: "changed", queued: false })
  expect(db.query("SELECT COUNT(*) AS n FROM tag_pushes").get()).toEqual({ n: 0 })
  expect(db.query("SELECT COUNT(*) AS n FROM tag_log").get()).toEqual({ n: 4 })
})
