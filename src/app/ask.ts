import { askTerms } from "../domain/filter"
import type { DataStore } from "../state/dataStore"
import type { UiStore } from "../state/uiStore"

/** Have Jev judge the rows the filter's `ask:` terms wait on, and report
 * (after `lead`, e.g. the categories a smart search matched outright). */
export async function runAsk(ui: UiStore, data: DataStore, note = "", lead = ""): Promise<void> {
  const terms = askTerms(data.state.filterExpr)
  if (!terms.length) return
  ui.setStatus(`Asking Jev: ${terms.map((w) => `"${w}"`).join(", ")}…`)
  try {
    const summary = await data.askAbout()
    if (summary) ui.setStatus(lead + summary + note, !!note)
  } catch (error) {
    ui.setStatus(error instanceof Error ? error.message : String(error), true)
  }
}
