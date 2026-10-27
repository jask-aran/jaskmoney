import { afterEach, expect, test } from "bun:test"
import { setAppClock } from "../../domain/days"
import { data } from "../../state/dataStore"
import { ui } from "../../state/uiStore"
import { renderApp } from "../../testing/app"
import { handleKey } from "../../app/keys"
import { key } from "../../testing/keys"

afterEach(() => setAppClock(null))

test("the Budgets tab (3): this cycle's budgets with bars, the past cycles of the one under the cursor, spending by category", async () => {
  setAppClock(new Date(2026, 9, 20, 12))
  const t = await renderApp({ width: 120, height: 40 })
  data.init(":memory:")
  const db = data.getDb()!
  db.query("INSERT INTO accounts (id, name, type, source, external_kind) VALUES (1, 'Spending', 'debit', 'up', 'TRANSACTIONAL')").run()
  const groceries = data.state.categories.find((c) => c.name === "Groceries")!.id
  // Monthly cycles from the 1st: $300 in September, $120 so far in October.
  for (const [date, amount] of [["2026-09-05", -200], ["2026-09-20", -100], ["2026-10-03", -120]] as const) {
    db.query("INSERT INTO transactions (date_raw, date_iso, amount, description, account_id, category_id, source) VALUES (?, ?, ?, 'Shop', 1, ?, 'up')").run(date, date, amount, groceries)
  }
  data.refresh()
  data.setBudget({ kind: "overall" }, 500)
  handleKey(ui, key("3"), data)
  await t.renderOnce(); await t.flush()
  const frame = t.captureCharFrame()
  expect(frame).toContain("Budgets · 1 Oct – 31 Oct · day 20 of 31")
  expect(frame).toMatch(/Overall spending\s+[█▌│─]+\s+\$120 of \$500\s+\$380 left · \$32\/day/)
  expect(frame).toContain("Past cycles · Overall spending")
  expect(frame).toMatch(/1 Sep – 30 Sep\s+\$300/)
  expect(frame).toMatch(/Groceries\s+\$120\s+\$300\s+—/)
  // The list keys work here: a opens the budget editor.
  handleKey(ui, key("a"), data)
  expect(ui.state.settingsEditor).toBe("budget")
})
