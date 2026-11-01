import { JEV_SETUP } from "../ai/judge"
import type { DataStore } from "../state/dataStore"
import type { UiStore } from "../state/uiStore"
import { runAsk } from "./ask"
import { jevService, searchReport, writtenText, type Written } from "./searchReport"
import { askTerms, parseFilter } from "../domain/filter"

/**
 * Turn the filter draft `?<query>` into a filter expression and put it in the
 * draft, applied live, for the user to read, edit and commit with enter. A
 * result that arrives after the draft changed is dropped.
 */
export async function runSmartSearch(ui: UiStore, data: DataStore, draft: string, onApplied: () => void): Promise<void> {
  const query = draft.trim().slice(1).trim()
  if (!query) { ui.setStatus("Type a search after ?, e.g. ?coffee over $5 last month"); return }
  // The core's models: set up where the core runs.
  if (!data.state.jev) { ui.setStatus(`Smart search needs Jev (${JEV_SETUP})`, true); return }
  const by = jevService(data.state.jev)
  ui.setStatus(`Writing a filter with ${by}${data.state.clairic ? " + Clairic" : ""}…`)
  try {
    const descriptions = [...new Set(data.accountScoped().map((t) => t.description))]
    const started = Date.now()
    const { expr, clairic, clairicOn } = await data.smartSearch(query, descriptions)
    if (ui.state.filterBar == null || (ui.state.filterBar?.draft ?? "") !== draft) return
    // Without Clairic the words are Jev's pick and written dates are not read.
    const written: Written = { ms: Date.now() - started, by, clairic: !clairicOn ? "off" : clairic ? { failed: clairic.replace(/^Workers AI clairic:\s*/, "") } : "used" }
    ui.setState({ filterBar: { draft: expr, caret: expr.length }, smartQuestion: { question: query, expr, written } })
    data.setFilterLive(expr)
    onApplied()
    if (askTerms(parseFilter(expr).node).length) {
      ui.setStatus(`${writtenText(written)} · Jev judging…`, typeof written.clairic === "object")
      await runAsk(ui, data, written)
    } else {
      ui.setStatus(searchReport({ written, rows: data.scopedTransactions().length }), typeof written.clairic === "object")
    }
  } catch (error) {
    ui.setStatus(error instanceof Error ? error.message : String(error), true)
  }
}
