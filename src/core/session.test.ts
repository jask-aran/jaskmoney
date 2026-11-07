import { afterEach, expect, test } from "bun:test"
import { createCore } from "./core"
import { createTag } from "../db/client"

/**
 * The core's session and lane machines (core/context Session, core/lane) —
 * frozen: change the code, not these.
 */

const cores: Array<ReturnType<typeof createCore>> = []
afterEach(() => { for (const core of cores.splice(0)) core.close() })

/** A core on a memory database with one CSV row and a tag. */
function coreWithRow() {
  const core = createCore()
  cores.push(core)
  core.open(":memory:")
  const db = core.db!
  db.query("INSERT INTO accounts (id, name, type, source) VALUES (100, 'Spending', 'debit', 'csv')").run()
  db.query("INSERT INTO transactions (id, date_raw, date_iso, amount, description, account_id, source) VALUES (1, 'x', '2026-10-01', -5, 'Shop', 100, 'csv')").run()
  const tag = createTag(db, { name: "Holiday", color: "#fff" })
  core.refresh()
  return { core, tag }
}

test("a factory reset is a new session: undo and the clients' caches of the old rows go", async () => {
  const { core, tag } = coreWithRow()
  await core.commands.applyTagPatch({ ids: [1], patch: { [tag]: "add" } })
  expect(core.state.undoLabel).not.toBeNull()
  const before = core.state.session
  core.commands.factoryResetDatabase({})
  expect(core.state.session).toBeGreaterThan(before)
  expect(core.state.undoLabel).toBeNull()
  expect(core.state.transactions).toEqual([])
  expect(await core.commands.undo({})).toEqual({ message: "Nothing to undo" })
})
