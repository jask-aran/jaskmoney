/**
 * The core to other clients: the web app at / (server/webBuild), and the
 * core's protocol (core/protocol) as JSON over a WebSocket at /api. One
 * process owns the database; everything else connects here.
 *
 * It listens on this machine only, and /api answers only requests
 * addressed to it by a loopback name, and a browser only from this
 * server's own page: a WebSocket ignores CORS, and a DNS-rebound page could
 * otherwise name its own host. There is no token: reaching it from
 * elsewhere (a tunnel) is the tunnel's business, and its own login.
 */
import type { ServerWebSocket } from "bun"
import { FRESH, webBundler } from "./webBuild"
import type { Core } from "../core/core"
import { KEYED_SLICES, type ClientMessage, type CoreState, type ServerMessage } from "../core/protocol"

export const DEFAULT_PORT = 4417

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"])
const KEYED = new Set<string>(KEYED_SLICES)

interface Connection {
  /** Each whole slice as this client last got it (JSON). */
  sent: Map<string, string>
  /** Each keyed slice's entries, and each transaction, as last sent (JSON). */
  entries: Map<string, Map<string, string>>
  rows: Map<string, string>
  order: string
  calls: Map<number, AbortController>
}

/** A patch serialised once for every client: whole slices, keyed slices by
 * entry, transactions by row. */
interface Encoded {
  whole: Map<string, string>
  entries: Map<string, Map<string, string>>
  rows: { byId: Map<string, string>; order: string } | null
}

function encode(patch: Partial<CoreState>): Encoded {
  const encoded: Encoded = { whole: new Map(), entries: new Map(), rows: null }
  for (const [key, value] of Object.entries(patch)) {
    if (key === "transactions") {
      const rows = value as CoreState["transactions"]
      encoded.rows = { byId: new Map(rows.map((t) => [String(t.id), JSON.stringify(t)])), order: rows.map((t) => t.id).join(",") }
    } else if (KEYED.has(key)) {
      encoded.entries.set(key, new Map(Object.entries(value as object).map(([k, v]) => [k, JSON.stringify(v)])))
    } else encoded.whole.set(key, JSON.stringify(value ?? null))
  }
  return encoded
}

/** The keys whose JSON changed since `before` was sent, and the keys gone. */
function changed(before: Map<string, string> | undefined, now: Map<string, string>): { set: string[]; remove: string[] } {
  const set = [...now].filter(([key, json]) => before?.get(key) !== json).map(([key]) => key)
  const remove = before ? [...before.keys()].filter((key) => !now.has(key)) : []
  return { set, remove }
}

/** The state message that brings this client up to date, or null when it is. */
function stateMessage(ws: ServerWebSocket<Connection>, encoded: Encoded): string | null {
  const patch: string[] = [], keyed: string[] = []
  for (const [key, json] of encoded.whole) {
    if (ws.data.sent.get(key) === json) continue
    ws.data.sent.set(key, json)
    patch.push(`${JSON.stringify(key)}:${json}`)
  }
  for (const [slice, now] of encoded.entries) {
    const before = ws.data.entries.get(slice)
    const { set, remove } = changed(before, now)
    ws.data.entries.set(slice, now)
    // The first time, even empty: the client then has the slice.
    if (set.length || remove.length || !before) keyed.push(`${JSON.stringify(slice)}:{"set":{${set.map((key) => `${JSON.stringify(key)}:${now.get(key)}`).join(",")}},"remove":${JSON.stringify(remove)}}`)
  }
  let rows = ""
  if (encoded.rows) {
    const now = encoded.rows.byId
    const { set, remove } = changed(ws.data.rows, now)
    const order = encoded.rows.order !== ws.data.order ? `,"order":[${encoded.rows.order}]` : ""
    ws.data.rows = now
    ws.data.order = encoded.rows.order
    if (set.length || remove.length || order) rows = `,"rows":{"set":[${set.map((id) => now.get(id)).join(",")}],"remove":[${remove.join(",")}]${order}}`
  }
  if (!patch.length && !keyed.length && !rows) return null
  return `{"t":"state","patch":{${patch.join(",")}}${keyed.length ? `,"keyed":{${keyed.join(",")}}` : ""}${rows}}`
}

const send = (ws: ServerWebSocket<Connection>, message: ServerMessage) => ws.send(JSON.stringify(message))

/** A served file: hashed bundles keep forever; the page, the worker, the manifest and icons are asked for fresh. */
function fileResponse(file: { body: Uint8Array; type: string }, fresh: boolean): Response {
  return new Response(file.body, { headers: { "content-type": file.type, "cache-control": fresh ? "no-cache" : "public, max-age=31536000, immutable" } })
}

export interface ServeOptions {
  port?: number
  hostname?: string
  /** How many clients are connected now, on each change. */
  onClients?: (count: number) => void
}

export function serveCore(core: Core, { port = DEFAULT_PORT, hostname = "127.0.0.1", onClients }: ServeOptions = {}) {
  const hosts = new Set([...LOOPBACK, hostname])
  const connections = new Set<ServerWebSocket<Connection>>()
  const bundler = webBundler()
  // One subscription for every client: each patch is serialised once.
  const unsubscribe = core.subscribe((patch) => {
    if (!connections.size) return
    const encoded = encode(patch)
    for (const ws of connections) {
      const message = stateMessage(ws, encoded)
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

  const server = Bun.serve<Connection>({
    port,
    hostname,
    async fetch(req, server) {
      const url = new URL(req.url)
      if (!hosts.has(url.hostname)) return new Response("Misdirected", { status: 421 })
      if (url.pathname !== "/api") {
        if (req.method !== "GET" && req.method !== "HEAD") return new Response("Not found", { status: 404 })
        const page = url.pathname === "/" || url.pathname === "/index.html"
        // The page and the service worker are where a new build shows: either may make it.
        const bundle = await bundler.get(page || url.pathname === "/sw.js")
        if (bundle.error) return new Response(`The web app didn't build:\n\n${bundle.error}`, { status: 500, headers: { "content-type": "text/plain; charset=utf-8" } })
        const path = page ? "/" : url.pathname
        const file = bundle.files.get(path)
        return file ? fileResponse(file, FRESH.has(path)) : new Response("Not found", { status: 404 })
      }
      const origin = req.headers.get("origin")
      if (origin && new URL(origin).host !== url.host) return new Response("Forbidden", { status: 403 })
      if (server.upgrade(req, { data: { sent: new Map(), entries: new Map(), rows: new Map(), order: "", calls: new Map() } })) return undefined
      return new Response("WebSocket only", { status: 426 })
    },
    websocket: {
      open(ws) {
        connections.add(ws)
        onClients?.(connections.size)
        const message = stateMessage(ws, encode(core.state))
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
        onClients?.(connections.size)
        for (const abort of ws.data.calls.values()) abort.abort()
      },
    },
  })

  const page = server.url.href
  return {
    /** The web app. */
    page,
    /** Where clients connect (`--connect`). */
    api: new URL("/api", page).href.replace(/^http/, "ws"),
    stop() {
      unsubscribe()
      server.stop(true)
    },
  }
}
