/**
 * The TUI's data: the client store (client/store) over the core
 * (core/core) in this process. A remote core works the same way through
 * `connect` (the TUI's --connect). The rest of the TUI reaches the core only
 * through this store's methods.
 */
import { unwrap } from "solid-js/store"
import { createCore, CONFIG_SETTLE_MS } from "../core/core"
import { emptyCoreState, type CoreState } from "../core/protocol"
import { localLink } from "../client/localLink"
import type { CoreLink } from "../client/link"
import { createClientStore, showNearMisses, type ClientStore } from "../client/store"

export { CONFIG_SETTLE_MS, showNearMisses }
export type { DataState, TagReview, AskResult } from "../client/store"

const CORE_KEYS = new Set(Object.keys(emptyCoreState()))

function createDataStore() {
  const core = createCore()
  const client = createClientStore(localLink(core))

  /** Writes to the mirror. Test seam: in this process, what it writes of
   * the core's state is written to the core too, as if the core had it. */
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
    /** Open the database at `dbPath` (the default one when not given) in this process's core. */
    init: (dbPath?: string) => core.open(dbPath),
    /** Use a core elsewhere (server/serve) instead of this process's. */
    connect: (link: CoreLink) => client.connect(link),
    /** This process's core, for serving it to other clients (server/serve). */
    core,
    /** Test isolation only: close the database and restore the pre-init
     * state. Call init() before using database actions again. Does not
     * erase disk data. */
    reset() {
      core.close()
      client.resetView()
    },
    /** Test seams, in this process only: reload from the database, reach it. */
    refresh: () => core.refresh(),
    getDb: () => core.db,
  }
}

export const data = createDataStore()
export type DataStore = typeof data
