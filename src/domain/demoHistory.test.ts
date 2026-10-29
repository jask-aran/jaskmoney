import { expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DEMO_ASK_ROWS, DEMO_CATEGORIES, demoSource, generateDemo, type DemoData, type DemoSourceRow } from "./demo"
import { readDemoTruth, seedDemoDb } from "../db/demoSeed"
import { loadTransactions, openDb } from "../db/client"
import { category, transaction } from "../testing/fixtures"
import type { Transaction } from "./types"

/**
 * Demo mode from your history (acceptance, frozen; approved 2026-10-29).
 * Switching demo on samples your ordinary spending (no people, transfers,
 * income, messages or bills) and makes five times as many rows from it,
 * amounts varied, spread spikily over three years. Some of the rarer
 * merchants are wholly uncategorised (about DEMO_ASK_ROWS rows, so a
 * suggestion run is cheap), which the decision model has to work out
 * rather than history; a few rows of known merchants are hidden too. The
 * evaluation's set hides far more (a fifth of all merchants). True
 * categories are kept beside the database. Fixtures here are invented.
 * (Cheaper demo approved 2026-10-29.)
 */
const today = "2026-10-27"

// Invented merchants, each in one of the demo's categories.
const MERCHANTS: Array<[string, string, number]> = [
  ["Bean Counter Cafe", "Restaurants & Cafes", 6], ["Tiny Teapot", "Restaurants & Cafes", 9], ["Noodle Lane", "Takeaway", 18],
  ["Burger Barn", "Takeaway", 14], ["Fresh Fields Market", "Groceries", 70], ["Corner Grocer", "Groceries", 35],
  ["Hop House", "Pubs & Bars", 30], ["Cellar Door Liquor", "Booze", 40], ["Kite & Twine", "Hobbies", 25],
  ["Pixel Arcade", "Apps, Games & Software", 15], ["Stage Door Tickets", "Events & Gigs", 60], ["Velvet Cuts", "Hair & Beauty", 45],
  ["Pill Box Pharmacy", "Health & Medical", 22], ["Thread Lab", "Clothing & Accessories", 80], ["Gadget Grove", "Technology", 120],
  ["Nest Supplies", "Homeware & Appliances", 55], ["Bolt & Nut Hardware", "Maintenance & Improvements", 40], ["Paws Pantry", "Pets", 33],
  ["Petrol Point", "Fuel", 60], ["Tap Transit", "Public Transport", 8], ["RideNow", "Taxis & Share Cars", 24], ["Park Easy", "Parking", 9],
  ["Motorway Co", "Tolls", 12], ["Wrench Garage", "Car Insurance, Rego & Maintenance", 210], ["Page Turners", "News, Magazines & Books", 20],
  ["Lift Gym", "Fitness & Wellbeing", 25], ["Wrap It Gifts", "Gifts & Charity", 35], ["Tea Garden", "Restaurants & Cafes", 12],
  ["Pho Station", "Takeaway", 16], ["Grain Bakery", "Groceries", 11],
]

const categories = DEMO_CATEGORIES.map((c, i) => category({ id: i + 1, name: c.name, income: !!c.income, notSpending: !!c.notSpending }))
const idOf = (name: string) => categories.find((c) => c.name === name)?.id ?? 999

function history(): Transaction[] {
  const rows: Transaction[] = []
  let id = 1
  const add = (o: Partial<Transaction>) => rows.push(transaction({ id: id++, dateISO: `2026-0${1 + (id % 9)}-1${id % 9}`, transactionType: "Purchase", ...o }))
  for (const [description, name, amount] of MERCHANTS) for (let n = 0; n < 3; n++) {
    add({ description, rawText: `${description.toUpperCase()} MELBOURNE`, amount: -amount * (1 + n / 10), categoryId: idOf(name), categoryName: name, cardMethod: "CONTACTLESS" })
  }
  // Left out: people, a handle, a message, a transfer, income, uncategorised, a bill, a category the demo hasn't.
  add({ description: "Alex Example", transactionType: "Pay Anyone", amount: -40, categoryId: idOf("People"), categoryName: "People" })
  add({ description: "$someone", amount: -12, categoryId: idOf("Restaurants & Cafes"), categoryName: "Restaurants & Cafes" })
  add({ description: "Cafe With Note", message: "for Sam", amount: -9, categoryId: idOf("Restaurants & Cafes"), categoryName: "Restaurants & Cafes" })
  add({ description: "To Savings", transactionType: "Transfer", amount: -300, internal: true, excluded: true, categoryId: idOf("Transfers"), categoryName: "Transfers" })
  add({ description: "Employer Pty", transactionType: "Salary", amount: 2500, income: true, categoryId: idOf("Salary"), categoryName: "Salary" })
  add({ description: "Mystery Shop", amount: -20, categoryId: null, categoryName: "Uncategorised" })
  add({ description: "Landlord Realty", transactionType: "Payment", amount: -1200, categoryId: idOf("Rent & Mortgage"), categoryName: "Rent & Mortgage" })
  add({ description: "Odd Place", amount: -15, categoryId: 999, categoryName: "Not In The Demo" })
  return rows
}

const source = (): DemoSourceRow[] => demoSource(history(), categories)
const make = (seed = 7, hide?: "demo" | "evaluation"): DemoData => generateDemo({ today, years: 3, seed, history: source(), hide })
const fromHistory = (demo: DemoData) => { const names = new Set(MERCHANTS.map(([d]) => d)); return demo.transactions.filter((t) => names.has(t.description)) }

test("demoSource: your ordinary spending only, its merchant, bank text, category and amount", () => {
  const rows = source()
  expect(rows).toHaveLength(MERCHANTS.length * 3)
  expect(new Set(rows.map((r) => r.description))).toEqual(new Set(MERCHANTS.map(([d]) => d)))
  expect(rows[0]).toMatchObject({ description: "Bean Counter Cafe", rawText: "BEAN COUNTER CAFE MELBOURNE", categoryName: "Restaurants & Cafes", amount: -6, transactionType: "Purchase", cardMethod: "CONTACTLESS" })
  // Up's current names (Tolls, Maintenance & Improvements, Car Insurance, Rego & Maintenance) are the demo's.
  for (const name of ["Tolls", "Maintenance & Improvements", "Car Insurance, Rego & Maintenance"]) expect(rows.some((r) => r.categoryName === name)).toBe(true)
})

test("five times as many rows from your merchants, amounts varied, over the whole three years", () => {
  const demo = make()
  const rows = fromHistory(demo)
  expect(rows.length).toBeGreaterThan(MERCHANTS.length * 3 * 5 * 0.8)
  expect(rows.length).toBeLessThan(MERCHANTS.length * 3 * 5 * 1.2)
  const original = new Set(source().map((r) => `${r.description}|${r.amount}`))
  expect(rows.filter((t) => original.has(`${t.description}|${t.amount}`)).length).toBeLessThan(rows.length * 0.1)
  const months = new Set(rows.map((t) => t.dateISO.slice(0, 7)))
  expect(months.size).toBeGreaterThanOrEqual(30)
  for (const t of rows) {
    expect(t.dateISO >= "2023-09-01" && t.dateISO <= today).toBe(true)
    expect(t.amount).toBeLessThan(0)
    expect(t.rawText).toBe(`${t.description.toUpperCase()} MELBOURNE`)
  }
})

test("spiky: months vary a lot, and some days have bursts", () => {
  const rows = fromHistory(make())
  const byMonth = new Map<string, number>()
  for (const t of rows) byMonth.set(t.dateISO.slice(0, 7), (byMonth.get(t.dateISO.slice(0, 7)) ?? 0) - t.amount)
  const values = [...byMonth.values()]
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length)
  expect(sd / mean).toBeGreaterThan(0.3)
  const byDay = new Map<string, number>()
  for (const t of rows) byDay.set(t.dateISO, (byDay.get(t.dateISO) ?? 0) + 1)
  expect(Math.max(...byDay.values())).toBeGreaterThanOrEqual(5)
})

const heldOutOf = (rows: ReturnType<typeof fromHistory>) => {
  const byMerchant = new Map<string, typeof rows>()
  for (const t of rows) byMerchant.set(t.description, [...(byMerchant.get(t.description) ?? []), t])
  const heldOut = [...byMerchant.values()].filter((list) => list.every((t) => t.categoryName === null))
  const others = rows.filter((t) => !heldOut.some((list) => list.includes(t)))
  return { byMerchant, heldOut, others }
}

test("the demo: about DEMO_ASK_ROWS rows from the rarer merchants wholly uncategorised, a few others hidden; the truth kept", () => {
  const rows = fromHistory(make())
  const { byMerchant, heldOut, others } = heldOutOf(rows)
  const asked = heldOut.flat().length
  expect(asked).toBeLessThanOrEqual(DEMO_ASK_ROWS)
  expect(asked).toBeGreaterThan(DEMO_ASK_ROWS * 0.6)
  // The rarer ones: none held out has more rows than a merchant left in.
  const counts = [...byMerchant.values()].filter((list) => !heldOut.includes(list)).map((list) => list.length)
  for (const list of heldOut) expect(list.length).toBeLessThanOrEqual(Math.min(...counts))
  const hiddenOthers = others.filter((t) => t.categoryName === null).length
  expect(hiddenOthers).toBeGreaterThan(0)
  expect(hiddenOthers).toBeLessThan(others.length * 0.03)
  const truth = new Map(MERCHANTS.map(([d, c]) => [d, c]))
  for (const t of rows) expect(t.truthCategory).toBe(truth.get(t.description)!)
  for (const t of rows) if (t.categoryName !== null) expect(t.categoryName).toBe(t.truthCategory)
})

test("the evaluation's set: a fifth of the merchants wholly uncategorised, plus a few rows elsewhere, spread over the years", () => {
  const rows = fromHistory(make(7, "evaluation"))
  const { heldOut, others } = heldOutOf(rows)
  expect(heldOut.length).toBeGreaterThanOrEqual(Math.floor(MERCHANTS.length * 0.15))
  expect(heldOut.length).toBeLessThanOrEqual(Math.ceil(MERCHANTS.length * 0.25))
  const hidden = rows.filter((t) => t.categoryName === null)
  expect(hidden.length).toBeGreaterThan(rows.length * 0.12)
  expect(new Set(hidden.map((t) => t.dateISO.slice(0, 7))).size).toBeGreaterThanOrEqual(24)
  expect(others.filter((t) => t.categoryName === null).length).toBeGreaterThan(0)
  expect(others.filter((t) => t.categoryName === null).length).toBeLessThan(others.length * 0.08)
  for (const t of rows) if (t.categoryName !== null) expect(t.categoryName).toBe(t.truthCategory)
})

test("every row has a time of day; deterministic by seed and history", () => {
  const demo = make()
  for (const t of demo.transactions) expect(t.time).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/)
  expect(make(7)).toEqual(make(7))
  expect(fromHistory(make(8)).slice(0, 20)).not.toEqual(fromHistory(make(7)).slice(0, 20))
})

test("too little history: the built-in demo, as before", () => {
  const demo = generateDemo({ today, years: 3, seed: 7, history: source().slice(0, 5) })
  expect(fromHistory(demo)).toHaveLength(0)
  expect(demo.transactions.length).toBeGreaterThan(1500)
})

test("seedDemoDb: bank text, card use and the time stored; the hidden rows' truth beside the database", () => {
  const demo = make()
  const path = join(mkdtempSync(join(tmpdir(), "jaskmoney-demo-")), "demo.db")
  seedDemoDb(path, demo)
  const db = openDb(path)
  const rows = loadTransactions(db)
  const truth = readDemoTruth(path)
  const hidden = rows.filter((t) => t.categoryName === "Uncategorised")
  expect(hidden.length).toBe(demo.transactions.filter((t) => t.categoryName === null).length)
  for (const t of hidden) expect(truth.get(t.id)).toBe(demo.transactions.find((d) => d.description === t.description)!.truthCategory!)
  expect(truth.size).toBe(hidden.length)
  const sample = rows.find((t) => t.description === "Bean Counter Cafe")!
  expect(sample).toMatchObject({ rawText: "BEAN COUNTER CAFE MELBOURNE", cardMethod: "CONTACTLESS" })
  expect(sample.dateRaw).toMatch(/T\d\d:\d\d/)
  expect(sample.createdMs).not.toBeNull()
  db.close()
})
