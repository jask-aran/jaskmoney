import type { DataStore } from "../state/dataStore"
import type { UiStore } from "../state/uiStore"

/** Turn the Uncategorised view on or off. On, it suggests categories for the
 * rows shown that have none yet (history at once, Jev as answers arrive). */
export function toggleUncategorised(ui: UiStore, data: DataStore): void {
  const on = !data.state.uncategorisedOnly
  data.setUncategorisedOnly(on)
  ui.clearSelection()
  ui.jumpManagerCursor(0, data.scopedTransactions().length)
  if (!on) { ui.setStatus("Transactions"); return }
  ui.setStatus(`${data.scopedTransactions().length} uncategorised · suggesting…`)
  void runSuggest(ui, data)
}

async function runSuggest(ui: UiStore, data: DataStore): Promise<void> {
  if (data.state.suggesting) return
  try {
    const summary = await data.suggestCategories(data.scopedTransactions().map((t) => t.id))
    if (data.state.uncategorisedOnly) ui.setStatus(summary)
  } catch (error) {
    ui.setStatus(error instanceof Error ? error.message : String(error), true)
  }
}

/** Accept the suggestions for `ids`; rows without one are left alone. */
export async function runAccept(ui: UiStore, data: DataStore, ids: number[]): Promise<void> {
  const suggested = ids.filter((id) => data.state.suggestions[id])
  if (!suggested.length) { ui.setStatus("No suggestion to accept"); return }
  ui.setStatus(`Accepting ${suggested.length}…`)
  try {
    const summary = await data.acceptSuggestions(suggested)
    ui.clearSelection()
    ui.jumpManagerCursor(Math.min(ui.state.managerCursor, Math.max(0, data.scopedTransactions().length - 1)), data.scopedTransactions().length)
    ui.setStatus(summary)
  } catch (error) {
    ui.setStatus(error instanceof Error ? error.message : String(error), true)
  }
}
