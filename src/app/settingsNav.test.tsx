import { expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { data } from "../state/dataStore"
import { DATABASE_ROWS } from "../state/databaseRows"
import { categoryRows } from "../state/taxonomyRows"
import { SETTINGS_SECTIONS, ui } from "../state/uiStore"
import { renderApp } from "../testing/app"
import { key } from "../testing/keys"
import { theme } from "../theme"
import type { Category } from "../domain/types"
import { handleKey } from "./keys"

let nextId = 700
const category = (name: string, over: Partial<Category> = {}): Category => ({
  id: nextId++, name, color: "#89b4fa", sortOrder: nextId, isDefault: false, parentId: null, extId: null,
  notSpending: false, income: false, budgetIgnored: false, ...over,
})
function taxonomy(): { income: Category; goodLife: Category } {
  const income = category("Income", { income: true })
  const goodLife = category("Good Life", { extId: "good-life" })
  data.setState({
    categories: [income, category("Salary", { income: true, parentId: income.id }), goodLife, category("Booze", { extId: "booze", parentId: goodLife.id }), category("Hobbies", { extId: "hobbies", parentId: goodLife.id })],
    tags: [{ id: 1, name: "COFFEE", color: "#89b4fa", categoryIds: [], about: null } as never, { id: 2, name: "TRAVEL", color: "#89b4fa", categoryIds: [], about: null } as never],
  })
  return { income, goodLife }
}

test("j/k stop once on each pane: Rules & Filters is one stop, not two", () => {
  data.init(":memory:")
  ui.switchTab("settings")
  ui.setState({ settingsActive: false, settingsSection: "taxonomy", focusedSection: "set.categories" })
  const seen: string[] = []
  for (let i = 0; i < SETTINGS_SECTIONS.length; i++) { seen.push(ui.state.settingsSection); handleKey(ui, key("j"), data) }
  expect(seen).toEqual(["taxonomy", "rules", "up", "web", "ai", "appearance", "database"])
  expect(ui.state.settingsSection).toBe("taxonomy")
  // Back up from Saved filters (where jump f leaves it): one press to the pane above.
  ui.setState({ settingsSection: "filters", focusedSection: "set.filters" })
  handleKey(ui, key("k"), data)
  expect(ui.state.settingsSection).toBe("taxonomy")
  ui.setState({ settingsSection: "filters", focusedSection: "set.filters" })
  handleKey(ui, key("j"), data)
  expect(ui.state.settingsSection).toBe("up")
  // h/l before the panes are drawn: the other column's first pane;
  // nothing further that way.
  handleKey(ui, key("h"), data)
  expect(ui.state.settingsSection).toBe("taxonomy")
  handleKey(ui, key("h"), data)
  expect(ui.state.settingsSection).toBe("taxonomy")
  handleKey(ui, key("l"), data)
  expect(ui.state.settingsSection).toBe("up")
})

test("drawn, h/l go to the pane beside: Web app beside Up Bank, Database beside Appearance", async () => {
  const t = await renderApp({ width: 220, height: 66 })
  data.init(":memory:")
  try {
    ui.switchTab("settings")
    ui.setState({ settingsActive: false, settingsSection: "up", focusedSection: "set.up" })
    await t.renderOnce()
    const go = (name: string) => { handleKey(ui, key(name), data); return ui.state.settingsSection }
    expect(go("l")).toBe("web")
    expect(go("l")).toBe("web")
    expect(go("h")).toBe("up")
    expect(go("h")).toBe("taxonomy")
    ui.setState({ settingsSection: "appearance", focusedSection: "set.appearance" })
    expect(go("l")).toBe("database")
    expect(go("h")).toBe("appearance")
  } finally { t.renderer.destroy() }
})

test("Taxonomy: space opens a group, h from inside closes it; j runs on from the categories into the tags", () => {
  data.init(":memory:")
  const { income, goodLife } = taxonomy()
  ui.switchTab("settings")
  ui.setState({ taxonomyOpen: [] })
  ui.activateSettings("taxonomy", "categories", true)
  const at = () => ui.state.taxonomyList === "tags" ? `tag ${data.state.tags[ui.state.tagCursor]!.name}` : categoryRows(data.state.categories, ui.state.taxonomyOpen)[ui.state.categoryCursor]!.category.name
  expect(at()).toBe("Income")
  handleKey(ui, key("space"), data)
  expect(ui.state.taxonomyOpen).toEqual([income.id])
  handleKey(ui, key("j"), data)
  expect(at()).toBe("Salary")
  handleKey(ui, key("h"), data)
  expect(ui.state.taxonomyOpen).toEqual([])
  expect(at()).toBe("Income")
  // enter on a group opens it too; l opens, h closes, on the group itself.
  handleKey(ui, key("j"), data)
  expect(at()).toBe("Good Life")
  handleKey(ui, key("return"), data)
  expect(ui.state.taxonomyOpen).toEqual([goodLife.id])
  expect(ui.state.settingsEditor).toBeNull()
  handleKey(ui, key("h"), data)
  expect(ui.state.taxonomyOpen).toEqual([])
  handleKey(ui, key("l"), data)
  expect(ui.state.taxonomyOpen).toEqual([goodLife.id])
  // Off the last category, into the tags, and back.
  for (let i = 0; i < 3; i++) handleKey(ui, key("j"), data)
  expect(at()).toBe("tag COFFEE")
  expect(ui.state.focusedSection).toBe("set.tags")
  handleKey(ui, key("k"), data)
  expect(at()).toBe("Hobbies")
  expect(ui.state.focusedSection).toBe("set.categories")
  // e edits any row, a group too; enter edits a leaf.
  handleKey(ui, key("k"), data)
  handleKey(ui, key("k"), data)
  expect(at()).toBe("Good Life")
  handleKey(ui, key("e"), data)
  expect(ui.state.settingsEditor).toMatchObject({ kind: "category", id: goodLife.id })
  ui.closeSettingsEditor()
  handleKey(ui, key("j"), data)
  handleKey(ui, key("return"), data)
  expect(ui.state.settingsEditor).toMatchObject({ kind: "category", id: data.state.categories.find((c) => c.name === "Booze")!.id })
  ui.closeSettingsEditor()
  ui.leaveSettings()
})

test("Rules run on into Saved filters; an empty list still takes a stop, where a adds to it", async () => {
  data.init(":memory:")
  await data.saveSavedFilter({ id: "f", name: "F", expr: "desc:x" })
  ui.switchTab("settings")
  ui.activateSettings("rules")
  expect(data.state.rules.length).toBe(0)
  handleKey(ui, key("j"), data)
  expect(ui.state.settingsSection).toBe("filters")
  expect(ui.state.filterCursor).toBe(0)
  handleKey(ui, key("k"), data)
  expect(ui.state.settingsSection).toBe("rules")
  handleKey(ui, key("a"), data)
  expect(ui.state.settingsEditor?.kind).toBe("rule")
  ui.closeSettingsEditor()
  ui.leaveSettings()
})

test("a click on any pane activates it; on a row, the cursor goes there; on the open group again, it closes", async () => {
  const t = await renderApp({ width: 160, height: 60 })
  data.init(":memory:")
  const { goodLife } = taxonomy()
  try {
    ui.switchTab("settings")
    ui.setState({ settingsActive: false, settingsSection: "taxonomy", focusedSection: "set.categories", taxonomyOpen: [] })
    await t.renderOnce()
    const click = async (text: string) => {
      const lines = t.captureCharFrame().split("\n")
      const y = lines.findIndex((line) => line.includes(text))
      expect(y).toBeGreaterThan(0)
      await t.mockMouse.click(lines[y]!.indexOf(text), y)
      await t.renderOnce()
      return y
    }
    await click("Accounts")
    expect(ui.activeScope()).toBe("settings.up")
    expect(ui.state.upCursor).toBe(2)
    await click("Address")
    expect(ui.activeScope()).toBe("settings.web")
    await click("Executor")
    expect(ui.activeScope()).toBe("settings.ai")
    await click("Weeks start on")
    expect(ui.activeScope()).toBe("settings.database")
    expect(ui.state.databaseCursor).toBe(DATABASE_ROWS.indexOf("weekStart"))
    await click("No saved filters")
    expect(ui.activeScope()).toBe("settings.filters")
    await click("TRAVEL")
    expect(ui.activeScope()).toBe("settings.taxonomy")
    expect(ui.state.taxonomyList).toBe("tags")
    expect(ui.state.tagCursor).toBe(1)
    const y = await click("Good Life")
    expect(ui.state.taxonomyList).toBe("categories")
    expect(ui.state.taxonomyOpen).toEqual([])
    const span = t.captureSpans().lines[y]!.spans.find((span) => span.text.includes("Good Life"))!
    expect(span.bg.toInts()).toEqual(RGBA.fromHex(theme.rowCursor).toInts())
    await click("Good Life")
    expect(ui.state.taxonomyOpen).toEqual([goodLife.id])
    expect(t.captureCharFrame()).toContain("Booze")
    await click("Good Life")
    expect(ui.state.taxonomyOpen).toEqual([])
    ui.leaveSettings()
  } finally { t.renderer.destroy() }
})

test("Import history is a dialog from Database & Import, not a pane", async () => {
  data.init(":memory:")
  const t = await renderApp({ width: 160, height: 66 })
  try {
    ui.switchTab("settings")
    data.setState({ imports: [{ id: 1, filename: "anz-2026-10.csv", rowCount: 312, importedAt: "2026-10-30 09:15:00" }] })
    await t.renderOnce()
    expect(t.captureCharFrame()).not.toContain("Import History")
    expect(t.captureCharFrame()).toMatch(/Import history…\s+1 import/)
    ui.activateSettings("database")
    ui.setState({ databaseCursor: DATABASE_ROWS.indexOf("history") })
    handleKey(ui, key("return"), data)
    await t.renderOnce()
    expect(ui.activeScope()).toBe("settings.importHistory")
    expect(t.captureCharFrame()).toMatch(/anz-2026-10\.csv\s+312 rows/)
    handleKey(ui, key("escape"), data)
    expect(ui.activeScope()).toBe("settings.database")
    ui.leaveSettings()
  } finally { t.renderer.destroy() }
})
