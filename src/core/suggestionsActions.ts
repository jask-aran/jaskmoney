import { saveSuggestions, deleteSuggestions, dismissSuggestionRows, undismissSuggestionRows, unrecordCategoryChoices } from "../db/client"
import { hasJev, JEV_SETUP, jevClient, type JevClient } from "../ai/jev"
import { judgeRows } from "../domain/ask"
import { count } from "../domain/words"
import { operationSummary } from "./upPush"
import type { CoreContext } from "./context"
import type { createSuggestions } from "./suggestions"

export function createSuggestionActions(ctx: CoreContext, deps: Parameters<typeof createSuggestions>[1]) {
  const { state, mutate, refresh, transactions, recordUndo, categorySnapshot, restoreCategories } = ctx
  const { applyCategories, ruleOfferNote } = deps

  async function judgeAsk(words: string, ids: number[], ai: Pick<JevClient, "judge"> | undefined, options: {
    onJudged: (scores: Array<[number, number]>) => void; active: () => boolean
  }): Promise<string[]> {
    if (!ai && !hasJev()) throw new Error(`ask: needs Jev (${JEV_SETUP})`)
    const session = ctx.db ? ctx.session() : null
    const isCurrent = () => session ? ctx.isCurrent(session) : ctx.db == null
    const byId = new Map(transactions().map((t) => [t.id, t]))
    const rows = ids.flatMap((id) => byId.get(id) ?? [])
    const failures: string[] = []
    await judgeRows(ai ?? jevClient(), words, rows, {
      active: () => isCurrent() && options.active(),
      onJudged: (scores) => { if (isCurrent()) options.onJudged([...scores]) },
      onError: (error) => failures.push(error instanceof Error ? error.message : String(error)),
    })
    if (!isCurrent()) return []
    return failures
  }

  async function acceptSuggestions(ids: number[], onProgress?: (pushed: number, total: number) => void): Promise<string> {
    const session = ctx.session()
    refresh([])
    const assignments = new Map<number, number>()
    for (const id of ids) {
      const suggestion = state.suggestions[id]
      if (suggestion) assignments.set(id, suggestion.categoryId)
    }
    if (!assignments.size) return "No suggestions accepted"
    const before = categorySnapshot(assignments)
    const suggestions = [...assignments.keys()].flatMap((id) => state.suggestions[id] ? [{ ...state.suggestions[id]! }] : [])
    const result = await applyCategories(assignments, "accept", onProgress, () => {
      const byId = new Map(transactions().map(t => [t.id, t]))
      const accepted = new Set([...assignments].filter(([id, categoryId]) => byId.get(id)?.categoryId === categoryId).map(([id]) => id))
      if (accepted.size) recordUndo(`accepted ${count(accepted.size, "suggestion")}`, async () => {
        const summary = await restoreCategories(before.filter((row) => accepted.has(row.id)))
        ctx.mutateSession(session, "suggestions were restored", (db) => {
          unrecordCategoryChoices(db, before.map((row) => ({ description: row.description, categoryId: assignments.get(row.id)!, times: 1 })))
          saveSuggestions(db, suggestions.filter((s) => accepted.has(s.transactionId)))
        }, [])
        return summary
      })
    })
    ctx.ensureCurrent(session, "suggestions were accepted")
    const byId = new Map(transactions().map(t => [t.id, t]))
    const accepted = [...assignments].filter(([id, categoryId]) => byId.get(id)?.categoryId === categoryId).map(([id]) => id)
    ctx.mutateSession(session, "suggestions were accepted", (db) => deleteSuggestions(db, accepted), [])
    return operationSummary(`Accepted ${result.done} suggestion${result.done === 1 ? "" : "s"}`, result) + ruleOfferNote(accepted)
  }

  function dismissSuggestions(ids: number[]): void {
    const dismissed = [...new Set(ids)].filter((id) => state.suggestions[id])
    mutate((db) => dismissSuggestionRows(db, dismissed))
    if (dismissed.length) recordUndo(`dismissed ${count(dismissed.length, "suggestion")}`, async () => {
      mutate((db) => undismissSuggestionRows(db, dismissed))
      return ""
    })
  }

  return { judgeAsk, acceptSuggestions, dismissSuggestions }
}
