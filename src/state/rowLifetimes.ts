import { createEffect, createRoot, on } from "solid-js"
import { unwrap } from "solid-js/store"
import type { DataStore } from "./dataStore"
import type { UiStore } from "./uiStore"

export function watchRowLifetimes(ui: UiStore, data: DataStore): () => void {
  return createRoot((dispose) => {
    createEffect(on(() => data.state.session, () => ui.forgetRows(), { defer: true }))
    createEffect(on(() => data.state.version, () => {
      ui.pruneRows(new Set(unwrap(data.state.transactions).map((transaction) => transaction.id)))
    }))
    return dispose
  })
}
