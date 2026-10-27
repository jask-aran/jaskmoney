import { expect, onTestFinished, spyOn, test } from "bun:test"
import { data } from "../state/dataStore"
import { ui } from "../state/uiStore"
import { key } from "../testing/keys"
import { testEnv } from "../testing/scoped"
import { handleKey } from "./keys"

/**
 * K3: esc steps back one level at a time in Transactions: the selection,
 * then a drill-down (back to Overview: its filter is the drill), then the
 * filter, then a special view (tag review, then the Uncategorised view).
 */
function setup() {
  testEnv("JASKMONEY_JEV_TOKEN", "")
  testEnv("JASKMONEY_UP_TOKEN", "")
  const network = spyOn(globalThis, "fetch").mockImplementation(Object.assign(() => Promise.reject(new Error("network is forbidden")), { preconnect: globalThis.fetch.preconnect }))
  onTestFinished(() => { network.mockRestore(); data.closeTagReview(); data.init(":memory:") })
  data.init(":memory:")
  const db = data.getDb()!
  db.query("INSERT INTO accounts (id, name, type, source) VALUES (100, 'Spending', 'debit', 'csv')").run()
  for (const [id, d] of [[1, "Shop"], [2, "Shop"], [3, "Cafe"]] as const) {
    db.query("INSERT INTO transactions (id, date_raw, date_iso, amount, description, account_id, source) VALUES (?, 'x', ?, -5, ?, 100, 'csv')").run(id, `2026-10-0${id}`, d)
  }
  data.refresh()
  data.setAccountSelection("all")
  ui.switchTab("manager")
  ui.setState({ focusedSection: "mgr.transactions", managerCursor: 0, selectedIds: {}, rangeSelecting: false, drillReturn: null })
}
const esc = () => handleKey(ui, key("escape"), data)

test("selection, then filter, then the Uncategorised view, one esc each", () => {
  setup()
  handleKey(ui, key("i"), data)
  expect(data.state.uncategorisedOnly).toBe(true)
  data.commitFilter("desc:shop")
  ui.setState({ selectedIds: { 1: true } })
  esc()
  expect(ui.state.selectedIds).toEqual({})
  expect(data.state.filterQuery).toBe("desc:shop")
  esc()
  expect(data.state.filterQuery).toBe("")
  expect(data.state.uncategorisedOnly).toBe(true)
  esc()
  expect(data.state.uncategorisedOnly).toBe(false)
  expect(ui.activeScope()).toBe("manager.txns")
})

test("tag review: the filter goes before the review", async () => {
  setup()
  const ai = { judge: async (qs: Record<string, unknown>) => Object.fromEntries(Object.keys(qs).map((id) => [id, { type: "noul" as const, noul: 0.9 }])) }
  await data.openTagReview({ tagId: null, name: "Shopping", scope: null }, ai)
  data.commitFilter("desc:shop")
  esc()
  expect(data.state.filterQuery).toBe("")
  expect(data.state.tagReview).not.toBeNull()
  esc()
  expect(data.state.tagReview).toBeNull()
})

test("a drill-down goes back to Overview after the selection, keeping its filter rule", () => {
  setup()
  ui.setState({ drillReturn: { filter: "", focus: "ov.charts" } as never, selectedIds: { 2: true } })
  data.commitFilter("desc:cafe")
  esc()
  expect(ui.state.selectedIds).toEqual({})
  expect(ui.state.activeTab).toBe("manager")
  esc()
  expect(ui.state.activeTab).toBe("overview")
  expect(data.state.filterQuery).toBe("")
})

test("with nothing to step back from, esc says so", () => {
  setup()
  esc()
  expect(ui.state.status).toBe("Nothing to clear")
})
