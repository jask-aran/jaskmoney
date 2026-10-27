import { expect, test } from "bun:test"
import { handleKey } from "../../app/keys"
import { data } from "../../state/dataStore"
import { ui } from "../../state/uiStore"
import { renderApp } from "../../testing/app"
import { account, transaction } from "../../testing/fixtures"
import { key } from "../../testing/keys"

const suggestion = (id: number, confidence: number) => ({ transactionId: id, categoryId: 1, confidence, source: "jev" as const })

test("a suggestion that re-sorts the Uncategorised view keeps the cursor on its transaction; s still goes to the top", async () => {
  const t = await renderApp({ width: 140, height: 30 })
  const rows = [1, 2, 3, 4].map((id) => transaction({ id, description: `Row ${id}`, categoryId: null, categoryName: "" }))
  data.setState({ accounts: [account({ name: "A" })], transactions: rows, accountSelection: "all", ready: true,
    suggestions: { 1: suggestion(1, 0.9), 2: suggestion(2, 0.8), 3: suggestion(3, 0.7), 4: suggestion(4, 0.6) } })
  data.setUncategorisedOnly(true)
  ui.switchTab("manager")
  ui.setState({ focusedSection: "mgr.transactions", managerCursor: 0, managerTop: 0, rangeSelecting: false })
  await t.renderOnce()
  handleKey(ui, key("j"), data)
  handleKey(ui, key("j"), data)
  const at = () => data.scopedTransactions()[ui.state.managerCursor]?.id
  expect(at()).toBe(3)
  // Row 3's new suggestion puts it first: the cursor goes with it.
  data.setState("suggestions", 3, suggestion(3, 0.95))
  await t.renderOnce()
  expect(data.scopedTransactions()[0]!.id).toBe(3)
  expect(ui.state.managerCursor).toBe(0)
  expect(at()).toBe(3)
  // A row moving past the cursor doesn't drag it along.
  data.setState("suggestions", 4, suggestion(4, 0.99))
  await t.renderOnce()
  expect(at()).toBe(3)
  // A change of view keeps the index rules: s goes to the top.
  handleKey(ui, key("j"), data)
  handleKey(ui, key("s"), data)
  await t.renderOnce()
  expect(ui.state.managerCursor).toBe(0)
  // The cursor's row leaving the view: the next comes up at the same place.
  ui.jumpManagerCursor(1, 4)
  await t.renderOnce()
  const next = data.scopedTransactions()[2]!.id
  const gone = at()!
  data.setState("transactions", (list) => list.map((r) => (r.id === gone ? { ...r, categoryId: 1, categoryName: "Cat" } : r)))
  await t.renderOnce()
  expect(ui.state.managerCursor).toBe(1)
  expect(at()).toBe(next)
})
