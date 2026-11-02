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
import { armLaunchReveal } from "../charts/motion"

const settle = async (t: Awaited<ReturnType<typeof renderApp>>, ms = 0) => { if (ms) await Bun.sleep(ms); await t.renderOnce(); await t.renderOnce() }
const body = (frame: string) => frame.split("\n").slice(2, -2).join("\n")

test("Chart animation off: even the launch's draw-in is skipped, the chart whole from its first frame", async () => {
  setAppClock(new Date(2026, 10, 20, 12))
  const path = join(mkdtempSync(join(tmpdir(), "jaskmoney-motion-")), "demo.db")
  seedDemoDb(path, generateDemo({ today: "2026-11-20", years: 1 }))
  // Armed before the Overview mounts, as index.tsx does at start.
  armLaunchReveal()
  ui.switchTab("overview")
  const t = await renderApp({ width: 160, height: 46 })
  try {
    data.init(path)
    data.setState("uiPrefs", { chartMotion: "off", chartSpeed: "juicy" })
    data.refresh()
    await settle(t, 50)
    const first = body(t.captureCharFrame())
    await settle(t, 1200)
    expect(body(t.captureCharFrame())).toBe(first)
  } finally { t.renderer.destroy(); setAppClock(null) }
})

test("Settings' backdrop: the chosen one behind the panes, moving only while Settings is in view", async () => {
  const t = await renderApp({ width: 160, height: 60 })
  try {
    data.init(":memory:")
    data.setState("uiPrefs", { backdrop: "plasma" })
    ui.switchTab("settings")
    await settle(t, 200)
    const last = () => t.captureCharFrame().split("\n").at(-4)!
    // The room below the panes: the plasma's marks, moving.
    expect(last()).toMatch(/[·:+=]/)
    const before = last()
    await settle(t, 400)
    expect(last()).not.toBe(before)
    // Another tab: Settings' clock stops (its tab is kept, hidden).
    ui.switchTab("budgets")
    await settle(t, 100)
    ui.switchTab("settings")
    await settle(t)
    const resumed = last()
    ui.switchTab("budgets")
    await settle(t, 400)
    ui.switchTab("settings")
    await t.renderOnce()
    expect(last()).toBe(resumed)
  } finally { t.renderer.destroy(); data.setState("uiPrefs", { backdrop: undefined }) }
})
