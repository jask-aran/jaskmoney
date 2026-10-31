import type { Core } from "../core/core"
import type { CoreState } from "../core/protocol"
import type { CoreLink } from "./link"

/** A JSON copy: what crosses the link is what a WebSocket could carry, so
 * the in-process client can't come to rely on sharing the core's objects. */
const wire = <T>(value: T): T => (value === undefined ? value : JSON.parse(JSON.stringify(value)))

/** A copy of a patch. The transactions (tens of thousands of rows, replaced
 * whole and never written in place) are shared rather than copied on every
 * write. */
function detach(patch: Partial<CoreState>): Partial<CoreState> {
  const { transactions, ...rest } = patch
  const copy = wire(rest)
  return transactions ? { ...copy, transactions } : copy
}

/**
 * The core in this process. A call runs at once: its state patches reach
 * the client before `call` returns, and its result (or error) settles the
 * promise. Params and results are copied as JSON, like a WebSocket would.
 */
export function localLink(core: Core): CoreLink {
  return {
    call(method, params, options = {}) {
      const cx = {
        progress: (data: unknown) => options.onProgress?.(wire(data) as never),
        signal: options.signal ?? new AbortController().signal,
        ai: options.ai,
        llm: options.llm,
        models: options.models,
      }
      try {
        const run = core.commands[method] as (params: unknown, cx: unknown) => unknown
        return Promise.resolve(run(wire(params), cx)).then(wire) as never
      } catch (error) {
        return Promise.reject(error)
      }
    },
    subscribe: (listener) => core.subscribe((patch) => listener(detach(patch))),
  }
}
