import { DATABASE_ROWS } from "../state/databaseRows"
import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { renderApp } from "../testing/app"
import { ui, CHART_VIEWS } from "../state/uiStore"
import { data } from "../state/dataStore"
import { saveSettingsConfig } from "../state/settingsConfig"
import { defaultTimeframe } from "../domain/timeframe"

test("bootstrap-off preserves UI defaults; scoped w updates the hint and calendar cells", async () => {
  const previousPath = process.env.JASKMONEY_CONFIG
  const path = join(mkdtempSync(join(tmpdir(), "jaskmoney-ui-render-")), "settings.json")
  process.env.JASKMONEY_CONFIG = path
  const timeframe = defaultTimeframe(new Date(2026, 9, 26))
  saveSettingsConfig({
    version: 2, savedFilters: [], importProfiles: [],
    ui: { timeframe: { ...timeframe, family: "lookback", lookback: "6M" }, accountSelection: "savers", chartViews: [1, 2] },
  })
  ui.switchTab("overview")
  ui.setTimeframe(timeframe)
  ui.setState({ chartViews: [0, 4] })
  data.setAccountSelection("all")
  const t = await renderApp({ width: 180, height: 50 })
  try {
    await t.renderOnce()
    expect(ui.state.timeframe).toEqual(timeframe)
    expect(ui.state.chartViews).toEqual([0, 4])
    expect(data.state.accountSelection).toBe("all")
    const untouched = readFileSync(path, "utf8")
    ui.setState({ chartViews: [1, 4] })
    await t.renderOnce()
    expect(readFileSync(path, "utf8")).toBe(untouched)

    ui.switchTab("settings")
    ui.activateSettings("database")
    ui.setState({ databaseCursor: DATABASE_ROWS.indexOf("weekStart") })
    await t.renderOnce()
    expect(t.captureCharFrame()).toMatch(/Weeks start on\s+Monday/)
    t.mockInput.pressEnter()
    await t.renderOnce()
    expect(data.state.weekStart).toBe("sunday")
    expect(ui.state.status).toBe("Weeks start on Sunday")
    expect(t.captureCharFrame()).toMatch(/Weeks start on\s+Sunday/)
    t.mockInput.pressEnter()
    await t.renderOnce()
    expect(data.state.weekStart).toBe("monday")
    expect(ui.state.status).toBe("Weeks start on Monday")
    t.mockInput.pressEnter()
    await t.renderOnce()

    ui.setState({ importStage: "path", importPath: "" })
    await t.mockInput.typeText("whl ")
    await t.renderOnce()
    expect(ui.state.importPath).toBe("whl ")
    expect(data.state.weekStart).toBe("sunday")
    t.mockInput.pressBackspace()
    await t.renderOnce()
    expect(ui.state.importPath).toBe("whl")
    ui.cancelImport()

    ui.switchTab("overview")
    ui.setState({ chartViews: [CHART_VIEWS.findIndex((v) => v.view === "Calendar"), 4] })
    await t.renderOnce()
    const weekdaySpans = () => t.captureSpans().lines.flatMap((line) => line.spans)
      .filter((span) => /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s*$/.test(span.text))
    expect(weekdaySpans().map((s) => s.text.trim())).toEqual(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"])
    const sunday = weekdaySpans()[0]!
    expect(sunday.fg.toInts()).toEqual([127, 132, 156, 255])
    expect(sunday.bg.toInts()).toEqual([17, 17, 27, 255])
    expect(sunday.attributes).toBe(0)
    t.mockInput.pressKey("w")
    await t.renderOnce()
    expect(data.state.weekStart).toBe("sunday")
    data.saveUiPrefs({ weekStart: "monday" })
    await t.renderOnce()
    expect(weekdaySpans().map((s) => s.text.trim())).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"])
  } finally {
    t.renderer.destroy()
    process.env.JASKMONEY_CONFIG = previousPath
    data.init(":memory:")
    ui.setState({ chartViews: [0, 4] })
  }
})
