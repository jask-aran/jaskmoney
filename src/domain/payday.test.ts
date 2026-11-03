import { expect, test } from "bun:test"
import { account, transaction } from "../testing/fixtures"
import { paydayResults, usualPay } from "./payday"

const spending = account({ id: 1, name: "Spending", balance: 1500 })
const saver = account({ id: 2, name: "Rainy day", externalKind: "SAVER", balance: 10000 })
let id = 0
const row = (dateISO: string, amount: number, extra: Parameters<typeof transaction>[0] = {}) => transaction({ id: ++id, accountId: 1, dateISO, amount, ...extra })
const pay = (dateISO: string, amount: number) => row(dateISO, amount, { categoryName: "Salary", income: true, description: "EMPLOYER" })
const sweep = (dateISO: string, amount: number) => row(dateISO, -amount, { transferAccountId: 2, internal: true, description: "Transfer to Rainy day" })

test("a payday: the pay in, and what went to savers from then until the next payday", () => {
  const rows = [pay("2026-09-14", 5000), sweep("2026-09-15", 3000), pay("2026-10-14", 5200), sweep("2026-10-14", 3000), sweep("2026-10-30", 250), row("2026-10-16", -300)]
  const [sep, oct] = paydayResults([spending, saver], rows, ["2026-09-14", "2026-10-14"], "2026-11-03")
  expect(sep).toMatchObject({ pay: 5000, sent: 3000 })
  // A late send (the 30th) is still this cycle's.
  expect(oct).toMatchObject({ pay: 5200, sent: 3250, bySaver: [{ accountId: 2, amount: 3250 }] })
})

test("your usual pay: the last pays averaged, none without any", () => {
  const rows = [pay("2026-08-14", 4800), pay("2026-09-14", 5000), pay("2026-10-14", 5200)]
  expect(usualPay([spending, saver], rows, ["2026-08-14", "2026-09-14", "2026-10-14"])).toBe(5000)
  expect(usualPay([spending, saver], rows, [])).toBeNull()
})
