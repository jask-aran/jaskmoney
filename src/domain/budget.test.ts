import { describe, expect, test } from "bun:test"
import { budgetProgress, cycleFor, cycleSpending, pastCycles, paydays, spendByGroup, type Budget, type CycleConfig } from "./budget"
import type { Transaction } from "./types"
import { computePeriodFlows } from "./position"
import { account, category, transaction } from "../testing/fixtures"

interface CycleCase {
  config: CycleConfig
  date: string
  start: string
  end: string
  days: number
}

const cycleCases: CycleCase[] = [
  { config: { unit: "week", anchor: "calendar", anchorDate: null }, date: "2026-10-07", start: "2026-10-05", end: "2026-10-11", days: 7 },
  { config: { unit: "fortnight", anchor: "calendar", anchorDate: null }, date: "1970-01-05", start: "1970-01-05", end: "1970-01-18", days: 14 },
  { config: { unit: "fortnight", anchor: "calendar", anchorDate: null }, date: "1970-01-04", start: "1969-12-22", end: "1970-01-04", days: 14 },
  { config: { unit: "fortnight", anchor: "calendar", anchorDate: null }, date: "1970-01-19", start: "1970-01-19", end: "1970-02-01", days: 14 },
  { config: { unit: "month", anchor: "calendar", anchorDate: "2030-05-31" }, date: "2024-02-10", start: "2024-02-01", end: "2024-02-29", days: 29 },
  { config: { unit: "week", anchor: "date", anchorDate: "2026-10-07" }, date: "2026-10-06", start: "2026-09-30", end: "2026-10-06", days: 7 },
  { config: { unit: "fortnight", anchor: "date", anchorDate: "2026-10-07" }, date: "2026-09-22", start: "2026-09-09", end: "2026-09-22", days: 14 },
  { config: { unit: "month", anchor: "date", anchorDate: "2026-01-31" }, date: "2026-02-15", start: "2026-01-31", end: "2026-02-27", days: 28 },
  { config: { unit: "month", anchor: "date", anchorDate: "2026-01-31" }, date: "2026-02-28", start: "2026-02-28", end: "2026-03-30", days: 31 },
  { config: { unit: "month", anchor: "date", anchorDate: "2026-01-31" }, date: "2024-02-28", start: "2024-01-31", end: "2024-02-28", days: 29 },
  { config: { unit: "month", anchor: "date", anchorDate: "2026-01-31" }, date: "2024-02-29", start: "2024-02-29", end: "2024-03-30", days: 31 },
  { config: { unit: "month", anchor: "date", anchorDate: "2026-01-31" }, date: "2026-04-29", start: "2026-03-31", end: "2026-04-29", days: 30 },
  { config: { unit: "month", anchor: "date", anchorDate: "2026-01-31" }, date: "2026-04-30", start: "2026-04-30", end: "2026-05-30", days: 31 },
  { config: { unit: "week", anchor: "weekStartNearDate", anchorDate: "2026-10-08" }, date: "2026-10-04", start: "2026-09-28", end: "2026-10-04", days: 7 },
  { config: { unit: "fortnight", anchor: "weekStartNearDate", anchorDate: "2026-10-09" }, date: "2026-10-11", start: "2026-09-28", end: "2026-10-11", days: 14 },
  { config: { unit: "month", anchor: "weekStartNearDate", anchorDate: "2026-10-08" }, date: "2026-10-07", start: "2026-10-05", end: "2026-11-08", days: 35 },
  { config: { unit: "month", anchor: "weekStartNearDate", anchorDate: "2026-10-08" }, date: "2026-09-08", start: "2026-09-07", end: "2026-10-04", days: 28 },
  { config: { unit: "month", anchor: "weekStartNearDate", anchorDate: "2026-01-31" }, date: "2026-02-01", start: "2025-12-29", end: "2026-02-01", days: 35 },
  { config: { unit: "month", anchor: "weekStartNearDate", anchorDate: "2026-01-31" }, date: "2026-03-01", start: "2026-02-02", end: "2026-03-01", days: 28 },
  { config: { unit: "month", anchor: "weekStartNearDate", anchorDate: "2026-01-31" }, date: "2024-02-29", start: "2024-02-26", end: "2024-03-31", days: 35 },
  { config: { unit: "month", anchor: "weekStartNearDate", anchorDate: "2026-01-31" }, date: "2026-05-01", start: "2026-04-27", end: "2026-05-31", days: 35 },
  { config: { unit: "month", anchor: "weekStartNearDate", anchorDate: "2026-04-01" }, date: "2026-03-31", start: "2026-03-30", end: "2026-05-03", days: 35 },
  { config: { unit: "week", anchor: "calendar", anchorDate: null }, date: "2026-04-05", start: "2026-03-30", end: "2026-04-05", days: 7 },
  { config: { unit: "week", anchor: "calendar", anchorDate: null }, date: "2026-10-04", start: "2026-09-28", end: "2026-10-04", days: 7 },
]

describe("cycleFor", () => {
  describe("payEarly", () => {
    const config: CycleConfig = { unit: "month", anchor: "date", anchorDate: "2000-01-14", payEarly: true, paydays: ["2026-09-12", "2026-10-14", "2026-11-16", "2026-12-06"] }
    test("early pay opens the cycle that day; the cycle before ends the day before", () => {
      expect(cycleFor(config, "2026-09-11")).toEqual({ start: "2026-08-14", end: "2026-09-11", days: 29 })
      for (const date of ["2026-09-12", "2026-09-13", "2026-09-14", "2026-10-13"]) {
        expect(cycleFor(config, date)).toEqual({ start: "2026-09-12", end: "2026-10-13", days: 32 })
      }
    })
    test("cycles stay contiguous across a year of early and late pay", () => {
      let previous = cycleFor(config, "2026-01-01")
      for (let time = Date.parse("2026-01-02T12:00:00Z"); time < Date.parse("2027-01-01T12:00:00Z"); time += 86400000) {
        const date = new Date(time).toISOString().slice(0, 10)
        const cycle = cycleFor(config, date)
        expect(cycle.start <= date && date <= cycle.end).toBe(true)
        if (cycle.start !== previous.start) {
          expect(previous.end).toBe(new Date(time - 86400000).toISOString().slice(0, 10))
          expect(cycle.start).toBe(date)
        } else expect(cycle).toEqual(previous)
        previous = cycle
      }
    })
    test("paydays are Salary income, once per day, in order", () => {
      const row = (dateISO: string, overrides: Partial<Transaction> = {}) => transaction({ dateISO, amount: 5000, categoryId: 56, categoryName: "Salary", income: true, ...overrides })
      expect(paydays([row("2026-10-14"), row("2026-09-12"), row("2026-09-12"), row("2026-08-01", { categoryName: "Interest" }),
        row("2026-07-01", { income: false }), row("2026-06-01", { tagNames: ["IGNORE"] })])).toEqual(["2026-09-12", "2026-10-14"])
    })
  })

  test("known cycles: the same cycle from a date inside it, its start and its end", () => {
    for (const { config, date, start, end, days } of cycleCases) {
      const expected = { start, end, days }
      for (const at of [date, start, end]) expect({ config, at, cycle: cycleFor(config, at) }).toEqual({ config, at, cycle: expected })
    }
  })
})

const row = (amount: number, overrides: Partial<Transaction> = {}) =>
  transaction({ dateISO: "2026-10-07", categoryId: 10, amount, ...overrides })

const config: CycleConfig = { unit: "week", anchor: "calendar", anchorDate: null }
const accounts = [account({ id: 1 }), account({ id: 2, source: "csv", externalKind: null }), account({ id: 3, externalKind: "SAVER" })]
const categories = [category({ id: 10 }), category({ id: 11, parentId: 10 }), category({ id: 12, parentId: 10 }), category({ id: 20 })]
const budgets: Budget[] = [
  { id: 9, scope: { kind: "overall" }, amount: 200 },
  { id: 4, scope: { kind: "category", categoryId: 10 }, amount: 100 },
  { id: 7, scope: { kind: "category", categoryId: 11 }, amount: 100 },
  { id: 2, scope: { kind: "account", accountId: 1 }, amount: 100 },
  { id: 8, scope: { kind: "account", accountId: 2 }, amount: 100 },
  { id: 1, scope: { kind: "account", accountId: 3 }, amount: 100 },
]
const transactions = [
  row(-10, { dateISO: "2026-10-05" }),
  row(-20, { dateISO: "2026-10-06", categoryId: 11, status: "HELD" }),
  row(-5, { accountId: 2, categoryId: 12 }),
  row(-15, { categoryId: 20 }),
  row(-10, { accountId: 2, categoryId: null }),
]

describe("budgetProgress", () => {
  test("overall (everything outside the category budgets), accounts, group and child spending preserve budget order and exact metrics", () => {
    const result = budgetProgress(budgets, config, "2026-10-07", accounts, categories, transactions)
    expect(result).toEqual(budgets.map((budget, index) => {
      const spent = [25, 35, 20, 45, 15, 0][index] ?? 0
      return {
        budget: index === 0 ? { ...budget, amount: 100 } : budget, spent, remaining: 100 - spent, usedPct: spent,
        daysLeft: 5, dailyAllowance: (100 - spent) / 5, projected: spent / 3 * 7,
      }
    }))
  })

  const excludedRows: Array<[string, Transaction]> = [
    ["inflow", row(1000)], ["zero", row(0)],
    ["excluded", row(-1000, { excluded: true })],
    ["internal excluded", row(-1000, { internal: true, excluded: true })],
    ["IGNORE", row(-1000, { tagNames: ["other", "IGNORE"] })],
    ["mixed-case IGNORE", row(-1000, { tagNames: ["iGnOrE"] })],
    ["saver", row(-1000, { accountId: 3 })],
    ["unknown account", row(-1000, { accountId: 99 })],
    ["no account", row(-1000, { accountId: null })],
    ["tomorrow", row(-1000, { dateISO: "2026-10-08" })],
    ["after cycle", row(-1000, { dateISO: "2026-10-12" })],
    ["before cycle", row(-1000, { dateISO: "2026-10-04" })],
  ]
  test("excludes inflows, zero, excluded, IGNORE, saver, unknown-account and out-of-cycle rows from every scope", () => {
    const base = budgetProgress(budgets, config, "2026-10-07", accounts, categories, transactions)
    for (const [name, excluded] of excludedRows) {
      expect({ name, progress: budgetProgress(budgets, config, "2026-10-07", accounts, categories, [...transactions, excluded]) }).toEqual({ name, progress: base })
    }
  })

  test("over budget, remaining stays negative; over or exactly at the limit, the allowance is zero", () => {
    const budget: Budget = { id: 1, scope: { kind: "overall" }, amount: 50 }
    expect(budgetProgress([budget], config, "2026-10-07", accounts, categories, transactions)).toEqual([
      { budget, spent: 60, remaining: -10, usedPct: 120, daysLeft: 5, dailyAllowance: 0, projected: 140 },
    ])
    expect(budgetProgress([{ ...budget, amount: 60 }], config, "2026-10-07", accounts, categories, transactions)[0]?.dailyAllowance).toBe(0)
  })

  test("shifted monthly progress uses the clamped start and the full 35-day cycle", () => {
    const budget: Budget = { id: 1, scope: { kind: "overall" }, amount: 112 }
    const monthly: CycleConfig = { unit: "month", anchor: "weekStartNearDate", anchorDate: "2026-01-31" }
    expect(budgetProgress([budget], monthly, "2026-05-01", accounts, categories, [
      row(-20, { dateISO: "2026-04-27" }), row(-30, { dateISO: "2026-05-01" }),
      row(-1000, { dateISO: "2026-04-26" }), row(-1000, { dateISO: "2026-05-02" }),
    ])).toEqual([
      { budget, spent: 50, remaining: 62, usedPct: 50 / 112 * 100, daysLeft: 31, dailyAllowance: 2, projected: 350 },
    ])
  })

  test("elapsed and remaining days are inclusive at both ends of the cycle", () => {
    for (const [today, daysLeft, projected] of [["2026-10-05", 7, 70], ["2026-10-11", 1, 10]] as const) {
      const alone: Budget = { ...budgets[0]!, amount: 100 }
      expect(budgetProgress([alone], config, today, accounts, categories, [row(-10, { dateISO: today })])[0])
        .toEqual({ budget: alone, spent: 10, remaining: 90, usedPct: 10, daysLeft, dailyAllowance: 90 / daysLeft, projected })
    }
  })
})

describe("past cycles and spending by group (the Budgets tab)", () => {
  const monthly: CycleConfig = { unit: "month", anchor: "date", anchorDate: "2026-01-14" }
  test("cycleSpending and spendByGroup: spending-account outflows in the cycle, children counted to their group", () => {
    const accounts = [account({ id: 1 }), account({ id: 2, externalKind: "SAVER" })]
    const categories = [category({ id: 10, name: "Good Life" }), category({ id: 11, name: "Cafes", parentId: 10 }), category({ id: 20, name: "Groceries" })]
    const rows = [
      transaction({ id: 1, accountId: 1, dateISO: "2026-09-20", amount: -10, categoryId: 11 }),
      transaction({ id: 2, accountId: 1, dateISO: "2026-09-21", amount: -5, categoryId: 10 }),
      transaction({ id: 3, accountId: 1, dateISO: "2026-09-22", amount: -40, categoryId: 20 }),
      transaction({ id: 4, accountId: 1, dateISO: "2026-09-23", amount: -7, categoryId: null }),
      transaction({ id: 5, accountId: 2, dateISO: "2026-09-23", amount: -99, categoryId: 20 }),
      transaction({ id: 6, accountId: 1, dateISO: "2026-10-20", amount: -99, categoryId: 20 }),
      transaction({ id: 7, accountId: 1, dateISO: "2026-09-24", amount: 30, categoryId: 20, categoryName: "Groceries" }),
    ]
    const cycle = pastCycles(monthly, "2026-10-27", 1)[0]!
    const spent = cycleSpending(cycle, cycle.end, accounts, rows)
    expect(spent.map((t) => t.id).sort()).toEqual([1, 2, 3, 4, 7])
    expect(Object.fromEntries(spendByGroup(spent, categories))).toEqual({ 10: 15, 20: 10, null: 7 })
    const overall = budgetProgress([{ id: 1, scope: { kind: "overall" }, amount: 100 }], monthly, cycle.end, accounts, categories, rows)[0]!
    const inCycle = rows.filter((t) => t.dateISO >= cycle.start && t.dateISO <= cycle.end)
    expect(overall.spent).toBe(computePeriodFlows(accounts, inCycle).spent)
    expect(overall.spent).toBe(32)
  })
})
