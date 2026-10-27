import { hasJev, jevClient } from "../ai/jev"
import { createWorkersAiClient, hasWorkersAi, readWorkersAiCredentials } from "../ai/workersAi"
import { appToday } from "../domain/days"
import { smartSearch } from "../domain/smartSearch"
import type { DataStore } from "../state/dataStore"
import type { UiStore } from "../state/uiStore"
import { runAsk } from "./ask"
import { askTerms, parseFilter } from "../domain/filter"

/**
 * Turn the filter draft `?<query>` into a filter expression and put it in the
 * draft, applied live, for the user to read, edit and commit with enter. A
 * result that arrives after the draft changed is dropped.
 */
export async function runSmartSearch(ui: UiStore, data: DataStore, draft: string, onApplied: () => void): Promise<void> {
  const query = draft.trim().slice(1).trim()
  if (!query) { ui.setStatus("Type a search after ?, e.g. ?coffee over $5 last month"); return }
  if (!hasJev()) { ui.setStatus("Smart search needs a Jev key: Settings › AI models", true); return }
  ui.setStatus(`Smart search: ${query}…`)
  try {
    const ai = { clairic: hasWorkersAi() ? createWorkersAiClient(readWorkersAiCredentials()).clairic : undefined, jev: jevClient() }
    const descriptions = [...new Set(data.accountScoped().map((t) => t.description))]
    const { expr, clairic, parsed } = await smartSearch(ai, query, { today: appToday(), cycle: data.cycle(), categories: data.state.categories, descriptions })
    if (!ui.state.filterMode || ui.state.filterDraft !== draft) return
    ui.setState({ filterDraft: expr, filterCaret: expr.length, smartQuestion: { question: query, expr } })
    data.setFilterLive(expr)
    onApplied()
    // What kind of search it became: a plain filter, or Jev reading rows.
    const jevReads = askTerms(parseFilter(expr).node).length > 0
    // Without Clairic the words are Jev's pick and written dates are not read.
    const note = clairic ? ` · no Clairic (${clairic.replace(/^Workers AI clairic:\s*/, "")}): check words, dates` : ""
    // A broad search names the categories it went to.
    const covered = (parsed.categories ?? []).map((id) => data.state.categories.find((c) => c.id === id)?.name).filter(Boolean).join(", ")
    const became = covered ? `${covered}${jevReads ? " + Jev reads the rest" : ""}` : jevReads ? "Jev reads each row" : "a plain filter"
    ui.setStatus(`?${query} → ${became} · enter applies${note}`, !!clairic)
    // Jev's tally counts only the rows it read: the categories' come first.
    if (jevReads) await runAsk(ui, data, note, covered ? `${covered} by category · outside them, ` : "")
  } catch (error) {
    ui.setStatus(error instanceof Error ? error.message : String(error), true)
  }
}
