import { createMemo, createRoot } from "solid-js"
import { produce, unwrap } from "solid-js/store"
import { loadTagDismissals, saveTagDismissals, deleteTagDismissals } from "../../db/client"
import { hasJev, jevClient, type JevClient } from "../../ai/jev"
import { detectRecurring, detectTrips } from "../../domain/tagGroups"
import { jevTagCandidates, knownTagCandidates, TAG_SHOW_AT, tagExamples, tagPool, type TagCandidate, type TagTarget } from "../../domain/tagSuggest"
import { ACCEPT_ALL_AT } from "../../domain/questions"
import { count } from "../../ui/text"
import type { createUpPush } from "./upPush"
import type { StoreContext } from "./context"

/** Finding transactions for a tag: its target and the candidates so far. */
export interface TagReview extends TagTarget {
  candidates: Record<number, TagCandidate>
  /** Jev is still answering. */
  asking: boolean
}

/** A tag created from a review (the schema's default tag colour). */
const NEW_TAG_COLOR = "#94e2d5"

export function createTagReview(ctx: StoreContext, deps: { applyTagPatch: ReturnType<typeof createUpPush>["applyTagPatch"] }) {
  const { state, setState, mutate, transactions, recordUndo, createSettingsTag } = ctx
  const { applyTagPatch } = deps

  /** Detected groupings in the history: trips, then regular payments. */
  const tagGroups = createRoot(() => createMemo(() => [...detectTrips(transactions()), ...detectRecurring(transactions())]))

  /** Bumped by each tag review opened or closed; a run stops once stale. */
  let tagRun = 0

  /**
   * Show the transactions `target` could go on (see tagSuggest): the group's
   * and history's at once, Jev's as its answers land (`ai` replaces the Jev
   * client in tests). Returns a summary, or "" when closed meanwhile.
   */
  async function openTagReview(target: TagTarget, ai?: Pick<JevClient, "judge">): Promise<string> {
    // Tag names are upper case (createTag); a new one is named as it will be.
    if (target.tagId == null) target = { ...target, name: target.name.trim().toUpperCase() }
    const run = ++tagRun
    const dismissed = ctx.db ? loadTagDismissals(ctx.db, target.name) : new Set<number>()
    const known = knownTagCandidates(target, transactions()).filter((c) => !dismissed.has(c.transactionId))
    setState({
      uncategorisedOnly: false, sortColumn: "confidence", sortAscending: false,
      tagReview: { ...target, candidates: Object.fromEntries(known.map((c) => [c.transactionId, c])), asking: true },
    })
    const failures: string[] = []
    if (ai || hasJev()) {
      // The group's rows are settled; Jev weighs the rest of the scope.
      const settled = new Set(known.filter((c) => c.source === "group").map((c) => c.transactionId))
      const rows = tagPool(target, transactions()).filter((t) => !settled.has(t.id) && !dismissed.has(t.id))
      await jevTagCandidates(ai ?? jevClient(), target, rows, tagExamples(target, transactions()), {
        active: () => run === tagRun,
        onCandidates: (found) => {
          if (run !== tagRun) return
          setState("tagReview", "candidates", (prev) => {
            const next = { ...prev }
            for (const c of found) if (!next[c.transactionId] || c.confidence > next[c.transactionId]!.confidence) next[c.transactionId] = c
            return next
          })
        },
        onError: (error) => failures.push(error instanceof Error ? error.message : String(error)),
      })
    }
    if (run !== tagRun || !state.tagReview) return ""
    setState("tagReview", "asking", false)
    const shown = Object.values(state.tagReview.candidates).filter((c) => c.confidence >= TAG_SHOW_AT)
    const parts = [`${target.name}: ${shown.length} to review, ${shown.filter((c) => c.confidence >= ACCEPT_ALL_AT).length} at ${ACCEPT_ALL_AT * 100}% or more`]
    if (!ai && !hasJev()) parts.push("Jev isn't set up: tag history and detected groups only")
    if (failures.length) parts.push(`${failures.length} failed: ${failures[0]}`)
    return parts.join(" · ")
  }

  /** Put the review's tag on the candidates among `ids` (creating the tag,
   * with its scope, when it is new); they leave the review. */
  async function acceptTagCandidates(ids: number[]): Promise<string> {
    const review = state.tagReview
    if (!review) return ""
    const take = ids.filter((id) => review.candidates[id])
    if (!take.length) return "Nothing to tag"
    let tagId = review.tagId
    if (tagId == null) {
      tagId = createSettingsTag({ name: review.name, color: NEW_TAG_COLOR, scope: review.scope })
      setState("tagReview", "tagId", tagId)
    }
    const summary = await applyTagPatch(take, { [tagId]: "add" }, "review")
    const tagged = new Set(transactions().filter((t) => t.tagIds.includes(tagId!)).map((t) => t.id))
    // produce: a store merges a plain object into the old one, keeping removed keys.
    setState("tagReview", "candidates", produce((c) => { for (const id of take) if (tagged.has(id)) delete c[id] }))
    return summary
  }

  /** Drop candidates from the review, remembered for the tag (by name). */
  function dismissTagCandidates(ids: number[]): void {
    const review = state.tagReview
    if (!review || !ctx.db) return
    const removed = Object.values(unwrap(review.candidates)).filter((c) => ids.includes(c.transactionId)).map((c) => ({ ...c }))
    if (!removed.length) return
    const run = tagRun
    const tagName = review.name
    saveTagDismissals(ctx.db, tagName, removed.map((c) => c.transactionId))
    recordUndo(`dismissed ${count(removed.length, "candidate")}`, async () => {
      mutate((db) => deleteTagDismissals(db, tagName, removed.map((c) => c.transactionId)))
      if (tagRun === run && state.tagReview?.name === tagName) {
        setState("tagReview", "candidates", (prev) => ({ ...prev, ...Object.fromEntries(removed.map((c) => [c.transactionId, c])) }))
      }
      return ""
    })
    setState("tagReview", "candidates", produce((c) => { for (const id of ids) delete c[id] }))
  }

  function closeTagReview(): void {
    tagRun++
    setState({ tagReview: null, ...(state.sortColumn === "confidence" ? { sortColumn: "date" as const, sortAscending: false } : {}) })
  }

  return { tagGroups, openTagReview, acceptTagCandidates, dismissTagCandidates, closeTagReview, invalidateTagReview: () => { tagRun++ } }
}
