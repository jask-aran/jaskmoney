import { settlePending } from "../testing/keys"
import { afterEach, expect, test } from "bun:test"
import { handleKey } from "../app/keys"
import { data } from "./dataStore"
import { ui } from "./uiStore"
import { theme } from "../theme"
import { key } from "../testing/keys"

function press(name: string) {
  handleKey(ui, key(name), data)
}
async function fixture() {
  ui.switchTab("manager")
  data.init(":memory:")
  const db = data.getDb()!
  const add = await data.createSettingsTag({ name: "COFFEE", color: theme.blue, categoryIds: [], about: null })
  const remove = await data.createSettingsTag({ name: "WORK", color: theme.green, categoryIds: [], about: null })
  for (const id of [1, 2, 3]) {
    db.query("INSERT INTO transactions (id, date_raw, date_iso, amount, description, source) VALUES (?, 'x', '2026-01-01', -1, 'Test', 'csv')").run(id)
    db.query("INSERT INTO transaction_tags VALUES (?, ?)").run(id, remove)
  }
  db.query("INSERT INTO transaction_tags VALUES (1, ?)").run(add)
  data.refresh()
  ui.openTagPicker([1, 2, 3])
  ui.setState("tagPicker", { query: "COFFEE" })
  return { db, add, remove }
}
const ids = () => data.state.transactions.map((t) => [...t.tagIds])
afterEach(() => { ui.closeTagPicker(); data.getDb()?.close() })

test("enter applies staged add and remove across local targets; all and none toggle back", async () => {
  const { add, remove } = await fixture()
  press("space")
  ui.setState("tagPicker", { query: "WORK", cursor: 0 })
  press("space")
  expect((ui.state.tagPicker?.patch ?? {})).toEqual({ [add]: "add", [remove]: "remove" })
  press("space")
  expect((ui.state.tagPicker?.patch ?? {})).toEqual({ [add]: "add" })
  press("space")
  press("enter")
  expect(ui.state.tagPicker!.applying).toBe(true)
  press("escape")
  expect(ui.state.tagPicker !== null).toBe(true)
  press("enter")
  await Promise.resolve(); await settlePending()
  expect(ids()).toEqual([[add], [add], [add]])
  expect(ui.state.tagPicker !== null).toBe(false)
  expect((ui.state.tagPicker?.patch ?? {})).toEqual({})
  ui.openTagPicker([1, 2, 3])
  ui.setState("tagPicker", { query: "WORK" })
  press("space")
  expect((ui.state.tagPicker?.patch ?? {})).toEqual({ [remove]: "add" })
  press("space")
  expect((ui.state.tagPicker?.patch ?? {})).toEqual({})
})
