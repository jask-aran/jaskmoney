import { expect, test } from "bun:test"
import { data } from "../../state/dataStore"
import { ui } from "../../state/uiStore"
import { renderApp } from "../../testing/app"

const settle = async (t: Awaited<ReturnType<typeof renderApp>>) => { await t.renderOnce(); await t.renderOnce() }

test("the Taxonomy list fits its pane: its footer is a line of its own below the rows", async () => {
  const t = await renderApp({ width: 120, height: 30 })
  data.init(":memory:")
  for (let i = 0; i < 30; i++) data.createSettingsCategory({ name: `Category ${String(i).padStart(2, "0")}`, color: "#94e2d5" })
  ui.switchTab("settings")
  ui.setState({ focusedSection: "set.categories", settingsActive: false })
  await settle(t)
  const lines = t.captureCharFrame().split("\n")
  const footer = lines.findIndex((line) => /─ 1–\d+ of \d+ ─/.test(line))
  expect(footer).toBeGreaterThan(0)
  const shown = Number(/─ 1–(\d+) of/.exec(lines[footer]!)![1])
  expect(shown).toBe(ui.state.categoryVisible)
  // The pane's bottom border is the next line; the rows end just above.
  expect(lines[footer + 1]).toMatch(/^╰─/)
})

test("narrow, the column scrolls to the focused pane and to the cursor row of a long Rules list", async () => {
  const t = await renderApp({ width: 70, height: 30 })
  data.init(":memory:")
  data.saveSavedFilter({ id: "f", name: "F", expr: "desc:x" })
  for (let i = 1; i <= 25; i++) data.createSettingsRule({ name: `Rule number ${i}`, savedFilterId: "f", setCategoryId: null, addTagIds: [], enabled: true })
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
  expect(t.captureCharFrame()).toContain("25. Rule number 25")
  ui.setState({ ruleCursor: 0 })
  await settle(t)
  expect(t.captureCharFrame()).toContain("1. Rule number 1 ")
})
