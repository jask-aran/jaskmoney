import { tripDates, type TagTarget } from "../domain/tagSuggest"
import type { DataStore } from "../state/dataStore"
import type { TagChoice } from "../state/tagChooser"
import type { UiStore } from "../state/uiStore"
import { count } from "../ui/text"

/**
 * Start finding transactions for a chosen tag: in its categories, or for a
 * trip found for it, within the trip's dates whatever the category (and the
 * status says so).
 */
export async function startTagReview(ui: UiStore, data: DataStore, choice: TagChoice): Promise<void> {
  let target: TagTarget
  if (choice.kind === "tag") {
    const { tag, group } = choice
    target = { tagId: tag.id, name: tag.name, categoryIds: tag.categoryIds, about: tag.about, ...(group ? { group } : {}) }
  } else if (choice.kind === "group") {
    target = { tagId: null, name: choice.group.name, categoryIds: [], about: null, group: choice.group }
  } else {
    target = { tagId: null, name: choice.name, categoryIds: [], about: null }
  }
  const dates = tripDates(target.group)
  const note = dates && target.categoryIds.length ? ` · within the trip's dates, any category` : ""
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
