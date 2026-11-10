import { UP_TOKEN_SETUP } from "../up/client"
import type { DataStore } from "../state/dataStore"
import { newSuggestionsNote, suggestNew } from "./suggest"
import { purchasesNote, lookUpPurchases, type PurchaseRound } from "./purchases"
import type { UiStore } from "../state/uiStore"
import { traceMark } from "./trace"

export async function runBackgroundRefresh(data: DataStore): Promise<{ purchases: PurchaseRound; suggested: number; error: string | null }> {
  let purchases: PurchaseRound = { looked: 0, found: 0, resuggested: 0, error: null }
  try {
    purchases = await lookUpPurchases(data)
    const suggested = await suggestNew(data)
    return { purchases, suggested, error: null }
  } catch (error) {
    return { purchases, suggested: 0, error: error instanceof Error ? error.message : String(error) }
  }
}

export const SYNC_INTERVAL_MS = 5 * 60 * 1000

function syncConfigured(data: DataStore): boolean {
  return data.state.upToken
}

export async function runSync(ui: UiStore, data: DataStore, { manual, off }: { manual: boolean; off?: string[] }): Promise<void> {
  if (data.state.demo) {
    if (manual) ui.setStatus("Demo mode: sync is off (Settings › Database & Import to leave)", true)
    return
  }
  if (!syncConfigured(data)) {
    if (manual) ui.setStatus(UP_TOKEN_SETUP, true)
    else {
      const refresh = await runBackgroundRefresh(data)
      if (refresh.error !== null) { ui.setStatus(refresh.error, true); return }
      const note = purchasesNote(refresh.purchases) + newSuggestionsNote(refresh.suggested)
      if (note) ui.setStatus(note.slice(3))
    }
    return
  }
  if (data.state.upSyncing) {
    if (manual) ui.setStatus("Sync already running")
    return
  }
  if (manual) ui.setStatus("Syncing…")
  try {
    traceMark("sync start")
    const summary = await data.syncUp(off)
    traceMark("sync done")
    const refresh = await runBackgroundRefresh(data)
    traceMark("background refresh done")
    if (refresh.error !== null) { ui.setStatus(refresh.error, true); return }
    const note = purchasesNote(refresh.purchases) + newSuggestionsNote(refresh.suggested)
    if (manual || note || !/^Up sync: 0 new, 0 updated, 0 pending removed/.test(summary)) ui.setStatus(summary + note)
  } catch (error) {
    ui.setStatus(error instanceof Error ? error.message : String(error), true)
  }
}

