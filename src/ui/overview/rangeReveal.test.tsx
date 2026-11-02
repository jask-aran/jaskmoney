import { expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { data } from "../../state/dataStore"
import { ui } from "../../state/uiStore"
import { renderApp } from "../../testing/app"
import { setAppClock } from "../../domain/days"
import { generateDemo } from "../../domain/demo"
import { seedDemoDb } from "../../db/demoSeed"
import type { ChartMotionMode } from "../charts/motion"

const settle = async (t: Awaited<ReturnType<typeof renderApp>>, ms = 0) => { if (ms) await Bun.sleep(ms); await t.renderOnce(); await t.renderOnce() }

/** The frame just after the Date Range changes, and once any draw-in is over. */
async function afterRangeChange(mode: ChartMotionMode) {
  setAppClock(new Date(2026, 10, 20, 12))
  const path = join(mkdtempSync(join(tmpdir(), "jaskmoney-range-reveal-")), "demo.db")
  seedDemoDb(path, generateDemo({ today: "2026-11-20", years: 1 }))
  ui.switchTab("overview")
  ui.setTimeframe({ ...ui.state.timeframe, family: "lookback", lookback: "3M" })
  const t = await renderApp({ width: 160, height: 46 })
  try {
    data.init(path)
    data.setState("uiPrefs", { chartMotion: mode, chartSpeed: "juicy" })
    data.refresh()
    await settle(t, 1200)
    ui.setTimeframe({ ...ui.state.timeframe, family: "lookback", lookback: "1M" })
    await settle(t, 60)
    const soon = t.captureCharFrame()
    await settle(t, 1200)
    return { soon, done: t.captureCharFrame() }
  } finally { t.renderer.destroy(); setAppClock(null) }
}

test("always: a new Date Range draws the charts in again", async () => {
  const { soon, done } = await afterRangeChange("always")
  expect(soon).not.toBe(done)
})

test("first launch: a new Date Range shows the charts whole at once", async () => {
  const { soon, done } = await afterRangeChange("launch")
  expect(soon).toBe(done)
})
