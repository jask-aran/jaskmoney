import { askTerms } from "../domain/filter"
import type { DataStore } from "../state/dataStore"
import type { UiStore } from "../state/uiStore"
import { searchReport, type Written } from "./searchReport"

export async function runAsk(ui: UiStore, data: DataStore, written?: Written): Promise<void> {
  if (!askTerms(data.state.filterExpr).length) return
  try {
    const judged = await data.askAbout()
    if (judged) ui.setStatus(searchReport({ written, judged }), judged.failures.length > 0 || (!!written && typeof written.clairic === "object"))
  } catch (error) {
    ui.setStatus(error instanceof Error ? error.message : String(error), true)
  }
}
