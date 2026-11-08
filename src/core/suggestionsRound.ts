import { saveSuggestions, loadMerchantBreadth, saveMerchantBreadth, loadMerchantNotes, loadDismissedSuggestionIds } from "../db/client"
import { hasJev, JEV_SETUP, jevClient, type JevClient } from "../ai/jev"
import { askMerchantBreadth, capSuggestion, historySuggestions, jevSuggestions, merchantBreadth, suggestionCap, unaskedMerchants } from "../domain/suggest"
import { isOrdinaryFlow, isUncategorised } from "../domain/moneyRules"
import type { CategorySuggestion, Transaction } from "../domain/types"
import type { CoreContext, Session } from "./context"

/** One round of category suggestions (suggestCategories in ./suggestions). */
export async function suggestNow(ctx: CoreContext, ids: number[] | undefined, ai: Pick<JevClient, "judge"> | undefined, options: { replace?: boolean }): Promise<string | number> {
  const { state, refresh, transactions } = ctx
  const session = ctx.session()
  const database = session.db
  // Whether anything since the last reload wrote to the database.
  const track = { wrote: false }
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
        track.wrote = true
        for (const [k, p] of answers) asked.set(k, p)
      },
      onError: (error) => failures.push(`merchants: ${error instanceof Error ? error.message : String(error)}`),
    })
    if (!ctx.isCurrent(session)) return options.replace ? 0 : ""
    const breadth = merchantBreadth(transactions(), state.categories, asked)
    if (capStored(ctx, database, breadth)) track.wrote = true
    // Each suggestion says whether it knew what its row bought (order emails).
    const knew = new Set(transactions().filter((t) => t.bought?.length).map((t) => t.id))
    const history = historySuggestions(transactions(), state.categories, new Set(targets.map((t) => t.id)), breadth).map((h) => (knew.has(h.transactionId) ? { ...h, knewBought: true } : h))
    // A reload follows each write. With nothing written (the view opened
    // again, every row already suggested) the clients already match the
    // database, and a reload would rebuild everything that reads the rows.
    if (history.length) saveSuggestions(database, history)
    // Suggestions and merchants' checks aren't in the rows: no row changed.
    if (history.length || track.wrote) { refresh([]); track.wrote = false }
    let fromJev = 0
    if (enabled) {
      const jev = await suggestFromJev(ctx, session, { targets, history, ai, options, breadth, notes, failures, track })
      if (jev === null) return options.replace ? 0 : ""
      fromJev = jev
    }
    if (options.replace) return history.length + fromJev
    const parts = [`Suggested ${history.length + fromJev}: ${history.length} from history, ${fromJev} from Jev`]
    if (!enabled) parts.push(`Jev is not set up (${JEV_SETUP})`)
    if (failures.length) parts.push(`${failures.length} failed: ${failures[0]}`)
    return parts.join(" · ")
  } finally {
    if (track.wrote && ctx.isCurrent(session)) refresh([])
  }
}

/** Jev's part of a round: the targets history didn't settle, each request's
 * suggestions saved as they arrive. How many it made; null when the database
 * changed meanwhile. */
async function suggestFromJev(ctx: CoreContext, session: Session, round: {
  targets: Transaction[]; history: CategorySuggestion[]; ai: Pick<JevClient, "judge"> | undefined; options: { replace?: boolean }
  breadth: ReturnType<typeof merchantBreadth>; notes: ReturnType<typeof loadMerchantNotes>; failures: string[]; track: { wrote: boolean }
}): Promise<number | null> {
  const { state, set, transactions } = ctx
  const { targets, history, ai, options, breadth, notes, failures, track } = round
  const database = session.db
  let fromJev = 0
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
    track.wrote = true
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
  if (!ctx.isCurrent(session)) return null
  flush()
  return fromJev
}

/** Hold stored suggestions to what their row can say: one made before a
 * merchant was known to be mixed (eBay at 100%) drops to a guess. */
function capStored(ctx: CoreContext, database: NonNullable<typeof ctx.db>, breadth: Parameters<typeof suggestionCap>[1]) {
  const { state, set, transactions } = ctx
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
  if (!changed.length) return false
  saveSuggestions(database, changed)
  set({ suggestions: { ...state.suggestions, ...Object.fromEntries(changed.map((s) => [s.transactionId, s])) } })
  return true
}
