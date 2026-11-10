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

test("the Range pane: the range as a track, what came in as a bar (spent, net), the net opened out to where it went, the ratios, and the categories under their bar against before; s opens out the spending instead, t lays it out as text, each and back", async () => {
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
  expect(text).toMatch(/↓ \$5,000 in\s+◆ \$1,000 savers\s*│[\s\S]*●[━◆●┿┄]+○[\s\S]*20 Sep\s+2 Oct\s+20 Oct/)
  const barAt = f.findIndex((l) => /\$400 spent\s+\+\$4,600 net/.test(l)) + 1
  expect(barAt).toBeGreaterThan(0)
  const colorsOf = (row: number) => t.captureSpans().lines[row]!.spans.filter((s) => s.text.includes("█")).map((s) => s.fg.toInts().join())
  expect(colorsOf(barAt)[0]).toBe(RGBA.fromHex(INKS.spend!).toInts().join())
  expect(colorsOf(barAt).at(-1)).toBe(RGBA.fromHex(tone.good).toInts().join())
  expect(f[barAt + 1]).toMatch(/╭─+╯\s+92\.0% saved\s+│/)
  expect(f[barAt + 3]).toMatch(/\$1,000 Rainy day\s+\$3,600 kept/)
  expect(text).not.toContain("Savings rate")
  expect(text).toMatch(/Daily average\s+before \$\d+\s+\$\d+/)
  expect(text).toMatch(/Transactions\s+before 2\s+\d+/)
  expect(text).toMatch(/Runway\s+at \$13\/day\s+814 days/)
  expect(text).toMatch(/Categories\s+Spent\s+%\s+Before[^\n]*\n[^\n]*Groceries/)
  expect(text).not.toMatch(/┃|before \$600/)
  expect(text).toMatch(/Groceries\s+\$300\s+75%\s+-\$100/)
  expect(text).toMatch(/Fuel\s+\$100\s+25%\s+-\$100/)
  expect(text).toMatch(/╭─ Range[^\n]*\n[^\n]*Daily average[^\n]*\n[^\n]*Transactions[^\n]*\n[^\n]*Runway[\s\S]*↓ \$5,000 in[\s\S]*\$400 spent/)
  ui.setState({ focusedSection: "ov.categories" })
  t.mockInput.pressKey("s")
  f = await frame()
  expect(data.state.uiPrefs.rangeView).toBe("spending")
  const opening = f.findIndex((l) => /│\s+(\S+% spent\s+)?╰─+╮/.test(l))
  expect(opening).toBeGreaterThan(0)
  expect(f[opening + 1]).toMatch(/│  █+ │/)
  expect(f[opening + 2]).toMatch(/\$300 Groceries\s+\$100 Fuel/)
  expect(f.join("\n").slice(f.join("\n").indexOf("╭─ Range"))).not.toMatch(/Rainy day|kept|saved/)
  t.mockInput.pressKey("s")
  f = await frame()
  expect(data.state.uiPrefs.rangeView).toBe("net")
  t.mockInput.pressKey("t")
  f = await frame()
  const text2 = f.join("\n")
  expect(data.state.uiPrefs.rangeText).toBe(true)
  expect(text2).toContain("╭─ Range")
  expect(text2).not.toMatch(/╭─ (Totals|Categories)/)
  expect(text2).not.toMatch(/█|spent ╰|saved/)
  expect(text2).toMatch(/Totals\s+Range\s+Before[^\n]*\n[^\n]*Spent\s+\$400\s+\$600/)
  expect(text2).toMatch(/Income\s+\$5,000/)
  expect(text2).toMatch(/Runway\s+814 days\s+at \$13\/day/)
  expect(text2).toMatch(/Categories\s+Spent\s+%\s+Before[^\n]*\n[^\n]*Groceries\s+\$300/)
  const column = (l: string | undefined, word: string) => l!.indexOf(word) + word.length
  const spentRow = f.find((l) => /Spent\s+\$400/.test(l)), heading = f.find((l) => /Categories\s+Spent/.test(l))
  expect(column(spentRow, "$400")).toBe(column(heading, "Spent"))
  expect(column(spentRow, "$600")).toBe(column(heading, "Before"))
  t.mockInput.pressKey("t")
  f = await frame()
  expect(data.state.uiPrefs.rangeText).toBe(false)
  expect(f.join("\n")).toMatch(/92\.0% saved/)
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
  expect(track.match(/[●◆]/g)).toEqual(["●"])
  expect(text).toMatch(/20 Oct 2025\s+20 Oct 2026/)
  expect(text).toMatch(/↓ \$52,000 in\s+◆ \$13,000 savers/)
  expect(text).toMatch(/\$26,000 spent\s+\+\$26,000 net/)
  t.renderer.destroy()
})

test("the Range pane spending more than came in: where it came from (in, each saver drawn on, Spending's balance) over what was spent, the same total, edges between", async () => {
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
  expect(f[at]).toMatch(/\$1,000 in\s+\$400( Rainy day)?\s+\$200( Spending)?/)
  const inside = (l: string) => l.slice(3, l.lastIndexOf("│") - 1)
  expect(inside(f[at + 1]!)).toMatch(/^█+$/)
  expect(inside(f[at + 2]!)).toMatch(/^│ +│$/)
  expect(inside(f[at + 3]!)).toMatch(/^█+╱+$/)
  expect(inside(f[at + 3]!).indexOf("╱")).toBe(Math.round((1000 / 1600) * inside(f[at + 1]!).length))
  expect(f[at + 4]).toMatch(/\$1,600 spent\s+-\$600 net/)
  expect(f.join("\n")).not.toMatch(/╭─+╯/)
  t.renderer.destroy()
})

test("spending more than came in, where the spending went: its categories as a third bar under the spending, the same total, the figures inside the edges between", async () => {
  const { t, frame } = await overview([pay("2026-10-01", 1000), spend("2026-10-05", 1200, 10, "Groceries"), spend("2026-10-06", 400, 11, "Fuel")], "1M")
  data.setState("uiPrefs", { ...data.state.uiPrefs, rangeView: "spending" })
  const f = await frame()
  const inside = (l: string) => l.slice(3, l.lastIndexOf("│") - 1)
  const spentAt = f.findIndex((l) => /^█+╱+$/.test(inside(l)))
  expect(spentAt).toBeGreaterThan(0)
  expect(inside(f[spentAt + 1]!)).toMatch(/^│ .*\$1,600 spent\s+-\$600 net.* │$/)
  expect(inside(f[spentAt + 2]!)).toMatch(/^█+$/)
  const spans = t.captureSpans().lines[spentAt + 2]!.spans
  const groceries = RGBA.fromHex("#a6e3a1").toInts().join(), fuel = RGBA.fromHex("#fab387").toInts().join()
  expect(spans.some((s) => s.text.includes("█") && s.fg.toInts().join() === groceries)).toBe(true)
  expect(spans.some((s) => s.text.includes("█") && s.fg.toInts().join() === fuel)).toBe(true)
  expect(t.captureSpans().lines[spentAt]!.spans.some((s) => s.text.includes("╱") && s.fg.toInts().join() === fuel)).toBe(false)
  expect(f[spentAt + 3]).toMatch(/\$1,200 Groceries\s+\$400 Fuel/)
  expect(f.join("\n")).toMatch(/Categories\s+Spent\s+%\s+Before[^\n]*\n[^\n]*Groceries/)
  t.renderer.destroy()
})

test("spending more than came in, paid for by money from outside (transfers in, not income): a measured part of its own, nothing guessed as Spending's balance", async () => {
  const { t, frame } = await overview([
    pay("2026-10-01", 1000), row("2026-10-02", 2000, { excluded: true, categoryName: "Transfers", description: "FROM OTHER BANK" }),
    spend("2026-10-05", 1200, 10, "Groceries"), spend("2026-10-06", 400, 11, "Fuel"),
  ], "1M")
  const text = (await frame()).join("\n")
  expect(text).toMatch(/\$1,000 in\s+\$600( transfers)?/)
  expect(text).not.toMatch(/\$\d[\d,]* (Spending|other)/)
  t.renderer.destroy()
})

test("the Range pane draws in with the charts, as the Budgets pane does: its bars sweep in under the Chart animation setting, the headings there from the start", async () => {
  const { t, frame } = await overview([
    spend("2026-09-01", 400, 10, "Groceries"), pay("2026-10-01", 5000),
    spend("2026-10-05", 300, 10, "Groceries"), spend("2026-10-06", 100, 11, "Fuel"),
  ], "1M")
  const bars = (f: string[]) => f.join("").split("█").length - 1
  const whole = bars(await frame())
  expect(whole).toBeGreaterThan(0)
  data.setState({ uiPrefs: { chartMotion: "always", chartSpeed: "juicy" } })
  const early = await frame()
  expect(bars(early)).toBeLessThan(whole)
  expect(early.join("\n")).toMatch(/Categories\s+Spent/)
  await Bun.sleep(1100)
  expect(bars(await frame())).toBe(whole)
  t.renderer.destroy()
})
