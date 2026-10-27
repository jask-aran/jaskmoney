import { afterEach, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { createFileCredentialStore } from "../../ai/oauthStore"
import { data } from "../../state/dataStore"
import { ui } from "../../state/uiStore"
import { renderApp } from "../../testing/app"
import { theme } from "../../theme"

let rendered: Awaited<ReturnType<typeof renderApp>> | undefined
afterEach(() => { rendered?.renderer.destroy(); rendered = undefined; ui.setState({ aiDialog: null, llmSignIn: null }) })

test("the AI models dialog: status, actions with the cursor, the hint for the action at it; a sign-in shows inside it", async () => {
  rendered = await renderApp({ width: 120, height: 36 })
  await createFileCredentialStore().modify("openrouter", async () => ({ type: "oauth", access: "a", refresh: "", expires: Date.now() + 60_000 }))
  data.refreshApiKeys()
  ui.switchTab("settings")
  ui.setState({ aiDialog: { row: "openrouter", cursor: 0, field: null, armed: false, note: null, busy: false } })
  await rendered.renderOnce(); await rendered.flush()
  let frame = rendered.captureCharFrame()
  expect(frame).toContain("OpenRouter · general model")
  expect(frame).toContain("Connection  signed in with the browser")
  expect(frame).toContain("Model       meta/muse-spark-1.3-contributor (default) · xhigh effort")
  expect(frame).toContain("Used for    writing rules (R, then a) · in use")
  expect(frame).toContain("› Sign in again with the browser")
  expect(frame).toContain("Remove the saved key, model and sign-in")
  expect(frame).toContain("the last stays active until you delete it on openrouter.ai")
  // The remove action reads as destructive.
  const spans = rendered.captureSpans().lines.flatMap((l) => l.spans)
  expect(spans.find((s) => s.text.includes("Remove the saved key"))!.fg.toInts()).toEqual(RGBA.fromHex(theme.error).toInts())

  ui.setState({ llmSignIn: { provider: "openrouter", url: "https://openrouter.ai/auth?callback_url=http%3A%2F%2F127.0.0.1%3A40000%2Fcallback&code_challenge=abc", message: "Your browser should open; finish signing in there.", paste: null } })
  await rendered.renderOnce(); await rendered.flush()
  frame = rendered.captureCharFrame()
  expect(frame).toContain("Your browser should open; finish signing in there.")
  expect(frame).toContain("If it didn't open, open this address:")
  expect(frame).toContain("https://openrouter.ai/auth?callback_url=")
  expect(frame).not.toContain("› Sign in again")
  expect(frame).toContain("esc cancel")
})
