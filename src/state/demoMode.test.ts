import { expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { data } from "./dataStore"
import { ui } from "./uiStore"
import { handleKey } from "../app/keys"
import { runSync } from "../app/sync"
import { DATABASE_ROWS } from "./databaseRows"
import { jaskmoneyHome } from "../storage/home"
import { key } from "../testing/keys"

/** Demo mode (Settings › Database & Import): made-up rows in their own
 * database; the real one untouched, sync off; enter again goes back. */
test("Demo mode: enter swaps in three years of made-up rows, sync does nothing, enter again restores your data", async () => {
  data.init(":memory:")
  const db = data.getDb()!
  db.query("INSERT INTO accounts (id, name, type, source, external_kind, sync_enabled) VALUES (300, 'Real Spending', 'debit', 'up', 'TRANSACTIONAL', 1)").run()
  db.query("INSERT INTO accounts (id, name, type, source, external_kind, sync_enabled) VALUES (301, 'Real Joint', 'debit', 'up', 'TRANSACTIONAL', 1)").run()
  db.query("INSERT INTO transactions (date_raw, date_iso, amount, description, account_id, source) VALUES ('2026-10-01', '2026-10-01', -12.5, 'Real Cafe', 300, 'up')").run()
  data.refresh()
  data.setAccountSelection(300)
  ui.switchTab("settings")
  ui.activateSettings("database")
  ui.setState({ databaseCursor: DATABASE_ROWS.indexOf("demo") })
  handleKey(ui, key("return"), data)
  expect(data.state.demo).toBe(true)
  expect(existsSync(join(jaskmoneyHome(), "demo.db"))).toBe(true)
  expect(data.state.transactions.length).toBeGreaterThan(1000)
  expect(data.state.transactions.some((t) => t.description === "Real Cafe")).toBe(false)
  expect(data.state.accountSelection).toBe("all")
  expect(ui.state.status).toMatch(/^Demo mode: [\d,]+ made-up transactions/)
  const before = data.state.dbInfo?.upLastSyncedAt ?? null
  await runSync(ui, data, { manual: true })
  expect(ui.state.status).toMatch(/Demo mode: sync is off/)
  expect(data.state.dbInfo?.upLastSyncedAt ?? null).toBe(before)
  handleKey(ui, key("return"), data)
  expect(data.state.demo).toBe(false)
  expect(data.state.transactions.map((t) => t.description)).toEqual(["Real Cafe"])
  expect(data.state.accountSelection).toBe(300)
})

test("Demo mode uses none of your data: nothing of yours in its rows, accounts or categories; it has its own monthly budget", () => {
  data.init(":memory:")
  const db = data.getDb()!
  db.query("INSERT INTO accounts (id, name, type, source, external_kind, sync_enabled) VALUES (300, 'Zqxprivate Spending', 'debit', 'up', 'TRANSACTIONAL', 1)").run()
  db.query("INSERT INTO categories (name, color, sort_order) VALUES ('Zqxprivate Hobby', '#fff', 99)").run()
  const hobby = (db.query("SELECT id FROM categories WHERE name = 'Zqxprivate Hobby'").get() as { id: number }).id
  for (let i = 1; i <= 28; i++) {
    const day = `2026-${String((i % 9) + 1).padStart(2, "0")}-${String((i % 27) + 1).padStart(2, "0")}`
    db.query("INSERT INTO transactions (date_raw, date_iso, amount, description, account_id, category_id, message, source) VALUES (?, ?, ?, 'Zqxprivate Bakery', 300, ?, 'zqxprivate note', 'up')").run(day, day, -(10 + i), hobby)
  }
  data.refresh()
  data.enterDemo()
  const everything = [
    ...data.state.transactions.map((t) => `${t.description} ${t.message ?? ""} ${t.notes}`),
    ...data.state.accounts.map((a) => a.name),
    ...data.state.categories.map((c) => c.name),
  ].join("\n")
  expect(everything).not.toMatch(/zqxprivate/i)
  expect(data.state.budgets).toEqual([expect.objectContaining({ scope: { kind: "overall" } })])
  expect(data.state.budgetCycle).toMatchObject({ unit: "month", anchor: "calendar" })
  data.leaveDemo()
  expect(data.state.categories.some((c) => c.name === "Zqxprivate Hobby")).toBe(true)
})
