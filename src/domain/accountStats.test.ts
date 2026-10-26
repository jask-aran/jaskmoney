import { describe, expect, test } from "bun:test"
import { computeAccountStats } from "./accountStats"
import type { Transaction } from "./types"
import { account, transaction } from "../testing/fixtures"

const row = (amount: number, overrides: Partial<Transaction> = {}) => transaction({ amount, ...overrides })

describe("computeAccountStats", () => {
  test("balances sum reported values; holds include null-balance accounts and internal rows", () => {
    const stats = computeAccountStats([account({ id: 1, balance: 200 }), account({ id: 2, balance: null }), account({ id: 3, balance: -50 })], [
      row(-20, { status: "HELD", internal: true, excluded: true, tagNames: ["IGNORE"] }),
      row(-5, { status: "HELD", accountId: 2 }),
      row(2, { status: "HELD", accountId: 3 }),
      row(-900), row(-900, { status: null }),
      row(-900, { status: "HELD", accountId: null }),
      row(-900, { status: "HELD", accountId: 99 }),
    ], "2026-10-05")
    expect(stats.balance).toBe(150)
    expect(stats.held).toEqual({ count: 3, amount: -23 })
    expect(stats.settledBalance).toBe(173)
    expect(computeAccountStats([account({ id: 1, balance: 0 })], [], "2026-10-05").balance).toBe(0)
    expect(computeAccountStats([account({ id: 1, balance: 0 })], [], "2026-10-05").settledBalance).toBe(0)
  })

  test("missing balances preserve nulls and empty history but still count activity and flows", () => {
    const stats = computeAccountStats([account({ id: 1, balance: null })], [row(-5, { status: "HELD" })], "2026-10-05")
    expect(stats.balance).toBeNull()
    expect(stats.settledBalance).toBeNull()
    expect(stats.history).toEqual([])
    expect(stats.held).toEqual({ count: 1, amount: -5 })
    expect(stats.windows[0]).toEqual({ days: 30, moneyIn: 0, moneyOut: 5, net: -5 })
    expect(stats.firstActivityISO).toBe("2026-10-05")
    expect(stats.lastActivityISO).toBe("2026-10-05")
  })

  test("empty scope ignores all rows and returns documented defaults", () => {
    const stats = computeAccountStats([], [row(20)], "2026-10-05")
    expect(stats.balance).toBeNull()
    expect(stats.held).toEqual({ count: 0, amount: 0 })
    expect(stats.firstActivityISO).toBeNull()
    expect(stats.lastActivityISO).toBeNull()
    expect(stats.history).toEqual([])
    expect(stats.monthly).toHaveLength(12)
    expect(stats.monthly.every((month) => month.moneyIn === 0 && month.moneyOut === 0)).toBe(true)
    expect(stats.windows).toEqual([30, 90, 365].map((days) => ({ days, moneyIn: 0, moneyOut: 0, net: 0 })))
    expect(stats.interest).toEqual({ thisYear: 0, last365: 0, latest: null, impliedAnnualRatePct: null })
    expect(stats.topOutflows).toEqual([])
  })

  test("first and last activity use all scoped rows, including future dates, regardless of input order", () => {
    const stats = computeAccountStats([account({ id: 1 })], [
      row(1, { dateISO: "2027-01-01" }), row(1),
      row(1, { dateISO: "2025-01-01", internal: true, excluded: true }),
      row(1, { dateISO: "2020-01-01", accountId: 99 }),
      row(1, { dateISO: "2030-01-01", accountId: null }),
    ], "2026-10-05")
    expect(stats.firstActivityISO).toBe("2025-01-01")
    expect(stats.lastActivityISO).toBe("2027-01-01")
    expect(computeAccountStats([account({ id: 1 })], [], "2026-10-05").lastActivityISO).toBeNull()
  })

  for (const [days, included, excluded] of [
    [30, "2026-09-06", "2026-09-05"],
    [90, "2026-07-08", "2026-07-07"],
    [365, "2025-10-06", "2025-10-05"],
  ] satisfies Array<[number, string, string]>) {
    test(`${days}-day window includes day ${days}, excludes day ${days + 1} and future rows`, () => {
      const stats = computeAccountStats([account({ id: 1 })], [
        row(10, { dateISO: included, internal: true, excluded: true }),
        row(-3, { dateISO: included, status: "HELD", tagNames: ["IGNORE"] }),
        row(2), row(-1), row(0),
        row(900, { dateISO: excluded }), row(-900, { dateISO: excluded }),
        row(900, { dateISO: "2026-10-06" }), row(-900, { dateISO: "2026-10-06" }),
        row(900, { accountId: 99 }), row(-900, { accountId: null }),
      ], "2026-10-05")
      expect(stats.windows.map((window) => window.days)).toEqual([30, 90, 365])
      expect(stats.windows.find((window) => window.days === days)).toEqual({ days, moneyIn: 12, moneyOut: 4, net: 8 })
    })
  }

  test("monthly calendar list crosses years, fills empty months, and stops the current month at today", () => {
    const stats = computeAccountStats([account({ id: 1 })], [
      row(10, { dateISO: "2025-11-30" }),
      row(20, { dateISO: "2025-12-01", internal: true, excluded: true }),
      row(-5, { dateISO: "2025-12-31" }),
      row(7, { dateISO: "2026-02-01" }), row(-2, { dateISO: "2026-02-03" }),
      row(900, { dateISO: "2026-02-04" }), row(900, { dateISO: "2026-03-01" }),
    ], "2026-02-03", { months: 3 })
    expect(stats.monthly).toEqual([
      { month: "2025-12", moneyIn: 20, moneyOut: 5 },
      { month: "2026-01", moneyIn: 0, moneyOut: 0 },
      { month: "2026-02", moneyIn: 7, moneyOut: 2 },
    ])
    const defaults = computeAccountStats([account({ id: 1 })], [], "2026-02-03").monthly
    expect(defaults).toHaveLength(12)
    expect(defaults[0]?.month).toBe("2025-03")
    expect(defaults.at(-1)?.month).toBe("2026-02")
  })

  test("history reverses dated balanced-account amounts, including holds, internal, IGNORE, and future rows", () => {
    const stats = computeAccountStats([account({ id: 1, balance: 100 }), account({ id: 2, balance: null })], [
      row(50), row(-20, { dateISO: "2026-10-04", status: "HELD" }),
      row(-10, { dateISO: "2026-10-04", internal: true, excluded: true, tagNames: ["IGNORE"] }),
      row(-7, { dateISO: "2026-10-06" }), row(2, { dateISO: "2027-01-01" }),
      row(999, { accountId: 2 }), row(999, { accountId: 99 }), row(999, { accountId: null }),
      row(999, { dateISO: "2026-10-02" }),
    ], "2026-10-05", { historyDays: 3 })
    expect(stats.history).toEqual([
      { dateISO: "2026-10-03", value: 85 },
      { dateISO: "2026-10-04", value: 55 },
      { dateISO: "2026-10-05", value: 105 },
    ])
    const defaults = computeAccountStats([account({ id: 1 })], [], "2026-10-05").history
    expect(defaults).toHaveLength(365)
    expect(defaults[0]).toEqual({ dateISO: "2025-10-06", value: 100 })
    expect(defaults.at(-1)).toEqual({ dateISO: "2026-10-05", value: 100 })
  })

  for (const fixture of [
    {
      today: "2026-10-01", future: "2026-10-02",
      boundaries: ["2026-09-02", "2026-09-01", "2026-07-04", "2026-07-03", "2025-10-02", "2025-10-01"],
      months: ["2026-08", "2026-09", "2026-10"],
    },
    {
      today: "2026-01-01", future: "2026-01-02",
      boundaries: ["2025-12-03", "2025-12-02", "2025-10-04", "2025-10-03", "2025-01-02", "2025-01-01"],
      months: ["2025-11", "2025-12", "2026-01"],
    },
  ]) {
    test(`months and all window boundaries stay exact on the first day ${fixture.today}`, () => {
      const rows = fixture.boundaries.map((dateISO, index) => row(10 ** index, { dateISO }))
      const stats = computeAccountStats([account({ id: 1 })], [
        ...rows, row(2, { dateISO: fixture.today }), row(1000000, { dateISO: fixture.future }),
      ], fixture.today, { months: 3 })
      expect(stats.windows).toEqual([
        { days: 30, moneyIn: 3, moneyOut: 0, net: 3 },
        { days: 90, moneyIn: 113, moneyOut: 0, net: 113 },
        { days: 365, moneyIn: 11113, moneyOut: 0, net: 11113 },
      ])
      expect(stats.monthly).toEqual(fixture.months.map((month, index) => ({
        month, moneyIn: [0, 11, 2][index], moneyOut: 0,
      })))
    })
  }

  for (const dates of [
    ["2026-10-03", "2026-10-04", "2026-10-05"],
    ["2026-04-04", "2026-04-05", "2026-04-06"],
    ["2024-02-28", "2024-02-29", "2024-03-01"],
    ["2025-12-30", "2025-12-31", "2026-01-01"],
  ]) {
    const todayISO = dates[2]!
    test(`history uses UTC calendar days across ${todayISO}`, () => {
      expect(computeAccountStats([account({ id: 1 })], [], todayISO, { historyDays: 3 }).history.map((day) => day.dateISO)).toEqual(dates)
    })
  }

  test("interest matches only positive exact trimmed case-insensitive descriptions; year and 365-day totals differ", () => {
    const stats = computeAccountStats([account({ id: 1 })], [
      row(1, { dateISO: "2025-10-05", description: "Interest" }),
      row(2, { dateISO: "2025-10-06", description: "Interest" }),
      row(3, { dateISO: "2025-12-31", description: "Interest" }),
      row(4, { dateISO: "2026-01-01", description: "  iNtErEsT \t", internal: true, excluded: true }),
      row(5, { description: "Interest", tagNames: ["IGNORE"] }),
      row(-900, { description: "Interest" }), row(0, { description: "Interest" }),
      row(900, { description: "Interest payment" }), row(900, { description: "Interest", accountId: 99 }),
      row(900, { description: "Interest", accountId: null }),
    ], "2026-10-05")
    expect(stats.interest.thisYear).toBe(9)
    expect(stats.interest.last365).toBe(14)
    expect(stats.interest.latest).toEqual({ dateISO: "2026-10-05", amount: 5 })
  })

  test("future interest remains latest and in its calendar year, but is outside trailing totals", () => {
    const stats = computeAccountStats([account({ id: 1, balance: 1000 })], [
      row(4, { dateISO: "2026-10-06", description: "Interest" }),
      row(3, { description: "Interest" }),
    ], "2026-10-05")
    expect(stats.interest.thisYear).toBe(7)
    expect(stats.interest.last365).toBe(3)
    expect(stats.interest.latest).toEqual({ dateISO: "2026-10-06", amount: 4 })
    expect(stats.interest.impliedAnnualRatePct).toBeCloseTo(4 / ((29 * 993 + 996) / 30) * 1200)
  })

  test("implied rate reconstructs 30 prior end-of-day balances beyond the displayed history", () => {
    const stats = computeAccountStats([account({ id: 1, balance: 1003.29 })], [
      row(3.29, { dateISO: "2026-08-01", description: "Interest" }),
    ], "2026-10-05", { historyDays: 1 })
    expect(stats.history).toEqual([{ dateISO: "2026-10-05", value: 1003.29 }])
    expect(stats.interest.impliedAnnualRatePct).toBeCloseTo(3.948, 8)

    // June 1-15 end at 1000; June 16-30 end at 2000. July 1 is excluded.
    const varied = computeAccountStats([account({ id: 1, balance: 2503 })], [
      row(1000, { dateISO: "2026-06-16" }),
      row(500, { dateISO: "2026-07-01" }),
      row(3, { dateISO: "2026-07-01", description: "Interest" }),
    ], "2026-10-05", { historyDays: 0 })
    expect(varied.history).toEqual([])
    expect(varied.interest.impliedAnnualRatePct).toBeCloseTo(3 / 1500 * 1200)
  })

  test("implied rate is null without interest, a reported balance, or a positive prior average", () => {
    expect(computeAccountStats([account({ id: 1 })], [], "2026-10-05").interest.impliedAnnualRatePct).toBeNull()
    for (const balance of [null, 3, -10]) {
      expect(computeAccountStats([account({ id: 1, balance })], [row(3, { description: "Interest" })], "2026-10-05").interest.impliedAnnualRatePct).toBeNull()
    }
  })

  test("implied rate skips zero-balance days before an opening deposit within the 30-day span", () => {
    const stats = computeAccountStats([account({ id: 1, balance: 1003 })], [
      row(1000, { dateISO: "2026-06-16" }),
      row(3, { dateISO: "2026-07-01", description: "Interest" }),
    ], "2026-10-05", { historyDays: 1 })
    // June 1-15 end at zero (not yet funded, skipped); June 16-30 end at 1000.
    expect(stats.firstActivityISO).toBe("2026-06-16")
    expect(stats.interest.impliedAnnualRatePct).toBeCloseTo(3 / 1000 * 1200)
    expect(stats.history).toHaveLength(1)

    const openedOnInterestDay = computeAccountStats([account({ id: 1, balance: 1003 })], [
      row(1000, { dateISO: "2026-07-01" }),
      row(3, { dateISO: "2026-07-01", description: "Interest" }),
    ], "2026-10-05", { historyDays: 1 })
    expect(openedOnInterestDay.interest.impliedAnnualRatePct).toBeNull()
  })

  test("top outflows group exact descriptions, rank positive totals, cap at five, and use 90 inclusive days", () => {
    const stats = computeAccountStats([account({ id: 1 })], [
      row(-20, { description: "Rent", dateISO: "2026-07-08" }), row(-80, { description: "Rent" }),
      row(-70, { description: "Food", status: "HELD", tagNames: ["IGNORE"] }),
      row(-60, { description: "Travel" }), row(-50, { description: "Bills" }),
      row(-40, { description: "rent" }), row(-30, { description: "Other" }),
      row(900, { description: "Rent" }), row(0, { description: "Rent" }),
      row(-900, { description: "Rent", internal: true, excluded: true }),
      row(-900, { description: "Rent", dateISO: "2026-07-07" }),
      row(-900, { description: "Rent", dateISO: "2026-10-06" }),
      row(-900, { description: "Rent", accountId: 99 }), row(-900, { accountId: null }),
    ], "2026-10-05")
    expect(stats.topOutflows).toEqual([
      { description: "Rent", amount: 100, count: 2 },
      { description: "Food", amount: 70, count: 1 },
      { description: "Travel", amount: 60, count: 1 },
      { description: "Bills", amount: 50, count: 1 },
      { description: "rent", amount: 40, count: 1 },
    ])
  })

  test("two-account groups sum balances and merge flows while internal transfer sides cancel in history", () => {
    const stats = computeAccountStats([account({ id: 1, balance: 100 }), account({ id: 2, balance: 200 })], [
      row(-50, { internal: true, excluded: true }), row(50, { accountId: 2, internal: true, excluded: true }),
      row(20, { accountId: 2 }), row(-10, { description: "Food" }),
      row(-5, { accountId: 2, description: "Food" }),
    ], "2026-10-05", { historyDays: 2, months: 1 })
    expect(stats.balance).toBe(300)
    expect(stats.windows[0]).toEqual({ days: 30, moneyIn: 70, moneyOut: 65, net: 5 })
    expect(stats.monthly).toEqual([{ month: "2026-10", moneyIn: 70, moneyOut: 65 }])
    expect(stats.history).toEqual([{ dateISO: "2026-10-04", value: 295 }, { dateISO: "2026-10-05", value: 300 }])
    expect(stats.topOutflows).toEqual([{ description: "Food", amount: 15, count: 2 }])
  })

  test("explicit zero options keep monthly and history lists empty", () => {
    const stats = computeAccountStats([account({ id: 1 })], [], "2026-10-05", { months: 0, historyDays: 0 })
    expect(stats.monthly).toEqual([])
    expect(stats.history).toEqual([])
  })
})
