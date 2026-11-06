import { afterEach, expect, test } from "bun:test"
import { setAppClock } from "../../domain/days"
import { data } from "../../state/dataStore"
import { BUDGET_PANES, BUDGET_VIEWS, CHART_VIEWS, CYCLE_VIEWS, ui } from "../../state/uiStore"
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
  expect(f).toMatch(/Spent\s+−\$100  \$400 left of \$500/)
  expect(f).toMatch(/All spending\s+\$100/)
  expect(f).toContain("Cumulative spending · All spending")
  // l: the Overview's next spending view, Daily.
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
  expect(f).toMatch(/Spent\s+−\$100  \$400 left of \$500/)
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
  expect(f).toMatch(/Spent\s+\$0  \$500 left of \$500/)
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
  // In the Budgets pane, between This cycle and the table.
  expect(f).toMatch(/This cycle[\s\S]*Spending calendar[\s\S]*Categories/)
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

test("the Budgets tab's panes: the budget pane on top; t, y jump to the budget and cycle panes, h/l step the focused one's views, H/L the cycle pane's from the Budgets pane, esc back", async () => {
  const { frame } = await budgetsTab()
  await data.setBudget({ kind: "overall" }, 500)
  await frame()
  // 120×44: the budget pane, a cycle pane under it.
  expect(ui.state.budgetCyclePanes).toBe(1)
  const start = ui.state.budgetCycleViews
  handleKey(ui, key("L"), data)
  // The next of CYCLE_VIEWS: never a spending view (the budget pane's) or the calendar.
  expect(ui.state.budgetCycleViews).toEqual([CYCLE_VIEWS[(CYCLE_VIEWS.indexOf(start[0]) + 1) % CYCLE_VIEWS.length], start[1]])
  for (let i = 0; i < CHART_VIEWS.length; i++) {
    handleKey(ui, key("L"), data)
    const view = CHART_VIEWS[ui.state.budgetCycleViews[0]]!
    expect(view.group === "Spending" || view.view === "Calendar").toBe(false)
  }
  ui.setState({ budgetCycleViews: start })
  // ←/→ move between panes: they don't step a chart's views.
  const chart = ui.state.budgetChart
  handleKey(ui, key("left"), data)
  expect(ui.state.budgetChart).toBe(chart)
  expect(BUDGET_PANES).toContain(ui.state.focusedSection)
  handleKey(ui, key("right"), data)
  expect(ui.state.focusedSection).toBe("bud.categories")
  handleKey(ui, key("v"), data); handleKey(ui, key("t"), data)
  expect(ui.state.focusedSection).toBe("bud.chart")
  handleKey(ui, key("l"), data)
  expect(ui.state.budgetChart).toBe(1)
  handleKey(ui, key("j"), data)
  expect(ui.state.focusedSection).toBe("bud.cycle")
  handleKey(ui, key("h"), data)
  expect(ui.state.budgetCycleViews[0]).toBe(CYCLE_VIEWS[(CYCLE_VIEWS.indexOf(start[0]) - 1 + CYCLE_VIEWS.length) % CYCLE_VIEWS.length])
  handleKey(ui, key("escape"), data)
  expect(ui.state.focusedSection).toBe("bud.categories")
  ui.setState({ budgetChart: 0, budgetCycleViews: start })
})

test("the cycle's calendar draws in with the charts: on \"always\", its days tile in when the budget at the cursor changes", async () => {
  const { t, frame } = await budgetsTab()
  await data.setBudget({ kind: "overall" }, 500)
  data.setState("uiPrefs", { ...data.state.uiPrefs, chartMotion: "always", chartSpeed: "quick" })
  const calendar = (f: string) => f.split("\n").filter((l) => l.includes("Sat")).join("\n")
  await frame(); await Bun.sleep(600)
  const done = calendar(await frame())
  expect(done).toContain("31")
  // Another budget at the cursor: the days come in again, the last ones not yet.
  await data.setBudget({ kind: "category", categoryId: data.state.categories.find((c) => c.name === "Groceries")!.id }, 300)
  ui.setState({ focusedSection: "bud.categories", budgetCategoryCursor: 1 })
  await frame(); await Bun.sleep(40)
  expect(calendar(await frame())).not.toContain("31")
  await Bun.sleep(600)
  expect(calendar(await frame())).toContain("31")
  data.setState("uiPrefs", { ...data.state.uiPrefs, chartMotion: "launch" })
  void t
})

test("Set budgets: with none yet the tab opens on it, the overall budget first with a nudge from its average; groups closed until space", async () => {
  const { frame } = await budgetsTab()
  const db = data.getDb()!
  const home = data.state.categories.find((c) => c.name === "Bills & Utilities")!
  db.query("INSERT INTO categories (name, color, parent_id) VALUES ('Power', '#f9e2af', ?)").run(home.id)
  data.refresh()
  const power = data.state.categories.find((c) => c.name === "Power")!.id
  db.query("INSERT INTO transactions (date_raw, date_iso, amount, description, account_id, category_id, source) VALUES ('2026-10-08', '2026-10-08', -80, 'POWER CO', 1, ?, 'up')").run(power)
  data.refresh()
  handleKey(ui, key("1"), data); handleKey(ui, key("3"), data)
  expect(ui.state.focusedSection).toBe("bud.categories")
  expect(ui.state.budgetCategoryCursor).toBe(0)
  let f = await frame()
  expect(f).toContain("Budgets · start here")
  // Nothing set: a tile says which keys set the pay and the target.
  expect(f).toContain("Set your pay and your spending target")
  expect(f).toMatch(/p your pay\s+t your spending target/)
  // Bills & Utilities is closed: Power isn't listed until space opens it.
  expect(f).toMatch(/▸ . Bills/)
  expect(f).not.toContain("Power")
  // Bills & Utilities is the row after All spending and Groceries.
  ui.setState({ budgetCategoryCursor: 2 })
  handleKey(ui, key("space"), data)
  f = await frame()
  expect(f).toMatch(/▾ . Bills/)
  expect(f).toContain("Power")
  // t sets the overall spending target from its average (Groceries' $300).
  handleKey(ui, key("t"), data)
  expect(ui.state.settingsDraft).toMatchObject({ scopeKey: "overall", amount: "300" })
  ui.setState({ settingsEditor: null, budgetSetupOpen: [] })
  // Once a budget is set, it no longer says to start here.
  await data.setBudget({ kind: "overall" }, 500)
  await frame()
  handleKey(ui, key("1"), data); handleKey(ui, key("3"), data)
  expect(ui.state.focusedSection).toBe("bud.categories")
  expect(await frame()).not.toContain("start here")
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
  const line = (f: string, label: string) => f.split("\n").find((l) => l.includes(label)) ?? ""
  // No plan yet: the facts, no judgment.
  let f = await frame()
  expect(f).toContain("Set your pay and your spending target")
  // The tiles: the next payday and the days till it (drawn large: no
  // "11" in the text, but "days" beside the digits).
  expect(f).toMatch(/Next payday\s+Days to pay\s+Left per day/)
  expect(f).toMatch(/Nov\s/)
  expect(f).toContain(" days")
  expect(f).toContain("t sets your")
  // This cycle: the track, 1 Oct to 1 Nov, today on it and the send.
  expect(f).toMatch(/1 Oct\s+today\s+1 Nov/)
  expect(f).toMatch(/●[━◆┿]+┄+○/)
  // No plan, no Savers ledger and no judgment.
  expect(f).not.toContain("To send")
  expect(f).not.toContain("✓")
  // p opens the Pay editor from your usual pay.
  expect(ui.state.focusedSection).toBe("bud.categories")
  handleKey(ui, key("p"), data)
  expect(ui.state.settingsEditor?.kind).toBe("pay")
  expect(ui.state.settingsDraft.amount).toBe("5000")
  ui.setState({ settingsEditor: null })
  // Pay $5,000 and spending $2,000: $3,000 to savers, and the Up setting to match.
  await data.saveUiPrefs({ expectedPay: 5000 })
  await data.setBudget({ kind: "overall" }, 2000)
  f = await frame()
  // Each pay's ledger: your pay, and what's spent of the target.
  expect(line(f, "Pay  ")).toMatch(/Pay\s+\$5,000  usual pay/)
  expect(line(f, "Spent  ")).toMatch(/Spent\s+−\$300  \$1,700 left of \$2,000/)
  // No Up pay-splitting hint: the API can't see the split, so it's not the app's to say.
  expect(f).not.toContain("pay splitting")
  // The third tile: what's left of the target a day till payday.
  // ($2,000 less $300 spent, over the 12 days to 1 Nov: $142, drawn large.)
  const { bigDigits } = await import("./PlanGraphics")
  expect(f).toContain("$ " + bigDigits("142")[0])
  expect(f).not.toContain("t sets your")
  // Each pay as a bar filling as you spend: the target's end marked over
  // it, today's even pace under it.
  let rows = f.split("\n")
  expect(rows[rows.findIndex((l) => l.includes("▾ target")) + 1]).toMatch(/█+/)
  expect(f).toMatch(/▴ today \$[\d,]+/)
  // Savers: the plan ($5,000 less $2,000), $2,500 of it sent on 2 Oct,
  // $500 still to send; on plan, no brackets.
  expect(line(f, "Savers")).toMatch(/Savers\s+plan \$3,000/)
  expect(line(f, "Sent  ")).toMatch(/Sent\s+\$2,500  2 Oct/)
  expect(line(f, "To send")).toMatch(/To send\s+\$500\s*│/)
  expect(f).not.toMatch(/└─* sent/)
  // $2,300 spent on a $2,000 target: $300 over, drawn in bad between the
  // target and savers, and savers get $300 less.
  add("2026-10-15", -2000, "Shop", id("Groceries"))
  data.refresh()
  f = await frame()
  // Spent says the target; the $300 over comes out of the plan: $200
  // still to send, $300 short, and the meter's parts bracketed.
  expect(line(f, "Spent  ")).toMatch(/Spent\s+−\$2,300  target \$2,000/)
  expect(line(f, "To send")).toMatch(/To send\s+\$200  \$300 short/)
  expect(f).toMatch(/└─* sent ─*┘/)
  expect(f).not.toContain("more than your pay")
  const bad = RGBA.fromHex(tone.bad).toInts().join()
  rows = f.split("\n")
  const barLine = rows.findIndex((l) => l.includes("▾ target")) + 1
  expect(t.captureSpans().lines[barLine]!.spans.some((s) => s.text.includes("█") && s.fg.toInts().join() === bad)).toBe(true)
  t.renderer.destroy()
})

test("two columns: the budget pane draws its focus; Budgets is the side column's one pane, its full height", async () => {
  const { t, frame } = await budgetsTab({ width: 145, height: 60 })
  await data.setBudget({ kind: "overall" }, 500)
  const f = (await frame()).split("\n")
  const chartTop = f.findIndex((l) => l.includes("╭─ Cumulative spending"))
  expect(chartTop).toBeGreaterThan(0)
  expect(f[chartTop]).toContain("╭─ Budgets")
  expect(f.filter((l) => l.includes("╭─ Spending calendar"))).toEqual([])
  // Focused, its title takes the focus colour, as every pane's does.
  const focus = RGBA.fromHex(tone.focus).toInts().join()
  const titleFocused = () => t.captureSpans().lines[chartTop]!.spans.some((s) => s.text.includes("Cumulative spending") && s.fg.toInts().join() === focus)
  expect(titleFocused()).toBe(false)
  handleKey(ui, key("v"), data); handleKey(ui, key("t"), data)
  await frame()
  expect(ui.state.focusedSection).toBe("bud.chart")
  expect(titleFocused()).toBe(true)
})

test("big digits: three lines of light, rounded strokes, a column between digits", async () => {
  const { bigDigits } = await import("./PlanGraphics")
  // Light, rounded lines, three cells a digit, a column between.
  expect(bigDigits("8")).toEqual(["╭─╮", "├─┤", "╰─╯"])
  expect(bigDigits("14")).toEqual(["╶╮  ╷ ╷", " │  ╰─┤", "╶┴╴   ╵"])
})

test("the calendar runs on to the next payday, marked pay in good, outside the cycle (no tile)", async () => {
  const { t, frame } = await budgetsTab({ width: 145, height: 60 })
  await data.setBudget({ kind: "overall" }, 500)
  const f = await frame()
  // Monthly cycles from the 1st: 1 Nov is the next payday.
  const spans = t.captureSpans().lines.flatMap((l) => l.spans)
  const pay = spans.find((s) => s.text.includes("pay") && s.fg.toInts().join() === RGBA.fromHex(tone.good).toInts().join())
  expect(pay).toBeTruthy()
  expect(f).toMatch(/Nov/)
})

test("Each pay, Savers and This cycle draw in on \"always\": the bars sweep in from the left, the lines drop in, then all of it", async () => {
  const { frame } = await budgetsTab({ width: 145, height: 60 })
  await data.setBudget({ kind: "overall" }, 500)
  data.setState("uiPrefs", { ...data.state.uiPrefs, chartMotion: "always", chartSpeed: "quick" })
  // Each pay's bar: the first line after the heading with blocks, at rest.
  await frame(); await Bun.sleep(600)
  const rest = (await frame()).split("\n"), head = rest.findIndex((l) => l.includes("Each pay"))
  const at = head + rest.slice(head).findIndex((l) => l.includes("█"))
  const bar = (f: string) => (f.split("\n")[at]!.match(/█/g) ?? []).length
  const full = bar(await frame())
  expect(full).toBeGreaterThan(20)
  // The cycle changes ([): it draws in again, the bar short of its width at first.
  handleKey(ui, key("["), data)
  handleKey(ui, key("]"), data)
  ui.setState({ activeTab: "overview" }); await frame()
  ui.setState({ activeTab: "budgets" })
  await frame(); await Bun.sleep(30)
  expect(bar(await frame())).toBeLessThan(full)
  await Bun.sleep(600)
  expect(bar(await frame())).toBe(full)
  data.setState("uiPrefs", { ...data.state.uiPrefs, chartMotion: "launch" })
})
