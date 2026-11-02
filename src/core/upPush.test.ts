import { expect, onTestFinished, spyOn, test } from "bun:test"
import { createCore } from "./core"
import { createTag } from "../db/client"

function fixture() {
  const core = createCore()
  core.open(":memory:")
  onTestFinished(() => { core.close(); core.dispose() })
  for (let id = 1; id <= 20; id++) core.db!.query(`INSERT INTO transactions
    (id, date_raw, date_iso, amount, description) VALUES (?, 'x', '2026-01-01', -5, ?)`)
    .run(id, `Test shop ${id}`)
  core.refresh()
  return core
}
const cx = { progress: () => {}, signal: new AbortController().signal }

test("bulk categories use one lookup snapshot and undo only changed rows", async () => {
  const core = fixture()
  const category = core.state.categories.find(c => c.name === "Groceries")!.id
  core.db!.query("UPDATE transactions SET category_id = ? WHERE id = 2").run(category)
  core.refresh()
  const before = core.state.transactions
  const find = spyOn(before, "find")
  onTestFinished(() => find.mockRestore())
  await core.commands.categorize({ ids: [1, 2, 3, 999], categoryId: category }, cx)
  expect(find).not.toHaveBeenCalled()
  expect(core.state.transactions.filter(t => t.categoryId === category).map(t => t.id).sort()).toEqual([1, 2, 3])
  expect(core.db!.query("SELECT transaction_id FROM category_log ORDER BY transaction_id").all())
    .toEqual([{ transaction_id: 1 }, { transaction_id: 3 }])
  await core.commands.undo({})
  expect(core.state.transactions.filter(t => t.categoryId === category).map(t => t.id)).toEqual([2])
})

test("bulk tags read refreshed rows for each undo reversal and ignore duplicate selected ids", async () => {
  const core = fixture()
  const db = core.db!
  const a = createTag(db, { name: "Test A", color: "#fff" })
  const b = createTag(db, { name: "Test B", color: "#fff" })
  db.query("INSERT INTO transaction_tags VALUES (2, ?)").run(a)
  core.refresh()
  const ids = [1, 2, 2, 999]
  const includes = spyOn(ids, "includes")
  onTestFinished(() => includes.mockRestore())
  await core.commands.applyTagPatch({ ids, patch: { [a]: "add", [b]: "add" } })
  expect(includes).not.toHaveBeenCalled()
  for (const id of [1, 2]) expect(core.state.transactions.find(t => t.id === id)!.tagIds).toEqual([a, b])
  expect(core.state.transactions.find(t => t.id === 3)!.tagIds).toEqual([])
  expect(core.state.undoLabel).toContain("on 2")
  await core.commands.undo({})
  expect(core.state.transactions.find(t => t.id === 1)!.tagIds).toEqual([])
  expect(core.state.transactions.find(t => t.id === 2)!.tagIds).toEqual([a])
})
