import { batch } from "solid-js"
import { $RAW, reconcile } from "solid-js/store"
import { normaliseSelection } from "../domain/accountTree"
import type { CoreState } from "../core/protocol"
import type { CoreLink } from "./link"
import type { SetStoreFunction } from "solid-js/store"
import type { DataState } from "./store"

const RECONCILED = new Set<keyof CoreState>(["suggestions", "merchantNotes", "merchantBreadth", "uiPrefs", "purchaseLookups"])

function plainRows<T>(rows: T): T {
  if (Array.isArray(rows) && Object.isExtensible(rows) && !Object.prototype.hasOwnProperty.call(rows, $RAW))
    Object.defineProperty(rows, $RAW, { value: rows })
  return rows
}

export function createMirror(initialLink: CoreLink, state: DataState, setState: SetStoreFunction<DataState>, newSession: () => void) {
  const core = { link: initialLink }
  let session = -1

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

  function connect(next: CoreLink) {
    unsubscribe()
    session = -1
    core.link = next
    unsubscribe = core.link.subscribe(applyPatch)
  }

  return { core, connect, start: () => { unsubscribe = core.link.subscribe(applyPatch) } }
}
