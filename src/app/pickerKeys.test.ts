import { expect, onTestFinished, spyOn, test } from "bun:test"
import { data } from "../state/dataStore"
import { ui } from "../state/uiStore"
import { key } from "../testing/keys"
import { testEnv } from "../testing/scoped"
import { footerHints, handleKey } from "./keys"

/**
 * Acceptance tests for ctrl+j/k in type-to-filter lists (K7) and the rule
 * offers' "Ask the AI" row (K9) — frozen: change the code, not these.
 */
function setup() {
  testEnv("JASKMONEY_OPENROUTER_TOKEN", "")
  const network = spyOn(globalThis, "fetch").mockImplementation(Object.assign(() => Promise.reject(new Error("network is forbidden")), { preconnect: globalThis.fetch.preconnect }))
  onTestFinished(() => { network.mockRestore(); ui.setState({ catPickerOpen: false, tagPickerOpen: false, tagChooserOpen: false, ruleOffersOpen: false }); data.init(":memory:") })
  data.init(":memory:")
  const db = data.getDb()!
  db.query("INSERT INTO accounts (id, name, type, source) VALUES (100, 'Spending', 'debit', 'csv')").run()
  db.query("INSERT INTO transactions (id, date_raw, date_iso, amount, description, account_id, source) VALUES (1, 'x', '2026-10-01', -5, 'Shop', 100, 'csv')").run()
  data.refresh()
  data.setAccountSelection("all")
  ui.switchTab("manager")
  ui.setState({ focusedSection: "mgr.transactions", managerCursor: 0, selectedIds: {} })
}
const ctrl = (name: string) => key(name, { ctrl: true })

test("ctrl+j / ctrl+k move in the category picker, tag picker and tag chooser, and don't type", () => {
  setup()
  handleKey(ui, key("c"), data)
  handleKey(ui, ctrl("j"), data); handleKey(ui, ctrl("j"), data); handleKey(ui, ctrl("k"), data)
  expect(ui.state.catPickerCursor).toBe(1)
  expect(ui.state.catPickerQuery).toBe("")
  handleKey(ui, key("escape"), data)

  data.createSettingsTag({ name: "AAA", color: "#fff", scope: null })
  data.createSettingsTag({ name: "BBB", color: "#fff", scope: null })
  handleKey(ui, key("t"), data)
  handleKey(ui, ctrl("j"), data)
  expect(ui.state.tagPickerCursor).toBe(1)
  handleKey(ui, ctrl("k"), data)
  expect(ui.state.tagPickerCursor).toBe(0)
  handleKey(ui, key("escape"), data)

  handleKey(ui, key("t", { shift: true }), data)
  handleKey(ui, ctrl("j"), data)
  expect(ui.state.tagChooserCursor).toBe(1)
  expect(ui.state.tagChooserQuery).toBe("")
  handleKey(ui, key("escape"), data)
})

test("the pickers' footers say ↑/↓ or ctrl+j/k move", () => {
  for (const scope of ["catPicker", "tagPicker", "tagChooser", "filterPicker"] as const) {
    const hints = footerHints(scope, { focusedSection: "mgr.transactions", drillReturn: null, chartViews: [0, 4] })
    expect(hints[0]).toEqual({ key: "↑↓ ^j/k", desc: "move" })
  }
})

test("rule offers: the last row asks the AI (when a model is set up); a no longer does", async () => {
  setup()
  testEnv("JASKMONEY_OPENROUTER_TOKEN", "test-key")
  handleKey(ui, key("r", { shift: true }), data)
  expect(ui.state.ruleOffersOpen).toBe(true)
  expect(data.allRuleOffers()).toEqual([])
  // a does nothing now.
  handleKey(ui, key("a"), data)
  expect(data.state.writingRules).toBe(false)
  // With no offers, the cursor is on the ask row; enter asks.
  expect(ui.state.ruleOfferCursor).toBe(0)
  handleKey(ui, key("return"), data)
  expect(ui.state.status).toStartWith("Asking ")
  await Bun.sleep(20)
  const hints = footerHints("manager.ruleOffers", { focusedSection: "mgr.transactions", drillReturn: null, chartViews: [0, 4] }).map((h) => h.key)
  expect(hints).not.toContain("a")
  handleKey(ui, key("escape"), data)
})

test("rule offers without a model: no ask row, and R says how to get offers", () => {
  setup()
  handleKey(ui, key("r", { shift: true }), data)
  expect(ui.state.ruleOffersOpen).toBe(false)
  expect(ui.state.status).toStartWith("No rule to offer")
})
