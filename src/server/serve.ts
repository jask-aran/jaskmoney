/**
 * The core to other clients: the web app at /, and the core's protocol
 * (core/protocol) as JSON over a WebSocket at /api. One process owns the
 * database; everything else connects here.
 *
 * Only the loopback address unless asked, and a browser may only connect
 * from this server's own pages (a WebSocket ignores CORS, so any web page
 * could otherwise reach a localhost port). JASKMONEY_SERVER_TOKEN, when set,
 * is required as /api?token=… too.
 */
import type { ServerWebSocket } from "bun"
import index from "../web/index.html"
import type { Core } from "../core/core"
import type { ClientMessage, CoreState, ServerMessage } from "../core/protocol"

export const DEFAULT_PORT = 4417

interface Connection {
  /** Each state slice as this client last got it (JSON). */
  sent: Map<string, string>
  calls: Map<number, AbortController>
}

const send = (ws: ServerWebSocket<Connection>, message: ServerMessage) => ws.send(JSON.stringify(message))

/** A state message with only the slices this client doesn't have yet,
 * built from each slice's JSON (made once per patch, not per client). */
function statePatch(ws: ServerWebSocket<Connection>, slices: Map<string, string>): string | null {
  const parts: string[] = []
  for (const [key, json] of slices) {
    if (ws.data.sent.get(key) === json) continue
    ws.data.sent.set(key, json)
    parts.push(`${JSON.stringify(key)}:${json}`)
  }
  return parts.length ? `{"t":"state","patch":{${parts.join(",")}}}` : null
}

const slicesOf = (patch: Partial<CoreState>) => new Map(Object.entries(patch).map(([key, value]) => [key, JSON.stringify(value ?? null)]))

export function serveCore(core: Core, { port = DEFAULT_PORT, hostname = "127.0.0.1" }: { port?: number; hostname?: string } = {}) {
  const token = process.env.JASKMONEY_SERVER_TOKEN || null
  const connections = new Set<ServerWebSocket<Connection>>()
  // One subscription for every client: each patch is serialised once.
  core.subscribe((patch) => {
    if (!connections.size) return
    const slices = slicesOf(patch)
    for (const ws of connections) {
      const message = statePatch(ws, slices)
      if (message) ws.send(message)
    }
  })

  const commands = core.commands as unknown as Record<string, (params: unknown, cx: unknown) => unknown>

  function call(ws: ServerWebSocket<Connection>, message: Extract<ClientMessage, { t: "call" }>) {
    const { id, method } = message
    if (!Object.hasOwn(commands, method)) return send(ws, { t: "result", id, error: `no such command: ${method}` })
    const abort = new AbortController()
    ws.data.calls.set(id, abort)
    const cx = { progress: (data: unknown) => send(ws, { t: "progress", id, data }), signal: abort.signal }
    // The command's state patches go out (above) as it makes them, so they
    // reach the client before its result.
    Promise.resolve()
      .then(() => commands[method]!(message.params ?? {}, cx))
      .then(
        (value) => send(ws, { t: "result", id, value: value ?? null }),
        (error: unknown) => send(ws, { t: "result", id, error: error instanceof Error ? error.message : String(error) }),
      )
      .finally(() => ws.data.calls.delete(id))
  }

  return Bun.serve<Connection>({
    port,
    hostname,
    routes: { "/": index },
    fetch(req, server) {
      const url = new URL(req.url)
      if (url.pathname !== "/api") return new Response("Not found", { status: 404 })
      const origin = req.headers.get("origin")
      if (origin && new URL(origin).host !== url.host) return new Response("Forbidden", { status: 403 })
      if (token && url.searchParams.get("token") !== token) return new Response("Unauthorized", { status: 401 })
      if (server.upgrade(req, { data: { sent: new Map(), calls: new Map() } })) return undefined
      return new Response("WebSocket only", { status: 426 })
    },
    websocket: {
      open(ws) {
        connections.add(ws)
        const message = statePatch(ws, slicesOf(core.state))
        if (message) ws.send(message)
      },
      message(ws, raw) {
        let message: ClientMessage
        try { message = JSON.parse(String(raw)) } catch { return }
        if (message.t === "cancel") ws.data.calls.get(message.id)?.abort()
        else if (message.t === "call") call(ws, message)
      },
      close(ws) {
        connections.delete(ws)
        for (const abort of ws.data.calls.values()) abort.abort()
      },
    },
  })
}
