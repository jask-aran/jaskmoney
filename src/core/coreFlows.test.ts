import { afterEach, expect, test } from "bun:test"
import { createCore } from "./core"
import { createTag } from "../db/client"

/**
 * The core's second round of machine fixes — frozen: change the code, not
 * these. A database switch never lets old work write; a sync and the
 * commands that delete what it fetches don't overlap; a failed undo goes;
 * a rule's tag obeys Up's limit like the picker's.
 */

const cores: Array<ReturnType<typeof createCore>> = []
afterEach(() => { for (const core of cores.splice(0)) core.close() })
const cx = { progress: () => {}, signal: new AbortController().signal }

function coreWithRows(rows = 1) {
  const core = createCore()
  cores.push(core)
  core.open(":memory:")
  const db = core.db!
  db.query("INSERT INTO accounts (id, name, type, source) VALUES (100, 'Spending', 'debit', 'csv')").run()
  for (let i = 1; i <= rows; i++) db.query("INSERT INTO transactions (id, date_raw, date_iso, amount, description, account_id, source) VALUES (?, 'x', '2026-10-01', -5, ?, 100, 'csv')").run(i, `Shop ${i % 5}`)
  core.refresh()
  return core
}

test("a suggestion round that spans demo mode coming on writes nothing to the real database", async () => {
  const core = coreWithRows(3000)
  const real = core.db!
  for (let c = 0; c < 300; c++) real.query("INSERT INTO categories (name, color, sort_order) VALUES (?, '#fff', 500)").run(`Pad ${c}`)
  core.refresh()
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  let calls = 0
  const ai = { async judge(questions: Record<string, unknown>) {
    calls++
    if (calls === 1) await held
    return Object.fromEntries(Object.keys(questions).map((id) => [id, (questions[id] as { type?: string }).type === "choice"
      ? { type: "choice" as const, choice: Object.keys((questions[id] as { options?: object }).options ?? {})[0] ?? "x", confidence: 0.9, probabilities: {} }
      : { type: "noul" as const, noul: 0.9 }]))
  } }
  const round = core.commands.suggestCategories({}, { ...cx, ai }).catch(() => "")
  await new Promise((resolve) => setTimeout(resolve, 10))
  expect(calls).toBe(1)
  const before = real.query("SELECT COUNT(*) AS n FROM category_suggestions").get()
  core.commands.enterDemo({})
  release()
  await round
  expect(real.query("SELECT COUNT(*) AS n FROM category_suggestions").get()).toEqual(before)
  expect(calls).toBe(1)
})

test("an undo that can't be done goes, and the one before it is next", async () => {
  const core = coreWithRows()
  const db = core.db!
  const a = createTag(db, { name: "A", color: "#fff" })
  const b = createTag(db, { name: "B", color: "#fff" })
  core.refresh()
  await core.commands.applyTagPatch({ ids: [1], patch: { [a]: "add" } })
  await core.commands.applyTagPatch({ ids: [1], patch: { [b]: "add" } })
  core.commands.deleteTag({ id: b })
  await expect(core.commands.undo({})).rejects.toThrow()
  expect((await core.commands.undo({})).message).toStartWith("Undid: +A")
  expect(core.state.transactions[0]!.tagIds).toEqual([])
  expect(core.state.undoLabel).toBeNull()
})

test("a rule's tag obeys Up's six-tag limit, as the picker's does", () => {
  const core = coreWithRows()
  const db = core.db!
  db.query("INSERT INTO accounts (id, name, type, source, sync_enabled) VALUES (200, 'Up', 'debit', 'up', 1)").run()
  db.query(`INSERT INTO transactions (id, date_raw, date_iso, amount, description, account_id, source, external_id, ext_tags)
    VALUES (2, 'x', '2026-10-02', -5, 'Cafe', 200, 'up', 'remote-2', '["a","b","c","d","e","f"]')`).run()
  const tag = createTag(db, { name: "Seventh", color: "#fff" })
  core.refresh()
  core.commands.saveSavedFilter({ filter: { id: "cafe", name: "Cafe", expr: "desc:cafe" } })
  core.commands.createRule({ input: { name: "Cafe tag", savedFilterId: "cafe", setCategoryId: null, addTagIds: [tag], enabled: true } })
  core.commands.applyRules({ ids: [2] })
  expect(core.state.transactions.find((t) => t.id === 2)!.tagIds).not.toContain(tag)
  expect(db.query("SELECT COUNT(*) AS n FROM tag_pushes").get()).toEqual({ n: 0 })
})
