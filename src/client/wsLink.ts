import type { CoreState, ServerMessage, ClientMessage } from "../core/protocol"
import type { CoreLink } from "./link"

/**
 * The core over a WebSocket (server/serve's /api), from a browser or from
 * Bun. Calls made before the socket opens wait for it; when it closes, the
 * calls still waiting fail and `onClose` hears why.
 */
export function wsLink(url: string, { onClose }: { onClose?: (reason: string) => void } = {}): CoreLink & { close(): void } {
  const socket = new WebSocket(url)
  const waiting = new Map<number, { resolve: (value: never) => void; reject: (error: Error) => void; onProgress?: (data: never) => void }>()
  const listeners = new Set<(patch: Partial<CoreState>) => void>()
  /** Everything heard so far, for a listener that comes late. */
  const seen: Partial<CoreState> = {}
  const outbox: string[] = []
  let nextId = 1
  let closed: string | null = null

  const send = (message: ClientMessage) => {
    const text = JSON.stringify(message)
    if (socket.readyState === WebSocket.OPEN) socket.send(text)
    else outbox.push(text)
  }

  socket.addEventListener("open", () => { for (const text of outbox.splice(0)) socket.send(text) })
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as ServerMessage
    if (message.t === "state") {
      Object.assign(seen, message.patch)
      for (const listener of listeners) listener(message.patch)
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
      if (options.ai || options.llm) return Promise.reject(new Error("stand-in models work in-process only"))
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
