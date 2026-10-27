import { expect, test } from "bun:test"
import { data } from "../../state/dataStore"
import { ui } from "../../state/uiStore"
import { renderApp } from "../../testing/app"

/** Tabs stay mounted; a hidden Overview holds its charts and catches up
 * when shown again. */
test("the Overview, hidden while the range changes, shows the new range when back", async () => {
  const t = await renderApp({ width: 140, height: 44 })
  data.init(":memory:")
  ui.switchTab("overview")
  ui.setState({ chartViews: [0, 4] })
  ui.setTimeframe({ ...ui.state.timeframe, family: "custom", custom: { start: "2026-03-01", end: "2026-03-31" } })
  await t.renderOnce()
  expect(t.captureCharFrame()).toContain("1 Mar")
  ui.switchTab("manager")
  ui.setTimeframe({ ...ui.state.timeframe, family: "custom", custom: { start: "2026-07-01", end: "2026-07-31" } })
  await t.renderOnce()
  expect(t.captureCharFrame()).not.toContain("1 Jul")
  ui.switchTab("overview")
  await t.renderOnce()
  const frame = t.captureCharFrame()
  expect(frame).toContain("1 Jul")
  expect(frame).not.toContain("1 Mar")
  t.renderer.destroy()
})
