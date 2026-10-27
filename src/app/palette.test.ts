import { expect, onTestFinished, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { data } from "../state/dataStore"
import { ui } from "../state/uiStore"
import { renderApp } from "../testing/app"
import { key } from "../testing/keys"
import { testEnv } from "../testing/scoped"
import { theme } from "../theme"
import { commands, rankCommands } from "./commands"
import { footerHints, footerLine, handleKey, hintState, paletteList } from "./keys"
import { FOOTER_LIMIT, hintEvent } from "./palette"

const state = { focusedSection: "mgr.transactions" as const, drillReturn: null, chartViews: [0, 4] as [number, number] }

function setup() {
  testEnv("JASKMONEY_UP_TOKEN", "")
  testEnv("JASKMONEY_OPENROUTER_TOKEN", "")
  onTestFinished(() => { ui.setState({ palette: null, lastCommandId: null, catPickerOpen: false, settingsEditor: null, settingsActive: false }); data.init(":memory:") })
  data.init(":memory:")
  const db = data.getDb()!
  db.query("INSERT INTO accounts (id, name, type, source) VALUES (100, 'Spending', 'debit', 'csv')").run()
  db.query("INSERT INTO transactions (id, date_raw, date_iso, amount, description, account_id, source) VALUES (1, 'x', '2026-10-01', -5, 'Shop', 100, 'csv')").run()
  data.refresh()
  data.saveSavedFilter({ id: "coffee", name: "Coffee", expr: "desc:coffee" })
  data.setAccountSelection("all")
  ui.switchTab("manager")
  ui.setState({ focusedSection: "mgr.transactions", managerCursor: 0, selectedIds: {}, lastCommandId: null })
}
const open = () => handleKey(ui, key("k", { ctrl: true }), data)
const type = (text: string) => { for (const c of text) handleKey(ui, key(c === " " ? "space" : c), data) }
const listFrom = (from: Parameters<typeof footerHints>[0]) =>
  commands({ ui, data, from, press: (event) => { handleKey(ui, event, data) } }, footerHints(from, hintState(ui, data)))

test("a hint's key becomes one key press; several keys don't", () => {
  expect(hintEvent("c")).toMatchObject({ name: "c", sequence: "c", shift: false, ctrl: false })
  expect(hintEvent("T")).toMatchObject({ name: "t", sequence: "T", shift: true })
  expect(hintEvent("S-s")).toMatchObject({ name: "s", sequence: "S", shift: true })
  expect(hintEvent("ctrl+l")).toMatchObject({ name: "l", ctrl: true })
  expect(hintEvent("enter")).toMatchObject({ name: "return" })
  expect(hintEvent("del del")).toMatchObject({ name: "delete" })
  expect(hintEvent("?")).toMatchObject({ sequence: "?" })
  for (const several of ["j/k", "S-j/k", "1-3", "d/D", "[ ]", "h/l", "type"]) expect(hintEvent(several)).toBeNull()
})

test("the footer shows the first few hints, then ctrl+k all; short lists stay whole", () => {
  const line = footerLine("manager.txns", state)
  expect(line).toHaveLength(FOOTER_LIMIT + 1)
  expect(line.at(-1)).toEqual({ key: "ctrl+k", desc: "all" })
  expect(footerLine("settings.taxonomy", state)).toEqual(footerHints("settings.taxonomy", state))
  expect(footerLine("catPicker", state).some((h) => h.key === "ctrl+k")).toBe(false)
})

test("commands go beyond keys: everywhere's, one per saved filter and account, each with a description or a reason", () => {
  setup()
  const list = listFrom("manager.txns")
  const byId = (id: string) => list.find((c) => c.id === id)
  // Keyed where the key works, keyless elsewhere.
  expect(byId("txn:uncategorised")).toMatchObject({ key: { hint: "i" }, group: "here" })
  expect(byId("rules:apply")).toMatchObject({ group: "everywhere", key: undefined })
  expect(byId("filter:saved:coffee")).toMatchObject({ label: "Filter: Coffee", description: "desc:coffee" })
  expect(list.some((c) => c.label === "Show Spending" || c.label.startsWith("Show "))).toBe(true)
  expect(byId("settings:rules")?.label).toBe("Settings › Rules")
  expect(byId("import:csv")?.description).toContain("preview")
  // Reasons, not silence.
  expect(byId("sync:now")?.disabled).toBe("set JASKMONEY_UP_TOKEN")
  expect(byId("edit:undo")?.disabled).toBe("nothing to undo")
  expect(byId("filter:clear")?.disabled).toBe("no filter")
  // The table's own commands, listed only where they act (the cursor row).
  expect(byId("txn:sort")).toMatchObject({ label: "Cycle the sort", key: { hint: "s" }, group: "here" })
  expect(listFrom("settings.rules").some((c) => c.id === "txn:category")).toBe(false)
  // A pane's keys the registry lacks are commands too, once per key.
  expect(listFrom("overview").find((c) => c.id === "key:overview:c")).toMatchObject({ label: "This cycle", key: { hint: "c" } })
  const keys = list.flatMap((c) => c.key ? [c.key.hint] : [])
  expect(new Set(keys).size).toBe(keys.length)
  // From Settings › Rules, apply shows its key there.
  expect(listFrom("settings.rules").find((c) => c.id === "rules:apply")).toMatchObject({ key: { hint: "S-a" }, group: "here" })
})

test("ranking: matches by label or description; the last command first; those that can't run last", () => {
  setup()
  const list = listFrom("manager.txns")
  expect(rankCommands(list, "uncat", null)[0]?.id).toBe("txn:uncategorised")
  expect(rankCommands(list, "payday", null)[0]?.id).toBe("budget:cycle")
  const empty = rankCommands(list, "", "rules:dry-run")
  expect(empty[0]?.id).toBe("rules:dry-run")
  const firstDisabled = empty.findIndex((c) => c.disabled)
  expect(empty.slice(firstDisabled).every((c) => c.disabled)).toBe(true)
  // With nothing typed, this pane's come before everywhere's.
  const enabled = empty.slice(1, firstDisabled)
  expect(enabled.findIndex((c) => c.group === "everywhere")).toBeGreaterThan(enabled.findLastIndex((c) => c.group === "here"))
})

test("run from another tab: it goes where it needs, and is listed first next time", () => {
  setup()
  ui.switchTab("settings")
  open()
  expect(ui.state.palette?.from).toBe("settings")
  type("review uncat")
  handleKey(ui, key("return"), data)
  expect(ui.state.palette).toBeNull()
  expect(ui.state.activeTab).toBe("manager")
  expect(data.state.uncategorisedOnly).toBe(true)
  // Already showing them: it can't run, so it isn't first; a runnable last one is.
  open()
  type("dry run")
  handleKey(ui, key("return"), data)
  expect(ui.state.dryRunReport).not.toBeNull()
  ui.setState({ dryRunReport: null })
  open()
  expect(paletteList(ui, data)[0]?.id).toBe("rules:dry-run")
  handleKey(ui, key("escape"), data)
})

test("a saved filter from Overview filters the table; adding a category opens its editor in Settings", () => {
  setup()
  ui.switchTab("overview")
  open()
  type("filter coffee")
  handleKey(ui, key("return"), data)
  expect(ui.state.activeTab).toBe("manager")
  expect(data.state.filterQuery).toBe("desc:coffee")
  open()
  type("add a category")
  handleKey(ui, key("return"), data)
  expect(ui.state.activeTab).toBe("settings")
  expect(ui.state.settingsEditor).toBe("category")
})

test("enter on one that can't run says why and keeps the palette open", () => {
  setup()
  open()
  type("undo")
  expect(paletteList(ui, data)[0]?.id).toBe("edit:undo")
  handleKey(ui, key("return"), data)
  expect(ui.state.palette).not.toBeNull()
  expect(ui.state.status).toBe("Undo: nothing to undo")
  handleKey(ui, key("escape"), data)
})

test("ctrl+k inside a picker still moves its cursor", () => {
  setup()
  handleKey(ui, key("c"), data)
  handleKey(ui, key("j", { ctrl: true }), data)
  handleKey(ui, key("k", { ctrl: true }), data)
  expect(ui.state.palette).toBeNull()
  expect(ui.activeScope()).toBe("catPicker")
  handleKey(ui, key("escape"), data)
})

test("the palette renders groups, descriptions, keys in a column, and dims what can't run", async () => {
  const t = await renderApp({ width: 140, height: 50 })
  try {
    setup()
    open()
    await t.renderOnce()
    const frame = t.captureCharFrame()
    expect(frame).toContain("Commands")
    expect(frame).toMatch(/Review uncategorised\s+the rows waiting for a category.*\s+i\s+│/)
    expect(frame).toContain("Everywhere")
    type("sync")
    await t.renderOnce()
    const sync = t.captureSpans().lines.flatMap((l) => l.spans).find((s) => s.text.includes("set JASKMONEY_UP_TOKEN"))!
    expect(sync.fg.toInts()).toEqual(RGBA.fromHex(theme.overlay0).toInts())
  } finally { t.renderer.destroy() }
})
