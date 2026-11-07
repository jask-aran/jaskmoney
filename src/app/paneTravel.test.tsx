import { expect, test } from "bun:test"
import { ui } from "../state/uiStore"
import { data } from "../state/dataStore"
import { renderApp } from "../testing/app"
import { web } from "./webApp"

/**
 * Arrow keys fly between the panes of a page and up into the top bar; the
 * mouse drives the same machine (app/paneTravel, app/webApp) — frozen:
 * change the code, not these.
 */

async function overview() {
  ui.switchTab("overview")
  const t = await renderApp({ width: 160, height: 48 })
  await t.renderOnce()
  return t
}
async function press(t: Awaited<ReturnType<typeof renderApp>>, dir: "up" | "down" | "left" | "right") {
  t.mockInput.pressArrow(dir)
  await t.renderOnce()
}
/** Cell of the first occurrence of `text` on screen. */
function find(t: Awaited<ReturnType<typeof renderApp>>, text: string): { x: number; y: number } {
  const lines = t.captureCharFrame().split("\n")
  const y = lines.findIndex((line) => line.includes(text))
  if (y < 0) throw new Error(`"${text}" is not on screen`)
  return { x: lines[y]!.indexOf(text), y }
}

test("arrows fly between the Overview's panes by where they are on screen", async () => {
  const t = await overview()
  await press(t, "down")
  expect(ui.state.focusedSection).toBe("ov.range")
  await press(t, "down")
  expect(ui.state.focusedSection).toBe("ov.chart")
  await press(t, "down")
  expect(ui.state.focusedSection).toBe("ov.chart2")
  await press(t, "right")
  expect(ui.state.focusedSection).toBe("ov.categories")
  await press(t, "up")
  expect(ui.state.focusedSection).toBe("ov.accounts")
  await press(t, "left")
  expect(ui.state.focusedSection).toBe("ov.chart")
})

test("left/right fly; h/l still step the chart's views", async () => {
  const t = await overview()
  ui.setState({ focusedSection: "ov.chart" })
  const views = [...ui.state.chartViews]
  await press(t, "right")
  expect(ui.state.focusedSection).toBe("ov.accounts")
  expect([...ui.state.chartViews]).toEqual(views)
  ui.setState({ focusedSection: "ov.chart" })
  t.mockInput.pressKey("l")
  await t.renderOnce()
  expect(ui.state.chartViews[0]).not.toBe(views[0])
})

test("up past the Date Range reaches the top bar; enter on the web app opens it in the browser", async () => {
  const opened: string[] = []
  const open = web.open
  web.open = (url) => { opened.push(url) }
  try {
    web.setServing({ page: "http://127.0.0.1:4417/", clients: 1 })
    const t = await overview()
    ui.setState({ focusedSection: "ov.range" })
    await press(t, "up")
    expect(ui.state.focusedSection).toStartWith("bar.")
    for (let i = 0; i < 8 && ui.state.focusedSection !== "bar.web"; i++) await press(t, "right")
    expect(ui.state.focusedSection).toBe("bar.web")
    expect(t.captureCharFrame()).toContain("1 web client")
    t.mockInput.pressEnter()
    await t.renderOnce()
    expect(opened).toEqual(["http://127.0.0.1:4417/"])
    // Down from the bar goes back into the page.
    await press(t, "down")
    expect(ui.state.focusedSection).toStartWith("ov.")
  } finally {
    web.open = open
    web.setServing(null)
  }
})

test("enter on a tab in the top bar switches to it", async () => {
  const t = await overview()
  ui.setState({ focusedSection: "ov.range" })
  await press(t, "up")
  for (let i = 0; i < 8 && ui.state.focusedSection !== "bar.manager"; i++) await press(t, "right")
  expect(ui.state.focusedSection).toBe("bar.manager")
  t.mockInput.pressEnter()
  await t.renderOnce()
  expect(ui.state.activeTab).toBe("manager")
})

test("a click is the same machine: a tab switches, the web app opens (a pane taking focus: pointerTravel)", async () => {
  const opened: string[] = []
  const open = web.open
  web.open = (url) => { opened.push(url) }
  try {
    web.setServing({ page: "http://127.0.0.1:4417/", clients: 0 })
    const t = await overview()
    // Serving with no client yet still offers the web app.
    const label = find(t, "web app")
    await t.mockMouse.click(label.x + 1, label.y)
    await t.renderOnce()
    expect(opened).toEqual(["http://127.0.0.1:4417/"])

    const tab = find(t, "Transactions")
    await t.mockMouse.click(tab.x + 2, tab.y)
    await t.renderOnce()
    expect(ui.state.activeTab).toBe("manager")
  } finally {
    web.open = open
    web.setServing(null)
  }
})

test("Transactions: a click puts the cursor on the row; a click on the cursor row opens it (the wheel: pointerTravel)", async () => {
  ui.switchTab("manager")
  const t = await renderApp({ width: 160, height: 48 })
  await t.renderOnce()
  await data.enterDemo()
  await t.renderOnce()
  const rows = data.scopedTransactions()
  const third = rows[3]!
  // The amount is unique enough on the first screen to find the row's line.
  const lines = t.captureCharFrame().split("\n")
  const y = lines.findIndex((line) => line.includes(third.description) && line.includes(Math.abs(third.amount).toFixed(2)))
  expect(y).toBeGreaterThan(0)
  await t.mockMouse.click(40, y)
  await t.renderOnce()
  expect(ui.state.managerCursor).toBe(3)
  expect(ui.state.detail).toBeNull()
  await t.mockMouse.click(40, y)
  await t.renderOnce()
  expect(ui.state.detail?.id).toBe(third.id)
  await data.leaveDemo()
})

test("an open dialog owns the mouse: a click elsewhere does nothing", async () => {
  const t = await overview()
  t.mockInput.pressKey("k", { ctrl: true })
  await t.renderOnce()
  expect(ui.state.palette).not.toBeNull()
  const tab = find(t, "Budgets")
  await t.mockMouse.click(tab.x + 2, tab.y)
  await t.renderOnce()
  expect(ui.state.activeTab).toBe("overview")
  expect(ui.state.palette).not.toBeNull()
})
