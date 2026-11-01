import { afterEach, expect, test } from "bun:test"
import { ui } from "./uiStore"

/**
 * The dialog machine's two rules (state/uiStore MODALS, Opening) — frozen:
 * change the code, not these.
 */
afterEach(() => ui.reset())

const aiDialog = { row: "jev" as const, cursor: 0, field: null, note: null, busy: false }

test("work that finishes after its dialog closed writes nothing (no fragment comes back)", () => {
  ui.setState({ aiDialog: { ...aiDialog } })
  const opened = ui.opening("aiDialog")
  opened.patch({ busy: true })
  expect(ui.state.aiDialog?.busy).toBe(true)
  ui.setState({ aiDialog: null })
  expect(opened.open).toBe(false)
  opened.patch({ note: { text: "late", ok: true }, busy: false })
  expect(ui.state.aiDialog).toBeNull()
})

test("work writes nothing to another opening of the same dialog", () => {
  ui.setState({ aiDialog: { ...aiDialog } })
  const first = ui.opening("aiDialog")
  ui.setState({ aiDialog: null })
  ui.setState({ aiDialog: { ...aiDialog, row: "workersAi" } })
  first.patch({ note: { text: "late", ok: true } })
  first.close()
  expect(ui.state.aiDialog).toMatchObject({ row: "workersAi", note: null })
})

test("a tab switch closes every dialog, and the first open one owns input", () => {
  ui.switchTab("settings")
  ui.setState({ aiDialog: { ...aiDialog }, executor: { status: null, cursor: 0, busy: null, waiting: null, note: null }, detailId: 3, importStage: "preview" })
  expect(ui.activeScope()).toBe("manager.detail")
  ui.switchTab("overview")
  expect(ui.activeScope()).toBe("overview")
  expect(ui.state).toMatchObject({ aiDialog: null, executor: null, detailId: null, importStage: "none" })
})
