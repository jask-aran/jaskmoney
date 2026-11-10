import { produce, unwrap } from "solid-js/store"
import { TAG_SHOW_AT, type TagTarget } from "../domain/tagSuggest"
import { ACCEPT_ALL_AT } from "../domain/questions"
import type { JevClient } from "../ai/jev"
import type { createHistoryRows } from "./derived"
import type { createMirror } from "./mirror"
import type { createTransactionCommands } from "./commands"
import { createLatestRun } from "./ask"
import type { SetStoreFunction } from "solid-js/store"
import type { DataState } from "./store"

const NEW_TAG_COLOR = "#94e2d5"

function createTagReviewOpening(state: DataState, setState: SetStoreFunction<DataState>, core: ReturnType<typeof createMirror>["core"], tagRuns: ReturnType<typeof createLatestRun>, stopTagReview: () => void) {
  async function openTagReview(target: TagTarget, ai?: Pick<JevClient, "judge">): Promise<string> {
    if (target.tagId == null) target = { ...target, name: target.name.trim().toUpperCase() }
    stopTagReview()
    const run = tagRuns.start()
    setState({
      uncategorisedOnly: false, sortColumn: "confidence", sortAscending: false,
      tagReview: { ...target, candidates: {}, asking: true },
    })
    try {
      const { failures, jev } = await core.link.call("tagCandidates", { target: unwrap(target) }, {
        ai,
        signal: run.signal,
        onProgress: (found) => {
          if (!run.isCurrent()) return
          setState("tagReview", "candidates", (prev) => {
            const next = { ...prev }
            for (const c of found) if (!next[c.transactionId] || c.confidence > next[c.transactionId]!.confidence) next[c.transactionId] = c
            return next
          })
        },
      })
      if (!run.isCurrent() || !state.tagReview) return ""
      const shown = Object.values(state.tagReview.candidates).filter((c) => c.confidence >= TAG_SHOW_AT)
      const parts = [`${target.name}: ${shown.length} to review, ${shown.filter((c) => c.confidence >= ACCEPT_ALL_AT).length} at ${ACCEPT_ALL_AT * 100}% or more`]
      if (!jev) parts.push("Jev isn't set up: tag history and detected groups only")
      if (failures.length) parts.push(`${failures.length} failed: ${failures[0]}`)
      return parts.join(" · ")
    } catch (error) {
      if (!run.isCurrent()) return ""
      throw error
    } finally {
      if (run.isCurrent() && state.tagReview) setState("tagReview", "asking", false)
    }
  }

  return { openTagReview }
}

export function createTagReview(state: DataState, setState: SetStoreFunction<DataState>, core: ReturnType<typeof createMirror>["core"], transactions: ReturnType<typeof createHistoryRows>["transactions"], applyTagPatch: ReturnType<typeof createTransactionCommands>["applyTagPatch"]) {
  const tagRuns = createLatestRun()
  let tagReviewId = 0
  function stopTagReview() {
    tagReviewId++
    tagRuns.stop()
  }

  const { openTagReview } = createTagReviewOpening(state, setState, core, tagRuns, stopTagReview)

  async function acceptTagCandidates(ids: number[]): Promise<string> {
    const review = state.tagReview
    if (!review) return ""
    const take = ids.filter((id) => review.candidates[id])
    if (!take.length) return "Nothing to tag"
    const reviewId = tagReviewId
    const open = () => reviewId === tagReviewId && !!state.tagReview
    let tagId = review.tagId
    if (tagId == null) {
      tagId = await core.link.call("createTag", { input: { name: review.name, color: NEW_TAG_COLOR } })
      if (open()) setState("tagReview", "tagId", tagId)
    }
    const summary = await applyTagPatch(take, { [tagId]: "add" }, "review")
    const tagged = new Set(transactions().filter((t) => t.tagIds.includes(tagId!)).map((t) => t.id))
    if (open()) setState("tagReview", "candidates", produce((c) => { for (const id of take) if (tagged.has(id)) delete c[id] }))
    return summary
  }

  function dismissTagCandidates(ids: number[]): Promise<void> {
    const review = state.tagReview
    if (!review) return Promise.resolve()
    const removed = Object.values(unwrap(review.candidates)).filter((c) => ids.includes(c.transactionId)).map((c) => ({ ...c }))
    if (!removed.length) return Promise.resolve()
    const done = core.link.call("dismissTagCandidates", { tag: review.name, candidates: removed, review: tagReviewId })
    setState("tagReview", "candidates", produce((c) => { for (const id of ids) delete c[id] }))
    return done
  }

  function closeTagReview(): void {
    stopTagReview()
    setState({ tagReview: null, ...(state.sortColumn === "confidence" ? { sortColumn: "date" as const, sortAscending: false } : {}) })
  }

  async function undo(): Promise<string> {
    const result = await core.link.call("undo", {})
    const back = result.restored
    if (back && back.review === tagReviewId && state.tagReview?.name === back.tag) {
      setState("tagReview", "candidates", (prev) => ({ ...prev, ...Object.fromEntries(back.candidates.map((c) => [c.transactionId, c])) }))
    }
    return result.message
  }

  return { stopTagReview, openTagReview, acceptTagCandidates, dismissTagCandidates, closeTagReview, undo }
}
