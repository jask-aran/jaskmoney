import { afterEach, expect, test } from "bun:test"
import { BoxRenderable, RGBA, type BaseRenderable, TextAttributes } from "@opentui/core"
import { setAppClock } from "../../domain/days"
import { data } from "../../state/dataStore"
import { ui } from "../../state/uiStore"
import { renderApp } from "../../testing/app"
import { account, category, transaction } from "../../testing/fixtures"
import { theme, tone } from "../../theme"
import { footerHints, handleKey, hintState } from "../../app/keys"
import { key } from "../../testing/keys"

afterEach(() => setAppClock(null))

async function overview(width: number, height: number) {
  setAppClock(new Date(2026, 9, 20, 12))
  const t = await renderApp({ width, height })
  await t.renderOnce()
  data.setState({
    accounts: [account({ balance: 2100 }), account({ id: 2, name: "Holiday", externalKind: "SAVER", balance: 3400 }), account({ id: 3, name: "Emergency", externalKind: "SAVER", balance: 5000 })],
    categories: Array.from({ length: 12 }, (_, i) => category({ id: i + 10, name: `Category ${i + 1}`, color: "#fab387" })),
    transactions: Array.from({ length: 40 }, (_, i) => transaction({ id: i + 1, dateISO: `2026-10-${String(i % 19 + 1).padStart(2, "0")}`, categoryId: i % 13 === 0 ? null : i % 12 + 10, categoryName: i % 13 === 0 ? "Uncategorised" : `Category ${i % 12 + 1}`, amount: -(i + 1) * 3 })),
    suggestions: {}, budgets: [], accountSelection: "all", ready: true, icons: false,
    uiPrefs: {},
  })
  ui.switchTab("overview")
  ui.setState({ focusedSection: "none", chartViews: [0, 4], timeframe: { ...ui.state.timeframe, family: "lookback", lookback: "1M" }, customEdit: null, overviewCategoryCursor: 0 })
  await t.renderOnce()
  await t.flush()
  return t
}

test("160×45 wide Overview keeps its captured cells", async () => {
  const t = await overview(160, 45)
  // Exclude shell status/footer, which contain runtime state.
  const cells = t.captureSpans().lines.slice(2, -2).map((line) => line.spans.map((s) => [s.text, s.fg.toInts(), s.bg.toInts(), s.attributes]))
  expect(Bun.hash(JSON.stringify(cells)).toString()).toMatchSnapshot()
})

function cards(root: BaseRenderable): BoxRenderable[] {
  return root.getChildren().flatMap((child) => [
    ...(child instanceof BoxRenderable && child.border === true ? [child] : []),
    ...cards(child),
  ])
}

/** The Overview's cards: Date Range, the charts, Accounts, Totals, Categories. */
function overviewCards(t: Awaited<ReturnType<typeof overview>>): BoxRenderable[] {
  const dateRange = cards(t.renderer.root).find((card) => card.y === 2)
  expect(dateRange).toBeDefined()
  // The Overview's body: Date Range's card sits in a box of its own (its
  // region and click), as Accounts' and Categories' do.
  let body = dateRange!.parent!
  while (cards(body).length < 2 && body.parent) body = body.parent
  return cards(body)
}

// Wide (>= 90 columns): two charts beside the stack. Narrow: one chart, then
// Accounts and Totals beside Categories, both columns one height.
for (const [width, height, wide] of [[80, 30, false], [80, 45, false], [89, 60, false], [90, 40, true], [100, 57, true], [160, 45, true]] as const) {
  test(`${width}×${height}: ${wide ? "two columns" : "one chart, cards beside Categories"}; no overlaps; jumps reach whole cards in focus paint`, async () => {
    const t = await overview(width, height)
    const frame = () => t.captureCharFrame()
    const settle = async () => { await t.renderOnce(); await t.flush() }
    const all = overviewCards(t)
    expect(all).toHaveLength(wide ? 6 : 5)
    expect(frame().includes("Balances · Net position")).toBe(wide)
    const sameCards = all.map((card) => card.id)
    for (let i = 0; i < all.length; i++) {
      const a = all[i]!
      expect(a.width).toBeGreaterThan(2)
      expect(a.x).toBeGreaterThanOrEqual(0)
      expect(a.x + a.width).toBeLessThanOrEqual(width)
      for (const b of all.slice(i + 1)) {
        expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true)
      }
    }
    // The columns end on the same row: no empty area under either (wide:
    // the bottom chart and Categories; narrow: Totals and Categories).
    const left = all[wide ? 2 : all.length - 2]!, categories = all.at(-1)!
    expect(left.y + left.height).toBe(categories.y + categories.height)
    const jumps = [["t", "Spending · Cumulative", "ov.chart", 1], ...(wide ? [["b", "Balances · Net position", "ov.chart2", 2] as const] : []), ["c", "Categories", "ov.categories", all.length - 1], ["d", "Date Range", "ov.range", 0]] as const
    for (const [jump, title, section, index] of jumps) {
      t.mockInput.pressKey("v")
      t.mockInput.pressKey(jump)
      await settle()
      expect(ui.state.focusedSection).toBe(section)
      expect(frame().split(title).length - 1).toBe(1)
      const focusedCard = all[index]!
      expect(focusedCard.y).toBeGreaterThanOrEqual(2)
      expect(focusedCard.y + focusedCard.height).toBeLessThanOrEqual(height - 2)
      const heading = t.captureSpans().lines.flatMap((line) => line.spans).find((s) => s.text.includes(` ${title.split(" · ")[0]}`))!
      expect(heading).toBeDefined()
      expect(heading.fg.toInts()).toEqual(RGBA.fromHex(tone.focus).toInts())
      expect(heading.bg.toInts()).toEqual(RGBA.fromHex(theme.canvas).toInts())
      expect(heading.attributes & TextAttributes.BOLD).toBe(TextAttributes.BOLD)
      if (jump === "c") {
        t.mockInput.pressKey("j")
        await settle()
        expect(ui.state.overviewCategoryCursor).toBe(1)
        const cursor = t.captureSpans().lines.flatMap((line) => line.spans).find((s) => s.text.includes("Category") && s.bg.toInts().join() === RGBA.fromHex(theme.rowCursor).toInts().join())
        expect(cursor).toBeDefined()
        expect(cursor!.attributes & TextAttributes.BOLD).toBe(TextAttributes.BOLD)
      }
    }
    // H/L step the bottom chart, or the one chart on screen.
    ui.setState({ focusedSection: "none" })
    expect(ui.state.overviewCharts).toBe(wide ? 2 : 1)
    t.mockInput.pressKey("L")
    await settle()
    expect(ui.state.chartViews).toEqual(wide ? [0, 5] : [1, 4])
    expect(frame()).toContain(wide ? "Balances · Available" : "Spending · Daily")
    t.mockInput.pressKey("H")
    await settle()
    expect(ui.state.chartViews).toEqual([0, 4])
    expect(footerHints("overview", hintState(ui, data)).some((h) => h.key === "H/L")).toBe(wide)
    // With one chart, v lists no bottom chart and b does nothing.
    t.mockInput.pressKey("v")
    await settle()
    expect(frame().includes("Bottom chart")).toBe(wide)
    t.mockInput.pressKey("b")
    await settle()
    expect(ui.state.focusedSection).toBe(wide ? "ov.chart2" : "none")
    ui.setState({ focusedSection: "none", jump: null })
    ui.setTimeframe({ ...ui.state.timeframe, family: "lookback", lookback: "2M" })
    await settle()
    expect(overviewCards(t).map((card) => card.id)).toEqual(sameCards)
  })
}

test("a resize to narrow keeps Categories in view, and drill returns to its cursor", async () => {
  const t = await overview(110, 65)
  ui.setState({ focusedSection: "ov.categories", overviewCategoryCursor: 11 })
  await t.renderOnce()
  t.resize(80, 30)
  await t.renderOnce()
  await t.flush()
  expect(t.captureCharFrame()).toContain("Categories · enter to open")
  expect(t.captureCharFrame()).toContain("4 uncategorised")
  t.mockInput.pressKey("k")
  await t.renderOnce()
  expect(ui.state.overviewCategoryCursor).toBe(10)
  t.mockInput.pressEnter()
  await t.renderOnce()
  expect(ui.state.activeTab).toBe("manager")
  // Dispatch Escape directly; a bare ESC byte waits for the input parser's
  // sequence timeout, which the renderer's layout flush does not advance.
  handleKey(ui, key("escape"), data)
  await t.renderOnce()
  await t.flush()
  expect(ui.state.activeTab).toBe("overview")
  expect(ui.state.overviewCategoryCursor).toBe(10)
  expect(t.captureCharFrame()).toContain("Categories · enter to open")
})

test("going narrow with the bottom chart focused moves focus to the one chart", async () => {
  const t = await overview(110, 45)
  ui.setState({ focusedSection: "ov.chart2" })
  await t.renderOnce()
  t.resize(80, 40)
  await t.renderOnce()
  await t.flush()
  expect(ui.state.focusedSection).toBe("ov.chart")
  expect(ui.state.overviewCharts).toBe(1)
})

test("narrow at its shortest: the Calendar chart shows all seven weekdays above its legend", async () => {
  const t = await overview(80, 30)
  ui.setState({ chartViews: [7, 4], focusedSection: "ov.chart" })
  await t.renderOnce()
  await t.flush()
  const pane = t.renderer.root.findDescendantById("overview-narrow-chart")!
  const lines = t.captureCharFrame().split("\n")
  for (const day of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) {
    const y = lines.findIndex((line) => line.startsWith(`│ ${day}`))
    expect(y).toBeGreaterThan(pane.y)
    expect(y).toBeLessThan(pane.y + pane.height - 1)
  }
})

test("the Date Range chips all show at every width, tightening before anything is cut; the dates show when they fit", async () => {
  const shown: Record<number, boolean> = {}
  for (const width of [80, 85, 90, 95, 100, 105, 110, 114, 120, 140, 160]) {
    const t = await overview(width, 40)
    const line = t.captureCharFrame().split("\n")[3]!
    for (const label of ["1M", "2M", "3M", "6M", "1Y", "QTR", "Half", "FY", "Custom"]) expect(line).toContain(` ${label} `)
    expect(line).toMatch(/ (Cycle|Cyc) .* (Month|Mth) .* (Year|Yr) /)
    // The card's right border is intact: nothing ran past it.
    expect(line.trimEnd().match(/│/g)!.length).toBeGreaterThanOrEqual(2)
    shown[width] = /\[ .+ \]/.test(line)
    t.renderer.destroy()
  }
  expect(shown[160]).toBe(true)
  expect(shown[80]).toBe(false)
})

test("the two chart panes are the same height, an odd line widening the gap between them, so two Calendars draw the same grid", async () => {
  // 69 and 59 leave an odd number of lines for the panes.
  for (const height of [59, 69, 70]) {
    const t = await overview(160, height)
    ui.setState({ chartViews: [7, 7] })
    await t.renderOnce()
    await t.flush()
    const lines = t.captureCharFrame().split("\n").map((line) => line.slice(0, 110))
    const tops = lines.flatMap((line, y) => (line.startsWith("╭─ Calendar") ? [y] : []))
    const bottoms = lines.flatMap((line, y) => (line.startsWith("╰─ less") ? [y] : []))
    expect(tops).toHaveLength(2)
    const pane = (k: number) => lines.slice(tops[k]! + 1, bottoms[k]!)
    expect(pane(1)).toEqual(pane(0))
    // The bottom pane still ends level with the side column (Categories).
    const full = t.captureCharFrame().split("\n")
    expect(full[bottoms[1]!]!.trimEnd().endsWith("╯")).toBe(true)
    expect(full[bottoms[1]!]!.match(/╯/g)!.length).toBe(2)
    t.renderer.destroy()
  }
})

test("the Custom range dialog says the range as it reads while typing, what it takes when it doesn't, and the error enter found", async () => {
  const t = await overview(140, 40)
  handleKey(ui, key("c", { shift: true, sequence: "C" }), data)
  const lines = async () => { await t.renderOnce(); return t.captureCharFrame().split("\n") }
  expect((await lines()).some((l) => l.includes("Start  20 Sep 2026"))).toBe(true)
  handleKey(ui, key("u", { ctrl: true }), data)
  for (const c of "sep") handleKey(ui, key(c), data)
  expect((await lines()).some((l) => l.includes("1 Sep – 20 Oct 2026 · 50 days"))).toBe(true)
  handleKey(ui, key("u", { ctrl: true }), data)
  handleKey(ui, key("z"), data)
  expect((await lines()).some((l) => l.includes("│ 18/11, 1 oct, oct, -14, today"))).toBe(true)
  handleKey(ui, key("return"), data)
  const error = (await lines()).find((l) => l.includes("Start isn't a date"))!
  // Whole: the dialog is wide enough for it.
  expect(error).toMatch(/Start isn't a date: 18\/11, 1 oct, oct, -14, today +│/)
  handleKey(ui, key("escape"), data)
  t.renderer.destroy()
})
