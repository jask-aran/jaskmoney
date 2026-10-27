import type { DataStore } from "../state/dataStore"
import { newSuggestionsNote, suggestNew } from "./suggest"
import type { UiStore } from "../state/uiStore"

/** Background sync interval (startup sync runs immediately). */
export const SYNC_INTERVAL_MS = 5 * 60 * 1000

export function syncConfigured(): boolean {
  return !!process.env.JASKMONEY_UP_TOKEN?.trim()
}

/**
 * Run a provider sync and report it. A manual sync always reports; a
 * background one only reports new or changed data, or an error, so it does
 * not overwrite whatever the status line is showing.
 */
export async function runSync(ui: UiStore, data: DataStore, { manual }: { manual: boolean }): Promise<void> {
  if (!syncConfigured()) {
    if (manual) ui.setStatus("Set JASKMONEY_UP_TOKEN to enable sync", true)
    // Still suggest for waiting rows (CSV imports, or none suggested yet).
    else { const n = await suggestNew(data); if (n) ui.setStatus(newSuggestionsNote(n).slice(3)) }
    return
  }
  if (data.state.upSyncing) {
    if (manual) ui.setStatus("Sync already running")
    return
  }
  if (manual) ui.setStatus("Syncing…")
  try {
    const summary = await data.syncUp()
    // New rows get suggestions now, so the Overview can say what's waiting.
    const note = newSuggestionsNote(await suggestNew(data))
    if (manual || note || !/^Up sync: 0 new, 0 updated, 0 pending removed/.test(summary)) ui.setStatus(summary + note)
  } catch (error) {
    ui.setStatus(error instanceof Error ? error.message : String(error), true)
  }
}

/** "just now", "4m ago", "2h ago", "3d ago". */
export function syncAgo(iso: string | null, now: number): string | null {
  if (!iso) return null
  const minutes = Math.floor((now - Date.parse(iso)) / 60000)
  if (!Number.isFinite(minutes)) return null
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  if (minutes < 48 * 60) return `${Math.floor(minutes / 60)}h ago`
  return `${Math.floor(minutes / 1440)}d ago`
}
