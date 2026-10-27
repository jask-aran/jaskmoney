import { expect, onTestFinished, spyOn, test } from "bun:test"
import { footerHints, handleKey } from "./keys"
import { ui } from "../state/uiStore"
import { data } from "../state/dataStore"
import { key } from "../testing/keys"
import { testEnv } from "../testing/scoped"

/** Data with no Jev and no network: suggestions come from history. */
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
  const add = (id: number, description: string, amount: number, categoryId: number | null = null) =>
    db.query(`INSERT INTO transactions (id, date_raw, date_iso, amount, description, category_id, account_id, source)
      VALUES (?, '2026-10-0' || ?, '2026-10-0' || ?, ?, ?, ?, 100, 'csv')`).run(id, id, id, amount, description, categoryId)
  add(1, "Shop", -10, 100)
  add(2, "Shop", -12)
  add(3, "Mystery", -5)
  add(4, "Shop", -3)
  add(5, "Shop", -7, 100)
  add(6, "Shop", -8, 100)
  add(7, "Shop", -9, 100)
  data.refresh()
  data.clearFilter()
  ui.switchTab("manager")
  ui.setState({ focusedSection: "mgr.transactions", managerCursor: 0, managerTop: 0, selectedIds: {}, rangeSelecting: false })
  onTestFinished(() => { data.setUncategorisedOnly(false); data.init(":memory:") })
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 5))
const shown = () => data.scopedTransactions().map((t) => t.description + t.id)

test("i shows only rows to categorise, with suggestions; y accepts, x dismisses, Y takes the confident ones; i goes back", async () => {
  setup()
  expect(footerHints("manager.txns", { focusedSection: "mgr.transactions", drillReturn: null, chartViews: [0, 4] }).some((h) => h.key === "i")).toBe(true)
  handleKey(ui, key("i"), data)
  expect(data.state.uncategorisedOnly).toBe(true)
  expect(shown()).toEqual(["Shop4", "Mystery3", "Shop2"])
  await settle()
  // History: four earlier Shops, all Test food, settle both uncategorised Shops (4/5 = 80%).
  expect(Object.values(data.state.suggestions).map((s) => [s.transactionId, s.categoryId, s.confidence]).sort()).toEqual([[2, 100, 0.8], [4, 100, 0.8]])

  expect(footerHints("manager.txns", { focusedSection: "mgr.transactions", drillReturn: null, chartViews: [0, 4], uncategorisedOnly: true }).map((h) => h.key)).toContain("Y")

  // y on the cursor row (Shop4) accepts its suggestion; the row leaves the view.
  handleKey(ui, key("y"), data)
  await settle()
  expect(data.transactions().find((t) => t.id === 4)?.categoryName).toBe("Test food")
  expect(shown()).toEqual(["Mystery3", "Shop2"])

  // x on a row without a suggestion says so; nothing changes.
  handleKey(ui, key("x"), data)
  expect(ui.state.status).toBe("No suggestion to dismiss")

  // Y accepts every suggestion at or above the threshold: Shop2.
  handleKey(ui, key("y", { shift: true, sequence: "Y" }), data)
  await settle()
  expect(shown()).toEqual(["Mystery3"])

  handleKey(ui, key("i"), data)
  expect(data.state.uncategorisedOnly).toBe(false)
  expect(shown()).toHaveLength(7)
})

test("x dismisses the selected rows' suggestions without categorising them", async () => {
  setup()
  handleKey(ui, key("i"), data)
  await settle()
  ui.setState({ selectedIds: { 2: true, 4: true } })
  handleKey(ui, key("x"), data)
  expect(data.state.suggestions).toEqual({})
  expect(shown()).toEqual(["Shop4", "Mystery3", "Shop2"])
  expect(ui.state.selectedIds).toEqual({})
})
