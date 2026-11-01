import { expect, onTestFinished, spyOn, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { ui } from "../state/uiStore"
import { data } from "../state/dataStore"
import { renderApp } from "../testing/app"
import { key } from "../testing/keys"
import { tone } from "../theme"
import { ExecutorPaused } from "../ai/executorSetup"
import { emailChecklist, stepMark, tokenShown, welcomeRows, welcomeStart, type WelcomeContext } from "../state/welcome"
import { handleKey, handlePaste } from "./keys"
import { openWelcome, shouldWelcome, sources } from "./welcome"

/**
 * The first-run setup (state/welcome, app/welcome, ui/welcome) — frozen:
 * when it opens by itself, its steps and their keys, that an Up token is
 * never drawn and is only saved once Up answers it, and that email is
 * connected end to end (sign in, add Gmail, approve, check) with a pause
 * or esc said plainly.
 */
const none: WelcomeContext = { up: false, openrouter: false, openai: false, jev: false, jevKey: false, clairic: false, executor: false }
const press = (...names: Array<string | [string, { ctrl?: boolean; shift?: boolean }]>) => {
  for (const n of names) handleKey(ui, typeof n === "string" ? key(n) : key(n[0], n[1]), data)
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 5))
/** From the tour to the Up step: its "Skip the tour" row. */
const skipTour = () => press("down", "return")
const app = { id: "app_1", slug: "gmail", name: "Gmail", requirement: "gmail" }

function fakeSaving() {
  const saved: unknown[] = []
  const save = spyOn(data, "saveApiKeys").mockImplementation(async (patch) => { saved.push(patch) })
  const seen = spyOn(data, "setWelcomed").mockImplementation(async () => {})
  onTestFinished(() => { save.mockRestore(); seen.mockRestore() })
  return { saved, seen }
}

test("it opens by itself only the first time: no Up token, not been through, not demo", () => {
  data.setState({ welcomed: false, upToken: false, demo: false })
  expect(shouldWelcome(data)).toBe(true)
  data.setState({ welcomed: true })
  expect(shouldWelcome(data)).toBe(false)
  data.setState({ welcomed: false, upToken: true })
  expect(shouldWelcome(data)).toBe(false)
  data.setState({ upToken: false, demo: true })
  expect(shouldWelcome(data)).toBe(false)
  data.setState({ demo: false })
})

test("enter starts, s and ctrl+n skip, esc goes back; leaving marks it seen and lands on the Overview", async () => {
  const { seen } = fakeSaving()
  openWelcome(ui)
  expect(ui.activeScope()).toBe("welcome")
  skipTour()
  expect(ui.state.welcome?.step).toBe("up")
  // The token screen types: s is a letter of the token, ctrl+n skips.
  press("s")
  expect(ui.state.welcome?.step).toBe("up")
  expect(ui.state.welcome?.token.value).toBe("s")
  press("backspace", ["n", { ctrl: true }])
  expect(ui.state.welcome?.step).toBe("ai")
  press("s")
  expect(ui.state.welcome?.step).toBe("email")
  press("escape")
  expect(ui.state.welcome?.step).toBe("ai")
  press("s", "s")
  expect(ui.state.welcome?.step).toBe("done")
  press("return")
  expect(ui.state.welcome).toBeNull()
  expect(ui.state.activeTab).toBe("overview")
  expect(seen).toHaveBeenCalledWith(true)
  // esc on the first screen is skipping it all.
  seen.mockClear()
  openWelcome(ui)
  press("escape")
  expect(ui.state.welcome).toBeNull()
  expect(seen).toHaveBeenCalledWith(true)
})

test("an Up token is pasted and never drawn; it's saved only when Up answers it, then the sync starts", async () => {
  const { saved } = fakeSaving()
  const t = await renderApp({ width: 130, height: 44 })
  openWelcome(ui)
  skipTour()
  expect(handlePaste(ui, "up:yeah:secret-token-9f3a\n", data)).toBe(true)
  await t.renderOnce()
  const frame = t.captureCharFrame()
  expect(frame).toContain("9f3a")
  expect(frame).not.toContain("secret-token")
  expect(frame).not.toContain("up:yeah")

  const accounts = spyOn(sources, "upAccounts").mockRejectedValueOnce(new Error("Up token is invalid or expired"))
  onTestFinished(() => accounts.mockRestore())
  press("return")
  await settle()
  expect(saved).toEqual([])
  expect(ui.state.welcome?.note).toEqual({ text: "Up didn't accept it: Up token is invalid or expired.", ok: false })
  expect(ui.state.welcome?.token.value).toBe("up:yeah:secret-token-9f3a")

  accounts.mockResolvedValueOnce(["Spending", "Rainy day"])
  press("return")
  await settle()
  expect(accounts).toHaveBeenLastCalledWith("up:yeah:secret-token-9f3a")
  expect(saved).toEqual([{ JASKMONEY_UP_TOKEN: "up:yeah:secret-token-9f3a" }])
  expect(ui.state.welcome?.upAccounts).toEqual(["Spending", "Rainy day"])
  expect(ui.state.welcome?.token.value).toBe("")
  expect(ui.state.welcome?.note?.ok).toBe(true)
  ui.switchTab("overview")
})

test("email is connected end to end: sign in, add Gmail, approve in the browser, check", async () => {
  fakeSaving()
  const opened: string[] = []
  let approve!: () => void
  const fakes = [
    spyOn(sources, "open").mockImplementation((url) => { opened.push(url) }),
    spyOn(sources, "executorSignedIn").mockReturnValue(false),
    spyOn(sources, "signInExecutor").mockImplementation(async (open) => { open("https://executor.sh/sign-in") }),
    spyOn(sources, "ensureMailApp").mockResolvedValue({ app, installed: true }),
    spyOn(sources, "mailAccount").mockResolvedValue(null),
    spyOn(sources, "connectLink").mockResolvedValue({ url: "https://accounts.google.com/approve" }),
    spyOn(sources, "waitForAccount").mockImplementation(() => new Promise((resolve) => { approve = () => resolve({ label: "me", email: "me@example.com", ready: true }) })),
    spyOn(sources, "countOrders").mockResolvedValue(7),
  ]
  onTestFinished(() => fakes.forEach((f) => f.mockRestore()))
  openWelcome(ui)
  skipTour()
  press(["n", { ctrl: true }], "s")
  expect(ui.state.welcome?.step).toBe("email")
  press("return")
  await settle()
  // Waiting on Google: the approval page opened, the checklist says where it is.
  expect(ui.state.welcome?.email.phase).toBe("approve")
  expect(opened).toEqual(["https://executor.sh/sign-in", "https://accounts.google.com/approve"])
  expect(emailChecklist(ui.state.welcome!, none).map((i) => i.state)).toEqual(["done", "done", "active", "todo"])
  approve()
  await settle()
  expect(ui.state.welcome?.email).toMatchObject({ phase: "done", account: "me@example.com", orders: 7 })
  expect(ui.state.welcome?.note).toEqual({ text: "Gmail connected (me@example.com)", ok: true })
  expect(welcomeRows(ui.state.welcome!, none).map((r) => r.action)).toEqual(["openExecutor", "next"])
  ui.switchTab("overview")
})

test("a step Executor pauses for approval says so; esc stops waiting for the browser", async () => {
  fakeSaving()
  const fakes: Array<{ mockRestore(): void }> = [
    spyOn(sources, "executorSignedIn").mockReturnValue(true),
    spyOn(sources, "ensureMailApp").mockRejectedValueOnce(new ExecutorPaused({ status: "paused", message: "Approve installing Gmail" })),
  ]
  onTestFinished(() => fakes.forEach((f) => f.mockRestore()))
  openWelcome(ui)
  skipTour()
  press(["n", { ctrl: true }], "s", "return")
  await settle()
  expect(ui.state.welcome?.email).toMatchObject({ phase: "failed", failedAt: "install" })
  expect(ui.state.welcome?.note?.text).toBe("Executor is waiting for your approval: Approve installing Gmail. Approve it at executor.sh, then try again.")
  expect(emailChecklist(ui.state.welcome!, { ...none, executor: true }).map((i) => i.state)).toEqual(["done", "failed", "todo", "todo"])

  // Again, this time waiting on Google, then esc.
  fakes.push(
    spyOn(sources, "mailAccount").mockResolvedValue(null),
    spyOn(sources, "connectLink").mockResolvedValue({ url: "https://accounts.google.com/approve" }),
    spyOn(sources, "waitForAccount").mockImplementation((_, signal) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("cancelled"))))),
  )
  ;(sources.ensureMailApp as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({ app, installed: false })
  press("return")
  await settle()
  expect(ui.state.welcome?.email.phase).toBe("approve")
  expect(ui.state.welcome?.busy).toBe("Waiting for you to approve Gmail in your browser…")
  press("escape")
  await settle()
  expect(ui.state.welcome?.step).toBe("email")
  expect(ui.state.welcome?.busy).toBeNull()
  expect(ui.state.welcome?.email.phase).toBe("idle")
  expect(ui.state.welcome?.note).toEqual({ text: "Stopped waiting. Try again when you're ready.", ok: null })
  ui.switchTab("overview")
})

test("the rail ticks a step only when its integration is connected; a token shows its last four", () => {
  const state = { ...welcomeStart(), step: "email" as const }
  expect(stepMark("up", state, none)).toBe("skipped")
  expect(stepMark("up", state, { ...none, up: true })).toBe("done")
  expect(stepMark("ai", state, { ...none, openrouter: true, jev: true })).toBe("done")
  expect(stepMark("email", state, none)).toBe("current")
  expect(stepMark("done", state, none)).toBe("ahead")
  expect(tokenShown("up:yeah:abcdefgh1234")).toBe("••••••••••••••••1234")
  expect(tokenShown("")).toBe("")
})

test("Settings › Up Bank › Setup runs it again", () => {
  ui.switchTab("settings")
  ui.setState({ focusedSection: "set.up", settingsActive: true, settingsSection: "up", upCursor: 3 })
  expect(ui.activeScope()).toBe("settings.up")
  press("return")
  expect(ui.state.welcome?.step).toBe("hello")
  ui.switchTab("overview")
})

test("the tour: ← → between the demos, enter to the next, and from the last on to Up", () => {
  openWelcome(ui)
  expect(ui.state.welcome?.demo).toBe(0)
  press("right", "right")
  expect(ui.state.welcome?.demo).toBe(2)
  press("left")
  expect(ui.state.welcome?.demo).toBe(1)
  press("return", "return")
  expect(ui.state.welcome?.demo).toBe(3)
  expect(welcomeRows(ui.state.welcome!, none).map((r) => r.label)).toEqual(["Connect Up Bank", "Skip setup, open the app"])
  press("right")
  expect(ui.state.welcome?.demo).toBe(3)
  press("return")
  expect(ui.state.welcome?.step).toBe("up")
  ui.switchTab("overview")
})

test("drawn: the title in the brand's pink, the button in pink and bold; the demo is the real table, filtering as it types", async () => {
  const t = await renderApp({ width: 130, height: 44 })
  openWelcome(ui)
  await t.renderOnce()
  const spans = () => t.captureSpans().lines.flatMap((l) => l.spans)
  // The title's first column (the second row's J) is the gradient's start: pink.
  const row = t.captureSpans().lines.find((l) => l.spans.map((s) => s.text).join("").includes("█▄█ █▀█"))!
  const first = row.spans.find((s) => s.text.trim())!
  expect(first.text.trimStart()[0]).toBe("█")
  // Drawn at full colour from the first frame: nothing fades in.
  const button = spans().find((s) => s.text === "Next")!
  expect(button.fg.toInts()).toEqual(RGBA.fromHex(tone.key).toInts())
  expect(button.attributes & 1).toBe(1)
  expect(t.captureCharFrame()).toMatch(/Date\s+Amount\s+Description\s+Category/)
  // A few seconds in, the filter is typed and the table counts what it keeps.
  await new Promise((resolve) => setTimeout(resolve, 1600))
  await t.renderOnce()
  expect(t.captureCharFrame()).toMatch(/Transactions · \d+ of \d+/)
  expect(t.captureCharFrame()).toMatch(/│\s+\/ \w+/)
  ui.switchTab("overview")
})
