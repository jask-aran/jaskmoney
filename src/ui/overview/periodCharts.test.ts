import { describe, expect, test } from "bun:test"
import { addDays } from "../../domain/days"
import type { Account } from "../../domain/types"
import { balancesChart, cashFlowChart, spendingChart } from "./periodCharts"
import { account, transaction } from "../../testing/fixtures"

const dates = Array.from({ length: 10 }, (_, i) => addDays("2026-10-01", i))
const legendText = (model: ReturnType<typeof spendingChart>) => model.legend.map((s) => s.text).join("")

describe("Cumulative budget", () => {
  test("the budget is a pace line: the legend says how far over or under pace today is", () => {
    const series = { dates, values: dates.map(() => 150) }
    const over = spendingChart("Cumulative", series, 40, 10, "2026-10-05", [], 1000)
    expect(legendText(over)).toContain("Budget $1,000, $250 over pace")
    const under = spendingChart("Cumulative", { dates, values: dates.map(() => 50) }, 40, 10, "2026-10-05", [], 1000)
    expect(legendText(under)).toContain("$250 under pace")
  })
  test("from a few days in it says where the period ends at its pace so far; once over, the budget's over or under, not its pace", () => {
    const series = { dates, values: dates.map(() => 150) }
    const text = (m: ReturnType<typeof spendingChart>) => m.rows.map((r) => r.map((run) => run.text).join("")).join("\n")
    expect(text(spendingChart("Cumulative", series, 40, 10, "2026-10-05", [], 1000))).toContain("≈ $1.5k")
    const over = spendingChart("Cumulative", series, 40, 10, "2026-10-20", [], 1000)
    expect(text(over)).not.toContain("≈")
    expect(legendText(over)).toContain("Budget $1,000, $500 over")
    expect(legendText(over)).not.toContain("pace")
  })
  test("without a budget there is no pace", () => {
    const model = spendingChart("Cumulative", { dates, values: dates.map(() => 150) }, 40, 10, "2026-10-05", [])
    expect(legendText(model)).not.toContain("pace")
  })
})

test("weekly spending and cash-flow charts use Sunday buckets and labels", () => {
  const dates = ["2026-10-03", "2026-10-04", "2026-10-05"]
  const weekly = spendingChart("Weekly", { dates, values: [1, 2, 3] }, 60, 8, "2026-10-05", [], undefined, undefined, "sunday")
  expect(weekly.labels).toMatch(/ 4 /)
  expect(weekly.legend.map((s) => s.text).join("")).toContain("this week $5 so far")
  const cashFlow = cashFlowChart(dates, 60, 8, "2026-10-05", [], [], new Set(), "sunday")
  expect(cashFlow.labels).toContain("4 Oct")
  expect(cashFlow.labels).not.toContain("5 Oct")
})

test("spending dated after today waits for its day in Weekly and Cash flow", () => {
  const dates = ["2026-10-05", "2026-10-06", "2026-10-07"]
  const weekly = spendingChart("Weekly", { dates, values: [1, 2, 40] }, 60, 8, "2026-10-06", [])
  expect(legendText(weekly)).toContain("this week $3 so far")
  const account = { id: 1, name: "Spending", type: "debit", sortOrder: 1, isActive: true, source: "up", externalKind: "TRANSACTIONAL", balance: 0, syncEnabled: true } as Account
  const row = (id: number, dateISO: string, amount: number) => transaction({ id, dateISO, amount, accountName: "Spending", status: null })
  const cashFlow = cashFlowChart(dates, 60, 8, "2026-10-06", [account], [row(1, "2026-10-05", -10), row(2, "2026-10-07", -40)], new Set([1]))
  expect(legendText(cashFlow)).toContain("Out $10")
})

describe("Savers", () => {
  const savers = (n: number): Account[] => Array.from({ length: n }, (_, i) => account({
    id: i + 1, name: ["💰 General", "🏖️ Holiday", "🚨 Emergency", "🎁 Gifts"][i]!, externalKind: "SAVER", balance: [5000, 3000, 1000, 500][i]!,
  }))
  const legend = (model: ReturnType<typeof balancesChart>) => model.legend.map((s) => s.text).join("")

  test("a line per saver in its own colour, then their total in white", () => {
    const model = balancesChart("Savers", dates, 60, 15, "2026-10-10", savers(3), [])
    expect(legend(model)).toContain("Total $9,000")
    expect(legend(model)).toMatch(/General .*Holiday .*Emergency/)
    const drawn = new Set(model.rows.flat().map((r) => r.ink).filter((i) => i && i !== "today" && i !== "week"))
    expect([...drawn].sort()).toEqual(["saver1", "saver2", "saver3", "total"])
  })

})

describe("what made a bar tall, and how much room there is", () => {
  const days = (n: number, from = "2026-10-01") => Array.from({ length: n }, (_, i) => addDays(from, i))
  const text = (m: ReturnType<typeof spendingChart>) => m.rows.map((r) => r.map((run) => run.text).join("")).join("\n")
  const spend = (id: number, dateISO: string, amount: number, description: string) =>
    transaction({ id, dateISO, amount: -amount, description, accountName: "Spending", status: null })

  test("Daily names its biggest days after their biggest spend, and shows what's left a day of a budget", () => {
    const d = days(20)
    const values = d.map((_, i) => (i === 3 ? 400 : 20))
    const rows = [spend(1, d[3]!, 380, "Centre Com"), spend(2, d[3]!, 20, "Coffee")]
    const m = spendingChart("Daily", { dates: d, values }, 80, 12, d[9]!, rows, 1000)
    expect(text(m)).toContain("Centre Com $400")
    expect(legendText(m)).toContain("a day left in the budget")
    const moved = spendingChart("Daily", { dates: d, values }, 80, 12, d[9]!, [...rows, transaction({ id: 3, dateISO: d[3]!, amount: -500, description: "Transfer to Holiday", internal: true, excluded: true, status: null })])
    expect(text(moved)).not.toContain("Transfer")
  })

  test("a period too new for bars (today its first day) is said beside today's rule, or in the legend where there's no room", () => {
    const acc = account({ id: 1, balance: 0 })
    const range = days(63, "2026-09-01")
    const today = range.at(-1)!
    const rows = [
      transaction({ id: 1, dateISO: "2026-10-30", amount: 2800, description: "Acme Pty Ltd", accountName: "Spending", categoryName: "Salary", income: true, status: null }),
      ...range.slice(-20).map((iso, k) => spend(10 + k, iso, 50, "Shop")),
    ]
    for (let width = 70; width <= 200; width += 7) {
      const m = cashFlowChart(range, width, 12, today, [acc], rows, new Set([1]))
      expect({ width, said: text(m).includes("this week -$50") || legendText(m).includes("this week -$50") }).toEqual({ width, said: true })
    }
    const year = days(366, "2025-11-02")
    const monthly = cashFlowChart(year, 120, 12, today, [acc], rows, new Set([1]))
    expect(text(monthly) + legendText(monthly)).toContain("Nov so far -$100")
    const weekly = spendingChart("Weekly", { dates: range, values: range.map((d) => (d >= range.at(-20)! ? 50 : 0)) }, 120, 12, today, [])
    expect(text(weekly)).toContain("this week $50")
  })

  test("Cash flow goes monthly when weeks would be too narrow, and nets each period on the axis where they fit", () => {
    const acc = account({ id: 1, balance: 0 })
    const rows = [spend(1, "2026-10-02", 300, "Rent")]
    const weekly = cashFlowChart(days(21), 80, 8, "2026-10-21", [acc], rows, new Set([1]))
    expect(legendText(weekly)).toContain("weekly")
    expect(weekly.labels).toContain("-$300")
    const year = cashFlowChart(days(365, "2025-11-01"), 80, 8, "2026-10-31", [acc], rows, new Set([1]))
    expect(legendText(year)).toContain("monthly")
  })

  test("a bar named after a payee who isn't most of it gives the payee's own figure, and adds up a payee's rows", () => {
    const acc = account({ id: 1, balance: 0 })
    const pay = (id: number, dateISO: string, amount: number, description: string) => transaction({ id, dateISO, amount, description, accountName: "Spending", categoryName: "Salary", income: true, status: null })
    const one = cashFlowChart(days(92, "2026-08-01"), 60, 12, "2026-10-31", [acc], [pay(1, "2026-10-02", 5000, "Acme Pty Ltd"), pay(2, "2026-10-16", 5000, "Acme Pty Ltd"), pay(3, "2026-10-20", 300, "Refund")], new Set([1]))
    expect(text(one)).toContain("Acme Pty Ltd +$10k")
    const two = cashFlowChart(days(92, "2026-08-01"), 60, 12, "2026-10-31", [acc], [pay(1, "2026-08-04", 6000, "Acme Pty Ltd"), pay(2, "2026-08-18", 4000, "Globex")], new Set([1]))
    expect(text(two)).toContain("+$10k · Acme Pty Ltd +$6k")
  })

  test("Available names its biggest moves and shows where it's headed", () => {
    const acc = account({ id: 1, balance: 1000 })
    const d = days(30)
    const rows = [spend(1, d[10]!, 800, "Car service")]
    const m = balancesChart("Available", d, 80, 12, d[19]!, [acc], rows, "monday", false, [{ dateISO: d[25]!, value: 600 }, { dateISO: d[29]!, value: 400 }])
    expect(text(m)).toContain("-$800 Car service")
    expect(text(m)).toContain("≈ $400")
    expect(legendText(m)).toContain("at usual spending")
  })
})
