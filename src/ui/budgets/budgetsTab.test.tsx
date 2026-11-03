import { afterEach, expect, test } from "bun:test"
import { setAppClock } from "../../domain/days"
import { data } from "../../state/dataStore"
import { CHART_VIEWS, CYCLE_VIEWS, ui } from "../../state/uiStore"
import { renderApp } from "../../testing/app"
import { handleKey } from "../../app/keys"
import { key } from "../../testing/keys"
import { saveBudget } from "../../db/client"
import { budgetIn } from "../../domain/budget"
import { RGBA } from "@opentui/core"
import { theme, tone } from "../../theme"

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
  // $120 less the $20 refund.
  expect(f).toContain("$100 of $500")
  // l: the Overview's next spending view, Daily.
  handleKey(ui, key("l"), data)
  expect(await frame()).toContain("Daily spending · Overall spending")
})

test("allocating down: in Categories, enter sets a category's budget starting from its average; it joins the budgets, and the chart follows the cursor", async () => {
  const { groceries, frame } = await budgetsTab()
  await data.setBudget({ kind: "overall" }, 500)
  handleKey(ui, key("v"), data); handleKey(ui, key("c"), data)
  expect(ui.activeScope()).toBe("budgets.categories")
  // The overall budget comes first; Groceries under it.
  ui.setState({ budgetCategoryCursor: 0 })
  handleKey(ui, key("j"), data)
  handleKey(ui, key("return"), data)
  expect(ui.state.settingsEditor?.kind).toBe("budget")
  expect(ui.state.settingsDraft).toMatchObject({ scopeKey: `category:${groceries}`, amount: "300" })
  ui.setState({ settingsEditor: null })
  await data.setBudget({ kind: "category", categoryId: groceries }, 300)
  const f = await frame()
  // With a category budget the overall one is everything else, and the
  // two add up to the total.
  // The total adds the category's budget to everything else's.
  expect(f).toContain("$100 of $800")
  // del twice removes the category's budget.
  handleKey(ui, key("delete"), data)
  handleKey(ui, key("delete"), data)
  expect(data.state.budgets.some((b) => b.scope.kind === "category")).toBe(false)
  // k from the top (the overall budget) goes back to Progress.
  handleKey(ui, key("k"), data)
  handleKey(ui, key("k"), data)
  expect(ui.activeScope()).toBe("budgets")
})

test("x leaves a category out of the budgets (not budgeted: the total and everything else leave it), and again brings it back", async () => {
  const { groceries, frame } = await budgetsTab()
  await data.setBudget({ kind: "overall" }, 500)
  handleKey(ui, key("v"), data); handleKey(ui, key("c"), data)
  ui.setState({ budgetCategoryCursor: 0 })
  // The first line is Groceries' group; its row is next.
  handleKey(ui, key("j"), data)
  handleKey(ui, key("x"), data)
  expect(data.state.categories.find((c) => c.id === groceries)!.budgetIgnored).toBe(true)
  const f = await frame()
  expect(f).toContain("$0 of $500")
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
  expect(f).toContain("$300 of $300")
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
  expect(f).toContain("$100 of $300")
  ui.setState({ budgetCursor: 1 })
  handleKey(ui, key("return"), data)
  expect(ui.state.settingsDraft).toMatchObject({ scopeKey: "overall", amount: "" })
})

test("no wash on a budget: the cursor's name and corners take the focus colour, the bar stays on the canvas", async () => {
  const { t, frame } = await budgetsTab()
  await data.setBudget({ kind: "overall" }, 500)
  ui.setState({ focusedSection: "bud.list", budgetCursor: 0 })
  await frame()
  const lines = t.captureSpans().lines
  const canvas = RGBA.fromHex(theme.canvas).toInts()
  // The corner and name share one style (one span), the closing corner too:
  // on the budget's own line, the bar on the line under it.
  const at = lines.findIndex((l) => l.spans.some((s) => s.text.includes("╭ Overall spending")))
  const name = lines[at]!.spans.find((s) => s.text.includes("╭ Overall spending"))!
  const corner = lines[at]!.spans.find((s) => s.text.includes("╮"))!
  const bar = lines[at + 1]!.spans.find((s) => s.text.startsWith("█"))!
  for (const s of [name, corner, bar]) expect(s.bg.toInts()).toEqual(canvas)
  expect(name.fg.toInts()).toEqual(RGBA.fromHex(tone.focus).toInts())
  expect(corner.fg.toInts()).toEqual(RGBA.fromHex(tone.focus).toInts())
})

test("the cycle's calendar is always there: the budget's days so far, and its regular payments due on the days to come, in caution, with what they leave", async () => {
  const { t, groceries, frame } = await budgetsTab()
  const db = data.getDb()!
  for (const month of ["06", "07", "08", "09"]) {
    db.query("INSERT INTO transactions (date_raw, date_iso, amount, description, account_id, category_id, source) VALUES (?, ?, -15, 'STREAMER', 1, ?, 'up')").run(`2026-${month}-25`, `2026-${month}-25`, groceries)
  }
  data.refresh()
  await data.setBudget({ kind: "overall" }, 500)
  const f = await frame()
  expect(f).toMatch(/Spending calendar · (Overall spending|Total budgeted)/)
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

test("the Budgets tab's panes: Progress on top; t, y jump to the budget and cycle panes, h/l step the focused one's views, H/L the cycle pane's from the cards, esc back", async () => {
  const { frame } = await budgetsTab()
  await data.setBudget({ kind: "overall" }, 500)
  await frame()
  // 120×44: the budget pane, a cycle pane under it, the budgets at the bottom.
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
  handleKey(ui, key("v"), data); handleKey(ui, key("t"), data)
  expect(ui.state.focusedSection).toBe("bud.chart")
  handleKey(ui, key("l"), data)
  expect(ui.state.budgetChart).toBe(1)
  handleKey(ui, key("j"), data)
  expect(ui.state.focusedSection).toBe("bud.cycle")
  handleKey(ui, key("h"), data)
  expect(ui.state.budgetCycleViews[0]).toBe(CYCLE_VIEWS[(CYCLE_VIEWS.indexOf(start[0]) - 1 + CYCLE_VIEWS.length) % CYCLE_VIEWS.length])
  handleKey(ui, key("escape"), data)
  expect(ui.state.focusedSection).toBe("bud.list")
  // Progress tops the main column: past its last budget, the budget pane under it.
  ui.setState({ budgetCursor: 0 })
  handleKey(ui, key("j"), data)
  expect(ui.state.focusedSection).toBe("bud.chart")
  ui.setState({ focusedSection: "bud.list", budgetChart: 0, budgetCycleViews: start })
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
  ui.setState({ budgetCursor: 1 })
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
  expect(f).toContain("Set budgets · start here")
  // Groceries averaged $300 over the cycle before.
  expect(f).toMatch(/Overall spending\s+not set/)
  expect(f).toContain("enter sets it from your $300 average")
  // Bills & Utilities is closed: Power isn't listed until space opens it.
  expect(f).toMatch(/▸ . Bills/)
  expect(f).not.toContain("Power")
  // Bills & Utilities is the row after the overall budget and Groceries.
  ui.setState({ budgetCategoryCursor: 2 })
  handleKey(ui, key("space"), data)
  f = await frame()
  expect(f).toMatch(/▾ . Bills/)
  expect(f).toContain("Power")
  // enter on the overall row sets the overall budget from its average.
  ui.setState({ budgetCategoryCursor: 0 })
  handleKey(ui, key("return"), data)
  expect(ui.state.settingsDraft).toMatchObject({ scopeKey: "overall", amount: "300" })
  ui.setState({ settingsEditor: null, budgetSetupOpen: [] })
  // Once a budget is set, the tab opens on Progress again.
  await data.setBudget({ kind: "overall" }, 500)
  await frame()
  handleKey(ui, key("1"), data); handleKey(ui, key("3"), data)
  expect(ui.state.focusedSection).toBe("bud.list")
  expect(await frame()).not.toContain("start here")
})
