import { afterEach, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { setAppClock } from "../../domain/days"
import { data } from "../../state/dataStore"
import { ui } from "../../state/uiStore"
import { renderApp } from "../../testing/app"
import { account, category, transaction } from "../../testing/fixtures"
import { tone } from "../../theme"
import { INKS } from "../charts/inks"

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

test("the Range pane: the range as a track, what came in as a bar (spent, net), the net opened out to where it went, the ratios, and the categories under their bar against before; t switches to Totals and Categories and back", async () => {
  // 1M on 20 Oct: 20 Sep to 20 Oct; before it, the month before.
  const { t, frame } = await overview([
    spend("2026-08-01", 5, 10, "Groceries"),
    spend("2026-09-01", 400, 10, "Groceries"), spend("2026-09-02", 200, 11, "Fuel"),
    pay("2026-10-01", 5000), send("2026-10-02", 1000), transaction({ id: ++id, accountId: 2, dateISO: "2026-10-02", amount: 1000, transferAccountId: 1, internal: true, excluded: true, description: "Transfer from Spending" }),
    spend("2026-10-05", 300, 10, "Groceries"), spend("2026-10-06", 100, 11, "Fuel"),
  ], "1M")
  let f = await frame()
  const text = f.join("\n")
  expect(text).toContain("╭─ Range")
  expect(text).not.toContain("Totals")
  // The track: the ends, today; what came in and went to savers over it
  // (what's spent is the bar's). Ending today, the end is its own label.
  expect(text).toMatch(/↓ \$5,000 in\s+◆ \$1,000 savers\s*│[\s\S]*●[━◆●┿┄]+○[\s\S]*20 Sep\s+2 Oct\s+20 Oct/)
  // What came in: spent in spending's colour, the net in good, each
  // figure over its part.
  const barAt = f.findIndex((l) => /\$400 spent\s+\+\$4,600 net/.test(l)) + 1
  expect(barAt).toBeGreaterThan(0)
  const colorsOf = (row: number) => t.captureSpans().lines[row]!.spans.filter((s) => s.text.includes("█")).map((s) => s.fg.toInts().join())
  expect(colorsOf(barAt)[0]).toBe(RGBA.fromHex(INKS.spend!).toInts().join())
  expect(colorsOf(barAt).at(-1)).toBe(RGBA.fromHex(tone.good).toInts().join())
  // Its net end opened out under it, the savings rate in the opening; then
  // where the net went: Rainy day's $1,000, and $3,600 kept in Spending.
  expect(f[barAt + 1]).toMatch(/╭─+╯\s+92\.0% saved\s+│/)
  expect(f[barAt + 3]).toMatch(/\$1,000 Rainy day\s+\$3,600 kept/)
  // No Savings rate row: the opening says it.
  expect(text).not.toContain("Savings rate")
  expect(text).toMatch(/Daily average\s+before \$\d+\s+\$\d+/)
  expect(text).toMatch(/Transactions\s+before 2\s+\d+/)
  // Runway: the net position ($10,500) at the range's daily average
  // ($400 over 31 days, $13).
  expect(text).toMatch(/Runway\s+at \$13\/day\s+814 days/)
  // The categories: a heading over the columns, their spending as a bar
  // under it with before's tick (before was more: the bar stops short,
  // dotted to the tick), each group's change on before.
  expect(text).toMatch(/Categories\s+Spent\s+%\s+Before[^\n]*\n[^\n]*█+┄+┃[^\n]*\n[^\n]*before \$600 ▲/)
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
  expect(text).toMatch(/↓ \$52,000 in\s+◆ \$13,000 savers/)
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

test("the Range pane spending more than came in: where it came from (in, each saver drawn on, Spending's balance) over what was spent, the same total, edges between", async () => {
  // In $1,000; spent $1,600: $400 from Rainy day, the other $200 from
  // Spending's balance.
  const withdraw = (dateISO: string, amount: number) => [
    row(dateISO, amount, { transferAccountId: 2, internal: true, excluded: true, description: "Transfer from Rainy day" }),
    transaction({ id: ++id, accountId: 2, dateISO, amount: -amount, transferAccountId: 1, internal: true, excluded: true, description: "Transfer to Spending" }),
  ]
  const { t, frame } = await overview([
    pay("2026-10-01", 1000), ...withdraw("2026-10-03", 400),
    spend("2026-10-05", 1200, 10, "Groceries"), spend("2026-10-06", 400, 11, "Fuel"),
  ], "1M")
  const f = await frame()
  const at = f.findIndex((l) => /\$1,000 in/.test(l) && !l.includes("↓"))
  expect(at).toBeGreaterThan(0)
  // Each source's figure; the smaller ones' names where they fit.
  expect(f[at]).toMatch(/\$1,000 in\s+\$400( Rainy day)?\s+\$200( Spending)?/)
  // The two bars, edges between them, the same width; the hatching under
  // what the savers and Spending paid.
  const inside = (l: string) => l.slice(3, l.lastIndexOf("│") - 1)
  expect(inside(f[at + 1]!)).toMatch(/^█+$/)
  expect(inside(f[at + 2]!)).toMatch(/^│ +│$/)
  expect(inside(f[at + 3]!)).toMatch(/^█+╱+$/)
  expect(inside(f[at + 3]!).indexOf("╱")).toBe(Math.round((1000 / 1600) * inside(f[at + 1]!).length))
  expect(f[at + 4]).toMatch(/\$1,600 spent\s+-\$600 net/)
  // No opening and no net bar: there's no net to open out.
  expect(f.join("\n")).not.toMatch(/╭─+╯/)
  t.renderer.destroy()
})

test("spending more than came in, edge cases: savers drawn on past the gap cover only the gap; nothing in, all hatched", async () => {
  const withdraw = (dateISO: string, amount: number) => [
    row(dateISO, amount, { transferAccountId: 2, internal: true, excluded: true, description: "Transfer from Rainy day" }),
    transaction({ id: ++id, accountId: 2, dateISO, amount: -amount, transferAccountId: 1, internal: true, excluded: true, description: "Transfer to Spending" }),
  ]
  // $900 drawn on, $300 needed: Rainy day's part is the $300; none from Spending.
  let o = await overview([pay("2026-10-01", 1000), ...withdraw("2026-10-03", 900), spend("2026-10-05", 1300, 10, "Groceries")], "1M")
  let f = await o.frame()
  expect(f.join("\n")).toMatch(/\$1,000 in\s+\$300 Rainy day\s*│/)
  o.t.renderer.destroy()
  // Nothing in: the spending all from Spending's balance, all of it hatched.
  o = await overview([spend("2026-10-05", 500, 10, "Groceries")], "1M")
  f = await o.frame()
  const at = f.findIndex((l) => /\$500 Spending/.test(l))
  expect(at).toBeGreaterThan(0)
  expect(f[at + 3]!.slice(3, f[at + 3]!.lastIndexOf("│") - 1)).toMatch(/^╱+$/)
  expect(f[at + 4]).toMatch(/\$500 spent/)
  o.t.renderer.destroy()
})

test("the Range pane: the ratios first; s switches the bar to where the spending went (the categories' bar opened out of the spent part) and back", async () => {
  const { t, frame } = await overview([
    spend("2026-08-01", 5, 10, "Groceries"), spend("2026-09-01", 400, 10, "Groceries"), spend("2026-09-02", 200, 11, "Fuel"),
    pay("2026-10-01", 5000), send("2026-10-02", 1000), transaction({ id: ++id, accountId: 2, dateISO: "2026-10-02", amount: 1000, transferAccountId: 1, internal: true, excluded: true, description: "Transfer from Spending" }),
    spend("2026-10-05", 300, 10, "Groceries"), spend("2026-10-06", 100, 11, "Fuel"),
  ], "1M")
  let text = (await frame()).join("\n")
  // The ratios, then the track, then the bar.
  expect(text).toMatch(/╭─ Range[^\n]*\n[^\n]*Daily average[^\n]*\n[^\n]*Transactions[^\n]*\n[^\n]*Runway[\s\S]*↓ \$5,000 in[\s\S]*\$400 spent/)
  expect(text).toMatch(/╭─+╯\s+92\.0% saved/)
  t.mockInput.pressKey("s")
  let f = await frame()
  text = f.join("\n")
  expect(data.state.uiPrefs.rangeView).toBe("spending")
  // The spent part opened out: the left edge down, a corner where the
  // spending ends; the categories' bar under it, before's under that.
  const opening = f.findIndex((l) => /│\s+\S+% spent\s+╰─+╮/.test(l) || /│\s+╰─+╮/.test(l))
  expect(opening).toBeGreaterThan(0)
  expect(f[opening + 1]).toMatch(/█+┄*┃/)
  expect(f[opening + 2]).toMatch(/before \$600/)
  // No net bar; the Categories heading straight over the rows.
  expect(text.slice(text.indexOf("╭─ Range"))).not.toMatch(/Rainy day|kept|saved/)
  expect(text).toMatch(/Categories\s+Spent\s+%\s+Before[^\n]*\n[^\n]*Groceries/)
  t.mockInput.pressKey("s")
  text = (await frame()).join("\n")
  expect(data.state.uiPrefs.rangeView).toBe("net")
  expect(text).toMatch(/92\.0% saved/)
  t.renderer.destroy()
})

test("spending more than came in, where the spending went: its categories as a third bar under the spending, the same total, the figures inside the edges between", async () => {
  const { t, frame } = await overview([pay("2026-10-01", 1000), spend("2026-10-05", 1200, 10, "Groceries"), spend("2026-10-06", 400, 11, "Fuel")], "1M")
  data.setState("uiPrefs", { ...data.state.uiPrefs, rangeView: "spending" })
  const f = await frame()
  const inside = (l: string) => l.slice(3, l.lastIndexOf("│") - 1)
  // The spent bar plain: spending's colour, then hatched.
  const spentAt = f.findIndex((l) => /^█+╱+$/.test(inside(l)))
  expect(spentAt).toBeGreaterThan(0)
  // Under it, the figures inside the edges; then the categories' bar, as wide.
  expect(inside(f[spentAt + 1]!)).toMatch(/^│ .*\$1,600 spent\s+-\$600 net.* │$/)
  expect(inside(f[spentAt + 2]!)).toMatch(/^█+$/)
  const spans = t.captureSpans().lines[spentAt + 2]!.spans
  const groceries = RGBA.fromHex("#a6e3a1").toInts().join(), fuel = RGBA.fromHex("#fab387").toInts().join()
  expect(spans.some((s) => s.text.includes("█") && s.fg.toInts().join() === groceries)).toBe(true)
  expect(spans.some((s) => s.text.includes("█") && s.fg.toInts().join() === fuel)).toBe(true)
  expect(t.captureSpans().lines[spentAt]!.spans.some((s) => s.text.includes("╱") && s.fg.toInts().join() === fuel)).toBe(false)
  // No bar of their own over the categories.
  expect(f.join("\n")).toMatch(/Categories\s+Spent\s+%\s+Before[^\n]*\n[^\n]*Groceries/)
  t.renderer.destroy()
})

test("spending more than came in, paid for by money from outside (transfers in, not income): a measured part of its own, nothing guessed as Spending's balance", async () => {
  // In $1,000, spent $1,600; $2,000 arrived from another bank: the $600
  // past what came in was paid by it (its share), and Spending's balance
  // rose, so it gave nothing.
  const { t, frame } = await overview([
    pay("2026-10-01", 1000), row("2026-10-02", 2000, { excluded: true, categoryName: "Transfers", description: "FROM OTHER BANK" }),
    spend("2026-10-05", 1200, 10, "Groceries"), spend("2026-10-06", 400, 11, "Fuel"),
  ], "1M")
  const text = (await frame()).join("\n")
  expect(text).toMatch(/\$1,000 in\s+\$600( transfers)?/)
  expect(text).not.toMatch(/\$\d[\d,]* (Spending|other)/)
  t.renderer.destroy()
})
