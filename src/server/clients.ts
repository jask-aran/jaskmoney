import type { ConnectedClient } from "../core/protocol"

/**
 * Who a connection is, from its upgrade request: a browser on the web app
 * or a TUI (`--connect`, Bun's WebSocket), where it comes from, and when.
 * Through the tunnel the socket's own address is the local proxy's, so the
 * visitor's comes from Cloudflare's header.
 */
export function describeClient(id: number, headers: Headers, socketAddress: string | null, now: number): ConnectedClient {
  const ua = headers.get("user-agent") ?? ""
  const tunnelled = headers.get("cf-connecting-ip")
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim()
  const tui = /\bBun\//.test(ua) || ua === ""
  return {
    id,
    kind: tui ? "tui" : "web",
    agent: tui ? "jaskmoney TUI" : describeAgent(ua),
    address: tunnelled ?? forwarded ?? socketAddress ?? "unknown",
    via: tunnelled ? "tunnel" : "direct",
    since: now,
  }
}

/** "Edge on Windows" from a browser's user agent; "Browser" when unknown. */
export function describeAgent(ua: string): string {
  const browser = /\bEdg(?:e|A|iOS)?\//.test(ua) ? "Edge"
    : /\bFirefox\/|\bFxiOS\//.test(ua) ? "Firefox"
    : /\bOPR\//.test(ua) ? "Opera"
    : /\bChrome\/|\bCriOS\//.test(ua) ? "Chrome"
    : /\bSafari\//.test(ua) ? "Safari"
    : "Browser"
  const os = /\bWindows\b/.test(ua) ? "Windows"
    : /\b(iPhone|iPad|iPod)\b/.test(ua) ? "iOS"
    : /\bAndroid\b/.test(ua) ? "Android"
    : /\bMac OS X\b|\bMacintosh\b/.test(ua) ? "macOS"
    : /\bCrOS\b/.test(ua) ? "ChromeOS"
    : /\bLinux\b/.test(ua) ? "Linux"
    : null
  return os ? `${browser} on ${os}` : browser
}
