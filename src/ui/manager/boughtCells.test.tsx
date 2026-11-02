import { expect, test } from "bun:test"
import { handleKey } from "../../app/keys"
import { data } from "../../state/dataStore"
import { ui } from "../../state/uiStore"
import { renderApp } from "../../testing/app"
import { key } from "../../testing/keys"

// Invented rows: an Amazon order with items, and a plain row.
async function setup() {
  const t = await renderApp({ width: 160, height: 40 })
  data.init(":memory:")
  const db = data.getDb()!
  db.query("INSERT INTO accounts (id, name, type, source) VALUES (100, 'Spending', 'debit', 'up')").run()
  db.query("INSERT INTO transactions (id, date_raw, date_iso, amount, description, account_id, source) VALUES (1, 'x', '2026-10-02', -69.99, 'Amazon', 100, 'up')").run()
  db.query("INSERT INTO transactions (id, date_raw, date_iso, amount, description, account_id, source) VALUES (2, 'x', '2026-10-01', -7, 'Beta Shop', 100, 'up')").run()
  const items = Array.from({ length: 12 }, (_, i) => ({ name: i ? `Brush Head ${i}` : "Electric Toothbrush", quantity: i === 1 ? 2 : 1, price: i ? 5.5 : 59.99 }))
  db.query("INSERT INTO purchase_lookups (transaction_id, status, source, items, checks, checked_at) VALUES (1, 'found', 'amazon', ?, 1, '2026-10-02T00:00:00Z')").run(JSON.stringify(items))
  const tech = Number(db.query("INSERT INTO categories (name, color, sort_order) VALUES ('Technology', '#89b4fa', 90)").run().lastInsertRowid)
  db.query("INSERT INTO category_suggestions (transaction_id, category_id, confidence, source, knew_bought) VALUES (1, ?, 0.62, 'jev', 1)").run(tech)
  data.refresh()
  data.setAccountSelection("all")
  ui.switchTab("manager")
  ui.setState({ focusedSection: "mgr.transactions", managerCursor: 1, managerTop: 0, selectedIds: {} })
  await t.renderOnce()
  return { t }
}

test("Uncategorised: the suggestion's confidence, and a Details column instead of tags", async () => {
  const { t } = await setup()
  data.setUncategorisedOnly(true)
  ui.setState({ managerCursor: 1 })
  await t.renderOnce()
  const frame = t.captureCharFrame()
  expect(frame).toContain("Details")
  expect(frame).not.toMatch(/ Tags/)
  expect(frame).toMatch(/62%.*Technology/)
  t.renderer.destroy()
})

test("detail: the Bought list shows 10 items; J/K scroll it, j/k still move rows", async () => {
  const { t } = await setup()
  ui.setState({ managerCursor: 0, detail: { boughtTop: 0, notes: null, id: 1 } })
  await t.renderOnce()
  let frame = t.captureCharFrame()
  expect(frame).toMatch(/Brush Head 9/)
  expect(frame).not.toMatch(/Brush Head 10/)
  handleKey(ui, key("J"), data)
  handleKey(ui, key("J"), data)
  handleKey(ui, key("J"), data)
  await t.renderOnce()
  frame = t.captureCharFrame()
  expect(frame).toMatch(/Brush Head 11/)
  expect(ui.state.detail?.boughtTop).toBe(2)
  handleKey(ui, key("j"), data)
  expect((ui.state.detail?.id ?? null)).toBe(2)
  expect((ui.state.detail?.boughtTop ?? 0)).toBe(0)
  t.renderer.destroy()
})
