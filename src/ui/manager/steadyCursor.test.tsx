import { expect, test } from "bun:test"
import { handleKey } from "../../app/keys"
import { data } from "../../state/dataStore"
import { ui } from "../../state/uiStore"
import { renderApp } from "../../testing/app"
import { account, transaction } from "../../testing/fixtures"
import { key } from "../../testing/keys"

const suggestion = (id: number, confidence: number) => ({ transactionId: id, categoryId: 1, confidence, source: "jev" as const })

test("new suggestions don't reorder the Uncategorised view under the cursor; reopening sorts afresh; s still goes to the top", async () => {
  const t = await renderApp({ width: 140, height: 30 })
  const rows = [1, 2, 3, 4].map((id) => transaction({ id, description: `Row ${id}`, categoryId: null, categoryName: "" }))
  data.setState({ accounts: [account({ name: "A" })], transactions: rows, accountSelection: "all", ready: true,
    suggestions: { 1: suggestion(1, 0.9), 2: suggestion(2, 0.8), 3: suggestion(3, 0.7), 4: suggestion(4, 0.6) } })
  data.setUncategorisedOnly(true)
  ui.switchTab("manager")
  ui.setState({ focusedSection: "mgr.transactions", managerCursor: 0, managerTop: 0, range: null })
  await t.renderOnce()
  handleKey(ui, key("j"), data)
  handleKey(ui, key("j"), data)
  const at = () => data.scopedTransactions()[ui.state.managerCursor]?.id
  expect(at()).toBe(3)
  data.setState("suggestions", 3, suggestion(3, 0.95))
  data.setState("suggestions", 4, suggestion(4, 0.99))
  await t.renderOnce()
  expect(data.scopedTransactions().map((r) => r.id)).toEqual([1, 2, 3, 4])
  expect(ui.state.managerCursor).toBe(2)
  expect(at()).toBe(3)
  data.setState("suggestions", 1, suggestion(1, 0.5))
  await t.renderOnce()
  expect(data.scopedTransactions().map((r) => r.id)).toEqual([2, 3, 4, 1])
  expect(at()).toBe(3)
  data.setState("suggestions", 1, suggestion(1, 0.97))
  await t.renderOnce()
  expect(data.scopedTransactions().map((r) => r.id)).toEqual([2, 3, 4, 1])
  data.setUncategorisedOnly(false)
  data.setUncategorisedOnly(true)
  expect(data.scopedTransactions().map((r) => r.id)).toEqual([4, 1, 3, 2])
  ui.jumpManagerCursor(1, 4)
  handleKey(ui, key("j"), data)
  handleKey(ui, key("s"), data)
  await t.renderOnce()
  expect(ui.state.managerCursor).toBe(0)
  ui.jumpManagerCursor(1, 4)
  await t.renderOnce()
  const next = data.scopedTransactions()[2]!.id
  const gone = at()!
  data.setState("transactions", (list) => list.map((r) => (r.id === gone ? { ...r, categoryId: 1, categoryName: "Cat" } : r)))
  await t.renderOnce()
  expect(ui.state.managerCursor).toBe(1)
  expect(at()).toBe(next)
})
