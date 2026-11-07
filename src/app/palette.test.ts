import { expect, onTestFinished, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { data } from "../state/dataStore"
import { type ChartViews, ui } from "../state/uiStore"
import { renderApp } from "../testing/app"
import { key } from "../testing/keys"
import { testEnv } from "../testing/scoped"
import { theme } from "../theme"
import { commands, rankCommands } from "./commands"
import { footerHints, footerLine, handleKey, hintState, paletteList } from "./keys"
import { footerParts, hintEvent } from "./palette"

const state = { focusedSection: "mgr.transactions" as const, drillReturn: null, chartViews: [0, 4, 7, 8] as ChartViews }

async function setup() {
  testEnv("JASKMONEY_UP_TOKEN", "")
  testEnv("JASKMONEY_OPENROUTER_TOKEN", "")
  onTestFinished(() => { ui.setState({ palette: null, lastCommandId: null, catPicker: null, settingsEditor: null, settingsActive: false }); data.init(":memory:") })
  data.init(":memory:")
  const db = data.getDb()!
  db.query("INSERT INTO accounts (id, name, type, source) VALUES (100, 'Spending', 'debit', 'csv')").run()
  db.query("INSERT INTO transactions (id, date_raw, date_iso, amount, description, account_id, source) VALUES (1, 'x', '2026-10-01', -5, 'Shop', 100, 'csv')").run()
  data.refresh()
  await data.saveSavedFilter({ id: "coffee", name: "Coffee", expr: "desc:coffee" })
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

test("the footer: the pane's name, its keys, a rule, the tab's, as many as the width holds; ctrl+k all always at the right where the palette opens; palette-only hints not suggested", () => {
  const text = (line: ReturnType<typeof footerLine>) => footerParts(line.pane, line.hints).map((p) => p.text).join("")
  // Wide enough, every hint the footer suggests.
  const all = footerLine("manager.txns", state)
  expect(all.pane).toBe("Transactions")
  expect(all.palette).toBe(true)
  expect(all.hints).toEqual(footerHints("manager.txns", state).filter((h) => !h.paletteOnly))
  // 80 wide: the first that fit, leaving ctrl+k all its room.
  const cut = footerLine("manager.txns", state, 80)
  expect(cut.hints).toEqual(footerHints("manager.txns", state).slice(0, cut.hints.length))
  expect(text(cut).length).toBeLessThanOrEqual(80 - "ctrl+k all".length - 2)
  expect(text(footerLine("manager.txns", state, 120)).length).toBeGreaterThan(text(cut).length)
  // A dialog's footer: no palette.
  expect(footerLine("catPicker", state, 40).palette).toBe(false)
  // The Overview's Range pane: its own keys under its name, then the tab's
  // after a rule.
  const range = footerLine("overview", { ...state, focusedSection: "ov.categories" })
  expect(text(range)).toMatch(/^Range {2}j\/k move {2}space open group {2}enter transactions {2}t text {2}s spending view {2}│ {2}d\/D range {2}\[ \] period/)
  // Transactions' keys and the rest are the palette's from the Overview:
  // reachable, not suggested.
  const overview = footerHints("overview", { ...state, focusedSection: "none" })
  for (const k of ["i", "/", "?", "c"]) expect(overview.find((h) => h.key === k)?.paletteOnly).toBe(true)
  expect(footerLine("overview", { ...state, focusedSection: "none" }).hints.map((h) => h.key)).not.toContain("i")
  // Nothing focused: no name, the tab's keys alone.
  expect(footerLine("overview", { ...state, focusedSection: "none" }).pane).toBeNull()
})

test("commands go beyond keys: from anywhere, per saved filter and account; keys come from the pane's hints", async () => {
  await setup()
  const list = listFrom("manager.txns")
  const byId = (id: string) => list.find((c) => c.id === id)
  // A hint naming a registry command lists it, keyed, in this pane's group.
  expect(byId("txn:uncategorised")).toMatchObject({ key: "i", category: "Transactions" })
  // A hint with its own label is a command of this pane.
  expect(byId("key:manager.txns:s")).toMatchObject({ key: "s", category: "Transactions" })
  // The rest of the registry: grouped, keyless unless global.
  expect(byId("rules:apply")?.category).toBe("Rules")
  expect(byId("rules:apply")?.key).toBeUndefined()
  expect(byId("data:sync")).toMatchObject({ key: "ctrl+r", disabled: expect.any(String) })
  expect(byId("txn:saved:coffee")).toBeDefined()
  expect(list.some((c) => c.id.startsWith("txn:account:"))).toBe(true)
  expect(byId("txn:undo")?.disabled).toBeTruthy()
  // Each key once, each command once.
  const keys = list.flatMap((c) => c.key ? [c.key] : [])
  expect(new Set(keys).size).toBe(keys.length)
  expect(new Set(list.map((c) => c.id)).size).toBe(list.length)
  // From Settings › Rules, S-a is apply, in that pane's group; the table's own aren't there.
  const rules = listFrom("settings.rules")
  expect(rules.find((c) => c.id === "rules:apply")).toMatchObject({ key: "S-a", category: "Settings › Rules" })
  expect(rules.some((c) => c.id.startsWith("key:manager.txns"))).toBe(false)
  // Overview's own key with its own words.
  expect(listFrom("overview").find((c) => c.id === "key:overview:c")?.key).toBe("c")
})

test("every hint that names a command names a real one, in every pane and state", async () => {
  await setup()
  const states = [{}, { uncategorisedOnly: true }, { tagReview: true }, { ruleOfferCount: 2 }, { asks: true }]
  for (const scope of ["overview", "manager.txns", "manager.merchants", "manager.accounts", "settings", "settings.taxonomy", "settings.rules", "settings.filters", "budgets.categories", "budgets.chart", "settings.up", "settings.ai", "settings.appearance", "settings.database"] as const) {
    for (const extra of states) {
      const ctx = { ui, data, from: scope, press: () => {} }
      expect(() => commands(ctx, footerHints(scope, { ...hintState(ui, data), ...extra }))).not.toThrow()
    }
  }
})

test("ranking: nothing typed leaves out what can't run, last used first, the pane before the rest; typing ranks and explains", async () => {
  await setup()
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
  expect(undo.at(-1)?.id).toBe("txn:undo")
  expect(undo.at(-1)?.disabled).toBeTruthy()
})

test("run from another tab: it goes where it needs, and is listed first next time", async () => {
  await setup()
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
  expect(ui.state.dryRun?.report).not.toBeNull()
  ui.setState({ dryRun: null })
  open()
  expect(paletteList(ui, data)[0]?.id).toBe("rules:dry-run")
  handleKey(ui, key("escape"), data)
})

test("a saved filter from Overview filters the table; adding a category opens its editor in Settings", async () => {
  await setup()
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
  expect(ui.state.settingsEditor?.kind).toBe("category")
})

test("enter on one that can't run says why and keeps the palette open", async () => {
  await setup()
  open()
  type("undo")
  const at = paletteList(ui, data).findIndex((c) => c.id === "txn:undo")
  ui.setState({ palette: { ...ui.state.palette!, cursor: at } })
  handleKey(ui, key("return"), data)
  expect(ui.state.palette).not.toBeNull()
  handleKey(ui, key("escape"), data)
})

test("moving doesn't rebuild the list: the same commands until the query changes or it reopens", async () => {
  await setup()
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
  await setup()
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

test("ctrl+k inside a picker still moves its cursor", async () => {
  await setup()
  handleKey(ui, key("c"), data)
  handleKey(ui, key("j", { ctrl: true }), data)
  handleKey(ui, key("k", { ctrl: true }), data)
  expect(ui.state.palette).toBeNull()
  expect(ui.activeScope()).toBe("catPicker")
  handleKey(ui, key("escape"), data)
})

test("the palette's cursor row gets the cursor look in the cells", async () => {
  const t = await renderApp({ width: 140, height: 54 })
  try {
    await setup()
    open()
    await t.renderOnce()
    const cursorCommand = paletteList(ui, data)[ui.state.palette!.cursor]!
    const spans = t.captureSpans().lines.flatMap((l) => l.spans)
    const bar = spans.find((s) => s.text.startsWith(cursorCommand.label))!
    expect(bar.bg.toInts()).toEqual(RGBA.fromHex(theme.rowCursor).toInts())
  } finally { t.renderer.destroy() }
})
