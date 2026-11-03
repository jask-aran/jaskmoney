import { expect, test } from "bun:test"
import { account, transaction } from "../testing/fixtures"
import { paydayResults, topUpForecast } from "./topUp"

const spending = account({ id: 1, name: "Spending", balance: 1500 })
const saver = account({ id: 2, name: "Rainy day", externalKind: "SAVER", balance: 10000 })
let id = 0
const row = (dateISO: string, amount: number, extra: Parameters<typeof transaction>[0] = {}) => transaction({ id: ++id, accountId: 1, dateISO, amount, ...extra })
const pay = (dateISO: string, amount: number) => row(dateISO, amount, { categoryName: "Salary", income: true, description: "EMPLOYER" })
const sweep = (dateISO: string, amount: number) => row(dateISO, -amount, { transferAccountId: 2, internal: true, description: "Transfer to Rainy day" })

test("a payday topped up to the target: what's kept is the target less what was left, the rest is due to savers; the sweep checked against it", () => {
  // Spending: $0 left the day before pay, $5,000 in, $3,200 sent on, $300 spent.
  const rows = [pay("2026-10-14", 5000), sweep("2026-10-14", 3200), row("2026-10-16", -300)]
  const [p] = paydayResults([spending, saver], rows, ["2026-10-14"], 2000)
  expect(p).toMatchObject({ dateISO: "2026-10-14", pay: 5000, before: 0, keep: 2000, due: 3000, sent: 3200, bySaver: [{ accountId: 2, amount: 3200 }] })
})

test("overspent: less was left, so more of the pay is kept and less is due to savers; a sweep after the window or the next payday doesn't count", () => {
  // $200 overdrawn before pay: keep $2,200.
  const rows = [row("2026-09-30", -200), pay("2026-10-14", 5000), sweep("2026-10-15", 1000), sweep("2026-10-20", 500)]
  const balance = { ...spending, balance: 5000 - 200 - 1000 - 500 }
  const [p] = paydayResults([balance, saver], rows, ["2026-10-14"], 2000)
  expect(p).toMatchObject({ before: -200, keep: 2200, due: 2800, sent: 1000 })
})

test("the next payday at this pace: Spending's projected end topped up to the target from a pay like the last", () => {
  expect(topUpForecast(310, 2000, 5000)).toEqual({ end: 310, keep: 1690, send: 3310 })
  // Ending above the target keeps nothing: all of the pay goes on.
  expect(topUpForecast(2400, 2000, 5000)).toEqual({ end: 2400, keep: 0, send: 5000 })
})
