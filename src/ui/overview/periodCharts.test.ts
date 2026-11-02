import { describe, expect, test } from "bun:test"
import { addDays } from "../../domain/days"
import { cellColumn } from "../charts/lineChart"
import type { Account } from "../../domain/types"
import { balancesChart, cashFlowChart, dateSlots, spendingChart } from "./periodCharts"
import { ink, theme } from "../../theme"
import { account, transaction } from "../../testing/fixtures"

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
  test("from a few days in it says where the period ends at its pace so far; once over, the budget's over or under, not its pace", () => {
    const series = { dates, values: dates.map(() => 150) }
    const text = (m: ReturnType<typeof spendingChart>) => m.rows.map((r) => r.map((run) => run.text).join("")).join("\n")
    // $750 over 5 days of 10: $1.5k by the end.
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
  // Its axis is a line chart's over the same days: Sunday the 4th starts a week.
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
    expect(model.inks).toEqual({ total: ink.figure, saver1: theme.yellow, saver2: theme.sky, saver3: theme.red })
    const drawn = new Set(model.rows.flat().map((r) => r.ink).filter((i) => i && i !== "today" && i !== "week"))
    expect([...drawn].sort()).toEqual(["saver1", "saver2", "saver3", "total"])
  })

  test("a short chart draws the largest savers; the rest are in the total", () => {
    const model = balancesChart("Savers", dates, 60, 6, "2026-10-10", savers(4), [])
    expect(Object.keys(model.inks!)).toEqual(["total", "saver1", "saver2"])
    expect(legend(model)).toContain("+2 more in the total")
  })

  test("one saver is its own total", () => {
    expect(Object.keys(balancesChart("Savers", dates, 60, 15, "2026-10-10", savers(1), []).inks!)).toEqual(["total"])
  })
})

test("Savers: each line is named at its end where there's room, else just its value", () => {
  const savers = ["💰 General", "🏖️ Holiday"].map((name, i) => account({ id: i + 1, name, externalKind: "SAVER", balance: [5000, 3000][i]! }))
  const text = (width: number) => balancesChart("Savers", dates, width, 15, "2026-10-05", savers, []).rows.map((r) => r.map((run) => run.text).join("")).join("\n")
  expect(text(60)).toContain("General $5k")
  expect(text(60)).toContain("Holiday $3k")
  expect(text(60)).toContain("Total $8k")
  // Too narrow for the names: the values stay.
  expect(text(8)).not.toContain("General")
  expect(text(8)).toContain("$5k")
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
    // A transfer isn't spending: it never names a bar.
    const moved = spendingChart("Daily", { dates: d, values }, 80, 12, d[9]!, [...rows, transaction({ id: 3, dateISO: d[3]!, amount: -500, description: "Transfer to Holiday", internal: true, excluded: true, status: null })])
    expect(text(moved)).not.toContain("Transfer")
  })

  test("Daily over more days than columns is a widening average line, with the biggest days as points", () => {
    const d = days(365, "2025-11-01")
    const m = spendingChart("Daily", { dates: d, values: d.map((_, i) => (i === 100 ? 2000 : 50)) }, 80, 12, d.at(-1)!, [])
    expect(legendText(m)).toContain("30-day average")
    expect(text(m)).toMatch(/[•▲]/)
  })

  test("Weekly over a year fills the width, with months under it", () => {
    const d = days(364, "2025-11-03")
    const m = spendingChart("Weekly", { dates: d, values: d.map(() => 30) }, 80, 10, d.at(-1)!, [])
    expect(m.rows[m.rows.length - 1]!.map((r) => r.text).join("").trimEnd().length).toBeGreaterThanOrEqual(78)
    // The months, January as its year, as a line chart's axis has them.
    expect(m.labels).toMatch(/2026 .*Jun/)
    // Months only, but for the first day and today, as a line chart has them.
    expect(m.labels.slice(m.today!.start, m.today!.start + m.today!.length)).toBe("1 Nov")
    expect(m.labels.slice("3 Nov 25".length, m.today!.start)).not.toMatch(/\b\d{1,2}\b/)
  })

  test("bar charts draw a line chart's gridlines and today's rule, under their bars; a week's bar spans its days", () => {
    // Mon 29 Jun – Sun 4 Oct, 80 columns.
    const d = days(98, "2026-06-29")
    const rules = (m: ReturnType<typeof spendingChart>, ink: string) => [...new Set(m.rows.flatMap((runs) => {
      let col = 0
      return runs.flatMap((r) => { const at = col; col += r.text.length; return [...r.text].flatMap((ch, k) => (r.ink === ink && ch === "│" ? [at + k] : [])) })
    }))].sort((a, b) => a - b)
    // Weekly at 80 columns; Daily at 120, where its 98 days are bars. No
    // spending, so no bar covers a rule: bars hide only the cells they fill.
    for (const [view, width] of [["Weekly", 80], ["Daily", 120]] as const) {
      const line = spendingChart("Cumulative", { dates: d, values: d.map(() => 30) }, width, 10, "2026-09-16", [])
      const bars = spendingChart(view, { dates: d, values: d.map(() => 0) }, width, 10, "2026-09-16", [])
      for (const ink of ["month", "today", "week"]) expect(rules(bars, ink)).toEqual(rules(line, ink))
      expect(bars.labels).toBe(line.labels)
    }
    // A week's bar runs from just after its first day's column (where a
    // week rule goes) to just before the next week's; the last to the edge.
    const slots = dateSlots(d.filter((_, i) => i % 7 === 0), d, 80)
    for (let k = 1; k < slots.length; k++) expect(slots[k]!.col - 1).toBe(cellColumn(7 * k, d.length, 80))
    for (let k = 0; k + 1 < slots.length; k++) expect(slots[k]!.col + slots[k]!.width).toBe(slots[k + 1]!.col - 1)
    expect(slots.at(-1)!.col + slots.at(-1)!.width).toBe(80)
  })

  test("Cash flow goes monthly when weeks would be too narrow, and nets each period on the axis where they fit", () => {
    const acc = account({ id: 1, balance: 0 })
    const rows = [spend(1, "2026-10-02", 300, "Rent")]
    const weekly = cashFlowChart(days(21), 80, 8, "2026-10-21", [acc], rows, new Set([1]))
    expect(legendText(weekly)).toContain("weekly")
    expect(weekly.labels).toContain("-$300")
    expect(weekly.labelInks?.some((l) => l.ink === "out")).toBe(true)
    expect(text(weekly)).toContain("Rent -$300")
    const year = cashFlowChart(days(365, "2025-11-01"), 80, 8, "2026-10-31", [acc], rows, new Set([1]))
    expect(legendText(year)).toContain("monthly")
  })

  test("a bar named after a payee who isn't most of it gives the payee's own figure, and adds up a payee's rows", () => {
    const acc = account({ id: 1, balance: 0 })
    const pay = (id: number, dateISO: string, amount: number, description: string) => transaction({ id, dateISO, amount, description, accountName: "Spending", categoryName: "Salary", income: true, status: null })
    // Two pays from one employer and a refund: the employer is the whole bar.
    const one = cashFlowChart(days(92, "2026-08-01"), 60, 12, "2026-10-31", [acc], [pay(1, "2026-10-02", 5000, "Acme Pty Ltd"), pay(2, "2026-10-16", 5000, "Acme Pty Ltd"), pay(3, "2026-10-20", 300, "Refund")], new Set([1]))
    expect(text(one)).toContain("Acme Pty Ltd +$10k")
    // Two payees: the bar's total, then the bigger payee's own.
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
