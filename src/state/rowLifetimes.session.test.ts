import { expect, test } from "bun:test"
import { transaction } from "../testing/fixtures"
import { data } from "./dataStore"
import { ui } from "./uiStore"

test("a session change forgets all row targets even when ids and version are unchanged", () => {
  data.setState({ transactions: [transaction({ id: 1 }), transaction({ id: 2 })] })
  ui.setState({
    selectedIds: { 1: true }, range: { anchorId: 1, cursorId: 2 }, pickerTargets: [1, 2],
    detail: { id: 1, boughtTop: 0, notes: { draft: "old database", caret: 0 } }, acceptPreview: [1],
    managerCursor: 1, managerTop: 1,
  })
  const version = data.state.version
  data.setState({ session: data.state.session + 1 })
  expect(data.state.version).toBe(version)
  expect(data.state.transactions.map((row) => row.id)).toEqual([1, 2])
  expect(ui.state.selectedIds).toEqual({})
  expect(ui.state.range).toBeNull()
  expect(ui.state.pickerTargets).toEqual([])
  expect(ui.state.detail).toBeNull()
  expect(ui.state.acceptPreview).toBeNull()
  expect(ui.state.managerCursor).toBe(1)
  expect(ui.state.managerTop).toBe(1)
})

test("version pruning still keeps surviving row targets in the same session", () => {
  data.setState({ transactions: [transaction({ id: 1 }), transaction({ id: 2 })] })
  ui.setState({ selectedIds: { 1: true, 2: true }, pickerTargets: [1, 2], detail: { id: 1, boughtTop: 2, notes: null } })
  data.setState({ transactions: [transaction({ id: 1 })], version: data.state.version + 1 })
  expect(ui.state.selectedIds).toEqual({ 1: true })
  expect(ui.state.pickerTargets).toEqual([1])
  expect(ui.state.detail).toEqual({ id: 1, boughtTop: 2, notes: null })
})
