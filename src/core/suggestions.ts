import { savePurchaseLookups, type PurchaseLookup, saveMerchantNote } from "../db/client"
import { hasJev, type JevClient } from "../ai/jev"
import { merchantKey } from "../domain/history"
import { isOrdinaryFlow, isUncategorised } from "../domain/moneyRules"
import type { Transaction } from "../domain/types"
import type { createUpPush } from "./upPush"
import type { CoreContext } from "./context"
import { createLane } from "./lane"
import { suggestNow } from "./suggestionsRound"
import { createSuggestionActions } from "./suggestionsActions"

export function createSuggestions(ctx: CoreContext, deps: {
  applyCategories: ReturnType<typeof createUpPush>["applyCategories"]
  ruleOfferNote: (ids: number[]) => string
}) {
  const { state, mutate, transactions } = ctx
  const { judgeAsk, acceptSuggestions, dismissSuggestions } = createSuggestionActions(ctx, deps)

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
    return lane.run(() => suggestNow(ctx, ids, ai, options))
  }

  /** Ask again for `ids`' existing suggestions once the running round is
   * done, if the database is still the one they're in. Resolves to how many. */
  function askAgain(ids: number[], ai?: Pick<JevClient, "judge">): Promise<number> {
    const session = ctx.session()
    return lane.whenIdle(() => ctx.isCurrent(session) && ids.length ? suggestCategories(ids, ai, { replace: true }) : 0)
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
      ctx.mutateSession(session, "the merchant note was saved", (db) => saveMerchantNote(db, description, note), [])
      if (!ai && !hasJev()) return 0
      const key = merchantKey(description)
      const targets = transactions().filter((t) => merchantKey(t.description) === key && isOrdinaryFlow(t) && isUncategorised(t) && state.suggestions[t.id]).map((t) => t.id)
      return targets.length ? suggestCategories(targets, ai, { replace: true }) : 0
    })
  }

  return { suggestCategories, askAgain, resuggestLike, setMerchantNote, recordPurchases, judgeAsk, acceptSuggestions, dismissSuggestions }
}
