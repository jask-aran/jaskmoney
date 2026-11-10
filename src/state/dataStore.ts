import { unwrap } from "solid-js/store"
import { createCore, CONFIG_SETTLE_MS, type Core } from "../core/core"
import { emptyCoreState, type CoreState } from "../core/protocol"
import type { CoreLink } from "../client/link"
import { createClientStore, showNearMisses, type ClientStore } from "../client/store"

const wire = <T>(value: T): T => (value === undefined ? value : JSON.parse(JSON.stringify(value)))

function detach(patch: Partial<CoreState>): Partial<CoreState> {
  const { transactions, ...rest } = patch
  const copy = wire(rest)
  return transactions ? { ...copy, transactions } : copy
}

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

export { CONFIG_SETTLE_MS, showNearMisses }
export type { DataState, TagReview, AskResult } from "../client/store"

const CORE_KEYS = new Set(Object.keys(emptyCoreState()))

function createDataStore() {
  const core = createCore()
  const client = createClientStore(localLink(core))

  const setState = ((...args: unknown[]) => {
    (client.setState as (...args: unknown[]) => void)(...args)
    const [first] = args
    const keys = typeof first === "string" ? [first] : first && typeof first === "object" ? Object.keys(first) : []
    const raw = unwrap(client.state) as unknown as Record<string, unknown>
    const patch = Object.fromEntries(keys.filter((key) => CORE_KEYS.has(key)).map((key) => [key, raw[key]]))
    if (Object.keys(patch).length) core.set(patch as Partial<CoreState>)
  }) as ClientStore["setState"]

  return {
    ...client,
    setState,
    init: (dbPath?: string) => core.open(dbPath),
    connect: (link: CoreLink) => client.connect(link),
    core,
    reset() {
      core.close()
      client.resetView()
    },
    refresh: () => core.refresh(),
    getDb: () => core.db,
  }
}

export const data = createDataStore()
export type DataStore = typeof data
