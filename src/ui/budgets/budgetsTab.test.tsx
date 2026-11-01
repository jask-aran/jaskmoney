import { afterEach, expect, test } from "bun:test"
import { setAppClock } from "../../domain/days"
import { data } from "../../state/dataStore"
import { ui } from "../../state/uiStore"
import { renderApp } from "../../testing/app"
import { handleKey } from "../../app/keys"
import { key } from "../../testing/keys"
import { saveBudget } from "../../db/client"
import { budgetIn } from "../../domain/budget"
import { RGBA } from "@opentui/core"
import { tone } from "../../theme"

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
  await data.setBudget({ kind: "overall" }, 500)
  const f = await frame()
  expect(f).toContain("Overall spending · Cumulative")
  expect(f).toContain("Budgets · day 20 of 31")
  // The Overview's Cumulative view over the cycle: $120 − $20 refund; an
  // even pace by day 20 is $323; $5 a day ends at $155.
  expect(f).toContain("This cycle $100")
  expect(f).toContain("Budget $500, $223 under pace")
  expect(f).toContain("≈ $155")
  expect(f).toMatch(/╭ Overall spending  \$100 of \$500\s+\$400 left · \$33\/day ╮ │/)
  // Under it, the bar the card's width with today's even pace marked.
  expect(f).toMatch(/\n│  █+─*│─+ │/)
  expect(f).toMatch(/Groceries\s+\$100\s+\$300/)
  // Each cycle, newest first, against its budget.
  expect(f).toMatch(/1 Oct – 31 Oct\s+\$100\s+[█─▏│ ]+\s+\$400 under/)
  expect(f).toMatch(/1 Sep – 30 Sep\s+\$300\s+[█─▏│ ]+\s+\$200 under/)
  expect(f).toContain("over in 0 of 1 · avg $300")
  // l: the Overview's next spending view, Daily.
  handleKey(ui, key("l"), data)
  expect(await frame()).toContain("Overall spending · Daily")
})

test("allocating down: in Categories, enter sets a category's budget starting from its average; it joins the budgets, and the chart follows the cursor", async () => {
  const { groceries, frame } = await budgetsTab()
  await data.setBudget({ kind: "overall" }, 500)
  handleKey(ui, key("j"), data)
  expect(ui.activeScope()).toBe("budgets.categories")
  handleKey(ui, key("return"), data)
  expect(ui.state.settingsEditor?.kind).toBe("budget")
  expect(ui.state.settingsDraft).toMatchObject({ scopeKey: `category:${groceries}`, amount: "300" })
  ui.setState({ settingsEditor: null })
  await data.setBudget({ kind: "category", categoryId: groceries }, 300)
  const f = await frame()
  // With a category budget the overall one is everything else, and the
  // two add up to the total.
  expect(f).toContain("Categories $300 + everything else $500")
  expect(f).toMatch(/╭ Total budgeted  \$100 of \$800 /)
  expect(f).toMatch(/╭ Everything else  \$0 of \$500 /)
  expect(f).toMatch(/╭ Groceries  \$100 of \$300\s+\$200 left/)
  expect(f).toContain("Groceries · Cumulative")
  expect(f).toContain("Each cycle · Groceries")
  // del twice removes the category's budget.
  handleKey(ui, key("delete"), data)
  handleKey(ui, key("delete"), data)
  expect(data.state.budgets.some((b) => b.scope.kind === "category")).toBe(false)
  // k from the top goes back to the budgets.
  handleKey(ui, key("k"), data)
  expect(ui.activeScope()).toBe("budgets")
})

test("x leaves a category out of the budgets (not budgeted: the total and everything else leave it), and again brings it back", async () => {
  const { groceries, frame } = await budgetsTab()
  await data.setBudget({ kind: "overall" }, 500)
  handleKey(ui, key("j"), data)
  ui.setState({ budgetCategoryCursor: 0 })
  // The first line is Groceries' group; its row is next.
  handleKey(ui, key("j"), data)
  handleKey(ui, key("x"), data)
  expect(data.state.categories.find((c) => c.id === groceries)!.budgetIgnored).toBe(true)
  const f = await frame()
  expect(f).toMatch(/╭ Overall spending  \$0 of \$500 /)
  expect(f).toContain("Not budgeted: Groceries")
  expect(f).toMatch(/Groceries\s+\$100\s+\$300\s+left out/)
  handleKey(ui, key("x"), data)
  expect(data.state.categories.find((c) => c.id === groceries)!.budgetIgnored).toBe(false)
})

test("each cycle is judged against the budget in force then", async () => {
  const { frame } = await budgetsTab()
  // $250 from September; $500 from this cycle.
  saveBudget(data.getDb()!, { kind: "overall" }, 250, "2026-09-01")
  data.refresh()
  await data.setBudget({ kind: "overall" }, 500)
  const f = await frame()
  expect(f).toMatch(/1 Oct – 31 Oct\s+\$100\s+[█─▏│ ]+\s+\$400 under/)
  expect(f).toMatch(/1 Sep – 30 Sep\s+\$300\s+[█─▏│ ]+\s+\$50 over/)
})

test("[ shows the cycle before with the budgets then; a budget removed from this cycle on stays in the cycles before (no longer renting)", async () => {
  const { groceries, frame } = await budgetsTab()
  await data.setBudget({ kind: "overall" }, 500)
  // First set now: it applies to every cycle.
  await data.setBudget({ kind: "category", categoryId: groceries }, 300)
  // Removed from this cycle on.
  await data.removeBudget({ kind: "category", categoryId: groceries })
  expect(data.state.budgets.some((b) => b.scope.kind === "category")).toBe(false)
  expect(await frame()).not.toMatch(/╭ Groceries /)
  handleKey(ui, key("["), data)
  expect(ui.state.budgetOffset).toBe(-1)
  const f = await frame()
  expect(f).toContain("Budgets · 1 Sep – 30 Sep · ] later")
  expect(f).toMatch(/╭ Groceries  \$300 of \$300 /)
  expect(f).toMatch(/╭ Total budgeted  \$300 of \$800 /)
  // No cycle before September has data; ] comes back, and no further.
  handleKey(ui, key("["), data)
  expect(ui.state.budgetOffset).toBe(-1)
  handleKey(ui, key("]"), data)
  handleKey(ui, key("]"), data)
  expect(ui.state.budgetOffset).toBe(0)
})

test("each past cycle's everything else leaves out categories that had their own budget then (rent before moving out)", async () => {
  const { groceries, frame } = await budgetsTab()
  await data.setBudget({ kind: "overall" }, 500)
  await data.setBudget({ kind: "category", categoryId: groceries }, 300)
  await data.removeBudget({ kind: "category", categoryId: groceries })
  const f = await frame()
  // This cycle Groceries is everything else; in September it had its own.
  expect(f).toMatch(/1 Oct – 31 Oct\s+\$100\s+[█─▏│ ]+\s+\$400 under/)
  expect(f).toMatch(/1 Sep – 30 Sep\s+\$0\s+[█─▏│ ]+\s+\$500 under/)
})

test("a budget set while showing a past cycle applies from that cycle until its next change", async () => {
  const { groceries } = await budgetsTab()
  await data.setBudget({ kind: "category", categoryId: groceries }, 300)
  await data.setBudget({ kind: "category", categoryId: groceries }, 250, "2026-09-01")
  expect(data.state.budgets.find((b) => b.scope.kind === "category")!.amount).toBe(250)
  expect(budgetIn(data.state.budgetHistory, { kind: "category", categoryId: groceries }, "2026-08-01")).toBe(300)
})

test("with only category budgets, the total is theirs and everything else waits to be set", async () => {
  const { groceries, frame } = await budgetsTab()
  await data.setBudget({ kind: "category", categoryId: groceries }, 300)
  const f = await frame()
  expect(f).toMatch(/╭ Total budgeted  \$100 of \$300 /)
  expect(f).toMatch(/Everything else\s+not set: enter sets one for the rest/)
  ui.setState({ budgetCursor: 1 })
  handleKey(ui, key("return"), data)
  expect(ui.state.settingsDraft).toMatchObject({ scopeKey: "overall", amount: "" })
})

test("wide, the categories run down the right beside the chart and the budgets", async () => {
  setAppClock(new Date(2026, 9, 20, 12))
  const t = await renderApp({ width: 140, height: 44 })
  data.init(":memory:")
  await data.setBudget({ kind: "overall" }, 4200)
  handleKey(ui, key("3"), data)
  await t.renderOnce(); await t.flush()
  const lines = t.captureCharFrame().split("\n")
  // The budgets first, then the chart, beside the categories.
  const top = lines.find((l) => l.includes("Budgets ·"))!
  expect(top).toContain("Categories")
  const chart = lines.findIndex((l) => l.includes("Overall spending ·"))
  expect(chart).toBeGreaterThan(lines.indexOf(top))
  expect(lines[chart]!.endsWith("│")).toBe(true)
})

test("short of room for two lines each, every budget takes one line, the bar between its name and figures", async () => {
  setAppClock(new Date(2026, 9, 20, 12))
  const t = await renderApp({ width: 120, height: 24 })
  data.init(":memory:")
  const db = data.getDb()!
  db.query("INSERT INTO accounts (id, name, type, source, external_kind) VALUES (1, 'Spending', 'debit', 'up', 'TRANSACTIONAL')").run()
  const groceries = data.state.categories.find((c) => c.name === "Groceries")!.id
  db.query("INSERT INTO transactions (date_raw, date_iso, amount, description, account_id, category_id, source) VALUES ('2026-10-03', '2026-10-03', -100, 'Shop', 1, ?, 'up')").run(groceries)
  data.refresh()
  await data.setBudget({ kind: "overall" }, 500)
  await data.setBudget({ kind: "category", categoryId: groceries }, 300)
  handleKey(ui, key("3"), data)
  await t.renderOnce(); await t.flush()
  const f = t.captureCharFrame()
  expect(f).toMatch(/Groceries\s+[█▌│─]+\s+\$100 of \$300\s+\$200 left/)
  expect(f).not.toContain("╭ Groceries")
})

test("Bar fills hatched (Settings › Appearance): the budgets' bars are ╱ in the same ink", async () => {
  const { t, frame } = await budgetsTab()
  await data.setBudget({ kind: "overall" }, 500)
  await data.saveUiPrefs({ hatched: true })
  const f = await frame()
  expect(f).toMatch(/\n│  ╱+─*│─+ │/)
  expect(f).not.toMatch(/\n│  █/)
  const bar = t.captureSpans().lines.flatMap((l) => l.spans).find((s) => s.text.startsWith("╱"))!
  expect(bar.fg.toInts()).toEqual(RGBA.fromHex(tone.good).toInts())
  await data.saveUiPrefs({ hatched: false })
  expect(await frame()).toMatch(/\n│  █+─*│─+ │/)
})
