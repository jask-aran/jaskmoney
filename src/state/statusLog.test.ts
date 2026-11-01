import { afterEach, expect, test } from "bun:test"
import { data } from "./dataStore"
import { ui } from "./uiStore"
import { handleKey } from "../app/keys"
import { key } from "../testing/keys"
import { DATABASE_ROWS } from "./databaseRows"

/**
 * The status line reads the latest entry of an append-only log; it holds no
 * state of its own (state/statusLog) — frozen: change the code, not these.
 */
afterEach(() => ui.reset())

test("each status is appended; the line shows the latest; nothing is overwritten", () => {
  const before = ui.state.statusLog.length
  ui.setStatus("Synced")
  ui.setStatus("Up refused one", true)
  expect(ui.state.statusLog.length).toBe(before + 2)
  expect(ui.state.statusLog.at(-2)).toMatchObject({ text: "Synced", level: "info" })
  expect(ui.state.status).toBe("Up refused one")
  expect(ui.state.statusErr).toBe(true)
})

test("a confirm prompt is withdrawn by another key: the line shows what was there before it", () => {
  data.init(":memory:")
  ui.switchTab("settings")
  ui.activateSettings("database")
  ui.setStatus("Before the prompt")
  ui.setState({ databaseCursor: DATABASE_ROWS.indexOf("clearData") })
  handleKey(ui, key("return"), data)
  expect(ui.state.status).toStartWith("Press enter again")
  handleKey(ui, key("k"), data)
  expect(ui.state.armed).toBeNull()
  expect(ui.state.status).toBe("Before the prompt")
  // The log kept both: nothing was erased.
  expect(ui.state.statusLog.some((e) => "text" in e && e.text.startsWith("Press enter again"))).toBe(true)
})
