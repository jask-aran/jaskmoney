import { afterEach, expect, test } from "bun:test"
import { RGBA, TextAttributes } from "@opentui/core"
import { createComponent } from "solid-js"
import { testRender } from "@opentui/solid"
import { handleKey, footerHints } from "../app/keys"
import { TagPicker } from "../ui/primitives/TagPicker"
import { tagPickerItems } from "./tagPicker"
import { data } from "./dataStore"
import { ui } from "./uiStore"
import { theme } from "../theme"
import { key } from "../testing/keys"

function press(name: string) {
  handleKey(ui, key(name), data)
}
function fixture() {
  ui.switchTab("manager")
  data.init(":memory:")
  const db = data.getDb()!
  const add = data.createSettingsTag({ name: "COFFEE", color: theme.blue, scope: null })
  const remove = data.createSettingsTag({ name: "WORK", color: theme.green, scope: null })
  for (const id of [1, 2, 3]) {
    db.query("INSERT INTO transactions (id, date_raw, date_iso, amount, description, source) VALUES (?, 'x', '2026-01-01', -1, 'Test', 'csv')").run(id)
    db.query("INSERT INTO transaction_tags VALUES (?, ?)").run(id, remove)
  }
  db.query("INSERT INTO transaction_tags VALUES (1, ?)").run(add)
  data.refresh()
  ui.openTagPicker([1, 2, 3])
  ui.setState({ tagPickerQuery: "COFFEE" })
  return { db, add, remove }
}
const ids = () => data.state.transactions.map((t) => [...t.tagIds])
afterEach(() => { ui.closeTagPicker(); data.getDb()?.close() })

test("space stages mixed → all → none → original; esc and empty enter write nothing", () => {
  const { add } = fixture()
  const original = ids()
  press("space")
  expect(ui.state.tagPickerPatch).toEqual({ [add]: "add" })
  expect(ids()).toEqual(original)
  press("space")
  expect(ui.state.tagPickerPatch).toEqual({ [add]: "remove" })
  press("space")
  expect(ui.state.tagPickerPatch).toEqual({})
  expect(ids()).toEqual(original)
  press("space")
  press("escape")
  expect(ids()).toEqual(original)
  expect(ui.state.tagPickerPatch).toEqual({})
  expect(ui.state.status).toBe("Tags unchanged")
  ui.openTagPicker([1, 2, 3])
  press("enter")
  expect(ui.state.status).toBe("Tags unchanged")
  expect(ids()).toEqual(original)
})

test("enter applies staged add and remove across local targets; all and none toggle back", async () => {
  const { add, remove } = fixture()
  press("space")
  ui.setState({ tagPickerQuery: "WORK", tagPickerCursor: 0 })
  press("space")
  expect(ui.state.tagPickerPatch).toEqual({ [add]: "add", [remove]: "remove" })
  press("space")
  expect(ui.state.tagPickerPatch).toEqual({ [add]: "add" })
  press("space")
  press("enter")
  expect(ui.state.tagPickerApplying).toBe(true)
  press("escape")
  expect(ui.state.tagPickerOpen).toBe(true)
  press("enter")
  await Promise.resolve()
  expect(ids()).toEqual([[add], [add], [add]])
  expect(ui.state.status).toBe("Tags: +COFFEE, -WORK on 3")
  expect(ui.state.tagPickerOpen).toBe(false)
  expect(ui.state.tagPickerPatch).toEqual({})
  ui.openTagPicker([1, 2, 3])
  ui.setState({ tagPickerQuery: "WORK" })
  press("space")
  expect(ui.state.tagPickerPatch).toEqual({ [remove]: "add" })
  press("space")
  expect(ui.state.tagPickerPatch).toEqual({})
})

test("create row is last, cursor reaches it, and enter also applies the existing patch", async () => {
  const { add, remove } = fixture()
  press("space")
  ui.setState({ tagPickerQuery: "WO", tagPickerCursor: 0 })
  press("down")
  expect(ui.state.tagPickerCursor).toBe(1)
  press("up")
  expect(ui.state.tagPickerCursor).toBe(0)
  press("down")
  press("enter")
  await Promise.resolve()
  const created = data.state.tags.find((t) => t.name === "WO")!
  expect(created).toMatchObject({ scope: null, color: theme.blue })
  expect(data.state.transactions.every((t) => [add, remove, created.id].every((id) => t.tagIds.includes(id)))).toBe(true)
  expect(ui.state.tagPickerPatch).toEqual({})
  expect(tagPickerItems(data.state.tags, data.state.transactions, [1], " wo ").some((r) => r.kind === "item" && r.value === null)).toBe(false)
})

test("IGNORE changes on Up rows remain local without a token or client", async () => {
  const { db } = fixture()
  const ignore = data.state.tags.find((t) => t.name === "IGNORE")!
  db.query("UPDATE transactions SET source = 'up', external_id = 'remote' WHERE id = 1").run()
  data.refresh()
  expect(await data.applyTagPatch([1], { [ignore.id]: "add" })).toBe("Tags: +IGNORE on 1")
  expect(data.state.transactions.find((t) => t.id === 1)?.tagIds).toContain(ignore.id)
})

test("tag rows group by scope (taking a target, none, elsewhere), omit empty sections and rank fuzzy matches within sections", () => {
  const { add } = fixture()
  const cat = data.createSettingsCategory({ name: "Food", color: theme.blue })
  const other = data.createSettingsCategory({ name: "Other", color: theme.blue })
  data.getDb()!.query("UPDATE transactions SET category_id = ? WHERE id = 1").run(cat)
  void other
  data.createSettingsTag({ name: "COFFEE BREAK", color: theme.blue, scope: "cat:Food" })
  data.createSettingsTag({ name: "COFFEE OTHER", color: theme.blue, scope: "cat:Other" })
  data.createSettingsTag({ name: "COFFEE SHOP", color: theme.blue, scope: null })
  data.refresh()
  const rows = tagPickerItems(data.state.tags, data.state.transactions, [1, 2], "cf")
  expect(rows.map((r) => r.label)).toEqual(["Scoped", "COFFEE BREAK", "Global", "COFFEE", "COFFEE SHOP", "Out of scope", "COFFEE OTHER", 'Create "cf"'])
  expect(rows.find((r) => r.label === "COFFEE OTHER")).toMatchObject({ color: theme.overlay1 })
  expect(rows.find((r) => r.kind === "item" && r.value === add)?.label).toBe("COFFEE")
  expect(tagPickerItems(data.state.tags, data.state.transactions, [1], "zz").map((r) => r.label)).toEqual(['Create "zz"'])
  expect(footerHints("tagPicker")).toEqual([
    { key: "↑↓ ^j/k", desc: "move" }, { key: "space", desc: "stage" },
    { key: "enter", desc: "apply" }, { key: "esc", desc: "cancel" },
  ])
})

test("captured cells show staged mixed/all/none marks and preserve cursor colours and attributes", async () => {
  fixture()
  const t = await testRender(() => createComponent(TagPicker, {}), { width: 90, height: 26 })
  try {
    const check = async (mark: string) => {
      await t.renderOnce()
      await t.flush()
      const spans = t.captureSpans().lines.flatMap((line) => line.spans)
      expect(spans.some((s) => s.text.includes(mark))).toBe(true)
      const label = spans.find((s) => s.text.includes("COFFEE") && (s.attributes & TextAttributes.BOLD))!
      expect(label.fg.toInts()).toEqual([137, 180, 250, 255])
      expect(label.bg.toInts()).toEqual(RGBA.fromHex(theme.rowCursor).toInts())
      expect(label.attributes & TextAttributes.BOLD).toBe(TextAttributes.BOLD)
    }
    await check("[-]")
    press("space")
    await check("[x]")
    press("space")
    await check("[ ]")
    press("space")
    await check("[-]")
  } finally { t.renderer.destroy() }
})
