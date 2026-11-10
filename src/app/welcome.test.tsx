import { expect, onTestFinished, spyOn, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { ui } from "../state/uiStore"
import { data } from "../state/dataStore"
import { renderApp } from "../testing/app"
import { key } from "../testing/keys"
import { ink } from "../theme"
import { welcomeRows, type WelcomeContext } from "../state/welcome"
import { handleKey, handlePaste } from "./keys"
import { openWelcome, sources } from "./welcome"

const none: WelcomeContext = { up: false, openrouter: false, openai: false, jev: false, jevKey: false, clairic: false, executor: false }
const press = (...names: Array<string | [string, { ctrl?: boolean; shift?: boolean }]>) => {
  for (const n of names) handleKey(ui, typeof n === "string" ? key(n) : key(n[0], n[1]), data)
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 5))
const skipTour = () => press("down", "return")

function fakeSaving() {
  const saved: unknown[] = []
  const save = spyOn(data, "saveApiKeys").mockImplementation(async (patch) => { saved.push(patch) })
  const seen = spyOn(data, "setWelcomed").mockImplementation(async () => {})
  onTestFinished(() => { save.mockRestore(); seen.mockRestore() })
  return { saved, seen }
}

test("an Up token is pasted and never drawn; it's saved only when Up answers it; its accounts are chosen, then the first sync starts without the ones switched off", async () => {
  const { saved } = fakeSaving()
  const t = await renderApp({ width: 130, height: 44 })
  openWelcome(ui)
  skipTour()
  await t.renderOnce()
  const hint = t.captureSpans().lines.flatMap((l) => l.spans).find((s) => s.text === "paste it here")!
  expect(hint.fg.toInts()).toEqual(RGBA.fromHex(ink.faint).toInts())
  expect(handlePaste(ui, "up:yeah:secret-token-9f3a\n", data)).toBe(true)
  await t.renderOnce()
  const frame = t.captureCharFrame()
  expect(frame).toContain("Token  ••••")
  expect(frame).not.toContain("9f3a")
  expect(frame).not.toContain("secret-token")
  expect(frame).not.toContain("up:yeah")

  const accounts = spyOn(sources, "upAccounts").mockRejectedValueOnce(new Error("Up token is invalid or expired"))
  onTestFinished(() => accounts.mockRestore())
  press("return")
  await settle()
  expect(saved).toEqual([])
  expect(ui.state.welcome?.note).toEqual({ text: "Up didn't accept it: Up token is invalid or expired.", ok: false })
  expect(ui.state.welcome?.token.value).toBe("up:yeah:secret-token-9f3a")

  const up = (id: string, name: string, type: string, ownership: string) => ({ id, name, type, ownership, on: true })
  accounts.mockResolvedValueOnce([up("s", "Spending", "TRANSACTIONAL", "INDIVIDUAL"), up("j", "2Up Spending", "TRANSACTIONAL", "JOINT"),
    up("h", "🏖️ Holiday", "SAVER", "INDIVIDUAL"), up("t", "🏠 House", "SAVER", "JOINT"), up("e", "🚨 Emergency", "SAVER", "INDIVIDUAL")])
  const synced = spyOn(data, "syncUp").mockResolvedValue("Up sync: 0 new")
  onTestFinished(() => synced.mockRestore())
  press("return")
  await settle()
  expect(accounts).toHaveBeenLastCalledWith("up:yeah:secret-token-9f3a")
  expect(saved).toEqual([{ JASKMONEY_UP_TOKEN: "up:yeah:secret-token-9f3a" }])
  expect(ui.state.welcome?.token.value).toBe("")
  data.setState({ upToken: true })
  const rows = () => welcomeRows(ui.state.welcome!, { ...none, up: true }).filter((r) => r.action === "account").map((r) => `${r.syncs ? "●" : "○"} ${r.label} · ${r.detail}`)
  expect(rows()).toEqual(["● Spending · will sync", "●   🏖️ Holiday · will sync", "●   🚨 Emergency · will sync", "● 2Up Spending · will sync", "●   🏠 House · will sync"])
  expect(synced).not.toHaveBeenCalled()
  expect(welcomeRows(ui.state.welcome!, { ...none, up: true })[ui.state.welcome!.cursor]!.label).toBe("Continue")
  ui.setState("welcome", { cursor: 3 }); press("return")
  expect(rows()).toEqual(["● Spending · will sync", "●   🏖️ Holiday · will sync", "●   🚨 Emergency · will sync", "○ 2Up Spending · won't sync", "○   🏠 House · won't sync"])
  ui.setState("welcome", { cursor: 4 }); press("space")
  expect(rows()[3]).toBe("● 2Up Spending · will sync")
  ui.setState("welcome", { cursor: 3 }); press("return")
  ui.setState("welcome", { cursor: 2 }); press("return")
  ui.setState("welcome", { cursor: 5 })
  expect(welcomeRows(ui.state.welcome!, { ...none, up: true })[5]!.label).toBe("Continue")
  press("return")
  await settle()
  expect(ui.state.welcome?.step).toBe("ai")
  expect(synced).toHaveBeenCalledTimes(1)
  expect(synced.mock.calls[0]![0]!.sort()).toEqual(["e", "j", "t"])
  press(["n", { ctrl: true }])
  ui.setState("welcome", { step: "up", cursor: 5 }); press("return")
  await settle()
  expect(synced).toHaveBeenCalledTimes(1)
  data.setState({ upToken: false })
  ui.switchTab("overview")
})
