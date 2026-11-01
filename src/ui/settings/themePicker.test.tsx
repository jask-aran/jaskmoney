import { afterEach, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { data } from "../../state/dataStore"
import { ui } from "../../state/uiStore"
import { renderApp } from "../../testing/app"
import { handleKey } from "../../app/keys"
import { key } from "../../testing/keys"
import { APPEARANCE_ROWS } from "../../state/appearanceRows"
import { applyTheme, themeId } from "../../theme"
import { DEFAULT_THEME, THEMES } from "../../themes"

afterEach(() => applyTheme(DEFAULT_THEME))

async function open() {
  const t = await renderApp({ width: 120, height: 40 })
  data.init(":memory:")
  ui.switchTab("settings")
  ui.activateSettings("appearance")
  ui.setState({ appearanceCursor: APPEARANCE_ROWS.indexOf("theme") })
  handleKey(ui, key("return"), data)
  const frame = async () => { await t.renderOnce(); await t.flush(); return t.captureCharFrame() }
  const canvas = () => t.captureSpans().lines[1]!.spans[0]!.bg.toInts()
  return { t, frame, canvas }
}

test("Appearance › Theme opens a picker listing every theme, the one in use marked", async () => {
  const { frame } = await open()
  expect(ui.activeScope()).toBe("themePicker")
  const f = await frame()
  for (const def of THEMES) expect(f).toContain(def.name)
  expect(f).toMatch(/Jaskmoney\s+■ ■ ■ ■ ■ ■ ■\s+in use/)
  expect(ui.state.themePicker).toEqual({ cursor: 0 })
})

test("moving previews the theme at the cursor across the app; enter keeps and saves it", async () => {
  const { frame, canvas } = await open()
  const nord = THEMES.findIndex((t) => t.id === "nord")
  for (let i = 0; i < nord; i++) handleKey(ui, key("j"), data)
  await frame()
  expect(themeId).toBe("nord")
  expect(canvas()).toEqual(RGBA.fromHex("#21252d").toInts())
  handleKey(ui, key("return"), data)
  await Bun.sleep(20)
  await frame()
  expect(ui.state.themePicker).toBeNull()
  expect(data.state.uiPrefs.theme).toBe("nord")
  expect(themeId).toBe("nord")
})

test("esc, or leaving the tab, puts the saved theme back", async () => {
  const { frame, canvas } = await open()
  handleKey(ui, key("j"), data)
  await frame()
  expect(themeId).toBe(THEMES[1]!.id)
  handleKey(ui, key("escape"), data)
  await frame()
  expect(themeId).toBe(DEFAULT_THEME)
  expect(canvas()).toEqual(RGBA.fromHex("#11111b").toInts())
  expect(data.state.uiPrefs.theme).toBeUndefined()
  // Again, closed by switching tabs.
  handleKey(ui, key("return"), data)
  handleKey(ui, key("j"), data)
  await frame()
  ui.switchTab("overview")
  await frame()
  expect(ui.state.themePicker).toBeNull()
  expect(themeId).toBe(DEFAULT_THEME)
})
