import { expect, test } from "bun:test"
import { handleKey } from "../app/keys"
import { account, transaction } from "../testing/fixtures"
import { key } from "../testing/keys"
import { data } from "./dataStore"
import { ui } from "./uiStore"

test("pruning existing rows preserves the store objects", () => {
  ui.setState({ selectedIds: { 1: true }, pickerTargets: [1], detail: { id: 1, boughtTop: 0, notes: null } })
  const selectedIds = ui.state.selectedIds
  const pickerTargets = ui.state.pickerTargets
  const detail = ui.state.detail
  ui.pruneRows(new Set([1]))
  expect(ui.state.selectedIds).toBe(selectedIds)
  expect(ui.state.pickerTargets).toBe(pickerTargets)
  expect(ui.state.detail).toBe(detail)
})

test("row zero is a range anchor; a missing end clears only the range during validation", () => {
  data.setState({ accounts: [account()], transactions: [0, 1, 2].map((id) => transaction({ id, dateISO: `2026-10-0${id + 1}` })), sortAscending: true, accountSelection: "all", ready: true })
  ui.switchTab("manager")
  ui.setState({ focusedSection: "mgr.transactions" })
  const rows = data.scopedTransactions()
  ui.jumpManagerCursor(rows.findIndex((row) => row.id === 0), rows.length)
  handleKey(ui, key("j", { shift: true }), data)
  handleKey(ui, key("j", { shift: true }), data)
  expect(ui.state.range).toEqual({ anchorId: 0, cursorId: 2 })
  ui.setState({ selectedIds: { 1: true } })
  // Supply shown rows directly to isolate validation from the filter language.
  ui.ensureRange([{ id: 1 }])
  expect(ui.state.range).toBeNull()
  expect(ui.state.selectedIds).toEqual({ 1: true })
})

test("a reload prunes picker targets and keeps the surviving detail and picked rows", async () => {
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
})
