import { expect, test } from "bun:test"
import { ui } from "../../state/uiStore"
import { data } from "../../state/dataStore"
import { renderApp } from "../../testing/app"

test("Settings shows the web app's address and each connected client, as the daemon broadcasts them", async () => {
  ui.switchTab("settings")
  const t = await renderApp({ width: 160, height: 48 })
  await t.renderOnce()
  expect(t.captureCharFrame()).toContain("not serving")
  data.setState({
    server: { page: "http://127.0.0.1:4417/", api: "ws://127.0.0.1:4417/api" },
    clients: [
      { id: 1, kind: "web", agent: "Edge on Windows", address: "203.0.113.7", via: "tunnel", since: Date.UTC(2026, 10, 1, 3, 2) },
      { id: 2, kind: "tui", agent: "jaskmoney TUI", address: "127.0.0.1", via: "direct", since: Date.UTC(2026, 10, 1, 3, 5) },
    ],
  })
  await t.renderOnce()
  const frame = t.captureCharFrame()
  expect(frame).toContain("Web app")
  expect(frame).toContain("http://127.0.0.1:4417/")
  expect(frame).toMatch(/Edge on Windows.*203\.0\.113\.7/)
  expect(frame).toContain("jaskmoney TUI")
  // The top bar counts browsers; the TUI is listed in Settings only.
  expect(frame).toContain("1 web client")
  data.setState({ server: null, clients: [] })
})
