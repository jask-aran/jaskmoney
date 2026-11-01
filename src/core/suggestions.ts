import { savePurchaseLookups, type PurchaseLookup, saveSuggestions, loadMerchantBreadth, saveMerchantBreadth, loadMerchantNotes, saveMerchantNote, loadDismissedSuggestionIds, deleteSuggestions, dismissSuggestionRows, undismissSuggestionRows, unrecordCategoryChoices } from "../db/client"
import { hasJev, JEV_SETUP, jevClient, type JevClient } from "../ai/jev"
import { askMerchantBreadth, capSuggestion, historySuggestions, jevSuggestions, merchantBreadth, suggestionCap, unaskedMerchants } from "../domain/suggest"
import { merchantKey } from "../domain/history"
import { isOrdinaryFlow, isUncategorised } from "../domain/moneyRules"
import type { CategorySuggestion, Transaction } from "../domain/types"
import { judgeRows } from "../domain/ask"
import { count } from "../domain/words"
import { operationSummary, type createUpPush } from "./upPush"
import type { CoreContext } from "./context"
import { createLane } from "./lane"

export function createSuggestions(ctx: CoreContext, deps: {
  applyCategories: ReturnType<typeof createUpPush>["applyCategories"]
  ruleOfferNote: (ids: number[]) => string
}) {
  const { state, set, mutate, refresh, transactions, recordUndo, categorySnapshot, restoreCategories } = ctx
  const { applyCategories, ruleOfferNote } = deps

  // One round at a time; a re-ask (a note, a purchase found) waits its turn.
  const lane = createLane(ctx, "suggesting", "Category suggestions are already running")

  /**
   * Suggest categories for ordinary uncategorised rows (`ids` narrows them)
   * that have none yet: history first, then Jev when it is set up, each
   * request's suggestions saved as they arrive. `ai` replaces the Jev client
   * (tests).
   */
  function suggestCategories(ids?: number[], ai?: Pick<JevClient, "judge">): Promise<string>
  function suggestCategories(ids: number[], ai: Pick<JevClient, "judge"> | undefined, options: { replace: true }): Promise<number>
  function suggestCategories(ids?: number[], ai?: Pick<JevClient, "judge">, options: { replace?: boolean } = {}): Promise<string | number> {
    return lane.run(() => suggestNow(ids, ai, options))
  }

  async function suggestNow(ids: number[] | undefined, ai: Pick<JevClient, "judge"> | undefined, options: { replace?: boolean }): Promise<string | number> {
    const session = ctx.session()
    const database = session.db
    try {
      const selected = ids ? new Set(ids) : null
      // Rows whose suggestion was dismissed get no new one.
      const dismissed = loadDismissedSuggestionIds(database)
      const targets = transactions().filter((t) => isOrdinaryFlow(t) && isUncategorised(t) && !dismissed.has(t.id) && (options.replace ? !!state.suggestions[t.id] : !state.suggestions[t.id]) && (!selected || selected.has(t.id)))
      const enabled = !!ai || hasJev()
      const failures: string[] = []
      // Which merchants' names don't say what was bought (eBay, Kmart): asked
      // once per name, then kept.
      const asked = loadMerchantBreadth(database)
      const notes = loadMerchantNotes(database)
      const unasked = enabled ? unaskedMerchants(transactions(), asked) : []
      if (unasked.length) await askMerchantBreadth(ai ?? jevClient(), unasked, {
        notes,
        onAnswers: (answers) => {
          if (!ctx.isCurrent(session)) return
          saveMerchantBreadth(database, answers)
          for (const [k, p] of answers) asked.set(k, p)
        },
        onError: (error) => failures.push(`merchants: ${error instanceof Error ? error.message : String(error)}`),
      })
      const breadth = merchantBreadth(transactions(), state.categories, asked)
      capStored(database, breadth)
      // Each suggestion says whether it knew what its row bought (order emails).
      const knew = new Set(transactions().filter((t) => t.bought?.length).map((t) => t.id))
      const history = historySuggestions(transactions(), state.categories, new Set(targets.map((t) => t.id)), breadth).map((h) => (knew.has(h.transactionId) ? { ...h, knewBought: true } : h))
      saveSuggestions(database, history)
      refresh()
      let fromJev = 0
      if (enabled) {
        const targetIds = new Set(targets.map((t) => t.id))
        const settled = new Set(history.map((s) => s.transactionId))
        const remaining = transactions().filter((t) => targetIds.has(t.id) && !settled.has(t.id) && (options.replace ? !!state.suggestions[t.id] : !state.suggestions[t.id]) && isOrdinaryFlow(t) && isUncategorised(t))
        // A request's answers arrive together: saved in one write and shown
        // in one update. One at a time, each update re-sorts the table, and
        // a few hundred answers hold the screen for seconds.
        let pending: CategorySuggestion[] = []
        const flush = () => {
          const arrived = pending
          pending = []
          if (!ctx.isCurrent(session) || !arrived.length) return
          const byId = new Map(transactions().map((t) => [t.id, t]))
          const fresh = arrived.filter((s) => {
            const current = byId.get(s.transactionId)
            return current && isOrdinaryFlow(current) && isUncategorised(current) && (options.replace ? !!state.suggestions[s.transactionId] : !state.suggestions[s.transactionId])
          }).map((s) => (byId.get(s.transactionId)?.bought?.length ? { ...s, knewBought: true } : s))
          if (!fresh.length) return
          saveSuggestions(database, fresh)
          set({ suggestions: { ...state.suggestions, ...Object.fromEntries(fresh.map((s) => [s.transactionId, s])) } })
          fromJev += fresh.length
        }
        if (remaining.length) await jevSuggestions(ai ?? jevClient(), remaining, state.categories, {
          history: transactions(),
          breadth,
          notes,
          onSuggestion: (s) => {
            if (!ctx.isCurrent(session) || !targetIds.has(s.transactionId)) return
            if (!pending.length) queueMicrotask(flush)
            pending.push(s)
          },
          onError: (ids, error) => failures.push(`${ids.length} rows: ${error instanceof Error ? error.message : String(error)}`),
        })
        flush()
      }
      if (options.replace) return history.length + fromJev
      const parts = [`Suggested ${history.length + fromJev}: ${history.length} from history, ${fromJev} from Jev`]
      if (!enabled) parts.push(`Jev is not set up (${JEV_SETUP})`)
      if (failures.length) parts.push(`${failures.length} failed: ${failures[0]}`)
      return parts.join(" · ")
    } finally {
      if (ctx.isCurrent(session)) refresh()
    }
  }

  /** Ask again for `ids`' existing suggestions once the running round is
   * done, if the database is still the one they're in. Resolves to how many. */
  function askAgain(ids: number[], ai?: Pick<JevClient, "judge">): Promise<number> {
    const session = ctx.session()
    return lane.whenIdle(() => ctx.isCurrent(session) && ids.length ? suggestCategories(ids, ai, { replace: true }) : 0)
  }

  /** Hold stored suggestions to what their row can say: one made before a
   * merchant was known to be mixed (eBay at 100%) drops to a guess. */
  function capStored(database: NonNullable<typeof ctx.db>, breadth: Parameters<typeof suggestionCap>[1]) {
    const byId = new Map(transactions().map((t) => [t.id, t]))
    const changed = Object.values(state.suggestions).flatMap((s) => {
      const t = s && byId.get(s.transactionId)
      if (!s || !t) return []
      const capped = capSuggestion(s, suggestionCap(t, breadth))
      if (capped === s) return []
      // Capped for want of items: once they're known, it's asked again.
      const { knewBought: _, ...rest } = capped
      return [t.bought?.length ? capped : rest]
    })
    if (!changed.length) return
    saveSuggestions(database, changed)
    set({ suggestions: { ...state.suggestions, ...Object.fromEntries(changed.map((s) => [s.transactionId, s])) } })
  }

  /** Replace existing suggestions for waiting rows with the same description. */
  function resuggestLike(ids: number[], ai?: Pick<JevClient, "judge">): Promise<number> {
    const session = ctx.session()
    return lane.whenIdle(() => {
      if (!ctx.isCurrent(session)) return 0
      const selected = new Set(ids)
      const key = (t: Transaction) => t.description.trim().toLowerCase()
      const descriptions = new Set(transactions().filter((t) => selected.has(t.id)).map(key))
      const targets = transactions().filter((t) => !selected.has(t.id) && descriptions.has(key(t)) && isOrdinaryFlow(t) && isUncategorised(t) && state.suggestions[t.id]).map((t) => t.id)
      return targets.length ? suggestCategories(targets, ai, { replace: true }) : 0
    })
  }

  /**
   * Save a round of purchase lookups (rows found get what they bought in
   * their facts), then ask again for waiting rows whose suggestion was made
   * without knowing what they bought, whenever that was. Returns how many
   * were asked again.
   */
  async function recordPurchases(lookups: PurchaseLookup[], ai?: Pick<JevClient, "judge">, sessionId?: number): Promise<number> {
    if (!ctx.db) return 0
    // Looked up for the rows of another database (demo mode came on meanwhile).
    if (sessionId != null && sessionId !== state.session) throw new Error("The database changed while purchases were looked up; nothing was saved")
    const session = ctx.session()
    if (lookups.length) mutate((db) => savePurchaseLookups(db, lookups))
    if (!ai && !hasJev()) return 0
    return lane.whenIdle(() => {
      if (!ctx.isCurrent(session)) return 0
      const targets = transactions().filter((t) => t.bought?.length && isOrdinaryFlow(t) && isUncategorised(t) && state.suggestions[t.id] && !state.suggestions[t.id]!.knewBought).map((t) => t.id)
      return targets.length ? suggestCategories(targets, ai, { replace: true }) : 0
    })
  }

  /** Save a merchant's note and replace its waiting rows' existing suggestions. */
  function setMerchantNote(description: string, note: string, ai?: Pick<JevClient, "judge">): Promise<number> {
    const session = ctx.session()
    // Saved once the running round is done: it reads the notes it started with.
    return lane.whenIdle(() => {
      if (!ctx.isCurrent(session)) return 0
      mutate((db) => saveMerchantNote(db, description, note))
      if (!ai && !hasJev()) return 0
      const key = merchantKey(description)
      const targets = transactions().filter((t) => merchantKey(t.description) === key && isOrdinaryFlow(t) && isUncategorised(t) && state.suggestions[t.id]).map((t) => t.id)
      return targets.length ? suggestCategories(targets, ai, { replace: true }) : 0
    })
  }

  /** Have Jev judge `ids` (in that order) for an `ask:` term, `onJudged`
   * hearing each batch's scores; stops sending once `active` says no. The
   * client chose the rows (domain/ask askCandidates) and keeps the verdicts. */
  async function judgeAsk(words: string, ids: number[], ai: Pick<JevClient, "judge"> | undefined, options: {
    onJudged: (scores: Array<[number, number]>) => void; active: () => boolean
  }): Promise<string[]> {
    if (!ai && !hasJev()) throw new Error(`ask: needs Jev (${JEV_SETUP})`)
    const byId = new Map(transactions().map((t) => [t.id, t]))
    const rows = ids.flatMap((id) => byId.get(id) ?? [])
    const failures: string[] = []
    await judgeRows(ai ?? jevClient(), words, rows, {
      active: options.active,
      onJudged: (scores) => options.onJudged([...scores]),
      onError: (error) => failures.push(error instanceof Error ? error.message : String(error)),
    })
    return failures
  }

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
    const suggestions = [...assignments.keys()].flatMap((id) => state.suggestions[id] ? [{ ...state.suggestions[id]! }] : [])
    const result = await applyCategories(assignments, "accept", onProgress, () => {
      const accepted = [...assignments].filter(([id, categoryId]) => transactions().some((t) => t.id === id && t.categoryId === categoryId)).map(([id]) => id)
      if (accepted.length) recordUndo(`accepted ${count(accepted.length, "suggestion")}`, async () => {
        const summary = await restoreCategories(before.filter((row) => accepted.includes(row.id)))
        mutate((db) => {
          unrecordCategoryChoices(db, before.map((row) => ({ description: row.description, categoryId: assignments.get(row.id)!, times: 1 })))
          saveSuggestions(db, suggestions.filter((s) => accepted.includes(s.transactionId)))
        })
        return summary
      })
    })
    const accepted = [...assignments].filter(([id, categoryId]) => transactions().some((t) => t.id === id && t.categoryId === categoryId)).map(([id]) => id)
    mutate((db) => deleteSuggestions(db, accepted))
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

  return { suggestCategories, askAgain, resuggestLike, setMerchantNote, recordPurchases, judgeAsk, acceptSuggestions, dismissSuggestions }
}
