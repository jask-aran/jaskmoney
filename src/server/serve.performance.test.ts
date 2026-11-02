import { expect, onTestFinished, spyOn, test } from "bun:test"
import type { ServerWebSocket, WebSocketHandler } from "bun"
import { createCore } from "../core/core"
import type { ConnectedClient } from "../core/protocol"
import { transaction } from "../testing/fixtures"
import { serveCore } from "./serve"

type SocketData = {
  sent: Map<string, string>
  entries: Map<string, Map<string, string>>
  rows: Map<string, string>
  order: string
  calls: Map<string | number, AbortController>
  client: ConnectedClient
}

/** Capture the handlers: no listener, HTTP request or WebSocket is started. */
function setup() {
  let handlers: WebSocketHandler<SocketData> | undefined
  const listener = spyOn(Bun, "serve").mockImplementation((options) => {
    if ("websocket" in options && options.websocket) handlers = options.websocket as WebSocketHandler<SocketData>
    return { url: new URL("http://127.0.0.1:4417/"), stop() {} } as never
  })
  onTestFinished(() => listener.mockRestore())
  const core = createCore()
  const server = serveCore(core)
  onTestFinished(() => { server.stop(); core.close() })
  if (!handlers) throw new Error("missing WebSocket handlers")
  const websocket = handlers
  let clientId = 0
  function connect() {
    const messages: string[] = []
    const data: SocketData = {
      sent: new Map(), entries: new Map(), rows: new Map(), order: "", calls: new Map(),
      client: { id: ++clientId, kind: "tui", agent: "test", address: "127.0.0.1", via: "direct", since: 0 },
    }
    // Only data and send are used by these handlers.
    const ws = { data, send: (text: string) => { messages.push(text); return text.length } } as ServerWebSocket<SocketData>
    websocket.open?.(ws)
    return { ws, messages, message: (value: unknown) => websocket.message(ws, JSON.stringify(value)) }
  }
  return { core, websocket, connect }
}

const settled = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }

test("row patches carry only what changed, the same bytes for every client", () => {
  const { core, connect } = setup()
  const a = transaction({ id: 1 }), b = transaction({ id: 2 })
  core.set({ transactions: [a, b] })
  const one = connect(), two = connect()
  one.messages.length = two.messages.length = 0
  core.set({ transactions: [a, b] })
  expect(one.messages).toEqual([])
  expect(two.messages).toEqual([])

  const updated = { ...b, notes: 'changed "note"' }
  core.set({ transactions: [a, updated] })
  const expected = `{"t":"state","patch":{},"rows":{"set":[${JSON.stringify(updated)}],"remove":[]}}`
  expect(one.messages).toEqual([expected])
  expect(two.messages).toEqual([expected])
  one.messages.length = two.messages.length = 0
  core.set({ transactions: [updated, a] })
  expect(one.messages).toEqual(['{"t":"state","patch":{},"rows":{"set":[],"remove":[],"order":[2,1]}}'])
  expect(two.messages).toEqual(one.messages)
  one.messages.length = 0
  core.set({ transactions: [updated] })
  expect(one.messages).toEqual(['{"t":"state","patch":{},"rows":{"set":[],"remove":[1],"order":[2]}}'])
  one.messages.length = 0
  core.set({ transactions: [] })
  expect(one.messages).toEqual(['{"t":"state","patch":{},"rows":{"set":[],"remove":[2],"order":[]}}'])
  const late = connect()
  expect(late.ws.data.rows.size).toBe(0)
  expect(late.ws.data.order).toBe("")
})

test("invalid messages are ignored; valid string and number call ids keep progress and results", async () => {
  const { core, connect } = setup()
  const client = connect()
  client.messages.length = 0
  const command = spyOn(core.commands, "judgeAsk").mockImplementation(async (_, cx) => {
    cx.progress([[1, 0.9]])
    return []
  })
  onTestFinished(() => command.mockRestore())
  for (const value of [null, true, 3, "call", [], {}, { t: null }, { t: 3 }, { t: "call" },
    { t: "call", id: {}, method: "judgeAsk" }, { t: "call", id: 1, method: 3 }])
    expect(() => client.message(value)).not.toThrow()
  await settled()
  expect(command).not.toHaveBeenCalled()
  expect(client.messages).toEqual([])
  for (const id of [1, "one"]) {
    client.message({ t: "call", id, method: "judgeAsk", params: { words: "coffee", ids: [1] } })
    await settled()
    expect(client.messages.splice(0)).toEqual([
      JSON.stringify({ t: "progress", id, data: [[1, 0.9]] }),
      JSON.stringify({ t: "result", id, value: [] }),
    ])
  }
})

test("duplicate active ids and more than 64 calls are refused without losing cancellation or capacity", async () => {
  const { core, connect } = setup()
  const client = connect(), other = connect()
  client.messages.length = 0
  let finish!: (value: string[]) => void
  const pending = new Promise<string[]>((resolve) => { finish = resolve })
  const command = spyOn(core.commands, "judgeAsk").mockReturnValue(pending)
  onTestFinished(() => command.mockRestore())
  for (let id = 0; id < 64; id++) client.message({ t: "call", id, method: "judgeAsk" })
  const original = client.ws.data.calls.get(0)!
  client.message({ t: "call", id: 0, method: "judgeAsk" })
  client.message({ t: "call", id: "overflow", method: "judgeAsk" })
  expect(client.messages).toEqual([
    '{"t":"result","id":0,"error":"duplicate active call id"}',
    '{"t":"result","id":"overflow","error":"too many active calls"}',
  ])
  expect(client.ws.data.calls.get(0)).toBe(original)
  client.message({ t: "cancel", id: 0 })
  expect(original.signal.aborted).toBe(true)
  expect(client.ws.data.calls.size).toBe(64)
  other.message({ t: "call", id: "independent", method: "judgeAsk" })
  other.message({ t: "cancel", id: "independent" })
  expect(other.ws.data.calls.get("independent")?.signal.aborted).toBe(true)
  await settled()
  expect(command).toHaveBeenCalledTimes(65)
  finish([])
  await settled()
  expect(client.ws.data.calls.size).toBe(0)
  client.message({ t: "call", id: 0, method: "judgeAsk" })
  await settled()
  expect(client.messages.at(-1)).toBe('{"t":"result","id":0,"value":[]}')
  expect(command).toHaveBeenCalledTimes(66)
})

test("command fallbacks, unknown-command errors and rejected-call cleanup stay unchanged", async () => {
  const { core, connect } = setup()
  const client = connect()
  client.messages.length = 0
  const refresh = spyOn(core.commands, "refreshApiKeys").mockImplementation(() => {})
  const judge = spyOn(core.commands, "judgeAsk").mockRejectedValue(new Error("invented failure"))
  onTestFinished(() => { refresh.mockRestore(); judge.mockRestore() })
  for (const params of [undefined, null]) {
    client.message({ t: "call", id: 1, method: "refreshApiKeys", params })
    await settled()
    expect(refresh.mock.calls.at(-1)?.[0]).toEqual({})
    expect(client.messages.splice(0)).toEqual(['{"t":"result","id":1,"value":null}'])
    expect(client.ws.data.calls.size).toBe(0)
  }
  client.message({ t: "call", id: 2, method: "inventedCommand" })
  expect(client.messages.splice(0)).toEqual(['{"t":"result","id":2,"error":"no such command: inventedCommand"}'])
  expect(client.ws.data.calls.size).toBe(0)
  client.message({ t: "call", id: 3, method: "judgeAsk" })
  await settled()
  expect(client.messages.splice(0)).toEqual(['{"t":"result","id":3,"error":"invented failure"}'])
  expect(client.ws.data.calls.size).toBe(0)
})
