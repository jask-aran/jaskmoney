import { expect, onTestFinished, spyOn, test } from "bun:test"
import { createComponent } from "solid-js"
import { testRender } from "@opentui/solid"
import { data } from "../../state/dataStore"
import { ui } from "../../state/uiStore"
import * as ranges from "../../state/overviewRange"
import { account, category, transaction } from "../../testing/fixtures"
import { OverviewTab } from "./OverviewTab"

test("a hidden Overview holds range accounts, selection and categories, then catches up", async () => {
  data.setState({ accounts: [account(), account({ id: 2 })], categories: [category()], transactions: [transaction()], ready: true })
  ui.switchTab("overview")
  const range = spyOn(ranges, "overviewRange")
  onTestFinished(() => range.mockRestore())
  const t = await testRender(() => createComponent(OverviewTab, { focused: "ov.chart" }), { width: 140, height: 44 })
  onTestFinished(() => t.renderer.destroy())
  await t.renderOnce()
  expect(range.mock.calls.length).toBeGreaterThan(0)
  ui.switchTab("manager")
  await t.renderOnce()
  const hiddenCalls = range.mock.calls.length
  data.setAccountSelection(2)
  data.setState({ accounts: [account(), account({ id: 2, name: "Second" })], categories: [category({ name: "Changed" })] })
  await t.renderOnce()
  expect(range.mock.calls.length).toBe(hiddenCalls)
  ui.switchTab("overview")
  await t.renderOnce()
  expect(range.mock.calls.length).toBeGreaterThan(hiddenCalls)
  const caughtUp = range.mock.calls.length
  ui.switchTab("manager")
  ui.switchTab("overview")
  await t.renderOnce()
  expect(range.mock.calls.length).toBe(caughtUp)
  const last = range.mock.calls.at(-1)![0]
  expect(last.state.accountSelection).toBe(2)
  expect(last.state.accounts[1]?.name).toBe("Second")
  expect(last.state.categories[0]?.name).toBe("Changed")
  expect(ranges.overviewRange(last, ui.state).scope.label).toBe("Second")
})
