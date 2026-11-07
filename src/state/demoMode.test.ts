import { expect, test } from "bun:test"
import { data } from "./dataStore"

test("Demo mode uses none of your data: nothing of yours in its rows, accounts or categories; it has its own monthly budget", async () => {
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
  await data.enterDemo()
  const everything = [
    ...data.state.transactions.map((t) => `${t.description} ${t.message ?? ""} ${t.notes}`),
    ...data.state.accounts.map((a) => a.name),
    ...data.state.categories.map((c) => c.name),
  ].join("\n")
  expect(everything).not.toMatch(/zqxprivate/i)
  expect(data.state.budgets).toEqual([expect.objectContaining({ scope: { kind: "overall" } })])
  expect(data.state.budgetCycle).toMatchObject({ unit: "month", anchor: "calendar" })
  await data.leaveDemo()
  expect(data.state.categories.some((c) => c.name === "Zqxprivate Hobby")).toBe(true)
})
