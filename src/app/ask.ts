import { askTerms } from "../domain/filter"
import type { DataStore } from "../state/dataStore"
import type { UiStore } from "../state/uiStore"

/** Have Clef judge the rows the filter's `ask:` terms wait on, and report. */
export async function runAsk(ui: UiStore, data: DataStore): Promise<void> {
  const terms = askTerms(data.state.filterExpr)
  if (!terms.length) return
  ui.setStatus(`Asking Clef: ${terms.map((w) => `"${w}"`).join(", ")}…`)
  try {
    const summary = await data.askAbout()
    if (summary) ui.setStatus(summary)
  } catch (error) {
    ui.setStatus(error instanceof Error ? error.message : String(error), true)
  }
}
