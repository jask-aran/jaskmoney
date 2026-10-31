import { afterEach, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { createFileCredentialStore } from "../../ai/oauthStore"
import { data } from "../../state/dataStore"
import { ui } from "../../state/uiStore"
import { renderApp } from "../../testing/app"
import { theme, tone } from "../../theme"

let rendered: Awaited<ReturnType<typeof renderApp>> | undefined
afterEach(() => { rendered?.renderer.destroy(); rendered = undefined; ui.setState({ aiDialog: null, llmSignIn: null }) })

test("the AI models dialog: status, actions with the cursor, the hint for the action at it; a sign-in shows inside it", async () => {
  rendered = await renderApp({ width: 120, height: 36 })
  await createFileCredentialStore().modify("openrouter", async () => ({ type: "oauth", access: "a", refresh: "", expires: Date.now() + 60_000 }))
  await data.refreshApiKeys()
  ui.switchTab("settings")
  ui.setState({ aiDialog: { row: "openrouter", cursor: 0, field: null, armed: false, note: null, busy: false } })
  await rendered.renderOnce(); await rendered.flush()
  let frame = rendered.captureCharFrame()
  expect(frame).toContain("OpenRouter · general model")
  expect(frame).toContain("Connection  signed in with the browser")
  expect(frame).toContain("Model       meta/muse-spark-1.3-contributor (default) · xhigh effort")
  // What it is: its address and sign-in, its limits and price from pi-ai's catalog, what it answers now.
  expect(frame).toContain("Endpoint    https://openrouter.ai/api/v1 (openai-completions)")
  expect(frame).toContain("Auth        An API key, or the browser sign-in")
  expect(frame).toContain("Price       $0.1 in, $0.2 out per million tokens (pi-ai's catalog)")
  expect(frame).toContain("Used by     Writing rules; Jev's queries (no TypeSafe key)")
  expect(frame).toContain("Sign in again with the browser")
  expect(frame).toContain("Remove the saved key, model and sign-in")
  expect(frame).toContain("the last stays active until you delete it on openrouter.ai")
  // The remove action reads as destructive; the cursor row has the wash.
  const spans = rendered.captureSpans().lines.flatMap((l) => l.spans)
  expect(spans.find((s) => s.text.includes("Sign in again"))!.bg.toInts()).toEqual(RGBA.fromHex(theme.rowCursor).toInts())
  expect(spans.find((s) => s.text.includes("Remove the saved key"))!.fg.toInts()).toEqual(RGBA.fromHex(tone.bad).toInts())

  ui.setState({ llmSignIn: { provider: "openrouter", url: "https://openrouter.ai/auth?callback_url=http%3A%2F%2F127.0.0.1%3A40000%2Fcallback&code_challenge=abc", message: "Your browser should open; finish signing in there.", paste: null } })
  await rendered.renderOnce(); await rendered.flush()
  frame = rendered.captureCharFrame()
  expect(frame).toContain("Your browser should open; finish signing in there.")
  expect(frame).toContain("If it didn't open, open this address:")
  expect(frame).toContain("https://openrouter.ai/auth?callback_url=")
  expect(frame).not.toContain("Sign in again")
  expect(frame).toContain("esc cancel")
})

test("the AI models pane: the models, then the uses with their model (teal when it can run); a use's dialog lines its values up", async () => {
  rendered = await renderApp({ width: 130, height: 45 })
  await createFileCredentialStore().modify("openrouter", async () => ({ type: "oauth", access: "a", refresh: "", expires: Date.now() + 60_000 }))
  await data.refreshApiKeys()
  ui.switchTab("settings")
  ui.activateSettings("ai")
  await rendered.renderOnce(); await rendered.flush()
  let frame = rendered.captureCharFrame()
  expect(frame).toContain("│ Models ")
  expect(frame).toContain("│ Uses ")
  expect(frame).toMatch(/Suggestions {2}Jev \(OpenRouter\)/)
  expect(frame).toMatch(/Rules {8}OpenRouter · meta\/muse-spark-1/)
  const spans = rendered.captureSpans().lines.flatMap((l) => l.spans)
  expect(spans.find((s) => s.text.startsWith("Jev (OpenRouter)"))!.fg.toInts()).toEqual(RGBA.fromHex(theme.teal).toInts())

  ui.setState({ aiUse: { use: "search", cursor: 0, note: null } })
  await rendered.renderOnce(); await rendered.flush()
  frame = rendered.captureCharFrame()
  expect(frame).toContain("Search · AI use")
  // The features it powers, how you reach each, the code; its queries; its model actions.
  expect(frame).toMatch(/Smart search +\? then words +app\/smartSearch\.runSmartSearch/)
  expect(frame).toMatch(/ask: terms +ask:words in any search +app\/ask\.runAsk → data\.askAbout/)
  for (const query of ["Smart search: your words", "Smart search: your categories", "Smart search: words and dates", "ask: judging"]) expect(frame).toContain(query)
  expect(frame).toContain("Connect Clairic… (optional: reads words and dates)")
  // The cursor's query has the wash.
  const rows = rendered.captureSpans().lines.flatMap((l) => l.spans)
  expect(rows.find((s) => s.text.startsWith("Smart search: your words"))!.bg.toInts()).toEqual(RGBA.fromHex(theme.rowCursor).toInts())
  ui.setState({ aiUse: null })
})
