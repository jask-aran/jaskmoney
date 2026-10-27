import { expect, test } from "bun:test"
import { RGBA, TextAttributes } from "@opentui/core"
import { handleKey } from "../../app/keys"
import { data } from "../../state/dataStore"
import { ui } from "../../state/uiStore"
import { renderApp } from "../../testing/app"
import { key } from "../../testing/keys"
import { theme } from "../../theme"

/** Table rows are one styled line each (StyledLine): prove, from captured
 * cells, that the cursor's bold and bar move with it and clear behind it. */
test("the cursor row is bold on its bar; the row it leaves returns to normal weight on the canvas", async () => {
  const t = await renderApp({ width: 140, height: 30 })
  data.init(":memory:")
  const db = data.getDb()!
  db.query("INSERT INTO accounts (id, name, type, source) VALUES (100, 'Spending', 'debit', 'csv')").run()
  db.query("INSERT INTO transactions (id, date_raw, date_iso, amount, description, account_id, source) VALUES (1, 'x', '2026-10-02', -5, 'Alpha Cafe', 100, 'csv')").run()
  db.query("INSERT INTO transactions (id, date_raw, date_iso, amount, description, account_id, source) VALUES (2, 'x', '2026-10-01', -7, 'Beta Shop', 100, 'csv')").run()
  data.refresh()
  data.setAccountSelection("all")
  ui.switchTab("manager")
  ui.setState({ focusedSection: "mgr.transactions", managerCursor: 0, managerTop: 0, selectedIds: {} })
  await t.renderOnce()
  const cell = (text: string) => t.captureSpans().lines.flatMap((l) => l.spans).find((s) => s.text.includes(text))!
  const ints = (hex: string) => RGBA.fromHex(hex).toInts()
  expect(cell("Alpha Cafe").attributes & TextAttributes.BOLD).toBe(TextAttributes.BOLD)
  expect(cell("Alpha Cafe").bg.toInts()).toEqual(ints(theme.surface2))
  expect(cell("Beta Shop").attributes & TextAttributes.BOLD).toBe(0)
  expect(cell("Beta Shop").bg.toInts()).toEqual(ints(theme.canvas))
  handleKey(ui, key("j"), data)
  await t.renderOnce()
  expect(cell("Alpha Cafe").attributes & TextAttributes.BOLD).toBe(0)
  expect(cell("Alpha Cafe").bg.toInts()).toEqual(ints(theme.canvas))
  expect(cell("Beta Shop").attributes & TextAttributes.BOLD).toBe(TextAttributes.BOLD)
  // Selected (not the cursor): its marker and background.
  ui.setState({ selectedIds: { 1: true } })
  await t.renderOnce()
  expect(t.captureCharFrame()).toMatch(/\*\d\d-10-26/)
  expect(cell("Alpha Cafe").bg.toInts()).toEqual(ints(theme.surface0))
  t.renderer.destroy()
})
