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

/**
 * Suggest categories, in the background, for waiting rows that have none
 * (and weren't dismissed, or tried already this session): after a sync or
 * an import, and at startup. Skips while suggestions already run. Returns
 * how many new ones were made.
 */
export async function suggestNew(data: DataStore): Promise<number> {
  if (data.state.suggesting) return 0
  const ids = data.untriedWaiting()
  if (!ids.length) return 0
  data.markTried(ids)
  const before = Object.keys(data.state.suggestions).length
  try {
    await data.suggestCategories(ids)
  } catch {
    return 0 // a background helper: the next sync tries again
  }
  return Math.max(0, Object.keys(data.state.suggestions).length - before)
}

/** " · 3 new suggestions (i to review)", or "" for none. */
export function newSuggestionsNote(n: number): string {
  return n ? ` · ${n} new suggestion${n === 1 ? "" : "s"} (i to review)` : ""
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
  const settle = () => ui.jumpManagerCursor(Math.min(ui.state.managerCursor, Math.max(0, data.scopedTransactions().length - 1)), data.scopedTransactions().length)
  let resuggest: Promise<string> | undefined
  try {
    // The rows take their categories at once; Up hears about them after.
    let summary = await data.acceptSuggestions(suggested, (pushed, total) => {
      if (pushed === 0) {
        ui.clearSelection()
        settle()
        resuggest ??= data.resuggestLike(suggested).then(
          (count) => count > 0 ? ` · re-suggested ${count} alike` : "",
          (error) => ` · re-suggest failed: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
      if (total) ui.setStatus(`Accepted ${suggested.length} · updating Up ${pushed}/${total}…`)
    })
    const failed = summary.includes(" failed: ")
    summary += await (resuggest ?? "")
    settle()
    ui.setStatus(summary, failed)
  } catch (error) {
    ui.setStatus(error instanceof Error ? error.message : String(error), true)
  }
}
