import { inTagScope } from "../domain/tagScope"
import { tripScope, type TagTarget } from "../domain/tagSuggest"
import type { DataStore } from "../state/dataStore"
import type { TagChoice } from "../state/tagChooser"
import type { UiStore } from "../state/uiStore"
import { count } from "../ui/text"

/**
 * Start finding transactions for a chosen tag. A trip found for an existing
 * tag whose scope leaves out the trip's rows (SINGAPORE 2026 scoped to
 * Holidays & Travel) takes the trip's dates as its scope, and says so.
 */
export async function startTagReview(ui: UiStore, data: DataStore, choice: TagChoice): Promise<void> {
  let target: TagTarget
  let note = ""
  if (choice.kind === "tag") {
    const { tag, group } = choice
    let scope = tag.scope
    const tripDates = group && tripScope(group)
    const rows = data.transactions()
    if (tripDates && group!.rows.some((r) => { const t = rows.find((x) => x.id === r.id); return t && !inTagScope(tag, t) })) {
      data.updateSettingsTag(tag.id, { name: tag.name, color: tag.color, scope: tripDates })
      note = ` · scope now ${tripDates}${tag.scope ? ` (was ${tag.scope})` : ""}`
      scope = tripDates
    }
    target = { tagId: tag.id, name: tag.name, scope, ...(group ? { group } : {}) }
  } else if (choice.kind === "group") {
    target = { tagId: null, name: choice.group.name, scope: tripScope(choice.group), group: choice.group }
  } else {
    target = { tagId: null, name: choice.name, scope: null }
  }
  ui.clearSelection()
  ui.jumpManagerCursor(0, 0)
  ui.setStatus(`Finding transactions for ${target.name}…${note}`)
  try {
    const summary = await data.openTagReview(target)
    if (!summary) return
    ui.jumpManagerCursor(0, data.scopedTransactions().length)
    ui.setStatus(summary + note)
  } catch (error) {
    ui.setStatus(error instanceof Error ? error.message : String(error), true)
  }
}

/** Tag the review's candidates among `ids`. */
export async function runTagAccept(ui: UiStore, data: DataStore, ids: number[]): Promise<void> {
  const review = data.state.tagReview
  if (!review) return
  const take = ids.filter((id) => review.candidates[id])
  if (!take.length) { ui.setStatus("No candidate to tag"); return }
  ui.setStatus(`Tagging ${count(take.length, "transaction")} ${review.name}…`)
  try {
    const summary = await data.acceptTagCandidates(take)
    ui.clearSelection()
    ui.jumpManagerCursor(Math.min(ui.state.managerCursor, Math.max(0, data.scopedTransactions().length - 1)), data.scopedTransactions().length)
    ui.setStatus(summary, summary.includes("failed"))
  } catch (error) {
    ui.setStatus(error instanceof Error ? error.message : String(error), true)
  }
}

export function endTagReview(ui: UiStore, data: DataStore): void {
  data.closeTagReview()
  ui.clearSelection()
  ui.jumpManagerCursor(0, data.scopedTransactions().length)
  ui.setStatus("Transactions")
}
