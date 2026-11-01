import { createEffect, createRoot, on } from "solid-js"
import type { DataStore } from "./dataStore"
import type { UiStore } from "./uiStore"

/** Prune row targets after data reloads, independently of rendering. */
export function watchRowLifetimes(ui: UiStore, data: DataStore): () => void {
  return createRoot((dispose) => {
    createEffect(on(() => data.state.version, () => {
      ui.pruneRows(new Set(data.state.transactions.map((transaction) => transaction.id)))
    }))
    return dispose
  })
}
