import { loadTagDismissals, saveTagDismissals, deleteTagDismissals } from "../db/client"
import { hasJev, jevClient, type JevClient } from "../ai/jev"
import { jevTagCandidates, knownTagCandidates, tagExamples, tagPool, type TagCandidate, type TagTarget } from "../domain/tagSuggest"
import { count } from "../domain/words"
import type { CoreContext } from "./context"

/** The core's half of finding transactions for a tag: the candidates and
 * the dismissals. The review itself (what's shown, accepting) is the
 * client's (client/store openTagReview). */
export function createTagCandidates(ctx: CoreContext) {
  const { state, mutate, transactions, recordUndo } = ctx

  /**
   * The transactions `target` could go on (see tagSuggest): the group's and
   * history's at once, then Jev's as its answers land, each set to
   * `onCandidates`; Jev stops once `active` says no. Returns the failures and
   * whether Jev was asked.
   */
  async function tagCandidates(target: TagTarget, ai: Pick<JevClient, "judge"> | undefined, options: {
    onCandidates: (found: TagCandidate[]) => void; active: () => boolean
  }): Promise<{ failures: string[]; jev: boolean }> {
    const dismissed = ctx.db ? loadTagDismissals(ctx.db, target.name) : new Set<number>()
    const known = knownTagCandidates(target, transactions(), state.categories).filter((c) => !dismissed.has(c.transactionId))
    options.onCandidates(known)
    const failures: string[] = []
    const jev = !!ai || hasJev()
    if (jev) {
      // The group's rows are settled; Jev weighs the rest of the scope.
      const settled = new Set(known.filter((c) => c.source === "group").map((c) => c.transactionId))
      const rows = tagPool(target, transactions(), state.categories).filter((t) => !settled.has(t.id) && !dismissed.has(t.id))
      await jevTagCandidates(ai ?? jevClient(), target, rows, tagExamples(target, transactions()), {
        active: options.active,
        onCandidates: options.onCandidates,
        onError: (error) => failures.push(error instanceof Error ? error.message : String(error)),
      })
    }
    return { failures, jev }
  }

  /** Remember candidates as not the tag's (by name). Undoing it hands them
   * back, with `review` (the client's review they came from). */
  function dismissTagCandidates(tag: string, candidates: TagCandidate[], review: number): void {
    if (!ctx.db || !candidates.length) return
    const ids = candidates.map((c) => c.transactionId)
    saveTagDismissals(ctx.db, tag, ids)
    recordUndo(`dismissed ${count(candidates.length, "candidate")}`, async () => {
      mutate((db) => deleteTagDismissals(db, tag, ids))
      return { message: "", restored: { review, tag, candidates } }
    })
  }

  return { tagCandidates, dismissTagCandidates }
}
