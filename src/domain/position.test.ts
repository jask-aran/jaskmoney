import { describe, expect, test } from "bun:test"
import { computeAccountStats } from "./accountStats"
import { balanceHistory, computePeriodFlows, computePosition } from "./position"
import type { Transaction } from "./types"
import { account, transaction } from "../testing/fixtures"

const row = (amount: number, overrides: Partial<Transaction> = {}) => transaction({ amount, ...overrides })

const accounts = [
  account({ id: 1, balance: 200 }),
  account({ id: 2, source: "csv", externalKind: null, balance: null }),
  account({ id: 4, externalKind: "SAVER", balance: 500 }),
  account({ id: 3, externalKind: "SAVER", balance: 300 }),
  account({ id: 5, externalKind: "SAVER", balance: null }),
]

describe("computePosition", () => {
  test("balances omit CSV nulls and preserve saver account order", () => {
    const p = computePosition(accounts, [], "2026-10-05")
    expect(p.netPosition).toBe(1000)
    expect(p.spendingBalance).toBe(200)
    expect(p.savers).toEqual([
      { accountId: 4, name: "Account 4", balance: 500 },
      { accountId: 3, name: "Account 3", balance: 300 },
    ])
    expect(p.saversTotal).toBe(800)
    expect(p.dailySpend).toBeNull()
    expect(p.runwayDays).toBeNull()
    expect(p.history).toHaveLength(90)
    expect(p.history[0]).toEqual({ dateISO: "2026-07-08", value: 1000 })
    expect(p.history.at(-1)).toEqual({ dateISO: "2026-10-05", value: 1000 })
  })

  test("pending counts only HELD spending rows, regardless of flow exclusions", () => {
    const p = computePosition(accounts, [
      row(-20, { status: "HELD" }),
      row(-5, { status: "HELD", internal: true, excluded: true, tagNames: ["IGNORE"] }),
      row(2, { status: "HELD", accountId: 2 }),
      row(-100, { status: "HELD", accountId: 3 }),
      row(-100), row(-100, { status: null }),
      row(-100, { status: "HELD", accountId: null }),
      row(-100, { status: "HELD", accountId: 99 }),
    ], "2026-10-05")
    expect(p.pendingCount).toBe(3)
    expect(p.pendingAmount).toBe(-23)
  })

  test("default burn uses 90 inclusive days, spending roles, and ordinary debits", () => {
    const p = computePosition(accounts, [
      row(-900, { dateISO: "2026-07-07" }),
      row(-60, { dateISO: "2026-07-08" }),
      row(-30, { accountId: 2, status: "HELD" }),
      row(-900, { dateISO: "2026-10-06" }),
      row(-900, { internal: true, excluded: true }),
      row(-900, { tagNames: ["other", "iGnOrE"] }),
      row(-900, { accountId: 3 }),
      row(-900, { accountId: null }),
      row(900),
    ], "2026-10-05")
    expect(p.dailySpend).toBe(1)
    expect(p.runwayDays).toBe(1000)
  })

  test("short coverage starts at the first transaction and ends today across DST", () => {
    const p = computePosition(accounts, [
      row(-30), row(50, { dateISO: "2026-10-03" }),
    ], "2026-10-05", { burnDays: 10 })
    expect(p.dailySpend).toBe(10)
    expect(computePosition(accounts, [row(-0.1), row(-0.2)], "2026-10-05").dailySpend).toBe(0.1 + 0.2)
  })

  test("null and zero balances stay distinct; runway allows zero and negative position", () => {
    const csv = account({ id: 1, source: "csv", balance: null })
    const p = computePosition([csv], [row(-10)], "2026-10-05", { historyDays: 1 })
    expect(p.netPosition).toBeNull()
    expect(p.spendingBalance).toBeNull()
    expect(p.savers).toEqual([])
    expect(p.saversTotal).toBe(0)
    expect(p.dailySpend).toBe(10)
    expect(p.runwayDays).toBeNull()
    expect(p.history).toEqual([{ dateISO: "2026-10-05", value: 0 }])
    expect(computePosition([account({ id: 1, balance: 0 })], [row(-10)], "2026-10-05").runwayDays).toBe(0)
    expect(computePosition([account({ id: 1, balance: -20 })], [row(-10)], "2026-10-05").runwayDays).toBe(-2)
    expect(computePosition([accounts[2]!], [], "2026-10-05").spendingBalance).toBeNull()
    expect(computePosition([], [], "2026-10-05").netPosition).toBeNull()
    expect(computePosition(accounts, [row(10), row(0)], "2026-10-05").dailySpend).toBeNull()
  })

  test("history reverses all dated balanced-account rows, including holds and future rows", () => {
    const p = computePosition(accounts, [
      row(-20, { dateISO: "2026-10-04", status: "HELD" }),
      row(50, { tagNames: ["IGNORE"] }),
      row(-100, { dateISO: "2026-10-04", internal: true, excluded: true, transferAccountId: 3 }),
      row(100, { dateISO: "2026-10-04", accountId: 3, internal: true, excluded: true, transferAccountId: 1 }),
      row(5, { dateISO: "2026-10-04", accountId: 4 }),
      row(-10, { dateISO: "2026-10-06" }),
      row(3, { dateISO: "2027-01-01", accountId: 3 }),
      row(999, { accountId: 2 }), row(999, { accountId: null }),
      row(999, { accountId: 99 }), row(999, { dateISO: "2026-10-02" }),
    ], "2026-10-05", { historyDays: 3 })
    expect(p.netPosition).toBe(1000)
    expect(p.history).toEqual([
      { dateISO: "2026-10-03", value: 972 },
      { dateISO: "2026-10-04", value: 957 },
      { dateISO: "2026-10-05", value: 1007 },
    ])
  })

  test("calendar history crosses leap day and year boundaries", () => {
    expect(computePosition([], [], "2024-03-01", { historyDays: 3 }).history.map((d) => d.dateISO))
      .toEqual(["2024-02-28", "2024-02-29", "2024-03-01"])
    expect(computePosition([], [], "2026-01-01", { historyDays: 2 }).history.map((d) => d.dateISO))
      .toEqual(["2025-12-31", "2026-01-01"])
  })

  for (const dates of [
    ["2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"],
    ["2026-04-01", "2026-04-02", "2026-04-03", "2026-04-04", "2026-04-05"],
  ]) {
    const todayISO = dates[4]!
    test(`history dates and burn window end on Melbourne DST change ${todayISO}`, () => {
      const transactions = [
        row(-900, { dateISO: dates[1]! }), // Before the three-day burn window.
        row(-20, { dateISO: dates[2]! }),
        row(-10, { dateISO: todayISO }),
      ]
      const p = computePosition(accounts, transactions, todayISO, { historyDays: 5, burnDays: 3 })
      expect(p.history.map((day) => day.dateISO)).toEqual(dates)
      expect(p.history).toHaveLength(5)
      expect(p.history.at(-1)?.dateISO).toBe(todayISO)
      expect(p.dailySpend).toBe(10)
      const short = computePosition(accounts, transactions.slice(1), todayISO, { burnDays: 90 })
      expect(short.dailySpend).toBe(10)
    })
  }
})

describe("computePeriodFlows", () => {
  const rows = [
    row(1000), row(-100, { status: "HELD" }),
    row(-200, { transferAccountId: 99 }), // Untracked rent account is spending.
    row(-500, { internal: true, excluded: true, transferAccountId: 3 }),
    row(500, { accountId: 3, internal: true, excluded: true, transferAccountId: 1 }),
    row(100, { internal: true, excluded: true, transferAccountId: 3 }),
    row(-100, { accountId: 3, internal: true, excluded: true, transferAccountId: 1 }),
    row(-50, { internal: true, excluded: true, transferAccountId: 2 }),
    row(50, { accountId: 2, internal: true, excluded: true, transferAccountId: 1 }),
    row(-999, { tagNames: ["iGnOrE"] }), row(999, { tagNames: ["IGNORE"] }),
    row(5, { accountId: 3 }), // Interest belongs to saver changes only.
    row(-2, { accountId: 4, tagNames: ["IGNORE"] }),
    row(-10, { accountId: 2 }), row(20, { accountId: 2 }), row(0),
    row(999, { accountId: null }), row(-999, { accountId: 99 }),
  ]

  test("ordinary flows exclude internal and IGNORE rows, but include untracked transfers", () => {
    expect(computePeriodFlows(accounts, rows)).toEqual({
      spent: 310, income: 1020, net: 710, savedToSavers: 400,
      savingsRate: 710 / 1020 * 100, txnCount: 6,
      saverChanges: [{ accountId: 4, change: -2 }, { accountId: 3, change: 405 }, { accountId: 5, change: 0 }],
    })
  })

  test("account scope narrows spending, income, count, and saving transfers only", () => {
    const p = computePeriodFlows(accounts, rows, new Set([2, 3, 99]))
    expect(p).toEqual({
      spent: 10, income: 20, net: 10, savedToSavers: 0, savingsRate: 50, txnCount: 2,
      saverChanges: [{ accountId: 4, change: -2 }, { accountId: 3, change: 405 }, { accountId: 5, change: 0 }],
    })
    const empty = computePeriodFlows(accounts, rows, new Set())
    expect(empty.spent).toBe(0)
    expect(empty.income).toBe(0)
    expect(empty.txnCount).toBe(0)
    expect(empty.savingsRate).toBeNull()
  })

  test("saving and withdrawal signs come from the spending side, including IGNORE", () => {
    expect(computePeriodFlows(accounts, [row(-20, { internal: true, excluded: true, transferAccountId: 3, tagNames: ["IGNORE"] })]).savedToSavers).toBe(20)
    expect(computePeriodFlows(accounts, [row(30, { internal: true, excluded: true, transferAccountId: 3 })]).savedToSavers).toBe(-30)
    expect(computePeriodFlows(accounts, [row(-20, { transferAccountId: 3 })]).savedToSavers).toBe(0)
  })

  test("no income yields a null savings rate; empty input yields zero flows", () => {
    const p = computePeriodFlows(accounts, [row(-10)])
    expect(p.savingsRate).toBeNull()
    expect(p.net).toBe(-10)
    expect(computePeriodFlows([], [])).toEqual({
      spent: 0, income: 0, net: 0, savedToSavers: 0, savingsRate: null, txnCount: 0, saverChanges: [],
    })
  })
})

describe("balanceHistory", () => {
  test("reconstructs end-of-day balances per role, ignoring rows after the end", () => {
    const accounts = [
      account({ id: 1, balance: 100 }),
      account({ id: 2, balance: 50, externalKind: "SAVER" }),
    ]
    const txns = [
      row(-30, { accountId: 1, dateISO: "2026-10-02" }),
      row(20, { accountId: 2, dateISO: "2026-10-03" }),
      row(-5, { accountId: 1, dateISO: "2026-10-05" }),
    ]
    expect(balanceHistory(accounts, txns, "2026-10-01", "2026-10-04")).toEqual([
      { dateISO: "2026-10-01", net: 165, spending: 135, savers: 30 },
      { dateISO: "2026-10-02", net: 135, spending: 105, savers: 30 },
      { dateISO: "2026-10-03", net: 155, spending: 105, savers: 50 },
      { dateISO: "2026-10-04", net: 155, spending: 105, savers: 50 },
    ])
  })
})

test("all history consumers retain holds, exclusions, future rows and null-balance account rules", () => {
  const scope = [account({ id: 1, balance: 200 }), account({ id: 2, externalKind: "SAVER", balance: 500 }), account({ id: 3, balance: null })]
  const rows = [
    row(-20, { dateISO: "2026-10-04", status: "HELD" }),
    row(-10, { dateISO: "2026-10-04", excluded: true, tagNames: ["IGNORE"] }),
    row(50),
    row(100, { accountId: 2, dateISO: "2026-10-06", internal: true, excluded: true }),
    row(-5, { dateISO: "2026-10-07" }),
    row(-900, { accountId: 3 }),
    row(-900, { accountId: null }),
    row(-900, { accountId: 99 }),
  ]
  const expected = [
    { dateISO: "2026-10-03", value: 585 },
    { dateISO: "2026-10-04", value: 555 },
    { dateISO: "2026-10-05", value: 605 },
  ]
  expect(computePosition(scope, rows, "2026-10-05", { historyDays: 3 }).history).toEqual(expected)
  expect(computeAccountStats(scope, rows, "2026-10-05", { historyDays: 3 }).history).toEqual(expected)
  expect(balanceHistory(scope, rows, "2026-10-03", "2026-10-05")).toEqual([
    { dateISO: "2026-10-03", net: 585, spending: 185, savers: 400 },
    { dateISO: "2026-10-04", net: 555, spending: 155, savers: 400 },
    { dateISO: "2026-10-05", net: 605, spending: 205, savers: 400 },
  ])
})

test("history consolidation preserves each caller's future-amount subtraction order", () => {
  const scope = [account({ id: 1, balance: 1 })]
  const rows = [row(0.1), row(0.1), row(0.1)]
  const sequential = 1 - 0.1 - 0.1 - 0.1
  const grouped = 1 - (0.1 + 0.1 + 0.1)
  expect(computePosition(scope, rows, "2026-10-04", { historyDays: 1 }).history[0]!.value).toBe(sequential)
  expect(balanceHistory(scope, rows, "2026-10-04", "2026-10-04")[0]!.net).toBe(sequential)
  expect(computeAccountStats(scope, rows, "2026-10-04", { historyDays: 1 }).history[0]!.value).toBe(grouped)
})
