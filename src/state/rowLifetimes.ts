import { createEffect, createRoot, on } from "solid-js"
import { unwrap } from "solid-js/store"
import type { DataStore } from "./dataStore"
import type { UiStore } from "./uiStore"

/** Prune row targets after data reloads, independently of rendering. */
export function watchRowLifetimes(ui: UiStore, data: DataStore): () => void {
  return createRoot((dispose) => {
    createEffect(on(() => data.state.session, () => ui.forgetRows(), { defer: true }))
    createEffect(on(() => data.state.version, () => {
      // The plain rows: through the store each row would be wrapped and read as a proxy.
      ui.pruneRows(new Set(unwrap(data.state.transactions).map((transaction) => transaction.id)))
    }))
    return dispose
  })
}
