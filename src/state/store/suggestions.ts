import { unwrap } from "solid-js/store"
import { saveSuggestions, loadDismissedSuggestionIds, deleteSuggestions, dismissSuggestionRows, undismissSuggestionRows, unrecordCategoryChoices } from "../../db/client"
import { hasJev, JEV_SETUP, jevClient, type JevClient } from "../../ai/jev"
import { historySuggestions, jevSuggestions } from "../../domain/suggest"
import { isOrdinaryFlow, isUncategorised } from "../../domain/moneyRules"
import type { Transaction } from "../../domain/types"
import { askCandidates, ASK_DEFAULT_DAYS, ASK_LIMIT, judgeRows } from "../../domain/ask"
import { askTerms, hasDateTerm, undecided, type AskVerdict } from "../../domain/filter"
import { MATCH_AT, NEAR_AT } from "../../domain/questions"
import { appToday } from "../../domain/days"
import { count } from "../../ui/text"
import { operationSummary, type createUpPush } from "./upPush"
import type { StoreContext } from "./context"

export function createSuggestions(ctx: StoreContext, deps: {
  applyCategories: ReturnType<typeof createUpPush>["applyCategories"]
  ruleOfferNote: (ids: number[]) => string
}) {
  const { state, setState, mutate, refresh, transactions, recordUndo, categorySnapshot, restoreCategories, askVerdicts, setAskVersion, askVerdict, accountScoped, inView } = ctx
  const { applyCategories, ruleOfferNote } = deps

  let suggestionsFinished: Promise<void> = Promise.resolve()

  /**
   * Suggest categories for ordinary uncategorised rows (`ids` narrows them)
   * that have none yet: history first, then Jev when it is set up, each
   * request's suggestions saved as they arrive. `ai` replaces the Jev client
   * (tests).
   */
  function suggestCategories(ids?: number[], ai?: Pick<JevClient, "judge">): Promise<string>
  function suggestCategories(ids: number[], ai: Pick<JevClient, "judge"> | undefined, options: { replace: true }): Promise<number>
  async function suggestCategories(ids?: number[], ai?: Pick<JevClient, "judge">, options: { replace?: boolean } = {}): Promise<string | number> {
    if (state.suggesting) throw new Error("Category suggestions are already running")
    if (!ctx.db) throw new Error("db not open")
    const database = ctx.db
    let finish = () => {}
    const finished = new Promise<void>((resolve) => { finish = resolve })
    suggestionsFinished = finished
    setState({ suggesting: true })
    try {
      const selected = ids ? new Set(ids) : null
      // Rows whose suggestion was dismissed get no new one.
      const dismissed = loadDismissedSuggestionIds(database)
      const targets = transactions().filter((t) => isOrdinaryFlow(t) && isUncategorised(t) && !dismissed.has(t.id) && (options.replace ? !!state.suggestions[t.id] : !state.suggestions[t.id]) && (!selected || selected.has(t.id)))
      const history = historySuggestions(transactions(), state.categories, new Set(targets.map((t) => t.id)))
      saveSuggestions(database, history)
      refresh()
      const failures: string[] = []
      let fromJev = 0
      const enabled = !!ai || hasJev()
      if (enabled) {
        const targetIds = new Set(targets.map((t) => t.id))
        const settled = new Set(history.map((s) => s.transactionId))
        const remaining = transactions().filter((t) => targetIds.has(t.id) && !settled.has(t.id) && (options.replace ? !!state.suggestions[t.id] : !state.suggestions[t.id]) && isOrdinaryFlow(t) && isUncategorised(t))
        if (remaining.length) await jevSuggestions(ai ?? jevClient(), remaining, state.categories, {
          history: transactions(),
          onSuggestion: (s) => {
            if (ctx.db !== database || !targetIds.has(s.transactionId)) return
            const current = transactions().find((t) => t.id === s.transactionId)
            if (!current || !isOrdinaryFlow(current) || !isUncategorised(current) || (options.replace ? !state.suggestions[s.transactionId] : state.suggestions[s.transactionId])) return
            saveSuggestions(database, [s])
            setState("suggestions", s.transactionId, s)
            fromJev++
          },
          onError: (ids, error) => failures.push(`${ids.length} rows: ${error instanceof Error ? error.message : String(error)}`),
        })
      }
      if (options.replace) return history.length + fromJev
      const parts = [`Suggested ${history.length + fromJev}: ${history.length} from history, ${fromJev} from Jev`]
      if (!enabled) parts.push(`Jev is not set up (${JEV_SETUP})`)
      if (failures.length) parts.push(`${failures.length} failed: ${failures[0]}`)
      return parts.join(" · ")
    } finally {
      try { if (ctx.db === database) refresh() } finally {
        if (suggestionsFinished === finished) setState({ suggesting: false })
        finish()
      }
    }
  }

  /** Replace existing suggestions for waiting rows with the same description. */
  async function resuggestLike(ids: number[], ai?: Pick<JevClient, "judge">): Promise<number> {
    const database = ctx.db
    while (state.suggesting) {
      await suggestionsFinished
      if (ctx.db !== database) return 0
    }
    if (!database || ctx.db !== database) return 0
    const selected = new Set(ids)
    const key = (t: Transaction) => t.description.trim().toLowerCase()
    const descriptions = new Set(transactions().filter((t) => selected.has(t.id)).map(key))
    const targets = transactions().filter((t) => !selected.has(t.id) && descriptions.has(key(t)) && isOrdinaryFlow(t) && isUncategorised(t) && state.suggestions[t.id]).map((t) => t.id)
    if (!targets.length) return 0
    return suggestCategories(targets, ai, { replace: true })
  }

  /**
   * Have Jev judge the rows the current filter's `ask:` terms are waiting
   * on: those the rest of the filter leaves possible, not judged yet, from
   * the last ASK_DEFAULT_DAYS unless the filter limits dates, at most
   * ASK_LIMIT, newest first. Matches show as each batch lands. Returns a
   * summary, or "" when a newer run or a cleared filter took over.
   */
  async function askAbout(ai?: Pick<JevClient, "judge">): Promise<string> {
    const expr = state.filterExpr ? unwrap(state.filterExpr) : null
    const terms = askTerms(expr)
    if (!terms.length) return ""
    if (!ai && !hasJev()) throw new Error(`ask: needs Jev (${JEV_SETUP})`)
    const run = ++ctx.askRun
    const client = ai ?? jevClient()
    const parts: string[] = []
    const failures: string[] = []
    try {
      // One term at a time: each verdict narrows the rows the next must judge.
      for (const words of terms) {
        const key = words.toLowerCase()
        const known = askVerdicts.get(key) ?? new Map<number, number>()
        askVerdicts.set(key, known)
        // Rows whose match turns on these words: not ruled out by the rest of
        // the filter, nor matched without them (a covered category's rows).
        const others: AskVerdict<Transaction> = (w, t) => w.toLowerCase() === key ? undefined : askVerdict(w, t)
        const possible = accountScoped().filter((t) => inView(t) && undecided(expr, t, others))
        const { rows, skipped } = askCandidates(possible, appToday(), hasDateTerm(expr))
        const todo = rows.filter((t) => !known.has(t.id))
        setState({ asking: { words, judged: 0, total: todo.length } })
        await judgeRows(client, words, todo, {
          active: () => run === ctx.askRun,
          onJudged: (scores) => {
            if (run !== ctx.askRun) return
            for (const [id, p] of scores) known.set(id, p)
            setAskVersion((v) => v + 1)
            setState("asking", (a) => a && { ...a, judged: a.judged + scores.size })
          },
          onError: (error) => failures.push(error instanceof Error ? error.message : String(error)),
        })
        if (run !== ctx.askRun) return ""
        const matched = rows.filter((t) => (known.get(t.id) ?? 0) >= MATCH_AT).length
        const near = rows.filter((t) => { const p = known.get(t.id) ?? 0; return p >= NEAR_AT && p < MATCH_AT }).length
        let part = `ask "${words}": ${matched} of ${rows.length} match`
        if (near) part += `, ${near} near (n shows them)`
        if (skipped && !hasDateTerm(expr)) part += ` · judged the last ${ASK_DEFAULT_DAYS} days (add date: to look further)`
        else if (skipped) part += ` · judged the latest ${ASK_LIMIT} of ${rows.length + skipped}`
        parts.push(part)
      }
    } finally {
      if (run === ctx.askRun) setState({ asking: null })
    }
    if (failures.length) parts.push(`${failures.length} request${failures.length > 1 ? "s" : ""} failed: ${failures[0]}`)
    return parts.join(" · ")
  }

  /** Rows background suggesting has asked about since the database opened:
   * one Jev couldn't place isn't asked again every sync. */
  const suggestTried = new Set<number>()
  /** Waiting rows with no suggestion that background suggesting hasn't tried. */
  const untriedWaiting = () => transactions().filter((t) => isOrdinaryFlow(t) && isUncategorised(t) && !state.suggestions[t.id] && !suggestTried.has(t.id)).map((t) => t.id)
  const markTried = (ids: number[]) => { for (const id of ids) suggestTried.add(id) }

  /** Categorise the rows among `ids` that have a suggestion as suggested,
   * all at once (see applyCategories), then clear the suggestions that
   * took; a row Up rejected keeps its suggestion. */
  async function acceptSuggestions(ids: number[], onProgress?: (pushed: number, total: number) => void): Promise<string> {
    if (!ctx.db) throw new Error("db not open")
    refresh()
    const assignments = new Map<number, number>()
    for (const id of ids) {
      const suggestion = state.suggestions[id]
      if (suggestion) assignments.set(id, suggestion.categoryId)
    }
    if (!assignments.size) return "No suggestions accepted"
    const before = categorySnapshot(assignments)
    const suggestions = [...assignments.keys()].flatMap((id) => state.suggestions[id] ? [{ ...unwrap(state.suggestions[id]!) }] : [])
    const result = await applyCategories(assignments, "accept", onProgress)
    const accepted = [...assignments].filter(([id, categoryId]) => transactions().some((t) => t.id === id && t.categoryId === categoryId)).map(([id]) => id)
    mutate((db) => deleteSuggestions(db, accepted))
    if (accepted.length) recordUndo(`accepted ${count(accepted.length, "suggestion")}`, async () => {
      const summary = await restoreCategories(before.filter((row) => accepted.includes(row.id)))
      mutate((db) => {
        unrecordCategoryChoices(db, before.map((row) => ({ description: row.description, categoryId: assignments.get(row.id)!, times: 1 })))
        saveSuggestions(db, suggestions.filter((s) => accepted.includes(s.transactionId)))
      })
      return summary
    })
    return operationSummary(`Accepted ${result.done} suggestion${result.done === 1 ? "" : "s"}`, result) + ruleOfferNote(accepted)
  }

  function dismissSuggestions(ids: number[]): void {
    // Kept and marked: re-suggesting (i, a sync) won't make it again.
    const dismissed = [...new Set(ids)].filter((id) => state.suggestions[id])
    mutate((db) => dismissSuggestionRows(db, dismissed))
    if (dismissed.length) recordUndo(`dismissed ${count(dismissed.length, "suggestion")}`, async () => {
      mutate((db) => undismissSuggestionRows(db, dismissed))
      return ""
    })
  }

  return { suggestCategories, resuggestLike, askAbout, suggestTried, untriedWaiting, markTried, acceptSuggestions, dismissSuggestions }
}
