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
  ui.setState({ filterBar: { draft: expr, caret: expr.length }, smartQuestion: { question: "coffee spending", expr } })
  expect(smartQuestionFor(ui.state, (ui.state.filterBar?.draft ?? ""))).toBe("coffee spending")
  expect(footerHints("filter", { focusedSection: "mgr.transactions", drillReturn: null, chartViews: [0, 4, 7, 8], recallQuestion: true }).some((h) => h.key === "↑")).toBe(true)
  handleKey(ui, key("up"), data)
  expect((ui.state.filterBar?.draft ?? "")).toBe("?coffee spending")
  expect((ui.state.filterBar != null)).toBe(true)
  expect(smartQuestionFor(ui.state, `${expr} AND amt:<=-5`)).toBeNull()
  expect(smartQuestionFor(ui.state, ` ${expr} `)).toBe("coffee spending")
  handleKey(ui, key("escape"), data)
  expect(ui.state.smartQuestion).toBeNull()
})
