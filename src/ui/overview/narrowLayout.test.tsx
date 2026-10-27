import { afterEach, expect, test } from "bun:test"
import { BoxRenderable, RGBA, type BaseRenderable, TextAttributes } from "@opentui/core"
import { setAppClock } from "../../domain/days"
import { data } from "../../state/dataStore"
import { ui } from "../../state/uiStore"
import { renderApp } from "../../testing/app"
import { account, category, transaction } from "../../testing/fixtures"
import { theme } from "../../theme"
import { handleKey } from "../../app/keys"
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

for (const [width, height] of [[80, 30], [100, 45], [110, 65], [119, 50], [160, 45]] as const) {
  test(`${width}×${height}: titles, border geometry and focus paint`, async () => {
    const t = await overview(width, height)
    const frame = () => t.captureCharFrame()
    const settle = async () => { await t.renderOnce(); await t.flush() }
    // At 80×30 the column must scroll. Across the scroll positions,
    // every title occurs exactly once, and each jump exposes its full card.
    expect(frame().match(/ Date Range /g)?.length).toBe(1)
    expect(frame().match(/ Spending · Cumulative /g)?.length).toBe(1)
    const overviewCard = cards(t.renderer.root).find((card) => card.y === 2)
    expect(overviewCard).toBeDefined()
    const overviewRoot = overviewCard!.parent
    expect(overviewRoot).toBeDefined()
    const all = cards(overviewRoot!)
    expect(all).toHaveLength(7)
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
    for (const [key, title, section] of [["t", "Spending · Cumulative", "ov.chart"], ["b", "Balances · Net position", "ov.chart2"], ["c", "Categories", "ov.categories"], ["d", "Date Range", "ov.range"]] as const) {
      t.mockInput.pressKey("v")
      t.mockInput.pressKey(key)
      await settle()
      expect(ui.state.focusedSection).toBe(section)
      expect(frame().split(title).length - 1).toBe(1)
      const focusedCard = all[key === "d" ? 0 : key === "t" ? 1 : key === "b" ? 2 : 6]!
      expect(focusedCard.y).toBeGreaterThanOrEqual(key === "d" ? 2 : 5)
      expect(focusedCard.y + focusedCard.height).toBeLessThanOrEqual(height - 2)
      const spans = t.captureSpans().lines.flatMap((line) => line.spans)
      const heading = spans.find((s) => s.text.includes(` ${title.split(" · ")[0]}`))!
      expect(heading).toBeDefined()
      expect(heading.fg.toInts()).toEqual(RGBA.fromHex(theme.focus).toInts())
      expect(heading.bg.toInts()).toEqual(RGBA.fromHex(theme.canvas).toInts())
      expect(heading.attributes & TextAttributes.BOLD).toBe(TextAttributes.BOLD)
      if (key === "c") {
        for (const cardTitle of ["Now", "Savers", "Totals", "Categories"]) expect(frame().match(new RegExp(` ${cardTitle} `, "g"))?.length).toBe(1)
        const categoryCard = all.at(-1)!
        expect(categoryCard.y).toBeGreaterThanOrEqual(5)
        expect(categoryCard.y + categoryCard.height).toBeLessThanOrEqual(height - 2)
        t.mockInput.pressKey("j")
        await settle()
        expect(ui.state.overviewCategoryCursor).toBe(1)
        const cursor = t.captureSpans().lines.flatMap((line) => line.spans).find((s) => s.text.includes("Category") && s.bg.toInts().join() === RGBA.fromHex(theme.surface0).toInts().join())
        expect(cursor).toBeDefined()
        expect(cursor!.attributes & TextAttributes.BOLD).toBe(TextAttributes.BOLD)
        if (process.env.OVERVIEW_CAPTURES === "1" && height === 30) {
          await Bun.write(`${import.meta.dir}/captures/${width}x${height}-categories.txt`, frame())
        }
      }
    }
    if (process.env.OVERVIEW_CAPTURES === "1") {
      await Bun.write(`${import.meta.dir}/captures/${width}x${height}.txt`, frame())
      const cells = t.captureSpans().lines.map((line) => line.spans.map((s) => ({ text: s.text, fg: s.fg.toInts(), bg: s.bg.toInts(), attributes: s.attributes, width: s.width })))
      await Bun.write(`${import.meta.dir}/captures/${width}x${height}.json`, JSON.stringify(cells))
    }
    ui.setState({ focusedSection: "none" })
    t.mockInput.pressKey("L")
    await settle()
    expect(ui.state.chartViews).toEqual([0, 5])
    expect(frame()).toContain("Balances · Available")
    t.mockInput.pressKey("H")
    await settle()
    expect(ui.state.chartViews).toEqual([0, 4])
    expect(frame()).toContain("Balances · Net position")
    ui.setTimeframe({ ...ui.state.timeframe, family: "lookback", lookback: "2M" })
    await settle()
    expect(cards(overviewRoot!).map((card) => card.id)).toEqual(sameCards)
  })
}

test("a resize follows Categories, and drill returns to its cursor", async () => {
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

test("the short Calendar pane contains all seven weekdays above its legend", async () => {
  const t = await overview(80, 30)
  ui.setState({ chartViews: [7, 4], focusedSection: "ov.chart" })
  await t.renderOnce()
  await t.flush()
  const pane = t.renderer.root.findDescendantById("overview-pane-ov.chart")!
  const lines = t.captureCharFrame().split("\n")
  for (const day of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) {
    const y = lines.findIndex((line) => line.startsWith(`│ ${day}`))
    expect(y).toBeGreaterThan(pane.y)
    expect(y).toBeLessThan(pane.y + pane.height - 1)
  }
})
