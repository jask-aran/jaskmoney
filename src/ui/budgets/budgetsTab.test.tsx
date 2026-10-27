import { afterEach, expect, test } from "bun:test"
import { setAppClock } from "../../domain/days"
import { data } from "../../state/dataStore"
import { ui } from "../../state/uiStore"
import { renderApp } from "../../testing/app"
import { handleKey } from "../../app/keys"
import { key } from "../../testing/keys"

afterEach(() => setAppClock(null))

/** Monthly cycles from the 1st: Groceries $300 in September; this cycle
 * $120 spent and a $20 refund into Groceries (it reduces spending). */
async function budgetsTab() {
  setAppClock(new Date(2026, 9, 20, 12))
  const t = await renderApp({ width: 120, height: 44 })
  data.init(":memory:")
  const db = data.getDb()!
  db.query("INSERT INTO accounts (id, name, type, source, external_kind) VALUES (1, 'Spending', 'debit', 'up', 'TRANSACTIONAL')").run()
  const groceries = data.state.categories.find((c) => c.name === "Groceries")!.id
  for (const [date, amount] of [["2026-09-05", -200], ["2026-09-20", -100], ["2026-10-03", -120], ["2026-10-04", 20]] as const) {
    db.query("INSERT INTO transactions (date_raw, date_iso, amount, description, account_id, category_id, source) VALUES (?, ?, ?, 'Shop', 1, ?, 'up')").run(date, date, amount, groceries)
  }
  data.refresh()
  handleKey(ui, key("3"), data)
  const frame = async () => { await t.renderOnce(); await t.flush(); return t.captureCharFrame() }
  return { t, groceries, frame }
}

test("Budgets tab (3): the overall budget against pace and last cycle; refunds reduce spending as on the Overview", async () => {
  const { frame } = await budgetsTab()
  data.setBudget({ kind: "overall" }, 500)
  const f = await frame()
  expect(f).toContain("Budgets · 1 Oct – 31 Oct · day 20 of 31")
  // $120 − $20 refund; an even pace by day 20 is $323.
  expect(f).toMatch(/Overall spending\s+[█▌│─]+\s+\$100 of \$500\s+\$400 left · \$33\/day\s+\$223 under pace/)
  expect(f).toMatch(/No category budgets yet \(l\) · last cycle \$300 by now \(−67%\)/)
  expect(f).toContain("Past cycles · Overall spending")
  expect(f).toMatch(/1 Sep – 30 Sep\s+\$300/)
  expect(f).toMatch(/Groceries\s+\$100\s+—\s+\$300\s+\$300/)
})

test("allocating down: in Categories, enter sets a category's budget starting from its average; the top card shows what's left to allocate", async () => {
  const { groceries, frame } = await budgetsTab()
  data.setBudget({ kind: "overall" }, 500)
  handleKey(ui, key("l"), data)
  expect(ui.activeScope()).toBe("budgets.categories")
  handleKey(ui, key("return"), data)
  expect(ui.state.settingsEditor).toBe("budget")
  expect(ui.state.settingsDraft).toMatchObject({ scopeKey: `category:${groceries}`, amount: "300" })
  ui.setState({ settingsEditor: null })
  data.setBudget({ kind: "category", categoryId: groceries }, 300)
  const f = await frame()
  expect(f).toContain("Categories $300 of $500 · $200 unallocated")
  expect(f).toMatch(/Groceries\s+\$100\s+\$300\s+\$200 left/)
  // The past cycles follow the row at the cursor.
  expect(f).toContain("Past cycles · Groceries")
  // del twice removes the category's budget.
  handleKey(ui, key("delete"), data)
  handleKey(ui, key("delete"), data)
  expect(data.state.budgets.some((b) => b.scope.kind === "category")).toBe(false)
  // k from the top goes back to the budgets.
  handleKey(ui, key("k"), data)
  expect(ui.activeScope()).toBe("budgets")
})

test("building up: with category budgets and no overall one, the overall row offers their total", async () => {
  const { groceries, frame } = await budgetsTab()
  data.setBudget({ kind: "category", categoryId: groceries }, 300)
  const f = await frame()
  expect(f).toMatch(/Overall spending\s+\$100 so far · not set: enter sets one \(your category budgets total \$300\)/)
  ui.setState({ budgetCursor: 1 })
  handleKey(ui, key("return"), data)
  expect(ui.state.settingsDraft).toMatchObject({ scopeKey: "overall", amount: "300" })
})

test("a narrow top card leaves out the pace figure rather than cutting it off", async () => {
  setAppClock(new Date(2026, 9, 20, 12))
  const t = await renderApp({ width: 84, height: 44 })
  data.init(":memory:")
  const db = data.getDb()!
  db.query("INSERT INTO accounts (id, name, type, source, external_kind) VALUES (1, 'Spending', 'debit', 'up', 'TRANSACTIONAL')").run()
  const groceries = data.state.categories.find((c) => c.name === "Groceries")!.id
  db.query("INSERT INTO transactions (date_raw, date_iso, amount, description, account_id, category_id, source) VALUES ('x', '2026-10-03', -1234, 'Shop', 1, ?, 'up')").run(groceries)
  data.refresh()
  data.setBudget({ kind: "overall" }, 4200)
  handleKey(ui, key("3"), data)
  await t.renderOnce(); await t.flush()
  const row = t.captureCharFrame().split("\n").find((l) => l.includes("Overall spending"))!
  expect(row).toContain("$1,234 of $4,200")
  // Nothing after "left · $X/day" but the card's border.
  expect(row).toMatch(/\/day\s*│\s*$/)
})
