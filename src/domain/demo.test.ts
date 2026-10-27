import { expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { demoProfile, generateDemo, type DemoTransaction } from "./demo"
import { seedDemoDb } from "../db/demoSeed"
import { loadAccounts, loadCategories, loadTransactions, openDb } from "../db/client"
import { account, category, transaction } from "../testing/fixtures"
import { isIncome, isSpending } from "./moneyRules"

/**
 * Demo mode (acceptance, frozen). demoProfile reads the user's data for its
 * patterns; generateDemo spreads them over `years` with a lot of noise;
 * seedDemoDb writes the result to a fresh database. Nothing personal leaves
 * the real data: payments to and from people, the employer (income
 * descriptions), notes, messages and account names are replaced.
 */
const categories = [
  category({ id: 1, name: "Groceries" }), category({ id: 2, name: "TV, Music & Streaming" }),
  category({ id: 3, name: "Salary", income: true }), category({ id: 4, name: "Restaurants & Cafes" }),
  category({ id: 5, name: "People" }), category({ id: 6, name: "Holidays & Travel" }),
  category({ id: 7, name: "Transfers", notSpending: true }),
]
const accounts = [
  account({ id: 1, name: "My Spending", externalKind: "TRANSACTIONAL", balance: 1027.23 }),
  account({ id: 2, name: "🏖️ My Holiday", externalKind: "SAVER", balance: 3400 }),
]
function realRows() {
  let id = 0
  const rows = []
  const day = (m: number, d: number) => `2026-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`
  for (let m = 5; m <= 10; m++) {
    for (const d of [2, 9, 16, 23]) rows.push(transaction({ id: ++id, dateISO: day(m, d), amount: -(60 + d), description: "Coles", categoryId: 1, categoryName: "Groceries" }))
    rows.push(transaction({ id: ++id, dateISO: day(m, 3), amount: -22.99, description: "Netflix", categoryId: 2, categoryName: "TV, Music & Streaming" }))
    rows.push(transaction({ id: ++id, dateISO: day(m, 14), amount: 3100, description: "PAYROLL SECRET EMPLOYER PTY", categoryId: 3, categoryName: "Salary", income: true }))
    rows.push(transaction({ id: ++id, dateISO: day(m, 20), amount: -45, description: "Alex Morgan ANZ", transactionType: "Pay Anyone", categoryId: 5, categoryName: "People", message: "rent share for jask", notes: "private note" }))
    rows.push(transaction({ id: ++id, dateISO: day(m, 15), amount: -400, description: "Transfer to My Holiday", transferAccountId: 2, internal: true, excluded: true, categoryId: null, categoryName: "Uncategorised" }))
    rows.push(transaction({ id: ++id, dateISO: day(m, 11), amount: -18.5, description: "Lane Coffee Roasters", categoryId: 4, categoryName: "Restaurants & Cafes" }))
  }
  return rows
}
const PERSONAL = /alex|morgan|secret employer|rent share|private note/i

function generated(seed = 7) {
  return generateDemo(demoProfile(realRows(), categories, accounts), { today: "2026-10-27", years: 3, seed })
}

test("three years of rows, oldest about three years back, none after today", () => {
  const demo = generated()
  const dates = demo.transactions.map((t) => t.dateISO).sort()
  expect(dates.at(-1)! <= "2026-10-27").toBe(true)
  expect(dates[0]! <= "2023-12-01").toBe(true)
  expect(dates[0]! >= "2023-09-01").toBe(true)
  // Every month of the three years has spending.
  const months = new Set(demo.transactions.filter((t) => t.amount < 0).map((t) => t.dateISO.slice(0, 7)))
  expect(months.size).toBeGreaterThanOrEqual(35)
  expect(demo.transactions.length).toBeGreaterThan(1000)
})

test("the same seed gives the same data; another seed different data", () => {
  expect(generated(7)).toEqual(generated(7))
  expect(generated(8).transactions.slice(0, 20)).not.toEqual(generated(7).transactions.slice(0, 20))
})

test("nothing personal: people, the employer, notes, messages and account names are replaced", () => {
  const demo = generated()
  for (const t of demo.transactions) expect(`${t.description} ${t.message ?? ""}`).not.toMatch(PERSONAL)
  for (const a of demo.accounts) expect(a.name).not.toMatch(PERSONAL)
  // People payments still happen, to made-up names.
  expect(demo.transactions.some((t) => t.categoryName === "People" && t.transactionType != null)).toBe(true)
})

test("patterned on the user's data, with noise", () => {
  const demo = generated()
  const coles = demo.transactions.filter((t) => t.description === "Coles")
  // About four a month for three years, give or take the noise.
  expect(coles.length).toBeGreaterThan(36 * 4 * 0.5)
  expect(coles.length).toBeLessThan(36 * 4 * 1.8)
  expect(coles.every((t) => t.categoryName === "Groceries" && t.amount < 0)).toBe(true)
  const amounts = new Set(coles.map((t) => t.amount))
  expect(amounts.size).toBeGreaterThan(coles.length / 2)
  // Merchants the user never used appear too (noise), each in a category the user has.
  const known = new Set(realRows().map((t) => t.description))
  const extra = new Set(demo.transactions.filter((t) => t.amount < 0 && !known.has(t.description) && t.categoryName !== "People" && !t.transferToKey).map((t) => t.description))
  expect(extra.size).toBeGreaterThanOrEqual(10)
  for (const t of demo.transactions) if (t.categoryName) expect(categories.some((c) => c.name === t.categoryName)).toBe(true)
})

test("subscriptions keep their cadence with price changes; pay arrives regularly; savers get transfers; trips abroad", () => {
  const demo = generated()
  const netflix = demo.transactions.filter((t) => t.description === "Netflix")
  expect(netflix.length).toBeGreaterThanOrEqual(30)
  expect(new Set(netflix.map((t) => t.amount)).size).toBeGreaterThanOrEqual(2)
  const pay = demo.transactions.filter((t) => t.amount > 0 && t.categoryName === "Salary")
  expect(pay.length).toBeGreaterThanOrEqual(30)
  const saver = demo.accounts.find((a) => a.kind === "saver")!
  expect(demo.transactions.filter((t: DemoTransaction) => t.transferToKey === saver.key).length).toBeGreaterThanOrEqual(12)
  expect(demo.transactions.filter((t) => t.foreignAmount).length).toBeGreaterThanOrEqual(10)
})

test("with no data of the user's, it still makes a full demo", () => {
  const demo = generateDemo(demoProfile([], categories, []), { today: "2026-10-27", years: 3, seed: 1 })
  expect(demo.accounts.some((a) => a.kind === "spending")).toBe(true)
  expect(demo.transactions.length).toBeGreaterThan(500)
})

test("seedDemoDb writes a fresh database: the categories copied, Up-like accounts with no Up ids, every row", () => {
  const demo = generated()
  const path = join(mkdtempSync(join(tmpdir(), "jaskmoney-demo-")), "demo.db")
  seedDemoDb(path, demo, categories)
  const db = openDb(path)
  const rows = loadTransactions(db)
  expect(rows.length).toBe(demo.transactions.length)
  for (const c of categories) expect(loadCategories(db).some((d) => d.name === c.name && d.income === c.income && d.notSpending === c.notSpending)).toBe(true)
  const saved = loadAccounts(db)
  expect(saved.map((a) => a.name).sort()).toEqual(demo.accounts.map((a) => a.name).sort())
  expect(saved.every((a) => a.source === "up")).toBe(true)
  expect(saved.some((a) => a.externalKind === "SAVER")).toBe(true)
  expect(db.query("SELECT COUNT(*) AS n FROM transactions WHERE external_id IS NOT NULL").get()).toEqual({ n: 0 })
  expect(db.query("SELECT COUNT(*) AS n FROM accounts WHERE external_id IS NOT NULL").get()).toEqual({ n: 0 })
  // Transfers to savers read as internal (not spending), pay as income.
  expect(rows.some((t) => t.internal)).toBe(true)
  expect(rows.some((t) => isIncome(t))).toBe(true)
  expect(rows.filter((t) => isSpending(t)).length).toBeGreaterThan(500)
  db.close()
})
