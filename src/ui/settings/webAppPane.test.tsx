import { expect, test } from "bun:test"
import { ui } from "../../state/uiStore"
import { data } from "../../state/dataStore"
import { renderApp } from "../../testing/app"

test("Settings shows the web app's address and each connected client, as the daemon broadcasts them", async () => {
  ui.switchTab("settings")
  const t = await renderApp({ width: 160, height: 48 })
  await t.renderOnce()
  const idle = t.captureCharFrame().split("\n")
  const at = idle.findIndex((line) => line.includes("not serving · start with --serve"))
  expect(at).toBeGreaterThan(0)
  // The card is its rows: the border comes straight after the last.
  // "│ ○ Address": the card's left border is four cells before the label (its inset and mark).
  expect(idle[at + 1]![idle[at]!.indexOf("Address") - 4]).toBe("╰")
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
  expect(frame).toMatch(/Clients\s+Edge on Windows\s+203\.0\.113\.7 · tunnel · since /)
  expect(frame).toMatch(/jaskmoney TUI\s+127\.0\.0\.1 · since /)
  const lines = frame.split("\n")
  const tui = lines.findIndex((line) => line.includes("jaskmoney TUI"))
  // The label column (9 cells), the mark (2), then the card's "│ ".
  const edge = lines[tui]!.indexOf("jaskmoney TUI") - 9 - 2 - 2
  expect(lines[tui + 1]![edge]).toBe("╰")
  // The top bar counts browsers; the TUI is listed in Settings only.
  expect(frame).toContain("1 web client")
  data.setState({ server: null, clients: [] })
})
