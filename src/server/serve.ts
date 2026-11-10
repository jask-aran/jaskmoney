import type { ServerWebSocket } from "bun"
import type { Core } from "../core/core"
import { KEYED_SLICES, type ClientMessage, type CoreState, type ServerMessage } from "../core/protocol"

export const DEFAULT_PORT = 4417

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"])
const KEYED = new Set<string>(KEYED_SLICES)

interface Connection {
  sent: Map<string, string>
  entries: Map<string, Map<string, string>>
  rows: Map<string, string>
  order: string
  calls: Map<string | number, AbortController>
}

interface Encoded {
  whole: Map<string, string>
  entries: Map<string, Map<string, string>>
  rows: { byId: Map<string, string>; order: string } | null
}

function createEncoder() {
  const rowJSON = new WeakMap<CoreState["transactions"][number], string>()
  let ids: number[] = [], order = ""
  return function encode(patch: Partial<CoreState>): Encoded {
    const encoded: Encoded = { whole: new Map(), entries: new Map(), rows: null }
    for (const [key, value] of Object.entries(patch)) {
      if (key === "transactions") {
        const rows = value as CoreState["transactions"]
        if (rows.length !== ids.length || rows.some((t, i) => t.id !== ids[i])) {
          ids = rows.map((t) => t.id)
          order = ids.join(",")
        }
        encoded.rows = { byId: new Map(rows.map((t) => {
          let json = rowJSON.get(t)
          if (json === undefined) { json = JSON.stringify(t); rowJSON.set(t, json) }
          return [String(t.id), json]
        })), order }
      } else if (KEYED.has(key)) {
        encoded.entries.set(key, new Map(Object.entries(value as object).map(([k, v]) => [k, JSON.stringify(v)])))
      } else encoded.whole.set(key, JSON.stringify(value ?? null))
    }
    return encoded
  }
}

function changed(before: Map<string, string> | undefined, now: Map<string, string>): { set: string[]; remove: string[] } {
  const set = [...now].filter(([key, json]) => before?.get(key) !== json).map(([key]) => key)
  const remove = before ? [...before.keys()].filter((key) => !now.has(key)) : []
  return { set, remove }
}

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

type Call = Omit<Extract<ClientMessage, { t: "call" }>, "id"> & { id: string | number }
type Reply = (Omit<Extract<ServerMessage, { t: "result" }>, "id"> | Omit<Extract<ServerMessage, { t: "progress" }>, "id">) & { id: Call["id"] }
const send = (ws: ServerWebSocket<Connection>, message: Reply) => ws.send(JSON.stringify(message))

interface ServeOptions {
  port?: number
  hostname?: string
}

export function serveCore(core: Core, { port = DEFAULT_PORT, hostname = "127.0.0.1" }: ServeOptions = {}) {
  const hosts = new Set([...LOOPBACK, hostname])
  const connections = new Set<ServerWebSocket<Connection>>()
  const encode = createEncoder()
  const unsubscribe = core.subscribe((patch) => {
    if (!connections.size) return
    const encoded = encode(patch)
    for (const ws of connections) {
      const message = stateMessage(ws, encoded)
      if (message) ws.send(message)
    }
  })

  const commands = core.commands as unknown as Record<string, (params: unknown, cx: unknown) => unknown>

  function call(ws: ServerWebSocket<Connection>, message: Call) {
    const { id, method } = message
    if (ws.data.calls.has(id)) return send(ws, { t: "result", id, error: "duplicate active call id" })
    if (ws.data.calls.size >= 64) return send(ws, { t: "result", id, error: "too many active calls" })
    if (!Object.hasOwn(commands, method)) return send(ws, { t: "result", id, error: `no such command: ${method}` })
    const abort = new AbortController()
    ws.data.calls.set(id, abort)
    const cx = { progress: (data: unknown) => send(ws, { t: "progress", id, data }), signal: abort.signal }
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
    fetch(req, server) {
      const url = new URL(req.url)
      if (!hosts.has(url.hostname)) return new Response("Misdirected", { status: 421 })
      if (url.pathname !== "/api") return new Response("Not found", { status: 404 })
      if (req.headers.get("origin")) return new Response("Forbidden", { status: 403 })
      if (server.upgrade(req, { data: { sent: new Map(), entries: new Map(), rows: new Map(), order: "", calls: new Map() } })) return undefined
      return new Response("WebSocket only", { status: 426 })
    },
    websocket: {
      open(ws) {
        connections.add(ws)
        const message = stateMessage(ws, encode(core.state))
        if (message) ws.send(message)
      },
      message(ws, raw) {
        let message: unknown
        try { message = JSON.parse(String(raw)) } catch { return }
        if (message === null || typeof message !== "object" || !("t" in message) || typeof message.t !== "string") return
        if (!("id" in message) || (typeof message.id !== "string" && typeof message.id !== "number")) return
        if (message.t === "cancel") ws.data.calls.get(message.id)?.abort()
        else if (message.t === "call" && "method" in message && typeof message.method === "string")
          call(ws, { t: "call", id: message.id, method: message.method, params: "params" in message ? message.params : undefined })
      },
      close(ws) {
        connections.delete(ws)
        for (const abort of ws.data.calls.values()) abort.abort()
      },
    },
  })

  const api = new URL("/api", server.url.href).href.replace(/^http/, "ws")
  return {
    api,
    stop() {
      unsubscribe()
      server.stop(true)
    },
  }
}
