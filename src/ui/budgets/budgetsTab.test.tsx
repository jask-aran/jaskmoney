import { afterEach, expect, test } from "bun:test"
import { setAppClock } from "../../domain/days"
import { data } from "../../state/dataStore"
import { BUDGET_VIEWS, ui } from "../../state/uiStore"
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
async function budgetsTab(size = { width: 120, height: 44 }) {
  setAppClock(new Date(2026, 9, 20, 12))
  const t = await renderApp(size)
  data.init(":memory:")
  const db = data.getDb()!
  db.query("INSERT INTO accounts (id, name, type, source, external_kind) VALUES (1, 'Spending', 'debit', 'up', 'TRANSACTIONAL')").run()
  const groceries = data.state.categories.find((c) => c.name === "Groceries")!.id
  for (const [date, amount] of [["2026-09-05", -200], ["2026-09-20", -100], ["2026-10-03", -120], ["2026-10-04", 20]] as const) {
    db.query("INSERT INTO transactions (date_raw, date_iso, amount, description, account_id, category_id, source) VALUES (?, ?, ?, 'Shop', 1, ?, 'up')").run(date, date, amount, groceries)
  }
  data.refresh()
  handleKey(ui, key("3"), data)
  // The Budgets pane, its cursor on All spending (what the charts follow).
  ui.setState({ focusedSection: "bud.categories", budgetCategoryCursor: 0, budgetChart: 0 })
  const frame = async () => { await t.renderOnce(); await t.flush(); return t.captureCharFrame() }
  return { t, groceries, frame }
}

/** The budget pane on Each cycle: the subject cycle by cycle. */
const eachCycle = () => ui.setState({ budgetChart: BUDGET_VIEWS.findIndex((v) => v.view === "Each cycle") })

test("Budgets tab (3): the charts follow the Budgets pane's row at the cursor, All spending to start; refunds reduce spending as on the Overview", async () => {
  const { frame } = await budgetsTab()
  await data.setBudget({ kind: "overall" }, 500)
  const f = await frame()
  // $120 less the $20 refund: in Each pay, and the table's total.
  expect(f).toMatch(/\$100 spent\s+\$400 left/)
  expect(f).toMatch(/All spending\s+\$100/)
  expect(f).toContain("Cumulative spending · All spending")
  // l on the budget pane: the Overview's next spending view, Daily.
  handleKey(ui, key("v"), data); handleKey(ui, key("t"), data)
  handleKey(ui, key("l"), data)
  expect(await frame()).toContain("Daily spending · All spending")
})

test("allocating down: in the Budgets pane, enter sets a category's budget starting from its average; it comes out of the target, and the chart follows the cursor", async () => {
  const { groceries, frame } = await budgetsTab()
  await data.setBudget({ kind: "overall" }, 500)
  handleKey(ui, key("v"), data); handleKey(ui, key("c"), data)
  expect(ui.activeScope()).toBe("budgets.categories")
  // All spending first; Groceries under it.
  handleKey(ui, key("j"), data)
  expect(ui.state.budgetCategoryCursor).toBe(1)
  handleKey(ui, key("return"), data)
  expect(ui.state.settingsEditor?.kind).toBe("budget")
  expect(ui.state.settingsDraft).toMatchObject({ scopeKey: `category:${groceries}`, amount: "300" })
  ui.setState({ settingsEditor: null })
  await data.setBudget({ kind: "category", categoryId: groceries }, 300)
  const f = await frame()
  // The chart follows Groceries.
  expect(f).toContain("Cumulative spending · Groceries")
  // The target is the cap: Groceries' $300 comes out of its $500, leaving
  // the rest $200.
  expect(f).toMatch(/\$100 spent\s+\$400 left/)
  expect(f).toMatch(/the rest \$0 of \$200/)
  // del twice removes the category's budget.
  handleKey(ui, key("delete"), data)
  handleKey(ui, key("delete"), data)
  expect(data.state.budgets.some((b) => b.scope.kind === "category")).toBe(false)
  // k goes back up to All spending.
  handleKey(ui, key("k"), data)
  expect(ui.state.budgetCategoryCursor).toBe(0)
})

test("x leaves a category out of the budgets (the target no longer counts it), and again brings it back", async () => {
  const { groceries, frame } = await budgetsTab()
  await data.setBudget({ kind: "overall" }, 500)
  handleKey(ui, key("v"), data); handleKey(ui, key("c"), data)
  // Groceries, under All spending.
  ui.setState({ budgetCategoryCursor: 1 })
  handleKey(ui, key("x"), data)
  expect(data.state.categories.find((c) => c.id === groceries)!.budgetIgnored).toBe(true)
  const f = await frame()
  expect(f).toMatch(/\$0 spent\s+\$500 left/)
  handleKey(ui, key("x"), data)
  expect(data.state.categories.find((c) => c.id === groceries)!.budgetIgnored).toBe(false)
})

test("Each cycle, a view of the budget pane: each cycle judged against the budget in force then", async () => {
  const { frame } = await budgetsTab()
  // $250 from September; $500 from this cycle.
  saveBudget(data.getDb()!, { kind: "overall" }, 250, "2026-09-01")
  data.refresh()
  await data.setBudget({ kind: "overall" }, 500)
  eachCycle()
  const f = await frame()
  expect(f).toContain("Each cycle · All spending")
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
  expect(data.state.budgets.some((b) => b.scope.kind === "category")).toBe(false)
  handleKey(ui, key("["), data)
  expect(ui.state.budgetOffset).toBe(-1)
  const f = await frame()
  // September had its Groceries budget: $300 of it spent, in Each pay's legend.
  expect(f).toContain("Groceries $300 of $300")
  // No cycle before September has data; ] comes back, and no further.
  handleKey(ui, key("["), data)
  expect(ui.state.budgetOffset).toBe(-1)
  handleKey(ui, key("]"), data)
  handleKey(ui, key("]"), data)
  expect(ui.state.budgetOffset).toBe(0)
})

test("each past cycle is judged against the target then, its category budgets carved out of it (rent before moving out)", async () => {
  const { groceries, frame } = await budgetsTab()
  await data.setBudget({ kind: "overall" }, 500)
  await data.setBudget({ kind: "category", categoryId: groceries }, 300)
  await data.removeBudget({ kind: "category", categoryId: groceries })
  eachCycle()
  const f = await frame()
  // All spending against the $500 cap, then and now ($300 of Groceries in
  // September, inside it).
  expect(f).toMatch(/1 Oct – 31 Oct\s+\$100\s+[█─▏│ ]+\s+\$400 under/)
  expect(f).toMatch(/1 Sep – 30 Sep\s+\$300\s+[█─▏│ ]+\s+\$200 under/)
})

test("a budget set while showing a past cycle applies from that cycle until its next change", async () => {
  const { groceries } = await budgetsTab()
  await data.setBudget({ kind: "category", categoryId: groceries }, 300)
  await data.setBudget({ kind: "category", categoryId: groceries }, 250, "2026-09-01")
  expect(data.state.budgets.find((b) => b.scope.kind === "category")!.amount).toBe(250)
  expect(budgetIn(data.state.budgetHistory, { kind: "category", categoryId: groceries }, "2026-08-01")).toBe(300)
})

test("with only category budgets, All spending's budget is theirs, and enter on it sets the target from the average", async () => {
  const { groceries, frame } = await budgetsTab()
  await data.setBudget({ kind: "category", categoryId: groceries }, 300)
  const f = await frame()
  expect(f).toMatch(/All spending\s+\$100\s+\$\d+\s+\$300/)
  // enter on All spending sets the target (from the average: Groceries' $300).
  ui.setState({ budgetCategoryCursor: 0 })
  handleKey(ui, key("return"), data)
  expect(ui.state.settingsDraft).toMatchObject({ scopeKey: "overall", amount: "300" })
})

test("the cycle's calendar is always there: the budget's days so far, and its regular payments due on the days to come, in caution, with what they leave", async () => {
  // Tall enough for the calendar's amounts and the cycle pane both.
  const { t, groceries, frame } = await budgetsTab({ width: 120, height: 60 })
  const db = data.getDb()!
  for (const month of ["06", "07", "08", "09"]) {
    db.query("INSERT INTO transactions (date_raw, date_iso, amount, description, account_id, category_id, source) VALUES (?, ?, -15, 'STREAMER', 1, ?, 'up')").run(`2026-${month}-25`, `2026-${month}-25`, groceries)
  }
  data.refresh()
  await data.setBudget({ kind: "overall" }, 500)
  const f = await frame()
  // In the Budgets pane, between the cycle's track and the table, with
  // no heading (it's plainly a calendar).
  expect(f).toMatch(/○[\s\S]*Mon[\s\S]*Sun[\s\S]*Categories/)
  expect(f).not.toMatch(/│\s+Spending calendar/)
  // STREAMER's next charge (and the fixture's Shop, regular enough to
  // count) on days to come: their amounts, the days in caution, and the
  // legend's total.
  expect(f).toContain("$15")
  expect(f).toMatch(/■ \d charges? · \$\d+ expected by 31 Oct/)
  const caution = RGBA.fromHex(tone.caution).toInts().join()
  const due = t.captureSpans().lines.flatMap((l) => l.spans).filter((s) => s.fg.toInts().join() === caution && /\d/.test(s.text))
  expect(due.some((s) => s.text.includes("$15"))).toBe(true)
  // A past cycle expects nothing.
  handleKey(ui, key("["), data)
  expect(await frame()).not.toContain("expected by")
  ui.setState({ budgetOffset: 0 })
})

test("the plan: your pay and your spending target give what goes to savers; each pay's bar fills as you spend and going over comes out of savers; Savers says what's gone, what's still to send and what's short; nothing without it", async () => {
  setAppClock(new Date(2026, 9, 20, 12))
  const t = await renderApp({ width: 160, height: 56 })
  data.init(":memory:")
  const db = data.getDb()!
  db.query("INSERT INTO accounts (id, name, type, source, external_kind, balance) VALUES (1, 'Spending', 'debit', 'up', 'TRANSACTIONAL', 1700), (2, 'Rainy day', 'debit', 'up', 'SAVER', 9000)").run()
  const id = (n: string) => data.state.categories.find((c) => c.name === n)!.id
  const add = (date: string, amount: number, description: string, category: number | null, transfer: number | null = null) =>
    db.query("INSERT INTO transactions (date_raw, date_iso, amount, description, account_id, category_id, source, transfer_account_id) VALUES (?, ?, ?, ?, 1, ?, 'up', ?)").run(date, date, amount, description, category, transfer)
  add("2026-09-01", 4800, "EMPLOYER", id("Salary"))
  add("2026-10-01", 5200, "EMPLOYER", id("Salary"))
  add("2026-10-02", -2500, "Transfer to Rainy day", id("Transfers"), 2)
  add("2026-10-10", -300, "Shop", id("Groceries"))
  data.refresh()
  handleKey(ui, key("3"), data)
  const frame = async () => { await t.renderOnce(); await t.flush(); await t.renderOnce(); return t.captureCharFrame() }
  // No plan yet: the track, no judgment. The pay has come in ($5,200 on
  // 1 Oct), so only the target is asked for; the next pay asks for your
  // usual pay.
  let f = await frame()
  expect(f).toMatch(/Next pay\s+p sets your pay\s+Sun 1 Nov │/)
  expect(f).toContain("t: your spending target")
  // At the top, the track, 1 Oct to 31 Oct (its last day), today on it and the send
  // (its day over it where there's room: here, none beside 1 Oct); the pay
  // in, the send and what's spent (in bad) under it.
  expect(f).toMatch(/1 Oct\s+today\s+31 Oct/)
  expect(f).toMatch(/●[━◆┿]+┄+○/)
  expect(f).toMatch(/↓ \$5,200 in\s+◆ \$2,500 savers\s+\$300 spent/)
  // No plan, no meter and no judgment.
  expect(f).not.toContain("to send")
  expect(f).not.toContain("✓")
  // p opens the Pay editor from your usual pay.
  handleKey(ui, key("p"), data)
  expect(ui.state.settingsEditor?.kind).toBe("pay")
  expect(ui.state.settingsDraft.amount).toBe("5000")
  ui.setState({ settingsEditor: null })
  // Usual pay $5,000 (the next pay's) and spending $2,000. This cycle's
  // plan is from what came in: $5,200 less $2,000, $3,200 to savers.
  await data.saveUiPrefs({ expectedPay: 5000 })
  await data.setBudget({ kind: "overall" }, 2000)
  f = await frame()
  // The next pay: when, and your usual pay.
  expect(f).toMatch(/Next pay\s+Sun 1 Nov\s+\$5,000 │/)
  // It's under the calendar: the top is this period's own.
  expect(f).toMatch(/○[\s\S]*less ■[\s\S]*Next pay[\s\S]*Days till pay\s+12 │[\s\S]*Categories/)
  // No Up pay-splitting hint: the API can't see the split, so it's not the app's to say.
  expect(f).not.toContain("pay splitting")
  // The pay as a bar filling as you spend, each part's figure over it:
  // the target, and what's left of the pay.
  let rows = f.split("\n")
  const above = rows.findIndex((l) => /\$2,000 target\s+\$4,900 left/.test(l))
  expect(above).toBeGreaterThan(0)
  expect(rows[above + 1]).toMatch(/█+/)
  // Savers: the bar's savers end opened out to the plan ($5,200 less
  // $2,000) at full width, $2,500 of it sent and $700 still to send.
  expect(rows[above + 2]).toMatch(/╭─+╯\s+savers plan \$3,200\s+│/)
  expect(rows[above + 3]).toMatch(/█+/)
  expect(rows[above + 4]).toMatch(/\$2,500 sent\s+\$700( to send)?/)
  // $2,300 spent on a $2,000 target: $300 over, hatched in bad between the
  // target and savers, and savers get $300 less.
  add("2026-10-15", -2000, "Shop", id("Groceries"))
  data.refresh()
  f = await frame()
  rows = f.split("\n")
  const overAt = rows.findIndex((l) => /\$2,000 target\s+\$300( over)?\s+\$2,900 left/.test(l))
  expect(overAt).toBeGreaterThan(0)
  // The $300 over comes out of the plan: $300 short, hatched first, $400
  // still to send.
  expect(rows[overAt + 4]).toMatch(/\$300 short\s+\$2,500 sent(\s+\$400( to send)?)?/)
  expect(f).not.toContain("more than your pay")
  // The next pay and the days till it under the calendar; the track's
  // spent at the top, in bad, and no Last pay or Spent this period lines.
  expect(f).toMatch(/Next pay\s+Sun 1 Nov\s+\$5,000 │/)
  expect(f).toMatch(/Days till pay\s+12 │/)
  expect(f).not.toMatch(/Last pay|Spent this period/)
  const spentRow = rows.findIndex((l) => /\$2,300 spent/.test(l))
  expect(spentRow).toBeLessThan(overAt)
  expect(t.captureSpans().lines[spentRow]!.spans.some((s) => s.text.includes("$2,300") && s.fg.toInts().join() === RGBA.fromHex(tone.bad).toInts().join())).toBe(true)
  const bad = RGBA.fromHex(tone.bad).toInts().join()
  const hatchAt = (row: number) => {
    let col = 0
    for (const span of t.captureSpans().lines[row]!.spans) {
      for (const ch of span.text) { if (ch === "╱" && span.fg.toInts().join() === bad) return col; col++ }
    }
    return -1
  }
  // The opening's corner is under where the hatching starts; the meter's
  // short starts at the left edge.
  const corner = [...rows[overAt + 2]!].indexOf("╯")
  expect(hatchAt(overAt + 1)).toBe(corner)
  expect(hatchAt(overAt + 3)).toBe([...rows[overAt + 2]!].indexOf("╭"))
  t.renderer.destroy()
})
