import { afterEach, expect, test } from "bun:test"
import { setAppClock } from "../../domain/days"
import { data } from "../../state/dataStore"
import { ui } from "../../state/uiStore"
import { renderApp } from "../../testing/app"
import { account, category, transaction } from "../../testing/fixtures"
import { handleKey } from "../../app/keys"
import { key } from "../../testing/keys"

afterEach(() => setAppClock(null))

async function overview(width: number, height: number, rangeText = false) {
  setAppClock(new Date(2026, 9, 20, 12))
  const t = await renderApp({ width, height })
  await t.renderOnce()
  data.setState({
    accounts: [account({ balance: 2100 }), account({ id: 2, name: "Holiday", externalKind: "SAVER", balance: 3400 }), account({ id: 3, name: "Emergency", externalKind: "SAVER", balance: 5000 })],
    categories: Array.from({ length: 12 }, (_, i) => category({ id: i + 10, name: `Category ${i + 1}`, color: "#fab387" })),
    transactions: Array.from({ length: 40 }, (_, i) => transaction({ id: i + 1, dateISO: `2026-10-${String(i % 19 + 1).padStart(2, "0")}`, categoryId: i % 13 === 0 ? null : i % 12 + 10, categoryName: i % 13 === 0 ? "Uncategorised" : `Category ${i % 12 + 1}`, amount: -(i + 1) * 3 })),
    suggestions: {}, budgets: [], accountSelection: "all", ready: true, icons: false,
    uiPrefs: { rangeText },
  })
  ui.switchTab("overview")
  ui.setState({ focusedSection: "none", chartViews: [0, 4, 7, 8], timeframe: { ...ui.state.timeframe, family: "lookback", lookback: "1M" }, customEdit: null, overviewCategoryCursor: 0 })
  await t.renderOnce()
  await t.flush()
  return t
}

test("the Custom range dialog: enter on a From that isn't a date keeps the dialog open with an error; esc closes it", async () => {
  const t = await overview(140, 44)
  handleKey(ui, key("c", { shift: true, sequence: "C" }), data)
  handleKey(ui, key("tab"), data)
  expect(ui.state.customEdit?.focus).toBe("from")
  // The range's length follows what's typed, as it reads.
  const days = async () => { await t.renderOnce(); return /From .*To .*? (\d+) days/.exec(t.captureCharFrame().split("\n").find((l) => l.includes("From  ")) ?? "")?.[1] }
  expect(await days()).toBe("31")
  handleKey(ui, key("u", { ctrl: true }), data)
  for (const c of "sep") handleKey(ui, key(c), data)
  expect(await days()).toBe("50")
  handleKey(ui, key("u", { ctrl: true }), data)
  handleKey(ui, key("z"), data)
  handleKey(ui, key("return"), data)
  expect(ui.state.customEdit?.error).toBeTruthy()
  expect(ui.state.timeframe.family).toBe("lookback")
  handleKey(ui, key("escape"), data)
  expect(ui.state.customEdit).toBeNull()
  t.renderer.destroy()
})

test("the Custom range calendar: enter marks a cell, a second applies; a month twice is that month; esc undoes a mark; clicks do the same", async () => {
  const t = await overview(140, 44)
  // The overview's clock: 20 Oct 2026.
  // It opens on the calendar, the cursor on the range's start (Sun 20 Sep).
  handleKey(ui, key("c", { shift: true, sequence: "C" }), data)
  expect(ui.state.customEdit).toMatchObject({ focus: "grid", cursor: "2026-09-20" })
  // Mark, a week on: the fields follow; esc puts them back.
  const before = ui.state.customEdit!.start.value
  handleKey(ui, key("return"), data)
  handleKey(ui, key("down"), data)
  expect(ui.state.customEdit?.end.value).toBe("27 Sep 2026")
  handleKey(ui, key("escape"), data)
  expect(ui.state.customEdit?.mark).toBeNull()
  expect(ui.state.customEdit?.start.value).toBe(before)
  // Off the bottom row (a Sunday, the right half): To; up comes back.
  handleKey(ui, key("down"), data)
  expect(ui.state.customEdit?.focus).toBe("to")
  handleKey(ui, key("up"), data)
  expect(ui.state.customEdit).toMatchObject({ focus: "grid", cursor: "2026-09-27" })
  // Left and right run on across months.
  for (let i = 0; i < 4; i++) handleKey(ui, key("right"), data)
  expect(ui.state.customEdit?.cursor).toBe("2026-10-01")
  for (let i = 0; i < 4; i++) handleKey(ui, key("left"), data)
  // Up off the top row (Sun 6 Sep, the right half): the views; right is
  // Months; down back to the grid. Off the left half: the page selector,
  // where right pages a month.
  for (let i = 0; i < 4; i++) handleKey(ui, key("up"), data)
  expect(ui.state.customEdit?.focus).toBe("views")
  handleKey(ui, key("right"), data)
  expect(ui.state.customEdit?.view).toBe("months")
  handleKey(ui, key("left"), data)
  handleKey(ui, key("down"), data)
  expect(ui.state.customEdit?.focus).toBe("grid")
  // Tue 1 Sep: the top row's left half.
  for (let i = 0; i < 5; i++) handleKey(ui, key("left"), data)
  expect(ui.state.customEdit?.cursor).toBe("2026-09-01")
  handleKey(ui, key("up"), data)
  expect(ui.state.customEdit?.focus).toBe("page")
  handleKey(ui, key("right"), data)
  expect(ui.state.customEdit?.cursor.slice(0, 7)).toBe("2026-10")
  handleKey(ui, key("left"), data)
  expect(ui.state.customEdit?.cursor.slice(0, 7)).toBe("2026-09")
  // Tab: page, views, grid, From, To, and round.
  const stops = [] as string[]
  for (let i = 0; i < 5; i++) { handleKey(ui, key("tab"), data); stops.push(ui.state.customEdit!.focus) }
  expect(stops).toEqual(["views", "grid", "from", "to", "page"])
  // Months (the cursor in September): enter twice is September.
  handleKey(ui, key("tab"), data)
  handleKey(ui, key("tab"), data)
  handleKey(ui, key("m"), data)
  handleKey(ui, key("return"), data)
  handleKey(ui, key("return"), data)
  expect(ui.state.customEdit).toBeNull()
  expect(ui.state.timeframe).toMatchObject({ family: "custom", custom: { start: "2026-09-01", end: "2026-09-30" } })
  // Clicks: it opens on September (the range applied); › pages on to
  // October; then its 5 and 12.
  handleKey(ui, key("c", { shift: true, sequence: "C" }), data)
  await t.renderOnce()
  const lines = () => t.captureCharFrame().split("\n")
  const click = async (y: number, x: number) => { await t.mockMouse.click(x, y); await t.renderOnce() }
  // From line `from` and column `left` on (the chart behind has its own 12s).
  const at = (text: string, from = 0, left = 0) => { const y = lines().findIndex((l, i) => i >= from && l.indexOf(text, left) >= 0); return { y, x: lines()[y]!.indexOf(text, left) } }
  const page = at("September 2026  ›")
  await click(page.y, page.x + "September 2026  ".length)
  expect(lines().some((l) => l.includes("‹  October 2026  ›"))).toBe(true)
  const { y: header, x: left } = at("Mo    Tu")
  const five = at("  5  ", header, left - 2)
  await click(five.y, five.x + 3)
  const twelve = at(" 12 ", header, left - 2)
  await click(twelve.y, twelve.x + 2)
  expect(ui.state.customEdit).toBeNull()
  expect(ui.state.timeframe.custom).toEqual({ start: "2026-10-05", end: "2026-10-12" })
  t.renderer.destroy()
})
