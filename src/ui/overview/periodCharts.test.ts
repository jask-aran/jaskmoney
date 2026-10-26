import { describe, expect, test } from "bun:test"
import { addDays } from "../../domain/days"
import type { Account } from "../../domain/types"
import { cashFlowChart, spendingChart } from "./periodCharts"
import { transaction } from "../../testing/fixtures"

const dates = Array.from({ length: 10 }, (_, i) => addDays("2026-10-01", i))
const legendText = (model: ReturnType<typeof spendingChart>) => model.legend.map((s) => s.text).join("")

describe("Cumulative budget", () => {
  test("the budget is a pace line: the legend says how far over or under pace today is", () => {
    // $150 a day for 5 days against $1,000 over 10 days: $750 spent, $500 pace.
    const series = { dates, values: dates.map(() => 150) }
    const over = spendingChart("Cumulative", series, 40, 10, "2026-10-05", [], 1000)
    expect(legendText(over)).toContain("Budget $1,000, $250 over pace")
    const under = spendingChart("Cumulative", { dates, values: dates.map(() => 50) }, 40, 10, "2026-10-05", [], 1000)
    expect(legendText(under)).toContain("$250 under pace")
  })
  test("without a budget there is no pace", () => {
    const model = spendingChart("Cumulative", { dates, values: dates.map(() => 150) }, 40, 10, "2026-10-05", [])
    expect(legendText(model)).not.toContain("pace")
  })
})

test("weekly spending and cash-flow charts use Sunday buckets and labels", () => {
  const dates = ["2026-10-03", "2026-10-04", "2026-10-05"]
  const weekly = spendingChart("Weekly", { dates, values: [1, 2, 3] }, 60, 8, "2026-10-05", [], undefined, undefined, "sunday")
  expect(weekly.labels).toContain("4 Oct")
  expect(weekly.legend.map((s) => s.text).join("")).toContain("This week $5 so far")
  const cashFlow = cashFlowChart(dates, 60, 8, "2026-10-05", [], [], new Set(), "sunday")
  expect(cashFlow.labels).toContain("4 Oct")
  expect(cashFlow.labels).not.toContain("5 Oct")
})

test("spending dated after today waits for its day in Weekly and Cash flow", () => {
  const dates = ["2026-10-05", "2026-10-06", "2026-10-07"]
  const weekly = spendingChart("Weekly", { dates, values: [1, 2, 40] }, 60, 8, "2026-10-06", [])
  expect(legendText(weekly)).toContain("This week $3 so far")
  const account = { id: 1, name: "Spending", type: "debit", sortOrder: 1, isActive: true, source: "up", externalKind: "TRANSACTIONAL", balance: 0, syncEnabled: true } as Account
  const row = (id: number, dateISO: string, amount: number) => transaction({ id, dateISO, amount, accountName: "Spending", status: null })
  const cashFlow = cashFlowChart(dates, 60, 8, "2026-10-06", [account], [row(1, "2026-10-05", -10), row(2, "2026-10-07", -40)], new Set([1]))
  expect(legendText(cashFlow)).toContain("Out $10")
})
