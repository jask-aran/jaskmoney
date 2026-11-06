import { expect, test } from "bun:test"
import { account, transaction } from "../testing/fixtures"
import { cyclePay, usualPay } from "./payday"

const spending = account({ id: 1, name: "Spending", balance: 1500 })
const saver = account({ id: 2, name: "Rainy day", externalKind: "SAVER", balance: 10000 })
let id = 0
const row = (dateISO: string, amount: number, extra: Parameters<typeof transaction>[0] = {}) => transaction({ id: ++id, accountId: 1, dateISO, amount, ...extra })
const pay = (dateISO: string, amount: number) => row(dateISO, amount, { categoryName: "Salary", income: true, description: "EMPLOYER" })
const sweep = (dateISO: string, amount: number) => row(dateISO, -amount, { transferAccountId: 2, internal: true, description: "Transfer to Rainy day" })

test("a cycle's pay: its first pay day, all its pay, and what went to savers day by day", () => {
  const rows = [pay("2026-09-14", 5000), sweep("2026-09-15", 3000), pay("2026-09-28", 760), sweep("2026-10-02", 200), row("2026-10-01", -300), pay("2026-10-14", 5200)]
  expect(cyclePay([spending, saver], rows, "2026-09-14", "2026-10-13")).toEqual({
    dateISO: "2026-09-14", pay: 5760, sent: 3200,
    sends: [{ dateISO: "2026-09-15", amount: 3000 }, { dateISO: "2026-10-02", amount: 200 }],
    paydays: ["2026-09-14", "2026-09-28"],
  })
  expect(cyclePay([spending, saver], rows, "2026-10-20", "2026-10-25")).toMatchObject({ dateISO: null, pay: 0, sent: 0 })
})

test("your usual pay: the median of the last pays, so a final pay or a long first one doesn't move it", () => {
  const rows = [pay("2026-06-12", 4915), pay("2026-07-14", 4967), pay("2026-08-14", 4967), pay("2026-09-14", 4967), pay("2026-09-28", 764), pay("2026-10-14", 5999)]
  expect(usualPay([spending, saver], rows)).toBe(4967)
  expect(usualPay([spending, saver], [])).toBeNull()
})
