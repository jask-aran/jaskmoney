import { expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DEMO_CATEGORIES, demoSource, generateDemo, type DemoData, type DemoSourceRow } from "./demo"
import { readDemoTruth, seedDemoDb } from "../db/demoSeed"
import { loadTransactions, openDb } from "../db/client"
import { category, transaction } from "../testing/fixtures"
import type { Transaction } from "./types"

const today = "2026-10-27"

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
