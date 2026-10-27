import { loadCategoryLog, loadTagLog, loadCategoryChoices, loadRuleDeclines, declineRule, declineCategoryChoice } from "../../db/client"
import { ruleOffers, type RuleOffer } from "../../domain/ruleOffers"
import type { HistoryData } from "../../domain/aiHistory"
import { createLlm, type Llm } from "../../ai/llm"
import { writeRules } from "../../ai/ruleWriter"
import { count } from "../../ui/text"
import type { createUpPush } from "./upPush"
import type { StoreContext } from "./context"

export function createRuleOffers(ctx: StoreContext, deps: { retryPendingCategories: ReturnType<typeof createUpPush>["retryPendingCategories"] }) {
  const { state, setState, mutate, transactions, recordUndo, saveSavedFilter, createSettingsRule, applyRules, deleteSettingsRule, deleteSavedFilter, restoreCategories } = ctx
  const { retryPendingCategories } = deps
  let offersCache: { key: readonly unknown[]; offers: RuleOffer[] } | null = null

  /** The history the AI reads (domain/aiHistory): current state and the logs. */
  function historyData(): HistoryData {
    return {
      transactions: transactions(), categories: state.categories, tags: state.tags, rules: state.rules, savedFilters: state.savedFilters,
      categoryLog: ctx.db ? loadCategoryLog(ctx.db) : [], tagLog: ctx.db ? loadTagLog(ctx.db) : [],
      categorySources: ctx.db ? new Map(ctx.db.query<{ id: number; source: string | null }, []>("SELECT id, category_source AS source FROM transactions").all().map((r) => [r.id, r.source])) : undefined,
    }
  }

  /** Rules worth making from your repeated categorisations (all of them, or
   * those for the descriptions of `ids`). */
  function ruleOffersFor(ids?: number[]): RuleOffer[] {
    if (!ctx.db) return []
    const descriptions = ids && transactions().filter((t) => ids.includes(t.id)).map((t) => t.description)
    return ruleOffers(loadCategoryChoices(ctx.db), transactions(), state.rules, state.savedFilters, state.categories, state.tags, descriptions)
  }

  /** R's list: the repeat offers, then the model's (one per expression and
   * category). Kept until a write, the rows, the saved filters or the
   * model's offers change: the footer asks on every key (~3.5ms to build). */
  function allRuleOffers(): RuleOffer[] {
    const key = [ctx.dbVersion, transactions(), state.savedFilters, state.aiRuleOffers] as const
    if (offersCache && offersCache.key.every((part, i) => part === key[i])) return offersCache.offers
    const repeat = ruleOffersFor()
    const saved = new Set(state.savedFilters.map((f) => f.expr.toLowerCase()))
    const ai = state.aiRuleOffers.filter((o) => !saved.has(o.expr.toLowerCase()) && !repeat.some((r) => r.expr.toLowerCase() === o.expr.toLowerCase() && r.categoryId === o.categoryId))
    offersCache = { key, offers: [...repeat, ...ai] }
    return offersCache.offers
  }

  /** Ask the general model for rules (ai/ruleWriter); `llm` replaces the
   * OpenRouter one (tests). Its offers replace the last run's. */
  async function askForRules(llm?: Llm, focus?: string): Promise<string> {
    if (!ctx.db) throw new Error("db not open")
    if (state.writingRules) throw new Error("Already asking for rules")
    setState({ writingRules: true })
    try {
      const model = llm ?? createLlm()
      const result = await writeRules(model, historyData(), { declined: loadRuleDeclines(ctx.db), focus })
      setState("aiRuleOffers", result.offers)
      const cost = result.usage.cost ? ` · $${result.usage.cost.toFixed(4)}` : ""
      if (result.error && !result.offers.length) return `No rules: ${result.error}${cost}`
      const turned = result.rejected.length ? `, ${result.rejected.length} turned down by the check` : ""
      return `${model.model.id.split("/").pop()} proposed ${count(result.offers.length, "rule")}${turned}${cost}`
    } finally {
      setState({ writingRules: false })
    }
  }

  /** " · R: rule for Coles → Groceries", or how many, for the rows just categorised. */
  function ruleOfferNote(ids: number[]): string {
    const offers = ruleOffersFor(ids)
    if (!offers.length) return ""
    if (offers.length > 1) return ` · R: ${offers.length} rules to make`
    const category = state.categories.find((c) => c.id === offers[0]!.categoryId)
    return ` · R: rule for ${offers[0]!.description} → ${category?.name ?? "?"}`
  }

  /** Make an offered rule: a saved filter and a rule (last in order), then
   * run it on the rows it finds waiting, Up rows sent to Up. */
  async function makeOfferedRule(offer: RuleOffer): Promise<string> {
    if (!ctx.db) throw new Error("db not open")
    const category = state.categories.find((c) => c.id === offer.categoryId)
    if (!category) throw new Error("category not found")
    const base = `desc-${offer.description.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "rule"}`
    let id = base
    for (let n = 2; state.savedFilters.some((f) => f.id === id); n++) id = `${base}-${n}`
    saveSavedFilter({ id, name: offer.description, expr: offer.expr })
    const ruleId = createSettingsRule({ name: `${offer.description} → ${category.name}`, savedFilterId: id, setCategoryId: category.id, addTagIds: [], enabled: true })
    setState("aiRuleOffers", (offers) => offers.filter((o) => o.expr !== offer.expr))
    const before = transactions().filter((t) => offer.waiting.includes(t.id)).map((t) => ({ id: t.id, categoryId: t.categoryId }))
    const applied = offer.waiting.length ? applyRules(offer.waiting) : null
    const changed = before.filter((row) => transactions().some((t) => t.id === row.id && t.categoryId !== row.categoryId))
    const sent = applied?.categoryChanges ? await retryPendingCategories() : null
    recordUndo(`rule ${offer.description} → ${category.name}`, async () => {
      deleteSettingsRule(ruleId)
      deleteSavedFilter(id)
      return restoreCategories(changed)
    })
    return [
      `Rule made: ${offer.description} → ${category.name}`,
      applied?.categoryChanges ? `${count(applied.categoryChanges, "waiting row")} categorised` : "",
      sent?.pushed ? `${sent.pushed} sent to Up` : "",
      sent?.waiting ? `${sent.waiting} waiting for Up` : "",
    ].filter(Boolean).join(" · ")
  }

  function declineRuleOffer(offer: RuleOffer): void {
    if (offer.source === "ai") {
      mutate((db) => declineRule(db, offer.expr, offer.categoryId))
      setState("aiRuleOffers", (offers) => offers.filter((o) => o !== offer && !(o.expr === offer.expr && o.categoryId === offer.categoryId)))
    } else mutate((db) => declineCategoryChoice(db, offer.description, offer.categoryId))
    recordUndo(`declined rule ${offer.description}`, async () => {
      mutate((db) => {
        if (offer.source === "ai") db.query("DELETE FROM rule_declines WHERE expr = ? AND category_id = ?").run(offer.expr, offer.categoryId)
        else db.query("UPDATE category_choices SET declined = 0 WHERE description = ? AND category_id = ?").run(offer.description.trim().toLowerCase(), offer.categoryId)
      })
      if (offer.source === "ai") setState("aiRuleOffers", (offers) => [...offers, offer])
      return ""
    })
  }

  return { historyData, ruleOffersFor, allRuleOffers, askForRules, ruleOfferNote, makeOfferedRule, declineRuleOffer }
}
