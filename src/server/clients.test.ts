import { expect, test } from "bun:test"
import { describeAgent, describeClient } from "./clients"

test("a browser's user agent reads as browser on system", () => {
  expect(describeAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0")).toBe("Edge on Windows")
  expect(describeAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")).toBe("Safari on iOS")
  expect(describeAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0")).toBe("Firefox on macOS")
  expect(describeAgent("Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36")).toBe("Chrome on Android")
  expect(describeAgent("curl/8.5")).toBe("Browser")
})

test("a TUI is Bun's WebSocket; through the tunnel the visitor's address is Cloudflare's header", () => {
  expect(describeClient(1, new Headers({ "user-agent": "Bun/1.3.14" }), "127.0.0.1", 5)).toEqual({ id: 1, kind: "tui", agent: "jaskmoney TUI", address: "127.0.0.1", via: "direct", since: 5 })
  const tunnelled = describeClient(2, new Headers({ "user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/141 Safari/537 Edg/141", "cf-connecting-ip": "203.0.113.7" }), "127.0.0.1", 9)
  expect(tunnelled).toMatchObject({ kind: "web", agent: "Edge on Windows", address: "203.0.113.7", via: "tunnel" })
})
