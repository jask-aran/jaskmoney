import { expect, onTestFinished, test } from "bun:test"
import { data } from "../state/dataStore"
import { ui } from "../state/uiStore"
import { renderApp } from "../testing/app"
import { key } from "../testing/keys"
import { footerHints, footerLine, handleKey } from "./keys"
import { FOOTER_LIMIT, hintEvent, paletteEntries } from "./palette"

const state = { focusedSection: "mgr.transactions" as const, drillReturn: null, chartViews: [0, 4] as [number, number] }

function setup() {
  onTestFinished(() => { ui.setState({ palette: null, catPickerOpen: false }); data.init(":memory:") })
  data.init(":memory:")
  const db = data.getDb()!
  db.query("INSERT INTO accounts (id, name, type, source) VALUES (100, 'Spending', 'debit', 'csv')").run()
  db.query("INSERT INTO transactions (id, date_raw, date_iso, amount, description, account_id, source) VALUES (1, 'x', '2026-10-01', -5, 'Shop', 100, 'csv')").run()
  data.refresh()
  data.setAccountSelection("all")
  ui.switchTab("manager")
  ui.setState({ focusedSection: "mgr.transactions", managerCursor: 0, selectedIds: {} })
}

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

test("the palette lists a scope's one-key actions and the global ones, each key once, and filters fuzzily", () => {
  const all = paletteEntries(footerHints("manager.txns", state), "")
  const keys = all.map((e) => e.key)
  expect(keys).toContain("i")
  expect(keys).toContain("ctrl+l")
  expect(keys).toContain("ctrl+r")
  expect(keys).toContain("1")
  expect(keys).not.toContain("j/k")
  expect(keys).not.toContain("esc")
  expect(new Set(keys).size).toBe(keys.length)
  expect(paletteEntries(footerHints("manager.txns", state), "uncat")[0]).toMatchObject({ label: "uncategorised", key: "i" })
})

test("the footer shows the first few hints, then ctrl+k all; short lists stay whole", () => {
  const line = footerLine("manager.txns", state)
  expect(line).toHaveLength(FOOTER_LIMIT + 1)
  expect(line.at(-1)).toEqual({ key: "ctrl+k", desc: "all" })
  expect(line.map((h) => h.key)).toEqual(["j/k", "c", "t", "space", "/", "?", "u", "esc"].concat("ctrl+k"))
  expect(footerLine("settings.taxonomy", state)).toEqual(footerHints("settings.taxonomy", state))
  // Not in a modal: the palette doesn't open there.
  expect(footerLine("catPicker", state).some((h) => h.key === "ctrl+k")).toBe(false)
})

test("ctrl+k opens over Transactions; typing filters; enter runs the action in Transactions; esc closes", () => {
  setup()
  handleKey(ui, key("k", { ctrl: true }), data)
  expect(ui.activeScope()).toBe("palette")
  expect(ui.state.palette).toMatchObject({ from: "manager.txns", query: "" })
  // j and k are text here.
  for (const c of "uncat") handleKey(ui, key(c), data)
  expect(ui.state.palette?.query).toBe("uncat")
  handleKey(ui, key("return"), data)
  expect(ui.state.palette).toBeNull()
  expect(data.state.uncategorisedOnly).toBe(true)
  handleKey(ui, key("k", { ctrl: true }), data)
  handleKey(ui, key("escape"), data)
  expect(ui.state.palette).toBeNull()
  expect(data.state.uncategorisedOnly).toBe(true)
})

test("a tab from the palette switches tab; ctrl+k inside a picker still moves its cursor", () => {
  setup()
  handleKey(ui, key("k", { ctrl: true }), data)
  for (const c of "settings tab") handleKey(ui, key(c === " " ? "space" : c), data)
  handleKey(ui, key("return"), data)
  expect(ui.state.activeTab).toBe("settings")
  ui.switchTab("manager")
  ui.setState({ focusedSection: "mgr.transactions" })
  handleKey(ui, key("c"), data)
  handleKey(ui, key("j", { ctrl: true }), data)
  handleKey(ui, key("k", { ctrl: true }), data)
  expect(ui.state.palette).toBeNull()
  expect(ui.activeScope()).toBe("catPicker")
})

test("the palette renders its commands with their keys, over the pane it opened from", async () => {
  const t = await renderApp({ width: 140, height: 40 })
  try {
    setup()
    handleKey(ui, key("k", { ctrl: true }), data)
    await t.renderOnce()
    const frame = t.captureCharFrame()
    expect(frame).toContain("Commands")
    expect(frame).toContain("Transactions")
    expect(frame).toMatch(/uncategorised\s+i\b/)
    expect(frame).toContain("enter run")
  } finally { t.renderer.destroy() }
})
