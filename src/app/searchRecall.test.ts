import { expect, test } from "bun:test"
import { data } from "../state/dataStore"
import { smartQuestionFor, ui } from "../state/uiStore"
import { account, transaction } from "../testing/fixtures"
import { key } from "../testing/keys"
import { footerHints, handleKey } from "./keys"

function setup() {
  data.setState({ accounts: [account({ name: "A" })], transactions: [transaction({ id: 1, description: "Coffee" })], accountSelection: "all", ready: true })
  ui.switchTab("manager")
  ui.setState({ focusedSection: "mgr.transactions" })
}

test("a smart search's question describes its filter until the filter changes; ↑ brings it back to reword", () => {
  setup()
  const expr = 'ask:"coffee" AND type:spending'
  handleKey(ui, key("/"), data)
  // As runSmartSearch leaves it: the expression in the draft, the question remembered.
  ui.setState({ filterDraft: expr, filterCaret: expr.length, smartQuestion: { question: "coffee spending", expr } })
  expect(smartQuestionFor(ui.state, ui.state.filterDraft)).toBe("coffee spending")
  expect(footerHints("filter", { focusedSection: "mgr.transactions", drillReturn: null, chartViews: [0, 4], recallQuestion: true }).some((h) => h.key === "↑")).toBe(true)
  handleKey(ui, key("up"), data)
  expect(ui.state.filterDraft).toBe("?coffee spending")
  expect(ui.state.filterMode).toBe(true)
  // Edited by hand, the filter is no longer the question's.
  expect(smartQuestionFor(ui.state, `${expr} AND amt:<=-5`)).toBeNull()
  expect(smartQuestionFor(ui.state, ` ${expr} `)).toBe("coffee spending")
  // esc forgets it.
  handleKey(ui, key("escape"), data)
  expect(ui.state.smartQuestion).toBeNull()
})

test("n toggles near misses only when the filter asks Jev", () => {
  setup()
  handleKey(ui, key("n"), data)
  expect(data.state.askLoose).toBeNull()
  data.commitFilter("ask:coffee")
  expect(footerHints("manager.txns", { focusedSection: "mgr.transactions", drillReturn: null, chartViews: [0, 4], asks: true }).find((h) => h.key === "n")?.desc).toBe("near misses")
  handleKey(ui, key("n"), data)
  expect(data.state.askLoose).toBe(true)
  expect(footerHints("manager.txns", { focusedSection: "mgr.transactions", drillReturn: null, chartViews: [0, 4], asks: true, askLoose: true }).find((h) => h.key === "n")?.desc).toBe("matches only")
  handleKey(ui, key("n"), data)
  expect(data.state.askLoose).toBe(false)
})
