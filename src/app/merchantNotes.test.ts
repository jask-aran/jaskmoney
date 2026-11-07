import { expect, onTestFinished, spyOn, test } from "bun:test"
import { handleKey } from "./keys"
import { ui } from "../state/uiStore"
import { data } from "../state/dataStore"
import { key } from "../testing/keys"
import { testEnv } from "../testing/scoped"

function setup() {
  testEnv("JASKMONEY_JEV_TOKEN", "")
  const network = spyOn(globalThis, "fetch").mockImplementation(Object.assign(() => { throw new Error("network is forbidden") }, { preconnect: globalThis.fetch.preconnect }))
  onTestFinished(() => {
    try { expect(network).not.toHaveBeenCalled() } finally { network.mockRestore() }
  })
  data.init(":memory:")
  const db = data.getDb()!
  db.query("INSERT INTO accounts (id, name, type, source) VALUES (100, 'Spending', 'debit', 'csv')").run()
  db.query("INSERT INTO categories (id, name, color) VALUES (100, 'Test food', '#fff')").run()
  for (const [id, description] of [[1, "Bulk Barn"], [2, "Bulk Barn"], [3, "Bulk Barn"], [4, "Corner Bar"]] as const) {
    db.query(`INSERT INTO transactions (id, date_raw, date_iso, amount, description, category_id, account_id, source)
      VALUES (?, '2026-10-01', '2026-10-01', -5, ?, 100, 100, 'csv')`).run(id, description)
  }
  db.query("INSERT INTO merchant_breadth (merchant, probability) VALUES ('bulk barn', 0.9)").run()
  data.refresh()
  data.clearFilter()
  ui.switchTab("manager")
  ui.setState({ focusedSection: "mgr.transactions", txnView: "rows", managerCursor: 0, managerTop: 0, selectedIds: {}, merchantNote: null })
  onTestFinished(() => { ui.setState({ merchantNote: null, txnView: "rows" }); data.init(":memory:") })
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 5))

test("n in Merchants writes a note (letters are text); N on a row opens the same; empty removes it; esc keeps it", async () => {
  setup()
  ui.setState({ txnView: "merchants", merchantCursor: 0 })
  expect(data.notePrompts().get("bulk barn")).toEqual({ kind: "always", categoryId: 100 })
  handleKey(ui, key("n"), data)
  expect(ui.activeScope()).toBe("merchantNote")
  const merchant = ui.state.merchantNote!.merchant
  for (const c of "jk always q") handleKey(ui, key(c === " " ? "space" : c), data)
  expect(ui.state.merchantNote!.draft).toBe("jk always q")
  handleKey(ui, key("return"), data)
  await settle()
  expect(ui.state.merchantNote).toBeNull()
  expect(data.state.merchantNotes[merchant.toLowerCase()]).toBe("jk always q")
  expect(data.notePrompts().has(merchant.toLowerCase())).toBe(false)
  // N on the row: the same note to edit; esc leaves it.
  ui.setState({ txnView: "rows", managerCursor: data.scopedTransactions().findIndex((t) => t.description === merchant) })
  handleKey(ui, key("n", { shift: true }), data)
  expect(ui.state.merchantNote).toMatchObject({ merchant, draft: "jk always q" })
  handleKey(ui, key("x"), data)
  handleKey(ui, key("escape"), data)
  expect(data.state.merchantNotes[merchant.toLowerCase()]).toBe("jk always q")
  // Emptied: removed.
  handleKey(ui, key("n", { shift: true }), data)
  for (let i = 0; i < 11; i++) handleKey(ui, key("backspace"), data)
  handleKey(ui, key("return"), data)
  await settle()
  expect(data.state.merchantNotes[merchant.toLowerCase()]).toBeUndefined()
})
