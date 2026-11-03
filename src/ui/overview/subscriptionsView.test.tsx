import { afterEach, expect, test } from "bun:test"
import { data } from "../../state/dataStore"
import { CHART_VIEWS, ui } from "../../state/uiStore"
import { renderApp } from "../../testing/app"
import { account, transaction } from "../../testing/fixtures"
import { setAppClock } from "../../domain/days"

afterEach(() => setAppClock(null))

test("the Subscriptions view lists regular payments with their change and the stopped ones", async () => {
  setAppClock(new Date(2026, 8, 20, 12))
  const t = await renderApp({ width: 160, height: 44 })
  let id = 0
  const months = (description: string, amounts: number[]) => amounts.map((amount, i) => transaction({ id: ++id, accountId: 1, description, dateISO: `2026-${String(5 + i).padStart(2, "0")}-03`, amount: -amount }))
  data.setState({ accounts: [account({ id: 1, name: "Spending" })], accountSelection: "all", ready: true, icons: false,
    transactions: [...months("NETFLIX", [18.99, 18.99, 22.99, 22.99, 22.99]), ...months("GYM", [60, 60, 60])] })
  ui.switchTab("overview")
  ui.setState({ chartViews: [CHART_VIEWS.findIndex((v) => v.view === "Subscriptions"), 4, 7, 8] })
  await t.renderOnce()
  await t.renderOnce()
  const frame = t.captureCharFrame()
  // NETFLIX's rise shows; GYM, three months gone, has stopped.
  expect(frame).toMatch(/NETFLIX.*▲/)
  expect(frame).toMatch(/GYM.*stopped/)
  expect(frame).toContain("1 active")
})
