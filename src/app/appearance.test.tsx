import { expect, test } from "bun:test"
import { BoxRenderable, RGBA, ScrollBoxRenderable, TextAttributes, type BaseRenderable } from "@opentui/core"
import { readFileSync, writeFileSync } from "node:fs"
import { APPEARANCE_ROWS, appearanceRow } from "../state/appearanceRows"
import { DATABASE_ROWS, databaseRow } from "../state/databaseRows"
import { data } from "../state/dataStore"
import { loadSettingsConfig, saveSettingsConfig } from "../state/settingsConfig"
import { OPEN_RANGES, OPEN_RANGE_LABELS } from "../domain/timeframe"
import { SETTINGS_SECTIONS, settingsSectionFocus, ui } from "../state/uiStore"
import { renderApp } from "../testing/app"
import { key } from "../testing/keys"
import { ink, theme } from "../theme"
import { CHART_LABEL_MODES, CHART_SPEEDS, DEFAULT_CHART_SPEED } from "../ui/charts/motion"
import { BACKDROPS, DEFAULT_BACKDROP } from "../ui/welcome/backdrop"
import { handleKey, paletteList } from "./keys"

// Approved port deviation: Appearance owns display rows; Database keeps week start.
test("Appearance shows eight rows and values without clipping at each settings layout", async () => {
  data.init(":memory:")
  for (const width of [140, 96, 70]) {
    ui.switchTab("settings")
    ui.setState({ settingsActive: false, focusedSection: "set.categories", appearanceCursor: 0 })
    const t = await renderApp({ width, height: 44 })
    try {
      await t.renderOnce()
      ui.activateSettings("appearance")
      await t.renderOnce()
      await t.flush()
      const frame = t.captureCharFrame()
      const expected = [
        ["Theme", "Jaskmoney"], ["Category icons", "on (Nerd Font)"], ["Charts' $0 line", "off"],
        ["Chart animation", "first launch"], ["Animation speed", "quick"],
        ["Chart labels", "together"], ["Range on open", "1M"], ["Welcome backdrop", "ticker tape"],
      ]
      const positions = expected.map(([label, value]) => {
        // A toggle's value comes after its on/off dot.
        expect(frame).toMatch(new RegExp(`${label!.replace("$", "\\$")}\\s+(?:[●○] )?${value!.replace(/[()]/g, "\\$&")}`))
        return frame.indexOf(label!)
      })
      expect(positions).toEqual([...positions].sort((a, b) => a - b))
      if (width === 140) expect(frame.indexOf("Appearance")).toBeLessThan(frame.indexOf("Database & Import"))
      const spans = () => t.captureSpans().lines.flatMap((line) => line.spans)
      // The row's icon shares the label's style, so the two may be one span.
      const label = () => spans().find((span) => /(^|\s)Theme /.test(span.text))!
      expect(label().fg.toInts()).toEqual(RGBA.fromHex(ink.label).toInts())
      expect(label().bg.toInts()).toEqual(RGBA.fromHex(theme.rowCursor).toInts())
      expect(label().attributes & TextAttributes.BOLD).toBe(TextAttributes.BOLD)
      t.mockInput.pressKey("j")
      await t.renderOnce()
      expect(ui.state.appearanceCursor).toBe(1)
      expect(label().bg.toInts()).toEqual(RGBA.fromHex(theme.canvas).toInts())
      expect(label().attributes & TextAttributes.BOLD).toBe(0)
      const value = spans().filter((span) => span.text.includes("Jaskmoney")).at(-1)!
      expect(value.fg.toInts()).toEqual(RGBA.fromHex(ink.figure).toInts())
      t.mockInput.pressEscape()
      await Bun.sleep(100)
      await t.renderOnce()
      expect(ui.activeScope()).toBe("settings")
      expect(ui.state.appearanceCursor).toBe(1)
    } finally { t.renderer.destroy() }
  }
})

test("Appearance enter changes every row, persists choices and reports status", async () => {
  data.init(":memory:")
  ui.switchTab("settings")
  ui.activateSettings("appearance")
  const t = await renderApp({ width: 140, height: 44 })
  const path = process.env.JASKMONEY_CONFIG!
  const enter = async (row: typeof APPEARANCE_ROWS[number]) => {
    ui.setState({ appearanceCursor: APPEARANCE_ROWS.indexOf(row) })
    t.mockInput.pressEnter()
    await t.renderOnce()
  }
  try {
    await t.renderOnce()
    await enter("icons")
    expect(data.state.icons).toBe(false)
    expect(ui.state.status).toBe("Category icons off")
    expect(loadSettingsConfig(path).icons).toBe(false)
    await enter("icons")
    expect(data.state.icons).toBe(true)
    expect(ui.state.status).toBe("Category icons on (needs a Nerd Font)")
    await enter("xAxis")
    expect(data.state.uiPrefs.xAxis).toBe(true)
    expect(ui.state.status).toBe("Charts draw an x-axis line")
    expect(loadSettingsConfig(path).ui?.xAxis).toBe(true)
    await enter("xAxis")
    expect(ui.state.status).toBe("Charts without an x-axis line")
    await enter("chartMotion")
    expect(data.state.uiPrefs.chartMotion).toBe("always")
    expect(ui.state.status).toBe("Charts draw in every time")
    await enter("chartMotion")
    expect(ui.state.status).toBe("Charts don't draw in")
    await enter("chartMotion")
    expect(ui.state.status).toBe("Charts draw in once, at launch")
    const current = CHART_SPEEDS.findIndex((speed) => speed.id === DEFAULT_CHART_SPEED)
    for (let step = 1; step <= CHART_SPEEDS.length; step++) {
      const speed = CHART_SPEEDS[(current + step) % CHART_SPEEDS.length]!
      await enter("chartSpeed")
      expect(data.state.uiPrefs.chartSpeed).toBe(speed.id)
      expect(ui.state.status).toBe(`Animation speed: ${speed.label}`)
    }
    for (const [mode, label] of [["sequential", "in order"], ["together", "together"]] as const) {
      await enter("chartLabels")
      expect(data.state.uiPrefs.chartLabels).toBe(mode)
      expect(loadSettingsConfig(path).ui?.chartLabels).toBe(mode)
      expect(ui.state.status).toBe(`Chart labels appear ${label}`)
      expect(t.captureCharFrame()).toMatch(new RegExp(`Chart labels\\s+${label}`))
    }
    for (let step = 1; step <= OPEN_RANGES.length; step++) {
      const openRange = OPEN_RANGES[step % OPEN_RANGES.length]!
      await enter("openRange")
      expect(data.state.uiPrefs.openRange).toBe(openRange)
      expect(loadSettingsConfig(path).ui?.openRange).toBe(openRange)
      expect(ui.state.status).toBe(`Range on open: ${OPEN_RANGE_LABELS[openRange]}`)
      expect(t.captureCharFrame()).toMatch(new RegExp(`Range on open\\s+${OPEN_RANGE_LABELS[openRange]}`))
    }
    const start = BACKDROPS.findIndex((entry) => entry.id === DEFAULT_BACKDROP)
    for (let step = 1; step <= BACKDROPS.length; step++) {
      const backdrop = BACKDROPS[(start + step) % BACKDROPS.length]!
      await enter("backdrop")
      expect(data.state.uiPrefs.backdrop).toBe(backdrop.id)
      expect(loadSettingsConfig(path).ui?.backdrop).toBe(backdrop.id)
      expect(ui.state.status).toBe(`Welcome backdrop: ${backdrop.label}`)
      expect(t.captureCharFrame()).toMatch(new RegExp(`Welcome backdrop\\s+${backdrop.label}`))
    }
  } finally { t.renderer.destroy() }
})

test("Appearance preferences save/load known values and discard unknown values", () => {
  const path = process.env.JASKMONEY_CONFIG!
  for (const chartLabels of CHART_LABEL_MODES) {
    for (const backdrop of BACKDROPS) {
      const prefs = { chartLabels, backdrop: backdrop.id }
      saveSettingsConfig({ version: 2, savedFilters: [], importProfiles: [], ui: prefs }, path)
      expect(loadSettingsConfig(path).ui).toEqual(prefs)
    }
  }
  for (const openRange of OPEN_RANGES) {
    saveSettingsConfig({ version: 2, savedFilters: [], importProfiles: [], ui: { openRange } }, path)
    expect(loadSettingsConfig(path).ui).toEqual({ openRange })
  }
  for (const value of ["unknown", "", "in order", "coin rain", null, false, 12, {}, []]) {
    writeFileSync(path, JSON.stringify({ version: 2, ui: { chartLabels: value, openRange: value, backdrop: value } }))
    expect(loadSettingsConfig(path).ui).toEqual({})
    // @ts-expect-error Exercise malformed runtime input at the settings write boundary.
    saveSettingsConfig({ version: 2, savedFilters: [], importProfiles: [], ui: { chartLabels: value, openRange: value, backdrop: value } }, path)
    expect(readFileSync(path, "utf8")).not.toContain('"chartLabels"')
    expect(readFileSync(path, "utf8")).not.toContain('"backdrop"')
    expect(readFileSync(path, "utf8")).not.toContain('"openRange"')
  }
  expect(appearanceRow("chartLabels", { icons: true }).value).toBe("together")
  expect(appearanceRow("openRange", { icons: true }).value).toBe("1M")
  expect(appearanceRow("backdrop", { icons: true }).value).toBe("ticker tape")
})

test("Database keeps only data rows and week start", () => {
  expect(DATABASE_ROWS).toEqual(["import", "history", "profiles", "weekStart", "demo", "clearData", "reset"])
  const labels = DATABASE_ROWS.map((row) => databaseRow(row, { weekStart: "monday", profiles: 1, demo: false }).label)
  for (const row of APPEARANCE_ROWS) expect(labels).not.toContain(appearanceRow(row, { icons: true }).label)
})

test("Appearance is reachable through section navigation, jump, pointer and palette", async () => {
  data.init(":memory:")
  ui.switchTab("settings")
  ui.setState({ settingsSection: "ai", focusedSection: "set.ai" })
  handleKey(ui, key("down"), data)
  expect(ui.state.settingsSection).toBe("appearance")
  expect(ui.state.focusedSection).toBe("set.appearance")
  handleKey(ui, key("return"), data)
  expect(ui.activeScope()).toBe("settings.appearance")
  handleKey(ui, key("escape"), data)
  handleKey(ui, key("down"), data)
  expect(ui.state.settingsSection).toBe("database")
  expect(ui.state.focusedSection).toBe("set.database")
  handleKey(ui, key("up"), data)
  expect(ui.state.settingsSection).toBe("appearance")
  expect(ui.state.focusedSection).toBe("set.appearance")
  handleKey(ui, key("v"), data)
  handleKey(ui, key("p"), data)
  expect(ui.activeScope()).toBe("settings.appearance")
  const t = await renderApp({ width: 140, height: 44 })
  try {
    await t.renderOnce()
    await t.flush()
    ui.leaveSettings()
    await t.renderOnce()
    for (let cursor = APPEARANCE_ROWS.length - 1; cursor >= 0; cursor--) {
      const label = appearanceRow(APPEARANCE_ROWS[cursor]!, { icons: true }).label
      const lines = t.captureCharFrame().split("\n")
      const y = lines.findIndex((line) => line.includes(label))
      expect(y).toBeGreaterThan(0)
      await t.mockMouse.click(lines[y]!.indexOf(label), y)
      await t.renderOnce()
      expect(ui.activeScope()).toBe("settings.appearance")
      expect(ui.state.appearanceCursor).toBe(cursor)
      const span = t.captureSpans().lines[y]!.spans.find((span) => span.text.includes(label))!
      expect(span.bg.toInts()).toEqual(RGBA.fromHex(theme.rowCursor).toInts())
      expect(span.attributes & TextAttributes.BOLD).toBe(TextAttributes.BOLD)
    }
    // A click selects; enter changes the selected preference.
    expect(data.state.uiPrefs.backdrop).toBeUndefined()
    ui.setState({ appearanceCursor: APPEARANCE_ROWS.indexOf("chartLabels") })
    ui.setState({ factoryReset: { draft: "", caret: 0, busy: false } })
    const before = ui.state.appearanceCursor
    await t.mockMouse.click(90, 20)
    await t.renderOnce()
    expect(ui.activeScope()).toBe("settings.factoryReset")
    expect(ui.state.appearanceCursor).toBe(before)
    ui.setState({ factoryReset: null })
    let opened = 10000
    const command = (id: string) => {
      ui.setState({ palette: { query: "", cursor: 0, from: ui.activeScope(), opened: ++opened } })
      const entry = paletteList(ui, data).find((item) => item.id === id)!
      ui.setState({ palette: null })
      return entry
    }
    const labels = command("display:chart-labels")
    expect(labels.label).toBe("Chart labels: in order")
    labels.run()
    await t.renderOnce()
    expect(data.state.uiPrefs.chartLabels).toBe("sequential")
    expect(command("display:chart-labels").label).toBe("Chart labels: together")
    const range = command("display:open-range")
    expect(range.label).toBe("Range on open: 3M")
    range.run()
    await t.renderOnce()
    expect(data.state.uiPrefs.openRange).toBe("3M")
    expect(command("display:open-range").label).toBe("Range on open: 6M")
    const backdrop = command("display:backdrop")
    expect(backdrop.label).toBe("Welcome backdrop: plasma")
    backdrop.run()
    await t.renderOnce()
    expect(data.state.uiPrefs.backdrop).toBe("plasma")
    expect(command("display:backdrop").label).toBe("Welcome backdrop: coin rain")
  } finally { t.renderer.destroy() }
})

function paneCards(root: BaseRenderable): BoxRenderable[] {
  return root.getChildren().flatMap((child) => [
    ...(child instanceof BoxRenderable && child.border === true ? [child] : []),
    ...paneCards(child),
  ])
}

test("Settings panes and cursor rows stay inside the viewport at 140x44 and 100x30", async () => {
  data.init(":memory:")
  for (const [width, height] of [[140, 44], [100, 30]] as const) {
    const t = await renderApp({ width, height })
    try {
      ui.switchTab("settings")
      ui.setState({ settingsActive: false, settingsSection: "taxonomy", focusedSection: "set.categories" })
      await t.renderOnce()
      await t.flush()
      for (const section of SETTINGS_SECTIONS) {
        expect(ui.state.settingsSection).toBe(section)
        expect(ui.state.focusedSection).toBe(settingsSectionFocus(section))
        const pane = section === "filters" ? "set.rules" : settingsSectionFocus(section)
        const node = t.renderer.root.findDescendantById(`settings-pane-${pane}`)!
        const card = paneCards(node)[0]!
        expect(card.y).toBeGreaterThanOrEqual(2)
        expect(card.y + card.height).toBeLessThanOrEqual(height - 2)
        const lines = t.captureCharFrame().split("\n")
        expect(lines[card.y]![card.x]).toBe("╭")
        expect(lines[card.y + card.height - 1]![card.x]).toBe("╰")
        // A border visible in text must also have its expected cell style.
        const spans = t.captureSpans().lines[card.y + card.height - 1]!.spans
        expect(spans.some((span) => span.text.includes("╰") && span.attributes === 0)).toBe(true)
        handleKey(ui, key("down"), data)
        await t.renderOnce()
        await t.flush()
      }
      // Travel back from Taxonomy to Database, then Appearance.
      handleKey(ui, key("up"), data)
      handleKey(ui, key("up"), data)
      await t.renderOnce()
      await t.flush()
      expect(ui.state.focusedSection).toBe("set.appearance")
      const lines = t.captureCharFrame().split("\n")
      const y = lines.findIndex((line) => line.includes("Welcome backdrop"))
      expect(y).toBeGreaterThan(2)
      await t.mockMouse.click(lines[y]!.indexOf("Welcome backdrop"), y)
      await t.renderOnce()
      expect(ui.state.appearanceCursor).toBe(APPEARANCE_ROWS.indexOf("backdrop"))
      expect(ui.activeScope()).toBe("settings.appearance")
      const last = t.captureSpans().lines[y]!.spans.find((span) => span.text.includes("Welcome backdrop"))!
      expect(last.bg.toInts()).toEqual(RGBA.fromHex(theme.rowCursor).toInts())
      ui.leaveSettings()
      if (width === 100) {
        // A partly visible pane scrolls when activated. The click must use
        // the row's position before that scroll, not its new position.
        const appearance = t.renderer.root.findDescendantById("settings-pane-set.appearance")!
        let parent = appearance.parent
        while (parent && !(parent instanceof ScrollBoxRenderable)) parent = parent.parent
        expect(parent).toBeInstanceOf(ScrollBoxRenderable)
        if (!(parent instanceof ScrollBoxRenderable)) throw new Error("Appearance needs a scrolling column")
        parent.scrollBy(appearance.y - (height - 4))
        await t.renderOnce()
        const partial = t.captureCharFrame().split("\n")
        const firstRow = partial.findIndex((line) => line.includes("Theme") && line.includes("Jaskmoney"))
        expect(firstRow).toBe(height - 3)
        await t.mockMouse.click(partial[firstRow]!.indexOf("Theme"), firstRow)
        await t.renderOnce()
        expect(ui.state.appearanceCursor).toBe(0)
      }
      ui.leaveSettings()
    } finally { t.renderer.destroy() }
  }
})

test("Settings opens on, and a resize keeps, the focused pane in view, low in a scrolling column", async () => {
  data.init(":memory:")
  const t = await renderApp({ width: 100, height: 40 })
  try {
    ui.switchTab("settings")
    ui.setState({ settingsSection: "database", focusedSection: "set.database" })
    await t.renderOnce()
    await t.flush()
    expect(t.captureCharFrame()).toContain("Clear data")
    for (const height of [24, 18, 30]) {
      t.resize(100, height)
      await t.renderOnce()
      await t.renderOnce()
      expect(t.captureCharFrame()).toContain("Clear data")
    }
    ui.leaveSettings()
  } finally { t.renderer.destroy() }
})
