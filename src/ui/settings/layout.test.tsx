import { expect, test } from "bun:test"
import { data } from "../../state/dataStore"
import { ui } from "../../state/uiStore"
import { RGBA } from "@opentui/core"
import { handleKey } from "../../app/keys"
import type { Category } from "../../domain/types"
import { renderApp } from "../../testing/app"
import { key } from "../../testing/keys"
import { ink, tone } from "../../theme"

const settle = async (t: Awaited<ReturnType<typeof renderApp>>) => { await t.renderOnce(); await t.renderOnce() }

let nextId = 500
const category = (name: string, over: Partial<Category> = {}): Category => ({
  id: nextId++, name, color: "#89b4fa", sortOrder: nextId, isDefault: false, parentId: null, extId: null,
  notSpending: false, income: false, budgetIgnored: false, ...over,
})
/** An invented synced taxonomy: Jaskmoney's Income (its subcategories sorted
 * last) and Transfers, Up's Good Life with twelve under it. */
function taxonomy(): { income: Category; goodLife: Category } {
  const income = category("Income", { income: true })
  const goodLife = category("Good Life", { extId: "good-life" })
  const fun = Array.from({ length: 12 }, (_, i) => category(`Fun ${String(i + 1).padStart(2, "0")}`, { extId: `fun-${i}`, parentId: goodLife.id }))
  data.setState({ categories: [income, category("Transfers", { notSpending: true }), goodLife, ...fun, category("Salary", { income: true, parentId: income.id }), category("Other income", { income: true, parentId: income.id })] })
  return { income, goodLife }
}
const lineOf = (t: Awaited<ReturnType<typeof renderApp>>, text: string) => t.captureCharFrame().split("\n").findIndex((line) => line.includes(text))

test("Taxonomy: Jaskmoney's categories apart from Up's, groups closed with their size, tags below", async () => {
  const t = await renderApp({ width: 160, height: 44 })
  data.init(":memory:")
  const { income, goodLife } = taxonomy()
  ui.switchTab("settings")
  ui.setState({ focusedSection: "set.categories", settingsActive: false, taxonomyOpen: [] })
  await settle(t)
  const frame = t.captureCharFrame()
  expect(frame).toMatch(/Jaskmoney categories 4/)
  expect(frame).toMatch(/Up categories 13/)
  expect(frame).toMatch(/▸ \S+ Income\s+2 subcategories · income/)
  expect(frame).toMatch(/▸ \S+ Good Life\s+12 subcategories/)
  expect(frame).not.toContain("Fun 01")
  expect(frame).not.toContain("Salary")
  expect(lineOf(t, "Tags")).toBeGreaterThan(lineOf(t, "Good Life"))
  // Opened, a group's subcategories sit under it, Salary under Income.
  ui.setState({ taxonomyOpen: [income.id, goodLife.id] })
  await settle(t)
  expect(t.captureCharFrame()).toMatch(/▾ \S+ Income/)
  expect(lineOf(t, "Salary")).toBe(lineOf(t, "Income") + 1)
  expect(lineOf(t, "Fun 12")).toBe(lineOf(t, "Good Life") + 12)
})

test("Settings panes: text one cell in from the border, the title two further, subheadings not the title's pink", async () => {
  const t = await renderApp({ width: 160, height: 66 })
  data.init(":memory:")
  taxonomy()
  ui.switchTab("settings")
  ui.setState({ focusedSection: "set.categories", settingsActive: false })
  await settle(t)
  const lines = t.captureCharFrame().split("\n")
  for (const [title, first] of [["Taxonomy", "Jaskmoney categories"], ["Up Bank", "Token"], ["AI models", "Models"], ["Rules & Filters", "Rules"], ["Appearance", "Theme"], ["Database & Import", "Import a CSV"]] as const) {
    const y = lines.findIndex((line) => line.includes(`── ${title} `))
    const corner = lines[y]!.lastIndexOf("╭", lines[y]!.indexOf(title))
    expect(lines[y]!.indexOf(title) - corner).toBe(4)
    const row = lines.findIndex((line, i) => i > y && line.includes(first))
    expect(lines[row]!.indexOf(first) - corner).toBe(2)
  }
  const y = lines.findIndex((line) => line.includes("Jaskmoney categories"))
  const span = t.captureSpans().lines[y]!.spans.find((span) => span.text.includes("Jaskmoney categories"))!
  expect(span.fg.toInts()).toEqual(RGBA.fromHex(ink.heading).toInts())
  expect(ink.heading).not.toBe(tone.key)
})

test("a long Taxonomy scrolls in its pane, following the cursor, and says there's more", async () => {
  const t = await renderApp({ width: 120, height: 24 })
  data.init(":memory:")
  const { goodLife } = taxonomy()
  ui.switchTab("settings")
  ui.activateSettings("taxonomy", "categories", true)
  ui.setState({ taxonomyOpen: [goodLife.id] })
  await settle(t)
  expect(t.captureCharFrame()).toContain("↓ more")
  for (let i = 0; i < 30; i++) handleKey(ui, key("j"), data)
  await settle(t)
  expect(ui.state.taxonomyList).toBe("tags")
  const frame = t.captureCharFrame()
  expect(frame).toContain("↑ more")
  expect(frame).toContain("Tags")
})

test("narrow, the column scrolls to the focused pane and to the cursor row of a long Rules list", async () => {
  const t = await renderApp({ width: 70, height: 30 })
  data.init(":memory:")
  await data.saveSavedFilter({ id: "f", name: "F", expr: "desc:x" })
  for (let i = 1; i <= 25; i++) await data.createSettingsRule({ name: `Rule number ${i}`, savedFilterId: "f", setCategoryId: null, addTagIds: [], enabled: true })
  ui.switchTab("settings")
  ui.setState({ focusedSection: "set.categories", settingsActive: false })
  await settle(t)
  expect(t.captureCharFrame()).toContain("Taxonomy")
  expect(t.captureCharFrame()).not.toContain("Database & Import")
  ui.setState({ focusedSection: "set.database" })
  await settle(t)
  expect(t.captureCharFrame()).toContain("Database & Import")
  ui.activateSettings("rules")
  ui.setState({ ruleCursor: 24 })
  await settle(t)
  expect(t.captureCharFrame()).toContain("25  Rule number 25")
  ui.setState({ ruleCursor: 0 })
  await settle(t)
  expect(t.captureCharFrame()).toContain(" 1  Rule number 1 ")
})

test("wide, panes sit in pairs of one height and Taxonomy and AI models lay out in two columns", async () => {
  const t = await renderApp({ width: 220, height: 66 })
  data.init(":memory:")
  taxonomy()
  ui.switchTab("settings")
  ui.setState({ focusedSection: "set.categories", settingsActive: false })
  await settle(t)
  const lines = t.captureCharFrame().split("\n")
  const row = (text: string) => lines.findIndex((line) => line.includes(text))
  expect(row("Tags ")).toBe(row("Jaskmoney categories"))
  expect(row("Uses")).toBe(row("Models"))
  expect(row("── Web app")).toBe(row("── Up Bank"))
  expect(row("── Database & Import")).toBe(row("── Appearance"))
  // A pair ends on one line: both bottom corners on the same row.
  const bottom = (title: string) => { const y = row(`── ${title}`); const x = lines[y]!.lastIndexOf("╭", lines[y]!.indexOf(title)); let b = y + 1; while (lines[b]![x] !== "╰") b++; return b }
  expect(bottom("Web app")).toBe(bottom("Up Bank"))
  expect(bottom("Database & Import")).toBe(bottom("Appearance"))
})
