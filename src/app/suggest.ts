import type { DataStore } from "../state/dataStore"
import type { UiStore } from "../state/uiStore"
import { lookUpPurchases, purchasesNote } from "./purchases"
import { afterPaint } from "./startup"

export function toggleUncategorised(ui: UiStore, data: DataStore): void {
  const on = !data.state.uncategorisedOnly
  data.setUncategorisedOnly(on)
  ui.clearSelection()
  ui.jumpManagerCursor(0, data.scopedTransactions().length)
  if (!on) { ui.setStatus("Transactions"); return }
  ui.setStatus(`${data.scopedTransactions().length} uncategorised · suggesting…`)
  afterPaint(() => {
    if (!data.state.uncategorisedOnly) return
    void runSuggest(ui, data)
    void lookUpPurchases(data).then((round) => {
      const note = purchasesNote(round)
      if (note && data.state.uncategorisedOnly) ui.setStatus(`${note.slice(3)}${round.resuggested ? `, ${round.resuggested} asked again` : ""}`)
    })
  })
}

export async function suggestNew(data: DataStore): Promise<number> {
  if (data.state.suggesting) return 0
  const ids = data.untriedWaiting()
  if (!ids.length) return 0
  const session = data.state.session
  const before = Object.keys(data.state.suggestions).length
  try {
    await data.suggestCategories(ids)
    if (data.state.session !== session) return 0
    data.markTried(ids)
  } catch {
    return 0
  }
  return Math.max(0, Object.keys(data.state.suggestions).length - before)
}

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

export async function runAccept(ui: UiStore, data: DataStore, ids: number[]): Promise<void> {
  const suggested = ids.filter((id) => data.state.suggestions[id])
  if (!suggested.length) { ui.setStatus("No suggestion to accept"); return }
  const settle = () => ui.jumpManagerCursor(Math.min(ui.state.managerCursor, Math.max(0, data.scopedTransactions().length - 1)), data.scopedTransactions().length)
  let resuggest: Promise<string> | undefined
  try {
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
