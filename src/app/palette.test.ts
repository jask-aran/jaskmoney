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

test("commands go beyond keys: from anywhere, per saved filter and account; keys come from the pane's hints", () => {
  setup()
  const list = listFrom("manager.txns")
  const byId = (id: string) => list.find((c) => c.id === id)
  // A hint naming a registry command lists it, keyed, in this pane's group.
  expect(byId("txn:uncategorised")).toMatchObject({ key: "i", category: "Transactions" })
  // A hint with its own label is a command of this pane.
  expect(byId("key:manager.txns:s")).toMatchObject({ label: "Cycle the sort", key: "s", category: "Transactions" })
  // The rest of the registry: grouped, keyless unless global.
  expect(byId("rules:apply")?.category).toBe("Rules")
  expect(byId("rules:apply")?.key).toBeUndefined()
  expect(byId("data:sync")).toMatchObject({ key: "ctrl+r", disabled: "no Up token" })
  expect(byId("txn:saved:coffee")).toMatchObject({ label: "Filter: Coffee", description: "desc:coffee" })
  expect(list.some((c) => c.id.startsWith("txn:account:"))).toBe(true)
  expect(byId("settings:rules")?.label).toBe("Rules")
  expect(byId("txn:undo")?.disabled).toBe("nothing to undo")
  // Each key once, each command once.
  const keys = list.flatMap((c) => c.key ? [c.key] : [])
  expect(new Set(keys).size).toBe(keys.length)
  expect(new Set(list.map((c) => c.id)).size).toBe(list.length)
  // From Settings › Rules, S-a is apply, in that pane's group; the table's own aren't there.
  const rules = listFrom("settings.rules")
  expect(rules.find((c) => c.id === "rules:apply")).toMatchObject({ key: "S-a", category: "Settings › Rules" })
  expect(rules.some((c) => c.id.startsWith("key:manager.txns"))).toBe(false)
  // Overview's own key with its own words.
  expect(listFrom("overview").find((c) => c.id === "key:overview:c")).toMatchObject({ label: "Range: this cycle", key: "c" })
})

test("every hint that names a command names a real one, in every pane and state", () => {
  setup()
  const states = [{}, { uncategorisedOnly: true }, { tagReview: true }, { ruleOffers: 2 }, { asks: true }]
  for (const scope of ["overview", "manager.txns", "manager.merchants", "manager.accounts", "settings", "settings.taxonomy", "settings.rules", "settings.filters", "budgets", "settings.up", "settings.ai", "settings.database"] as const) {
    for (const extra of states) {
      const ctx = { ui, data, from: scope, press: () => {} }
      expect(() => commands(ctx, footerHints(scope, { ...hintState(ui, data), ...extra }))).not.toThrow()
    }
  }
})

test("ranking: nothing typed leaves out what can't run, last used first, the pane before the rest; typing ranks and explains", () => {
  setup()
  const list = listFrom("manager.txns")
  const empty = rankCommands(list, "", "rules:dry-run")
  expect(empty[0]?.id).toBe("rules:dry-run")
  expect(empty.some((c) => c.disabled)).toBe(false)
  const categories = empty.slice(1).map((c) => c.category)
  expect(categories.indexOf("Rules")).toBeGreaterThan(categories.lastIndexOf("Transactions") - 1)
  expect(rankCommands(list, "uncat", null)[0]?.id).toBe("txn:uncategorised")
  expect(rankCommands(list, "payday", null)[0]?.id).toBe("settings:cycle")
  // Can't run: listed when asked for, last, with why.
  const undo = rankCommands(list, "undo", null)
  expect(undo.at(-1)).toMatchObject({ id: "txn:undo", disabled: "nothing to undo" })
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
  const at = paletteList(ui, data).findIndex((c) => c.id === "txn:undo")
  ui.setState({ palette: { ...ui.state.palette!, cursor: at } })
  handleKey(ui, key("return"), data)
  expect(ui.state.palette).not.toBeNull()
  expect(ui.state.status).toBe("Undo: nothing to undo")
  handleKey(ui, key("escape"), data)
})

test("moving doesn't rebuild the list: the same commands until the query changes or it reopens", () => {
  setup()
  open()
  const first = paletteList(ui, data)
  handleKey(ui, key("down"), data)
  handleKey(ui, key("down"), data)
  expect(ui.state.palette?.cursor).toBe(2)
  expect(paletteList(ui, data)).toBe(first)
  type("rul")
  const ranked = paletteList(ui, data)
  expect(ranked).not.toBe(first)
  handleKey(ui, key("down"), data)
  expect(paletteList(ui, data)).toBe(ranked)
  handleKey(ui, key("escape"), data)
  open()
  expect(paletteList(ui, data)).not.toBe(first)
  handleKey(ui, key("escape"), data)
})

test("rule offers are kept until a write changes them", async () => {
  setup()
  const db = data.getDb()!
  const food = Number(db.query("INSERT INTO categories (name, color) VALUES ('Test food', '#fff')").run().lastInsertRowid)
  for (const id of [2, 3, 4]) db.query("INSERT INTO transactions (id, date_raw, date_iso, amount, description, account_id, source) VALUES (?, 'x', '2026-10-02', -5, 'Shop', 100, 'csv')").run(id)
  data.refresh()
  const before = data.allRuleOffers()
  expect(data.allRuleOffers()).toBe(before)
  expect(before).toEqual([])
  await data.categorizeTransactions([1, 2, 3], food)
  expect(data.allRuleOffers().map((o) => o.description)).toEqual(["Shop"])
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

test("the palette renders like opencode's: search line, bold group headings, the cursor wash on the cursor row, keys at the right", async () => {
  const t = await renderApp({ width: 140, height: 50 })
  try {
    setup()
    open()
    await t.renderOnce()
    const frame = t.captureCharFrame()
    expect(frame).toContain("Search commands")
    expect(frame).toMatch(/Categorise…\s+selection or row\s+c/)
    expect(frame).toContain("Rules")
    expect(frame).not.toContain("Can't run")
    const spans = t.captureSpans().lines.flatMap((l) => l.spans)
    const bar = spans.find((s) => s.text.startsWith("Categorise…"))!
    expect(bar.bg.toInts()).toEqual(RGBA.fromHex(theme.rowCursor).toInts())
    expect(bar.fg.toInts()).toEqual(RGBA.fromHex(theme.text).toInts())
    const heading = spans.find((s) => s.text === "Transactions" && s.fg.toInts().join() === RGBA.fromHex(theme.accent).toInts().join())
    expect(heading).toBeDefined()
    // Typed: one list, each row naming its group; what can't run is last, dimmed, with why.
    type("sync")
    await t.renderOnce()
    expect(t.captureCharFrame()).toMatch(/Sync with Up no Up token\s+Data · ctrl\+r/)
    for (let i = 0; i < 4; i++) handleKey(ui, key("backspace"), data)
    type("go to")
    await t.renderOnce()
    const here = t.captureSpans().lines.flatMap((l) => l.spans).find((s) => s.text.startsWith("Transactions") && s.bg.toInts().join() === RGBA.fromHex(theme.mantle).toInts().join())!
    expect(here.fg.toInts()).toEqual(RGBA.fromHex(theme.overlay0).toInts())
    expect(t.captureCharFrame()).toMatch(/Transactions here now\s+Go to · 2/)
  } finally { t.renderer.destroy() }
})
