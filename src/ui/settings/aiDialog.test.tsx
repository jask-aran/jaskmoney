import { afterEach, expect, test } from "bun:test"
import { data } from "../../state/dataStore"
import { ui } from "../../state/uiStore"
import { renderApp } from "../../testing/app"

let rendered: Awaited<ReturnType<typeof renderApp>> | undefined
afterEach(() => { rendered?.renderer.destroy(); rendered = undefined; ui.setState({ aiDialog: null, llmSignIn: null }) })

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
  expect(JSON.stringify(data.state.apiKeys)).not.toContain("9z7q")
  expect(data.state.apiKeys.JASKMONEY_UP_TOKEN).toEqual({ source: "saved", mask: "" })
  await data.saveApiKeys({ JASKMONEY_UP_TOKEN: null })
})
