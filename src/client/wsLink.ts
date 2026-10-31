import type { CoreState, ServerMessage, ClientMessage } from "../core/protocol"
import type { Transaction } from "../domain/types"
import type { CoreLink } from "./link"

/**
 * The core over a WebSocket (server/serve's /api), from a browser or from
 * Bun. Calls made before the socket opens wait for it; `onOpen` hears it
 * open. When it closes, the calls still waiting fail and `onClose` hears why.
 */
export function wsLink(url: string, { onClose, onOpen }: { onClose?: (reason: string) => void; onOpen?: () => void } = {}): CoreLink & { close(): void } {
  const socket = new WebSocket(url)
  const waiting = new Map<number, { resolve: (value: never) => void; reject: (error: Error) => void; onProgress?: (data: never) => void }>()
  const listeners = new Set<(patch: Partial<CoreState>) => void>()
  /** Everything heard so far, for a listener that comes late. */
  const seen: Partial<CoreState> = {}
  const outbox: string[] = []
  let nextId = 1
  let closed: string | null = null

  /** Transactions by id, in the core's order. */
  const rows = new Map<number, Transaction>()
  let order: number[] = []

  /** The keyed slices and transactions a message changes, whole again. */
  function wholeSlices(message: Extract<ServerMessage, { t: "state" }>): Partial<CoreState> {
    const whole: Record<string, unknown> = {}
    for (const [slice, change] of Object.entries(message.keyed ?? {})) {
      const next: Record<string, unknown> = { ...(seen[slice as keyof CoreState] as object | undefined), ...change.set }
      for (const key of change.remove) delete next[key]
      whole[slice] = next
    }
    if (message.rows) {
      for (const id of message.rows.remove) rows.delete(id)
      for (const t of message.rows.set) rows.set(t.id, t)
      if (message.rows.order) order = message.rows.order
      whole.transactions = order.map((id) => rows.get(id)!)
    }
    return whole
  }

  const send = (message: ClientMessage) => {
    const text = JSON.stringify(message)
    if (socket.readyState === WebSocket.OPEN) socket.send(text)
    else outbox.push(text)
  }

  socket.addEventListener("open", () => {
    for (const text of outbox.splice(0)) socket.send(text)
    onOpen?.()
  })
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as ServerMessage
    if (message.t === "state") {
      const patch = { ...message.patch, ...wholeSlices(message) }
      Object.assign(seen, patch)
      for (const listener of listeners) listener(patch)
    } else if (message.t === "progress") {
      waiting.get(message.id)?.onProgress?.(message.data as never)
    } else {
      const call = waiting.get(message.id)
      waiting.delete(message.id)
      if (message.error != null) call?.reject(new Error(message.error))
      else call?.resolve(message.value as never)
    }
  })
  socket.addEventListener("close", (event) => {
    closed = event.reason || "the jaskmoney server went away"
    for (const call of waiting.values()) call.reject(new Error(closed))
    waiting.clear()
    onClose?.(closed)
  })

  return {
    call(method, params, options = {}) {
      if (options.ai || options.llm || options.models) return Promise.reject(new Error("stand-in models work in-process only"))
      if (closed) return Promise.reject(new Error(closed))
      const id = nextId++
      return new Promise((resolve, reject) => {
        waiting.set(id, { resolve, reject, onProgress: options.onProgress as never })
        options.signal?.addEventListener("abort", () => send({ t: "cancel", id }), { once: true })
        send({ t: "call", id, method, params })
      })
    },
    subscribe(listener) {
      listeners.add(listener)
      if (Object.keys(seen).length) listener({ ...seen })
      return () => { listeners.delete(listener) }
    },
    close: () => socket.close(),
  }
}
