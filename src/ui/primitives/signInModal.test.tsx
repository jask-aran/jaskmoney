import { afterEach, expect, test } from "bun:test"
import { ui } from "../../state/uiStore"
import { renderApp } from "../../testing/app"

let rendered: Awaited<ReturnType<typeof renderApp>> | undefined
afterEach(() => { rendered?.renderer.destroy(); rendered = undefined; ui.setState({ llmSignIn: null }) })

test("the sign-in modal shows what's happening, the whole address, and the paste field with its caret", async () => {
  rendered = await renderApp({ width: 120, height: 34 })
  const url = "https://auth.openai.com/oauth/authorize?response_type=code&client_id=app_test&redirect_uri=http%3A%2F%2F127.0.0.1%3A1455%2Fauth%2Fcallback&state=abc123"
  ui.setState({ llmSignIn: { provider: "openai", url, message: "Your browser should open; finish signing in there.", paste: { message: "Complete login in your browser, or paste the final redirect URL here:", value: "http://127.0.0.1:1455/x", caret: 23 } } })
  await rendered.renderOnce(); await rendered.flush()
  const frame = rendered.captureCharFrame()
  expect(frame).toContain("Sign in with ChatGPT")
  expect(frame).toContain("Your browser should open; finish signing in there.")
  // The address in full lines of the modal's inner width (74), none lost.
  for (let i = 0; i < url.length; i += 74) expect(frame).toContain(url.slice(i, i + 74))
  expect(frame).toContain("If it didn't open, open this address:")
  expect(frame).toContain("> http://127.0.0.1:1455/x")
  expect(frame).toContain("enter send · esc cancel")
})
