import { afterEach, expect, test } from "bun:test"
import { RGBA, TextAttributes } from "@opentui/core"
import { ui } from "../state/uiStore"
import { data } from "../state/dataStore"
import { renderApp } from "../testing/app"
import { account, category, transaction } from "../testing/fixtures"
import { setAppClock } from "../domain/days"
import { allCategoryLines, overviewRange } from "../state/overviewRange"
import { CUSTOM_CHIP, chipCount } from "../domain/timeframe"
import { regionRects } from "../ui/regions"
import { chipLook } from "../ui/primitives/chip"
import { web, webLabel } from "./webApp"
import { handleKey } from "./keys"
import { keyEvent } from "./keyEvent"

afterEach(() => { setAppClock(null); web.setServing(null) })

async function overview() {
  ui.switchTab("overview")
  const t = await renderApp({ width: 160, height: 48 })
  setAppClock(new Date(2026, 9, 20, 12))
  data.setState({ accounts: [account()], categories: [category({ id: 10 }), category({ id: 11 }), category({ id: 12 })], transactions: [10, 11, 12].map((id) => transaction({ id, categoryId: id, categoryName: `Category ${id}` })), icons: false })
  ui.setTimeframe({ ...ui.state.timeframe, family: "lookback", lookback: "1M" })
  await t.renderOnce()
  return t
}

async function arrow(t: Awaited<ReturnType<typeof renderApp>>, dir: "up" | "down" | "left" | "right") {
  t.mockInput.pressArrow(dir)
  await t.renderOnce()
}

test("Categories arrows move each line, then travel only at the list edges", async () => {
  const t = await overview()
  const lines = allCategoryLines(overviewRange(data, ui.state))
  expect(lines.length).toBeGreaterThan(2)
  ui.setState({ focusedSection: "ov.categories", overviewCategoryCursor: 0 })
  for (let i = 1; i < lines.length; i++) {
    await arrow(t, "down")
    expect(ui.state.overviewCategoryCursor).toBe(i)
    expect(ui.state.focusedSection).toBe("ov.categories")
  }
  await arrow(t, "down")
  expect(ui.state.overviewCategoryCursor).toBe(lines.length - 1)
  for (let i = lines.length - 2; i >= 0; i--) {
    await arrow(t, "up")
    expect(ui.state.overviewCategoryCursor).toBe(i)
    expect(ui.state.focusedSection).toBe("ov.categories")
  }
  await arrow(t, "up")
  expect(ui.state.focusedSection).toBe("ov.accounts")
  expect(ui.state.overviewCategoryCursor).toBe(0)
})

test("Date Range arrows stop wrapping at the ends; h/l still wrap", async () => {
  const t = await overview()
  ui.setState({ focusedSection: "ov.range", dashChipCursor: 0 })
  for (let i = 1; i < chipCount(); i++) {
    await arrow(t, "right")
    expect(ui.state.dashChipCursor).toBe(i)
    expect(ui.state.focusedSection).toBe("ov.range")
  }
  await arrow(t, "right")
  expect(ui.state.dashChipCursor).toBe(CUSTOM_CHIP)
  for (let i = chipCount() - 2; i >= 0; i--) {
    await arrow(t, "left")
    expect(ui.state.dashChipCursor).toBe(i)
    expect(ui.state.focusedSection).toBe("ov.range")
  }
  await arrow(t, "left")
  expect(ui.state.dashChipCursor).toBe(0)
  handleKey(ui, keyEvent("h"), data)
  expect(ui.state.dashChipCursor).toBe(CUSTOM_CHIP)
  handleKey(ui, keyEvent("l"), data)
  expect(ui.state.dashChipCursor).toBe(0)
  await arrow(t, "down")
  expect(ui.state.focusedSection).toBe("ov.chart")
})

test("focused bar tabs and web item paint chipLook fg/bg and bold", async () => {
  const t = await overview()
  web.setServing({ page: "http://localhost/", clients: 0 })
  for (const [id, label, active] of [["bar.overview", " Overview ", true], ["bar.manager", " Transactions ", false], ["bar.web", "web app", false]] as const) {
    ui.setState({ focusedSection: id })
    await t.renderOnce()
    const span = t.captureSpans().lines[0]!.spans.find((s) => s.text.includes(label))!
    const look = chipLook({ active, cursor: true })
    expect(span.fg.toInts()).toEqual(RGBA.fromHex(look.fg).toInts())
    expect(span.bg.toInts()).toEqual(RGBA.fromHex(look.bg!).toInts())
    expect(span.attributes & TextAttributes.BOLD).toBe(TextAttributes.BOLD)
  }
})

test("Accounts click selects the row through the same action as j/k and a dialog blocks it", async () => {
  const t = await overview()
  ui.switchTab("manager")
  data.setState({ accounts: [account({ id: 1, name: "First" }), account({ id: 2, name: "Second" })], accountSelection: "all" })
  await t.renderOnce()
  const lines = t.captureCharFrame().split("\n")
  const y = lines.findIndex((line) => line.includes("Second"))
  const x = lines[y]!.indexOf("Second")
  ui.setState({ managerCursor: 2, selectedIds: { 1: true } })
  await t.mockMouse.click(x, y)
  await t.renderOnce()
  expect(ui.state.focusedSection).toBe("mgr.accounts")
  expect(data.state.accountSelection).toBe(2)
  expect(ui.state.managerCursor).toBe(0)
  expect(ui.state.selectedIds).toEqual({})
  handleKey(ui, keyEvent("k"), data)
  expect(data.state.accountSelection).toBe(1)
  handleKey(ui, keyEvent("k", { ctrl: true }), data)
  await t.renderOnce()
  await t.mockMouse.click(x, y)
  expect(data.state.accountSelection).toBe(1)
})

test("webLabel covers absent, idle, singular and plural serving state", () => {
  expect(webLabel(null)).toBe("")
  expect(webLabel({ page: "x", clients: 0 })).toBe("web app")
  expect(webLabel({ page: "x", clients: 1 })).toBe("1 web client")
  expect(webLabel({ page: "x", clients: 2 })).toBe("2 web clients")
})

test("table wheel moves three rows after Escape closes the detail", async () => {
  const t = await overview()
  ui.switchTab("manager")
  data.setState({ transactions: Array.from({ length: 20 }, (_, id) => transaction({ id, description: `Row ${id}` })) })
  await t.renderOnce()
  const rect = regionRects("manager").find((r) => r.id === "mgr.transactions")!.rect
  ui.setState({ managerCursor: 3 })
  ui.setState({ detail: { id: data.scopedTransactions()[3]!.id, boughtTop: 0, notes: null } })
  await t.renderOnce()
  t.mockInput.pressEscape()
  // Bare Escape waits for OpenTUI to distinguish it from an escape sequence.
  await Bun.sleep(100)
  await t.renderOnce()
  expect(ui.state.detail).toBeNull()
  const before = ui.state.managerCursor
  await t.mockMouse.scroll(rect.x + 40, rect.y + 5, "down")
  await t.renderOnce()
  expect(ui.state.managerCursor).toBe(before + 3)
})

test("Overview mouse focuses from the bar, scrolls Categories one line and applies a chip", async () => {
  const t = await overview()
  ui.setState({ focusedSection: "bar.overview", overviewCategoryCursor: 0 })
  const categories = regionRects("overview").find((r) => r.id === "ov.categories")!.rect
  await t.mockMouse.click(categories.x + 2, categories.y)
  await t.renderOnce()
  expect(ui.state.focusedSection).toBe("ov.categories")
  await t.mockMouse.scroll(categories.x + 2, categories.y + 1, "down")
  await t.renderOnce()
  expect(ui.state.overviewCategoryCursor).toBe(1)
  await t.mockMouse.scroll(categories.x + 2, categories.y + 1, "up")
  await t.renderOnce()
  expect(ui.state.overviewCategoryCursor).toBe(0)
  const lines = t.captureCharFrame().split("\n")
  const y = lines.findIndex((line) => line.includes("3M"))
  await t.mockMouse.click(lines[y]!.indexOf("3M"), y)
  await t.renderOnce()
  expect(ui.state.focusedSection).toBe("ov.range")
  expect(ui.state.timeframe.lookback).toBe("3M")
  ui.setState({ focusedSection: "ov.accounts" })
  handleKey(ui, keyEvent("return"), data)
  expect(ui.state.activeTab).toBe("manager")
  expect(ui.state.focusedSection).toBe("mgr.accounts")
})

test("KeptTab regions stay mounted but cannot be targets while hidden", async () => {
  const t = await overview()
  expect(regionRects("overview").some((r) => r.id === "ov.range")).toBe(true)
  ui.switchTab("manager")
  await t.renderOnce()
  expect(regionRects("overview").every((r) => r.id.startsWith("bar."))).toBe(true)
  expect(regionRects("manager").some((r) => r.id === "mgr.accounts")).toBe(true)
  ui.switchTab("overview")
  await t.renderOnce()
  expect(regionRects("manager").every((r) => r.id.startsWith("bar."))).toBe(true)
  expect(regionRects("overview").some((r) => r.id === "ov.range")).toBe(true)
})

test("a click on any column of a Date Range chip chooses that chip: each chip is its own text", async () => {
  for (const width of [160, 110, 84]) {
    ui.switchTab("overview")
    const t = await renderApp({ width, height: 40 })
    try {
      setAppClock(new Date(2026, 9, 20, 12))
      data.setState({ accounts: [account()], categories: [category({ id: 10 })], transactions: [transaction({ id: 1, categoryId: 10 })], icons: false })
      ui.setTimeframe({ ...ui.state.timeframe, family: "lookback", lookback: "1M" })
      await t.renderOnce()
      const y = regionRects("overview").find((r) => r.id === "ov.range")!.rect.y + 1
      // Each chip is " label ": its first column is the space before. Read
      // from what's drawn now: a chosen range changes the text beside the
      // chips, and with it their spacing.
      const labels = ["1M", "2M", "3M", "6M", "1Y", "Cycle", "Month", "QTR", "Half", "FY", "Year", "Custom"]
      expect(labels.length).toBe(CUSTOM_CHIP + 1)
      const chipAt = (index: number) => {
        const row = t.captureCharFrame().split("\n")[y]!
        let at = -1
        for (const label of labels.slice(0, index + 1)) at = row.indexOf(label, at + 1)
        return { first: at - 1, last: at + labels[index]!.length }
      }
      for (const index of labels.keys()) {
        for (const end of ["first", "last"] as const) {
          // Custom opens its dates dialog, which then owns the mouse.
          ui.setState({ customEdit: null })
          ui.setDashChipCursor(0)
          await t.renderOnce()
          const x = chipAt(index)[end]
          await t.mockMouse.click(x, y)
          await t.renderOnce()
          expect({ width, x, cursor: ui.state.dashChipCursor }).toEqual({ width, x, cursor: index })
          expect(ui.state.focusedSection).toBe("ov.range")
        }
      }
    } finally { t.renderer.destroy() }
  }
})

test("a click on the Date Range's [ or ] steps the range, as the keys do; a lookback stays one, saying how far back", async () => {
  const t = await overview()
  const y = regionRects("overview").find((r) => r.id === "ov.range")!.rect.y + 1
  const row = () => t.captureCharFrame().split("\n")[y]!
  const dates = () => /\[ (.+) \]/.exec(row())![1]
  const was = dates()
  await t.mockMouse.click(row().lastIndexOf("["), y)
  await t.renderOnce()
  expect(ui.state.timeframe).toMatchObject({ family: "lookback", lookback: "1M", lookbackOffset: -1 })
  expect(row()).toContain("1 month back · 0 now")
  expect(dates()).not.toBe(was)
  await t.mockMouse.click(row().lastIndexOf("]"), y)
  await t.renderOnce()
  expect(ui.state.timeframe.lookbackOffset).toBe(0)
  expect(row()).not.toContain("back")
  expect(dates()).toBe(was)
})
