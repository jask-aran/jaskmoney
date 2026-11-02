import { afterEach, expect, test } from "bun:test"
import { createFileCredentialStore } from "../../ai/oauthStore"
import { data } from "../../state/dataStore"
import { ui } from "../../state/uiStore"
import { renderApp } from "../../testing/app"

let rendered: Awaited<ReturnType<typeof renderApp>> | undefined
afterEach(() => { rendered?.renderer.destroy(); rendered = undefined; ui.setState({ aiDialog: null, llmSignIn: null }) })

test("the AI models dialog: its actions, until a sign-in shows inside it instead", async () => {
  // Under 104 columns the dialog is one column, its lines whole.
  rendered = await renderApp({ width: 100, height: 40 })
  await createFileCredentialStore().modify("openrouter", async () => ({ type: "oauth", access: "a", refresh: "", expires: Date.now() + 60_000 }))
  await data.refreshApiKeys()
  ui.switchTab("settings")
  ui.setState({ aiDialog: { row: "openrouter", cursor: 0, field: null, note: null, busy: false } })
  await rendered.renderOnce(); await rendered.flush()
  let frame = rendered.captureCharFrame()
  expect(frame).toContain("OpenRouter")
  expect(frame).toContain("Sign in again")

  ui.setState({ llmSignIn: { provider: "openrouter", url: "https://openrouter.ai/auth?callback_url=http%3A%2F%2F127.0.0.1%3A40000%2Fcallback&code_challenge=abc", message: "Your browser should open; finish signing in there.", paste: null } })
  await rendered.renderOnce(); await rendered.flush()
  frame = rendered.captureCharFrame()
  // A sign-in takes the dialog's place: its address, not the actions.
  expect(frame).toContain("https://openrouter.ai/auth?callback_url=")
  expect(frame).not.toContain("Sign in again")
})

test("Up Bank's dialog: no part of the saved token, anywhere; the steps to make one while there's none; what jaskmoney does with Up beside it", async () => {
  rendered = await renderApp({ width: 140, height: 50 })
  data.init(":memory:")
  ui.switchTab("settings")
  ui.setState({ aiDialog: { row: "up", cursor: 0, field: null, note: null, busy: false } })
  await rendered.renderOnce(); await rendered.flush()
  let frame = rendered.captureCharFrame()
  expect(frame).toContain("Data sharing › Personal Access Token")
  expect(frame).toContain("What jaskmoney does with Up")
  expect(frame).toContain("GET /util/ping")
  const token = "up:yeah:invented0000tail9z7q"
  await data.saveApiKeys({ JASKMONEY_UP_TOKEN: token })
  await rendered.renderOnce(); await rendered.flush()
  frame = rendered.captureCharFrame()
  expect(frame).toContain("key saved here")
  expect(frame).not.toContain("9z7q")
  expect(frame).not.toContain("••••")
  expect(frame).not.toContain("Data sharing › Personal Access Token")
  // The core's state, which every client (the web app too) receives, says only where it's from.
  expect(JSON.stringify(data.state.apiKeys)).not.toContain("9z7q")
  expect(data.state.apiKeys.JASKMONEY_UP_TOKEN).toEqual({ source: "saved", mask: "" })
  await data.saveApiKeys({ JASKMONEY_UP_TOKEN: null })
})
