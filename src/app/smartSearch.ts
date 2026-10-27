import { createWorkersAiClient, hasWorkersAi, readWorkersAiCredentials } from "../ai/workersAi"
import { appToday } from "../domain/days"
import { smartSearch } from "../domain/smartSearch"
import type { DataStore } from "../state/dataStore"
import type { UiStore } from "../state/uiStore"
import { runAsk } from "./ask"

/**
 * Turn the filter draft `?<query>` into a filter expression and put it in the
 * draft, applied live, for the user to read, edit and commit with enter. A
 * result that arrives after the draft changed is dropped.
 */
export async function runSmartSearch(ui: UiStore, data: DataStore, draft: string, onApplied: () => void): Promise<void> {
  const query = draft.trim().slice(1).trim()
  if (!query) { ui.setStatus("Type a search after ?, e.g. ?coffee over $5 last month"); return }
  if (!hasWorkersAi()) { ui.setStatus("Set JASKMONEY_CF_TOKEN and JASKMONEY_CF_ACCOUNT_ID for smart search", true); return }
  ui.setStatus(`Smart search: ${query}…`)
  try {
    const ai = createWorkersAiClient(readWorkersAiCredentials())
    const { expr } = await smartSearch(ai, query, { today: appToday(), cycle: data.cycle(), categories: data.state.categories })
    if (!ui.state.filterMode || ui.state.filterDraft !== draft) return
    ui.setState({ filterDraft: expr, filterCaret: expr.length })
    data.setFilterLive(expr)
    onApplied()
    ui.setStatus(`Smart search: ${query} · enter applies, or edit it`)
    await runAsk(ui, data)
  } catch (error) {
    ui.setStatus(error instanceof Error ? error.message : String(error), true)
  }
}
