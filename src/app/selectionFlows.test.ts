import { afterEach, beforeEach, expect, test } from "bun:test"
import { data } from "../state/dataStore"
import { ui } from "../state/uiStore"
import { key } from "../testing/keys"
import { handleKey } from "./keys"

/**
 * The Transactions selection machine (legacy update_transactions.go:
 * ensureRangeSelectionValid, pruneSelections) and the detail dialog —
 * frozen: change the code, not these.
 *
 * Picked rows (space) stay through filtering and sorting, by id, and go
 * when their row no longer exists. A range (shift+move) is its two end ids:
 * it ends when either end isn't among the rows shown.
 */

beforeEach(() => {
  data.init(":memory:")
  const db = data.getDb()!
  db.query("INSERT INTO accounts (id, name, type, source) VALUES (100, 'Spending', 'debit', 'csv'), (200, 'Other', 'debit', 'csv')").run()
  const add = (id: number, description: string, account = 100) =>
    db.query("INSERT INTO transactions (id, date_raw, date_iso, amount, description, account_id, source) VALUES (?, 'x', ?, -5, ?, ?, 'csv')").run(id, `2026-10-${String(30 - id).padStart(2, "0")}`, description, account)
  add(1, "Alpha"); add(2, "Bravo"); add(3, "Charlie"); add(4, "Delta"); add(5, "Echo", 200)
  data.refresh()
  data.setAccountSelection("all")
  ui.switchTab("manager")
  ui.setState({ focusedSection: "mgr.transactions" })
  ui.jumpManagerCursor(0, data.scopedTransactions().length)
})
afterEach(() => { data.clearFilter(); ui.reset() })

const rows = () => data.scopedTransactions()
const ids = () => rows().map((t) => t.id)

test("a range whose end is filtered out is no range: actions fall back to the selection, then the cursor row", () => {
  expect(ids()).toEqual([1, 2, 3, 4, 5])
  handleKey(ui, key("j", { shift: true }), data)
  handleKey(ui, key("j", { shift: true }), data)
  expect(ui.targetIds(rows()).sort()).toEqual([1, 2, 3])
  // Filter out the range's anchor (row 1).
  data.setFilterLive("desc:bravo or desc:charlie or desc:delta")
  data.commitFilter("desc:bravo or desc:charlie or desc:delta")
  ui.jumpManagerCursor(0, rows().length)
  expect(ui.highlightedIds(rows())).toEqual({})
  expect(ui.targetIds(rows())).toEqual([rows()[0]!.id])
})

test("picked rows stay through a filter and a sort, by id", () => {
  handleKey(ui, key("space"), data)
  handleKey(ui, key("j"), data)
  handleKey(ui, key("j"), data)
  handleKey(ui, key("space"), data)
  expect(Object.keys(ui.state.selectedIds).map(Number).sort()).toEqual([1, 3])
  data.setFilterLive("desc:alpha or desc:charlie")
  data.commitFilter("desc:alpha or desc:charlie")
  handleKey(ui, key("s"), data)
  expect(Object.keys(ui.state.selectedIds).map(Number).sort()).toEqual([1, 3])
})
