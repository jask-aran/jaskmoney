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
    // Monthly from the 14th; pay lands on 12 Sep (a Friday, early), 14 Oct
    // (on time), 16 Nov (late) and 6 Dec (too early to count).
    const config: CycleConfig = { unit: "month", anchor: "date", anchorDate: "2000-01-14", payEarly: true, paydays: ["2026-09-12", "2026-10-14", "2026-11-16", "2026-12-06"] }
    test("early pay opens the cycle that day; the cycle before ends the day before", () => {
      expect(cycleFor(config, "2026-09-11")).toEqual({ start: "2026-08-14", end: "2026-09-11", days: 29 })
      for (const date of ["2026-09-12", "2026-09-13", "2026-09-14", "2026-10-13"]) {
        expect(cycleFor(config, date)).toEqual({ start: "2026-09-12", end: "2026-10-13", days: 32 })
      }
    })
    test("pay on or after the scheduled start, or more than 5 days early, changes nothing", () => {
      expect(cycleFor(config, "2026-10-14")).toEqual({ start: "2026-10-14", end: "2026-11-13", days: 31 })
      expect(cycleFor(config, "2026-11-16")).toEqual({ start: "2026-11-14", end: "2026-12-13", days: 30 })
      expect(cycleFor(config, "2026-12-06").start).toBe("2026-11-14")
    })
    test("off, or with no pay dates, cycles keep their schedule", () => {
      expect(cycleFor({ ...config, payEarly: false }, "2026-09-12").start).toBe("2026-08-14")
      expect(cycleFor({ ...config, paydays: [] }, "2026-09-12").start).toBe("2026-08-14")
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

  for (const unit of ["week", "fortnight", "month"] as const) {
    for (const anchor of ["calendar", "date", "weekStartNearDate"] as const) {
      // All anchor days include both directions of Monday shifts and month crossings.
      const anchorDays = anchor === "calendar" ? [1] : Array.from({ length: 31 }, (_, i) => i + 1)
      for (const day of anchorDays) {
        test(`${unit}/${anchor}, anchor day ${day}: daily containment and contiguous cycles over 2023–2025`, () => {
          const config: CycleConfig = { unit, anchor, anchorDate: `2024-01-${String(day).padStart(2, "0")}` }
          let previous = cycleFor(config, "2022-12-31")
          for (let time = Date.parse("2023-01-01T12:00:00Z"); time < Date.parse("2026-01-01T12:00:00Z"); time += 86400000) {
            const date = new Date(time).toISOString().slice(0, 10)
            const cycle = cycleFor(config, date)
            expect(cycle.start <= date && date <= cycle.end).toBe(true)
            expect(cycle.days).toBe((Date.parse(cycle.end + "T12:00:00Z") - Date.parse(cycle.start + "T12:00:00Z")) / 86400000 + 1)
            if (cycle.start === previous.start) {
              expect(cycle).toEqual(previous)
            } else {
              expect(previous.end).toBe(new Date(time - 86400000).toISOString().slice(0, 10))
              expect(cycle.start).toBe(date)
            }
            previous = cycle
          }
        })
      }
    }
  }

  for (const day of [29, 30, 31]) {
    test(`monthly date anchor ${day} restores the original day after every clamp`, () => {
      const config: CycleConfig = { unit: "month", anchor: "date", anchorDate: `2024-01-${day}` }
      for (const year of [2023, 2024, 2025]) {
        const monthLengths = [31, year === 2024 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
        for (const [index, length] of monthLengths.entries()) {
          const start = `${year}-${String(index + 1).padStart(2, "0")}-${Math.min(day, length)}`
          expect(cycleFor(config, start).start).toBe(start)
        }
      }
    })
  }

  for (const { config, date, start, end, days } of cycleCases) {
    test(`${config.unit}/${config.anchor}/${config.anchorDate} at ${date}, start and end`, () => {
      const expected = { start, end, days }
      expect(cycleFor(config, date)).toEqual(expected)
      expect(cycleFor(config, start)).toEqual(expected)
      expect(cycleFor(config, end)).toEqual(expected)
    })
  }

  for (const unit of ["week", "fortnight"] as const) {
    for (const [anchorDate, start] of [
      ["2026-10-05", "2026-10-05"], ["2026-10-06", "2026-10-05"],
      ["2026-10-07", "2026-10-05"], ["2026-10-08", "2026-10-05"],
      ["2026-10-09", "2026-10-12"], ["2026-10-10", "2026-10-12"],
      ["2026-10-11", "2026-10-12"],
    ]) {
      test(`${unit} shifts ${anchorDate} to the nearest Monday`, () => {
        expect(cycleFor({ unit, anchor: "weekStartNearDate", anchorDate }, start).start).toBe(start)
      })
    }
  }

  for (const unit of ["week", "fortnight", "month"] as const) {
    for (const anchor of ["date", "weekStartNearDate"] as const) {
      test(`${unit}/${anchor} needs an anchor date`, () => {
        expect(() => cycleFor({ unit, anchor, anchorDate: null }, "2026-10-07"))
          .toThrow(new Error("budget cycle needs an anchor date"))
      })
    }
    test(`${unit}/calendar ignores anchorDate`, () => {
      expect(cycleFor({ unit, anchor: "calendar", anchorDate: "2030-05-31" }, "1969-12-31"))
        .toEqual(cycleFor({ unit, anchor: "calendar", anchorDate: null }, "1969-12-31"))
    })
  }
})

// Rows default to today (2026-10-07) in the group category 10.
const row = (amount: number, overrides: Partial<Transaction> = {}) =>
  transaction({ dateISO: "2026-10-07", categoryId: 10, amount, ...overrides })

const config: CycleConfig = { unit: "week", anchor: "calendar", anchorDate: null }
const accounts = [account({ id: 1 }), account({ id: 2, source: "csv", externalKind: null }), account({ id: 3, externalKind: "SAVER" })]
const categories = [category({ id: 10 }), category({ id: 11, parentId: 10 }), category({ id: 12, parentId: 10 }), category({ id: 20 })]
const budgets: Budget[] = [
  { id: 9, scope: { kind: "overall" }, amount: 100 },
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
  test("overall, accounts, group and child spending preserve budget order and exact metrics", () => {
    const result = budgetProgress(budgets, config, "2026-10-07", accounts, categories, transactions)
    expect(result).toEqual(budgets.map((budget, index) => {
      const spent = [60, 35, 20, 45, 15, 0][index] ?? 0
      return {
        budget, spent, remaining: 100 - spent, usedPct: spent,
        daysLeft: 5, dailyAllowance: (100 - spent) / 5, projected: spent / 3 * 7,
      }
    }))
    expect(result[0]).toEqual({
      budget: budgets[0], spent: 60, remaining: 40, usedPct: 60,
      daysLeft: 5, dailyAllowance: 8, projected: 140,
    })
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
  for (const [name, excluded] of excludedRows) {
    test(`excludes ${name} from every scope`, () => {
      expect(budgetProgress(budgets, config, "2026-10-07", accounts, categories, [...transactions, excluded]))
        .toEqual(budgetProgress(budgets, config, "2026-10-07", accounts, categories, transactions))
    })
  }

  test("over-budget remaining stays negative and allowance is zero", () => {
    const budget: Budget = { id: 1, scope: { kind: "overall" }, amount: 50 }
    expect(budgetProgress([budget], config, "2026-10-07", accounts, categories, transactions)).toEqual([
      { budget, spent: 60, remaining: -10, usedPct: 120, daysLeft: 5, dailyAllowance: 0, projected: 140 },
    ])
  })

  test("spending exactly the limit gives zero allowance", () => {
    const budget: Budget = { id: 1, scope: { kind: "overall" }, amount: 60 }
    expect(budgetProgress([budget], config, "2026-10-07", accounts, categories, transactions)[0]?.dailyAllowance).toBe(0)
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

  for (const [today, daysLeft, projected] of [["2026-10-05", 7, 70], ["2026-10-11", 1, 10]] as const) {
    test(`inclusive elapsed and remaining days on ${today}`, () => {
      expect(budgetProgress(budgets.slice(0, 1), config, today, accounts, categories, [row(-10, { dateISO: today })])[0])
        .toEqual({ budget: budgets[0], spent: 10, remaining: 90, usedPct: 10, daysLeft, dailyAllowance: 90 / daysLeft, projected })
    })
  }

  test("a new cycle starts fresh and empty budget input stays empty", () => {
    expect(budgetProgress(budgets, config, "2026-10-12", accounts, categories, transactions).map((p) => p.spent))
      .toEqual([0, 0, 0, 0, 0, 0])
    expect(budgetProgress([], config, "2026-10-07", accounts, categories, transactions)).toEqual([])
  })
})

describe("past cycles and spending by group (the Budgets tab)", () => {
  const monthly: CycleConfig = { unit: "month", anchor: "date", anchorDate: "2026-01-14" }
  test("pastCycles: the whole cycles before today's, newest first", () => {
    expect(pastCycles(monthly, "2026-10-27", 3).map((c) => `${c.start}..${c.end}`)).toEqual([
      "2026-09-14..2026-10-13", "2026-08-14..2026-09-13", "2026-07-14..2026-08-13",
    ])
  })
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
      // A refund into a spending category reduces it.
      transaction({ id: 7, accountId: 1, dateISO: "2026-09-24", amount: 30, categoryId: 20, categoryName: "Groceries" }),
    ]
    const cycle = pastCycles(monthly, "2026-10-27", 1)[0]!
    const spent = cycleSpending(cycle, cycle.end, accounts, rows)
    expect(spent.map((t) => t.id).sort()).toEqual([1, 2, 3, 4, 7])
    expect(Object.fromEntries(spendByGroup(spent, categories))).toEqual({ 10: 15, 20: 10, null: 7 })
    // One rule for spending: a budget's spent is the Overview's Spent.
    const overall = budgetProgress([{ id: 1, scope: { kind: "overall" }, amount: 100 }], monthly, cycle.end, accounts, categories, rows)[0]!
    const inCycle = rows.filter((t) => t.dateISO >= cycle.start && t.dateISO <= cycle.end)
    expect(overall.spent).toBe(computePeriodFlows(accounts, inCycle).spent)
    expect(overall.spent).toBe(32)
  })
})
