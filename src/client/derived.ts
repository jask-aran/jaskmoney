import { createEffect, createMemo, createRoot, createSignal, on } from "solid-js"
import { unwrap } from "solid-js/store"
import { selectedAccounts } from "../domain/accountTree"
import { paydays, type CycleConfig } from "../domain/budget"
import { categoryUses as findCategoryUses, merchantBreadth, notePrompts as findNotePrompts } from "../domain/suggest"
import { detectRecurring, detectTrips } from "../domain/tagGroups"
import { isOrdinaryFlow, isUncategorised } from "../domain/moneyRules"
import { ruleOffers, type RuleOffer } from "../domain/ruleOffers"
import { dryRunRules as evaluateRules } from "../domain/rules"
import type { DataState } from "./store"
import { lazyMemo } from "./lazyMemo"
export function createHistoryRows(state: DataState) {
  // Rows derived from the transactions, recomputed once per change and
  // shared by every reader. They work on the plain arrays behind the store:
  // `transactions` and `filterExpr` are only ever replaced whole, so
  // tracking those properties is enough.

  /** Every transaction, as the plain array behind the store. Readers that
   * walk all of them use this: through the store each field read would be
   * a tracked dependency, tens of thousands per pass. */
  const transactions = createRoot(() => createMemo(() => unwrap(state.transactions)))

  /** Merchants worth a note (domain/suggest notePrompts), by key. */
  // These four walk the whole history: computed when read (lazyMemo), not
  // on every write and at start whether anything reads them or not.
  const notePrompts = lazyMemo(() => findNotePrompts(transactions(), state.categories,
    new Map(Object.entries(state.merchantBreadth)), new Map(Object.entries(state.merchantNotes))))
  /** The account holder's examples per category, for Jev (suggest categoryUses). */
  const categoryUses = lazyMemo(() => findCategoryUses(transactions(), state.categories,
    merchantBreadth(transactions(), state.categories, new Map(Object.entries(state.merchantBreadth)))))
  /** The budget cycle with the pay dates `payEarly` needs. Everything that
   * works out cycles reads this, not `state.budgetCycle`. */
  const cycle = createRoot(() => createMemo((): CycleConfig => ({ ...state.budgetCycle, paydays: paydays(transactions()) })))
  /** Detected groupings in the history: trips, then regular payments. */
  const tagGroups = lazyMemo(() => [...detectTrips(transactions()), ...detectRecurring(transactions())])
  /** Order-email lookups so far, by row. */
  const purchaseLookups = createRoot(() => createMemo(() => new Map(Object.entries(state.purchaseLookups).map(([id, l]) => [Number(id), { ...l, items: l.items.map((item) => ({ ...item })) }]))))

  /** Transactions of the Transactions tab's selected account(s). */
  const accountScoped = createRoot(() => createMemo(() => {
    const ids = new Set(selectedAccounts(state.accounts, state.accountSelection).map((a) => a.id))
    return transactions().filter((t) => t.accountId != null && ids.has(t.accountId))
  }))

  return { transactions, notePrompts, categoryUses, cycle, tagGroups, purchaseLookups, accountScoped }
}

export function createSuggestTracking(state: DataState, transactions: ReturnType<typeof createHistoryRows>["transactions"]) {
  /** Rows background suggesting has asked about since the database opened:
   * one Jev couldn't place isn't asked again every sync. */
  const suggestTried = new Set<number>()
  /** Waiting rows with no suggestion that background suggesting hasn't tried. */
  const untriedWaiting = () => transactions().filter((t) => isOrdinaryFlow(t) && isUncategorised(t) && !state.suggestions[t.id] && !suggestTried.has(t.id)).map((t) => t.id)
  const markTried = (ids: number[]) => { for (const id of ids) suggestTried.add(id) }

  return { suggestTried, untriedWaiting, markTried }
}

export function createRuleOffers(state: DataState, transactions: ReturnType<typeof createHistoryRows>["transactions"]) {
  /** Rules worth making from your repeated categorisations (all of them, or
   * those for the descriptions of `ids`). */
  function ruleOffersFor(ids?: number[]): RuleOffer[] {
    if (!state.ready) return []
    const descriptions = ids && transactions().filter((t) => ids.includes(t.id)).map((t) => t.description)
    return ruleOffers(unwrap(state.categoryChoices), transactions(), unwrap(state.rules), unwrap(state.savedFilters), unwrap(state.categories), unwrap(state.tags), descriptions)
  }

  /** R's list: the repeat offers, then the model's (one per expression and
   * category). */
  const allRuleOffers = lazyMemo(() => {
    const repeat = ruleOffersFor()
    const saved = new Set(state.savedFilters.map((f) => f.expr.toLowerCase()))
    const ai = unwrap(state.aiRuleOffers).filter((o) => !saved.has(o.expr.toLowerCase()) && !repeat.some((r) => r.expr.toLowerCase() === o.expr.toLowerCase() && r.categoryId === o.categoryId && r.tagId === o.tagId))
    return [...repeat, ...ai]
  })

  /** How many rules are offered, for the footer's "R rules (n)": worked
   * out 150 ms after the last write rather than in its frame (the offers
   * walk the whole history). */
  const [ruleOfferCount, setRuleOfferCount] = createSignal(0)
  createRoot(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    createEffect(on(() => [transactions(), state.categoryChoices, state.rules, state.savedFilters, state.categories, state.tags, state.aiRuleOffers, state.ready], () => {
      clearTimeout(timer)
      timer = setTimeout(() => setRuleOfferCount(allRuleOffers().length), 150)
    }))
  })

  function dryRunRules(transactionIds?: number[]) {
    const ids = transactionIds ? new Set(transactionIds) : null
    return evaluateRules(ids ? transactions().filter((txn) => ids.has(txn.id)) : transactions(), unwrap(state.rules), unwrap(state.savedFilters), unwrap(state.categories), unwrap(state.tags))
  }

  return { ruleOffersFor, allRuleOffers, ruleOfferCount, dryRunRules }
}
