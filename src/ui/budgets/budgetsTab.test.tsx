import { afterEach, expect, test } from "bun:test"
import { setAppClock } from "../../domain/days"
import { data } from "../../state/dataStore"
import { ui } from "../../state/uiStore"
import { renderApp } from "../../testing/app"
import { handleKey } from "../../app/keys"
import { key } from "../../testing/keys"
import { saveBudget } from "../../db/client"

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

test("Budgets tab (3): a chart of the budget at the cursor under where it stands; the budgets as bars; refunds reduce spending as on the Overview", async () => {
  const { frame } = await budgetsTab()
  data.setBudget({ kind: "overall" }, 500)
  const f = await frame()
  expect(f).toContain("Overall spending · day 20 of 31")
  // $120 − $20 refund; an even pace by day 20 is $323; $5 a day ends at $155.
  expect(f).toMatch(/\$100 of \$500\s+\$400 left · \$33\/day\s+\$223 under pace\s+heading for \$155/)
  expect(f).toContain("Last cycle $300 by now -67%")
  expect(f).toMatch(/Overall spending\s+[█▌│─]+\s+\$100 of \$500\s+\$400 left · \$33\/day/)
  expect(f).toMatch(/Groceries\s+\$100\s+\$300/)
  // Each cycle, newest first, against its budget.
  expect(f).toMatch(/1 Oct – 31 Oct\s+\$100\s+[█─▏│ ]+\s+\$400 under/)
  expect(f).toMatch(/1 Sep – 30 Sep\s+\$300\s+[█─▏│ ]+\s+\$200 under/)
  // l: cycle by cycle, against the budget.
  handleKey(ui, key("l"), data)
  expect(await frame()).toContain("over in 0 of 1 · avg $300")
})

test("allocating down: in Categories, enter sets a category's budget starting from its average; it joins the budgets, and the chart follows the cursor", async () => {
  const { groceries, frame } = await budgetsTab()
  data.setBudget({ kind: "overall" }, 500)
  handleKey(ui, key("j"), data)
  expect(ui.activeScope()).toBe("budgets.categories")
  handleKey(ui, key("return"), data)
  expect(ui.state.settingsEditor).toBe("budget")
  expect(ui.state.settingsDraft).toMatchObject({ scopeKey: `category:${groceries}`, amount: "300" })
  ui.setState({ settingsEditor: null })
  data.setBudget({ kind: "category", categoryId: groceries }, 300)
  const f = await frame()
  expect(f).toContain("Categories $300 of $500 · $200 unallocated")
  expect(f).toMatch(/Groceries\s+[█▌│─]+\s+\$100 of \$300\s+\$200 left/)
  expect(f).toContain("Groceries · day 20 of 31")
  expect(f).toContain("Each cycle · Groceries")
  // del twice removes the category's budget.
  handleKey(ui, key("delete"), data)
  handleKey(ui, key("delete"), data)
  expect(data.state.budgets.some((b) => b.scope.kind === "category")).toBe(false)
  // k from the top goes back to the budgets.
  handleKey(ui, key("k"), data)
  expect(ui.activeScope()).toBe("budgets")
})

test("x leaves a category out of the overall budget (its own budget still counts it), and again brings it back", async () => {
  const { groceries, frame } = await budgetsTab()
  data.setBudget({ kind: "overall" }, 500)
  data.setBudget({ kind: "category", categoryId: groceries }, 300)
  handleKey(ui, key("j"), data)
  handleKey(ui, key("j"), data)
  ui.setState({ budgetCategoryCursor: 0 })
  // The first line is Groceries' group; its row is next.
  handleKey(ui, key("j"), data)
  handleKey(ui, key("x"), data)
  expect(data.state.categories.find((c) => c.id === groceries)!.budgetIgnored).toBe(true)
  const f = await frame()
  expect(f).toMatch(/Overall spending\s+[█▌│─]+\s+\$0 of \$500/)
  expect(f).toMatch(/Groceries\s+[█▌│─]+\s+\$100 of \$300/)
  expect(f).toContain("Leaving out Groceries")
  expect(f).toMatch(/Groceries\s+\$100\s+\$300\s+\$300/)
  handleKey(ui, key("x"), data)
  expect(data.state.categories.find((c) => c.id === groceries)!.budgetIgnored).toBe(false)
})

test("each cycle is judged against the budget in force then", async () => {
  const { frame } = await budgetsTab()
  // $250 from September; $500 from this cycle.
  saveBudget(data.getDb()!, { kind: "overall" }, 250, "2026-09-01")
  data.refresh()
  data.setBudget({ kind: "overall" }, 500)
  const f = await frame()
  expect(f).toMatch(/1 Oct – 31 Oct\s+\$100\s+[█─▏│ ]+\s+\$400 under/)
  expect(f).toMatch(/1 Sep – 30 Sep\s+\$300\s+[█─▏│ ]+\s+\$50 over/)
})

test("building up: with category budgets and no overall one, the overall row offers their total", async () => {
  const { groceries, frame } = await budgetsTab()
  data.setBudget({ kind: "category", categoryId: groceries }, 300)
  const f = await frame()
  expect(f).toMatch(/Overall spending\s+not set: enter sets one \(your category budgets total \$300\)/)
  ui.setState({ budgetCursor: 0 })
  handleKey(ui, key("return"), data)
  expect(ui.state.settingsDraft).toMatchObject({ scopeKey: "overall", amount: "300" })
})

test("wide, the categories run down the right beside the chart and the budgets", async () => {
  setAppClock(new Date(2026, 9, 20, 12))
  const t = await renderApp({ width: 140, height: 44 })
  data.init(":memory:")
  data.setBudget({ kind: "overall" }, 4200)
  handleKey(ui, key("3"), data)
  await t.renderOnce(); await t.flush()
  const lines = t.captureCharFrame().split("\n")
  const top = lines.find((l) => l.includes("Overall spending ·"))!
  expect(top).toContain("Categories")
  expect(lines.some((l) => l.includes("Budgets") && l.includes("│"))).toBe(true)
})
