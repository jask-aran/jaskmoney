import { expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DEMO_CATEGORIES, generateDemo, type DemoData } from "./demo"
import { seedDemoDb } from "../db/demoSeed"
import { loadAccounts, loadBudgetCycle, loadBudgets, loadCategories, loadTransactions, openDb } from "../db/client"
import { isIncome, isSpending } from "./moneyRules"

/**
 * Demo mode (acceptance, frozen). The demo ships with the app, so it is
 * made from built-in data only: generateDemo takes no user data at all.
 * Three years of an Up-style account with real variety: up months and
 * down months, different spending patterns, a monthly budget it sometimes
 * keeps and sometimes blows.
 */
const today = "2026-10-27"
const make = (seed = 7): DemoData => generateDemo({ today, years: 3, seed })

function monthlySpend(demo: DemoData): Map<string, number> {
  const spend = new Map<string, number>()
  const spendingCats = new Set(DEMO_CATEGORIES.filter((c) => !c.income && !c.notSpending).map((c) => c.name))
  for (const t of demo.transactions) {
    if (t.amount >= 0 || t.transferToKey || !t.categoryName || !spendingCats.has(t.categoryName)) continue
    const month = t.dateISO.slice(0, 7)
    spend.set(month, (spend.get(month) ?? 0) - t.amount)
  }
  return spend
}

test("only built-in data: generateDemo takes options alone, and is deterministic by seed", () => {
  expect(generateDemo.length).toBe(1)
  expect(make(7)).toEqual(make(7))
  expect(make(8).transactions.slice(0, 30)).not.toEqual(make(7).transactions.slice(0, 30))
})

test("three years ending today, every month with spending, a few thousand rows", () => {
  const demo = make()
  const dates = demo.transactions.map((t) => t.dateISO).sort()
  expect(dates.at(-1)! <= today).toBe(true)
  expect(dates[0]! <= "2023-11-30").toBe(true)
  expect(dates[0]! >= "2023-09-01").toBe(true)
  const months = monthlySpend(demo)
  expect(months.size).toBeGreaterThanOrEqual(36)
  expect(demo.transactions.length).toBeGreaterThan(1500)
  expect(demo.transactions.length).toBeLessThan(9000)
})

test("an Up-style category tree: groups with categories in them, income and not-spending ones; every row's category is in it", () => {
  const groups = DEMO_CATEGORIES.filter((c) => c.parent === null && DEMO_CATEGORIES.some((d) => d.parent === c.name))
  expect(groups.length).toBeGreaterThanOrEqual(4)
  expect(DEMO_CATEGORIES.filter((c) => c.parent !== null).length).toBeGreaterThanOrEqual(15)
  expect(DEMO_CATEGORIES.some((c) => c.income)).toBe(true)
  expect(DEMO_CATEGORIES.some((c) => c.notSpending)).toBe(true)
  for (const c of DEMO_CATEGORIES) if (c.parent) expect(DEMO_CATEGORIES.some((d) => d.name === c.parent)).toBe(true)
  const names = new Set(DEMO_CATEGORIES.map((c) => c.name))
  for (const t of make().transactions) if (t.categoryName) expect(names.has(t.categoryName)).toBe(true)
})

test("up months and down months: monthly spending varies a lot, with clear highs and lows", () => {
  const values = [...monthlySpend(make()).values()].slice(1, -1) // whole months only
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length)
  expect(sd / mean).toBeGreaterThan(0.2)
  const sorted = [...values].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]!
  expect(values.filter((v) => v > median * 1.3).length).toBeGreaterThanOrEqual(3)
  expect(values.filter((v) => v < median * 0.8).length).toBeGreaterThanOrEqual(3)
})

test("different spending patterns: a few big one-off purchases, trips abroad, regular bills and subscriptions, pay and saving", () => {
  const demo = make()
  const spending = demo.transactions.filter((t) => t.amount < 0 && !t.transferToKey)
  const big = spending.filter((t) => -t.amount >= 800 && t.categoryName !== null && !/rent|mortgage/i.test(t.categoryName))
  expect(big.length).toBeGreaterThanOrEqual(2)
  expect(big.length).toBeLessThanOrEqual(15)
  expect(demo.transactions.filter((t) => t.foreignAmount).length).toBeGreaterThanOrEqual(10)
  const byDesc = new Map<string, number>()
  for (const t of spending) byDesc.set(t.description, (byDesc.get(t.description) ?? 0) + 1)
  expect([...byDesc.values()].filter((n) => n >= 30).length).toBeGreaterThanOrEqual(4)
  expect(demo.transactions.filter((t) => t.amount > 0 && t.categoryName && DEMO_CATEGORIES.find((c) => c.name === t.categoryName)?.income).length).toBeGreaterThanOrEqual(36)
  const saver = demo.accounts.find((a) => a.kind === "saver")!
  expect(demo.transactions.filter((t) => t.transferToKey === saver.key).length).toBeGreaterThanOrEqual(12)
})

test("a monthly budget it keeps in some months and blows in others", () => {
  const demo = make()
  expect(demo.budget.monthly).toBeGreaterThan(0)
  const values = [...monthlySpend(demo).values()].slice(1, -1)
  expect(values.filter((v) => v > demo.budget.monthly).length).toBeGreaterThanOrEqual(4)
  expect(values.filter((v) => v <= demo.budget.monthly).length).toBeGreaterThanOrEqual(8)
})

test("seedDemoDb: the demo's own categories, Up-style accounts without Up ids, an overall budget on monthly cycles from the 1st, every row", () => {
  const demo = make()
  const path = join(mkdtempSync(join(tmpdir(), "jaskmoney-demo-")), "demo.db")
  seedDemoDb(path, demo)
  const db = openDb(path)
  const rows = loadTransactions(db)
  expect(rows.length).toBe(demo.transactions.length)
  const categories = loadCategories(db)
  for (const c of DEMO_CATEGORIES) {
    const saved = categories.find((d) => d.name === c.name)
    expect(saved).toBeDefined()
    expect(saved!.income).toBe(!!c.income)
    if (c.parent) expect(categories.find((d) => d.id === saved!.parentId)?.name).toBe(c.parent)
  }
  expect(loadAccounts(db).every((a) => a.source === "up")).toBe(true)
  expect(db.query("SELECT COUNT(*) AS n FROM transactions WHERE external_id IS NOT NULL").get()).toEqual({ n: 0 })
  expect(loadBudgets(db)).toEqual([expect.objectContaining({ scope: { kind: "overall" }, amount: demo.budget.monthly })])
  expect(loadBudgetCycle(db)).toMatchObject({ unit: "month", anchor: "calendar" })
  expect(rows.some((t) => t.internal)).toBe(true)
  expect(rows.some((t) => isIncome(t))).toBe(true)
  expect(rows.filter((t) => isSpending(t)).length).toBeGreaterThan(1000)
  db.close()
})
