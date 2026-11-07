import { expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DEMO_CATEGORIES, generateDemo, type DemoData } from "./demo"
import { seedDemoDb } from "../db/demoSeed"
import { loadAccounts, loadBudgetCycle, loadBudgets, loadCategories, loadTransactions, openDb } from "../db/client"
import { isIncome, isSpending } from "./moneyRules"

/**
 * Demo mode (acceptance, frozen). Without history, the built-in life
 * alone (it ships with the app): three years of an Up-style account with
 * real variety: up months and down months, different spending patterns, a
 * monthly budget it sometimes keeps and sometimes blows. With your history
 * (approved 2026-10-29), see demoHistory.test.
 */
const today = "2026-10-27"
const make = (seed = 7): DemoData => generateDemo({ today, years: 3, seed })

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
