import { batch } from "solid-js"
import { $RAW, reconcile } from "solid-js/store"
import { normaliseSelection } from "../domain/accountTree"
import type { CoreState } from "../core/protocol"
import type { CoreLink } from "./link"
import type { SetStoreFunction } from "solid-js/store"
import type { DataState } from "./store"

/** Slices patched in place, so a reader of one entry reruns only when it changes. */
const RECONCILED = new Set<keyof CoreState>(["suggestions", "merchantNotes", "merchantBreadth", "uiPrefs", "purchaseLookups"])

/** The core's rows, marked as already plain. Setting a store value unwraps
 * it deeply (every field of every row, ~half of a write's cost); the core's
 * rows are fresh plain objects, never store proxies, so the marker (which
 * Solid's `unwrap` returns as is) skips that walk. Reads still wrap them. */
function plainRows<T>(rows: T): T {
  if (Array.isArray(rows) && Object.isExtensible(rows) && !Object.prototype.hasOwnProperty.call(rows, $RAW))
    Object.defineProperty(rows, $RAW, { value: rows })
  return rows
}

export function createMirror(initialLink: CoreLink, state: DataState, setState: SetStoreFunction<DataState>, newSession: () => void) {
  const core = { link: initialLink }
  let session = -1

  /** Take in a patch from the core. */
  function applyPatch(patch: Partial<CoreState>) {
    batch(() => {
      const plain: Partial<CoreState> = {}
      for (const [key, value] of Object.entries(patch) as [keyof CoreState, never][]) {
        if (RECONCILED.has(key)) setState(key, reconcile(value))
        else (plain as Record<string, unknown>)[key] = key === "transactions" ? plainRows(value) : value
      }
      setState(plain)
      if (patch.session !== undefined && patch.session !== session) {
        session = patch.session
        newSession()
      }
      if (patch.accounts) setState({ accountSelection: normaliseSelection(state.accounts, state.accountSelection) })
    })
  }

  let unsubscribe = () => {}

  /** Use another link (another core): the mirror starts again from its state. */
  function connect(next: CoreLink) {
    unsubscribe()
    // Another core's sessions are numbered on their own: its first patch is a new one.
    session = -1
    core.link = next
    unsubscribe = core.link.subscribe(applyPatch)
  }

  return { core, connect, start: () => { unsubscribe = core.link.subscribe(applyPatch) } }
}
