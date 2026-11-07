import { expect, test } from "bun:test"
import { data } from "./dataStore"
import { ui } from "./uiStore"

test("rows that no longer exist leave the selection, the picker's targets and the open detail; surviving ones stay", async () => {
  data.init(":memory:")
  const db = data.getDb()!
  db.query("INSERT INTO accounts (id, name, type, source) VALUES (100, 'One', 'debit', 'csv'), (200, 'Two', 'debit', 'csv')").run()
  db.query("INSERT INTO transactions (id, date_raw, date_iso, amount, description, account_id, source) VALUES (1, 'x', '2026-10-01', -1, 'One', 100, 'csv'), (2, 'x', '2026-10-02', -2, 'Two', 200, 'csv')").run()
  data.refresh()
  ui.setState({ selectedIds: { 1: true, 2: true }, pickerTargets: [1, 2], detail: { id: 1, boughtTop: 3, notes: { draft: "keep", caret: 4 } } })
  await data.clearAccountData(200)
  expect(ui.state.selectedIds).toEqual({ 1: true })
  expect(ui.state.pickerTargets).toEqual([1])
  expect(ui.state.detail).toEqual({ id: 1, boughtTop: 3, notes: { draft: "keep", caret: 4 } })
  // Its row gone too, the detail closes.
  await data.clearAccountData(100)
  expect(ui.state.selectedIds).toEqual({})
  expect(ui.state.pickerTargets).toEqual([])
  expect(ui.state.detail).toBeNull()
})
