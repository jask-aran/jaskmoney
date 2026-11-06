import { afterEach, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { setAppClock } from "../../domain/days"
import { data } from "../../state/dataStore"
import { ui } from "../../state/uiStore"
import { renderApp } from "../../testing/app"
import { account, category, transaction } from "../../testing/fixtures"
import { tone } from "../../theme"

afterEach(() => setAppClock(null))

const WIDTH = 160
const SIDE = 56

/** The Overview at 160 wide, the side column's lines, with the range's
 * pay, a send to savers and spending (and before it, to compare). */
async function overview(rows: ReturnType<typeof transaction>[], lookback: "1M" | "1Y") {
  setAppClock(new Date(2026, 9, 20, 12))
  const t = await renderApp({ width: WIDTH, height: 60 })
  await t.renderOnce()
  data.setState({
    accounts: [account({ id: 1, name: "Spending", balance: 1500 }), account({ id: 2, name: "Rainy day", externalKind: "SAVER", balance: 9000 })],
    categories: [category({ id: 10, name: "Groceries", color: "#a6e3a1" }), category({ id: 11, name: "Fuel", color: "#fab387" })],
    transactions: rows,
    suggestions: {}, budgets: [], accountSelection: "all", ready: true, icons: false, uiPrefs: {},
  })
  ui.switchTab("overview")
  ui.setState({ focusedSection: "none", chartViews: [0, 4, 7, 8], timeframe: { ...ui.state.timeframe, family: "lookback", lookback }, customEdit: null, overviewCategoryCursor: 0 })
  await t.renderOnce(); await t.flush()
  const frame = async () => { await t.renderOnce(); await t.flush(); await t.renderOnce(); return t.captureCharFrame().split("\n").map((l) => l.slice(WIDTH - SIDE)) }
  return { t, frame }
}

let id = 0
const row = (dateISO: string, amount: number, extra: Parameters<typeof transaction>[0] = {}) => transaction({ id: ++id, accountId: 1, dateISO, amount, ...extra })
const pay = (dateISO: string, amount: number) => row(dateISO, amount, { categoryName: "Salary", income: true, description: "EMPLOYER" })
const send = (dateISO: string, amount: number) => row(dateISO, -amount, { transferAccountId: 2, internal: true, excluded: true, description: "Transfer to Rainy day" })
const spend = (dateISO: string, amount: number, categoryId: number, categoryName: string) => row(dateISO, -amount, { categoryId, categoryName, description: categoryName.toUpperCase() })

test("the Range pane: the range as a track, what came in as a bar against before, the ratios and the categories with Before; t switches to Totals and Categories and back", async () => {
  // 1M on 20 Oct: 20 Sep to 20 Oct; before it, the month before.
  const { t, frame } = await overview([
    spend("2026-08-01", 5, 10, "Groceries"),
    spend("2026-09-01", 400, 10, "Groceries"), spend("2026-09-02", 200, 11, "Fuel"),
    pay("2026-10-01", 5000), send("2026-10-02", 1000),
    spend("2026-10-05", 300, 10, "Groceries"), spend("2026-10-06", 100, 11, "Fuel"),
  ], "1M")
  let f = await frame()
  const text = f.join("\n")
  expect(text).toContain("╭─ Range")
  expect(text).not.toContain("Totals")
  // The track: the ends, today; what came in, went to savers, was spent.
  // Ending today, the range's end is its own label.
  expect(text).toMatch(/20 Sep\s+2 Oct\s+20 Oct/)
  expect(text).toMatch(/●[━◆●┿]+/)
  expect(text).toMatch(/↓ \$5,000 in\s+◆ \$1,000 savers\s+\$400 spent/)
  const spentRow = f.findIndex((l) => /\$400 spent/.test(l) && l.includes("↓"))
  const bad = RGBA.fromHex(tone.bad).toInts().join()
  expect(t.captureSpans().lines[spentRow]!.spans.some((s) => s.text === "$400" && s.fg.toInts().join() === bad)).toBe(true)
  // The bar: spent and the net over it, before's tick on it and under it.
  expect(text).toMatch(/\$400 spent\s+\+\$4,600 net/)
  expect(text).toContain("┃")
  expect(text).toMatch(/▲ before \$600|before \$600 ▲/)
  // The ratios, before beside each.
  expect(text).toMatch(/Savings rate\s+before\s+\S+\s+\S+/)
  expect(text).toMatch(/Daily average\s+before \$\d+\s+\$\d+/)
  expect(text).toMatch(/Transactions\s+before 2\s+\d+/)
  // The categories: a heading over the columns, each group's change on before.
  expect(text).toMatch(/Categories\s+Spent\s+%\s+Before/)
  expect(text).toMatch(/Groceries\s+\$300\s+75%\s+-\$100/)
  expect(text).toMatch(/Fuel\s+\$100\s+25%\s+-\$100/)
  // t: Totals and Categories, saved; again, back.
  t.mockInput.pressKey("t")
  f = await frame()
  expect(data.state.uiPrefs.totalsCards).toBe(true)
  expect(f.join("\n")).toContain("╭─ Totals")
  expect(f.join("\n")).toContain("╭─ Categories")
  expect(f.join("\n")).not.toContain("╭─ Range")
  t.mockInput.pressKey("t")
  f = await frame()
  expect(data.state.uiPrefs.totalsCards).toBe(false)
  expect(f.join("\n")).toContain("╭─ Range")
  t.renderer.destroy()
})

test("the Range pane over a year: a fortnight's paydays and sends would crowd the track, so it draws none; the figures are the year's", async () => {
  const rows: ReturnType<typeof transaction>[] = []
  for (let d = new Date(Date.UTC(2025, 9, 24)); d < new Date(Date.UTC(2026, 9, 20)); d.setUTCDate(d.getUTCDate() + 14)) {
    const day = d.toISOString().slice(0, 10)
    rows.push(pay(day, 2000), send(day, 500), spend(day, 1000, 10, "Groceries"))
  }
  const { t, frame } = await overview(rows, "1Y")
  const text = (await frame()).join("\n")
  const track = text.split("\n").find((l) => /●[━┿┄]/.test(l))!
  expect(track).toBeDefined()
  // Only the ends and today: no paydays or sends between.
  expect(track.match(/[●◆]/g)).toEqual(["●"])
  // Its ends' years; the figures (short of their words where they'd crowd).
  expect(text).toMatch(/20 Oct 2025\s+20 Oct 2026/)
  expect(text).toMatch(/↓ \$52,000 in\s+◆ \$13,000( savers)?\s+\$26,000 spent/)
  expect(text).toMatch(/\$26,000 spent\s+\+\$26,000 net/)
  t.renderer.destroy()
})

test("the Range pane's categories: groups closed until space opens them, as Budgets'; the cursor moves over what shows", async () => {
  const { t, frame } = await overview([
    spend("2026-10-05", 300, 10, "Groceries"), spend("2026-10-06", 50, 12, "Takeaway"), spend("2026-10-07", 100, 11, "Fuel"),
  ], "1M")
  data.setState("categories", [category({ id: 20, name: "Food", color: "#a6e3a1" }), category({ id: 10, name: "Groceries", color: "#a6e3a1", parentId: 20 }), category({ id: 12, name: "Takeaway", color: "#a6e3a1", parentId: 20 }), category({ id: 11, name: "Fuel", color: "#fab387" })])
  let text = (await frame()).join("\n")
  expect(text).toMatch(/▸ +. Food\s+\$350/)
  expect(text).not.toContain("Groceries")
  // Fuel has no subcategories: no chevron.
  expect(text).not.toMatch(/▸ +. Fuel/)
  ui.setState({ focusedSection: "ov.categories", overviewCategoryCursor: 0 })
  t.mockInput.pressKey(" ")
  text = (await frame()).join("\n")
  expect(ui.state.overviewOpen).toEqual([20])
  expect(text).toMatch(/▾ +. Food[\s\S]*Groceries\s+\$300[\s\S]*Takeaway\s+\$50[\s\S]*Fuel/)
  // From a subcategory, space closes its group and the cursor goes to it.
  t.mockInput.pressKey("j")
  await frame()
  expect(ui.state.overviewCategoryCursor).toBe(1)
  t.mockInput.pressKey(" ")
  text = (await frame()).join("\n")
  expect(ui.state.overviewOpen).toEqual([])
  expect(ui.state.overviewCategoryCursor).toBe(0)
  expect(text).not.toContain("Groceries")
  t.renderer.destroy()
})
