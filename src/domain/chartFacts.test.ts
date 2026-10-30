import { expect, test } from "bun:test"
import { account, transaction } from "../testing/fixtures"
import { biggestRow, computePeriodFlows, flowRows, historyCovers, projectAvailable, usualDailySpend } from "./position"
import { subscriptions, upcomingCharges, type Subscription } from "./subscriptions"

const spending = account({ id: 1, balance: 500 })
const saver = account({ id: 2, name: "Holiday", externalKind: "SAVER", balance: 100 })
const row = (id: number, dateISO: string, amount: number, over: Parameters<typeof transaction>[0] = {}) =>
  transaction({ id, dateISO, amount, accountId: 1, accountName: "Spending", status: null, description: `ROW ${id}`, ...over })

test("flowRows are the rows computePeriodFlows sums: spent and money in", () => {
  const rows = [row(1, "2026-10-01", -40), row(2, "2026-10-02", -10), row(3, "2026-10-03", 900, { categoryId: 1, categoryName: "Salary" })]
  const flows = computePeriodFlows([spending, saver], rows)
  const { spent, income } = flowRows([spending, saver], rows)
  expect(-spent.reduce((s, t) => s + t.amount, 0)).toBe(flows.spent)
  expect(income.reduce((s, t) => s + t.amount, 0)).toBe(flows.income)
  // Charts name a bar after its biggest outgoing row.
  const outs = spent.filter((t) => t.amount < 0)
  expect(biggestRow(outs, "2026-10-01", "2026-10-31")?.id).toBe(1)
  expect(biggestRow(outs, "2026-10-02", "2026-10-02")?.id).toBe(2)
})

test("a few stray old rows don't make an earlier period comparable", () => {
  const now = Array.from({ length: 20 }, (_, i) => row(i + 1, `2026-10-${String(i + 1).padStart(2, "0")}`, -5))
  const stray = [row(99, "2026-09-03", -5), row(98, "2026-09-20", -5)]
  const sept = { start: "2026-09-01", end: "2026-09-20" }, oct = { start: "2026-10-01", end: "2026-10-20" }
  expect(historyCovers([...now, ...stray], sept, oct)).toBe(false)
  const full = Array.from({ length: 12 }, (_, i) => row(200 + i, `2026-09-${String(i + 1).padStart(2, "0")}`, -5))
  expect(historyCovers([...now, ...full], sept, oct)).toBe(true)
})

const sub = (over: Partial<Subscription>): Subscription => ({ name: "Netflix", cadence: "monthly", amount: 10, monthly: 10, last: "2026-10-05", next: "2026-11-05", stopped: false, change: null, categoryId: null, chargeIds: [], ...over })

test("upcoming charges: each one's next, then on at its cadence; stopped ones none; overdue once, today", () => {
  const list = [sub({}), sub({ name: "Gym", cadence: "weekly", amount: 15, next: "2026-10-28" }), sub({ name: "Old", stopped: true })]
  expect(upcomingCharges(list, "2026-10-30", "2026-11-10").map((c) => `${c.name} ${c.dateISO}`)).toEqual([
    "Gym 2026-10-30", "Gym 2026-11-04", "Netflix 2026-11-05",
  ])
})

test("Available projected to payday: a usual day off each day, and each charge on its day", () => {
  const days = projectAvailable(1000, "2026-11-01", "2026-11-03", 60, [{ dateISO: "2026-11-02", amount: 40 }])
  expect(days).toEqual([{ dateISO: "2026-11-02", value: 900 }, { dateISO: "2026-11-03", value: 840 }])
})

test("a usual day leaves out regular payments and the biggest tenth of days", () => {
  // 20 days of $10, one day with a $900 one-off, rent on another.
  const rows = [
    ...Array.from({ length: 20 }, (_, i) => row(i + 1, `2026-10-${String(i + 1).padStart(2, "0")}`, -10)),
    row(50, "2026-10-05", -900), row(51, "2026-10-08", -1200, { description: "RENT" }),
  ]
  expect(usualDailySpend([spending, saver], rows, "2026-10-20", new Set([51]))).toBe(10)
})

test("a regular payment whose price changed once, or that was split in two one day, is still regular", () => {
  const rent = (id: number, dateISO: string, amount: number) => row(id, dateISO, -amount, { description: "Transfer to Rent" })
  const rows = [
    rent(1, "2026-01-21", 1531), rent(2, "2026-02-21", 1531), rent(3, "2026-03-21", 1531),
    rent(4, "2026-04-21", 1190), rent(5, "2026-05-21", 1190), rent(6, "2026-06-21", 1109), rent(7, "2026-06-21", 81), rent(8, "2026-07-21", 1190),
  ]
  const [found] = subscriptions(rows, "2026-07-30")
  expect(found).toMatchObject({ name: "Transfer to Rent", cadence: "monthly", amount: 1190, next: "2026-08-21", change: { from: 1531, to: 1190, since: "2026-04-21" } })
  expect(found!.chargeIds).toHaveLength(8)
})
