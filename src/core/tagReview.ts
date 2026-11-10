import { loadTagDismissals, saveTagDismissals, deleteTagDismissals } from "../db/client"
import { hasJev, jevClient, type JevClient } from "../ai/jev"
import { jevTagCandidates, knownTagCandidates, tagExamples, tagPool, type TagCandidate, type TagTarget } from "../domain/tagSuggest"
import { count } from "../domain/words"
import type { CoreContext } from "./context"

export function createTagCandidates(ctx: CoreContext) {
  const { state, mutate, transactions, recordUndo } = ctx

  async function tagCandidates(target: TagTarget, ai: Pick<JevClient, "judge"> | undefined, options: {
    onCandidates: (found: TagCandidate[]) => void; active: () => boolean
  }): Promise<{ failures: string[]; jev: boolean }> {
    const session = ctx.db ? ctx.session() : null
    const isCurrent = () => session ? ctx.isCurrent(session) : ctx.db == null
    const dismissed = ctx.db ? loadTagDismissals(ctx.db, target.name) : new Set<number>()
    const known = knownTagCandidates(target, transactions(), state.categories).filter((c) => !dismissed.has(c.transactionId))
    options.onCandidates(known)
    const failures: string[] = []
    const jev = !!ai || hasJev()
    if (jev) {
      const settled = new Set(known.filter((c) => c.source === "group").map((c) => c.transactionId))
      const rows = tagPool(target, transactions(), state.categories).filter((t) => !settled.has(t.id) && !dismissed.has(t.id))
      await jevTagCandidates(ai ?? jevClient(), target, rows, tagExamples(target, transactions()), {
        active: () => isCurrent() && options.active(),
        onCandidates: (found) => { if (isCurrent()) options.onCandidates(found) },
        onError: (error) => failures.push(error instanceof Error ? error.message : String(error)),
      })
    }
    return { failures, jev }
  }

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
