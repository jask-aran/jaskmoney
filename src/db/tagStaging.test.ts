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
