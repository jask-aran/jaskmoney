import { loadCategoryLog, loadTagLog, loadCategoryChoices, loadRuleDeclines, declineRule, declineCategoryChoice, undeclineRule } from "../db/client"
import { ruleOffers, type RuleOffer } from "../domain/ruleOffers"
import type { HistoryData } from "../domain/aiHistory"
import { createLlm, type Llm } from "../ai/llm"
import { writeRules } from "../ai/ruleWriter"
import { count } from "../domain/words"
import type { createUpPush } from "./upPush"
import type { CoreContext } from "./context"
import { createLane } from "./lane"
import type { CategorySource } from "../db/schema"

export function createRuleOffers(ctx: CoreContext, deps: Pick<ReturnType<typeof createUpPush>, "retryPendingCategories" | "retryPendingTags" | "applyTagPatch">) {
  const { state, set, mutate, transactions, recordUndo, saveSavedFilter, createSettingsRule, applyRules, deleteSettingsRule, deleteSavedFilter, restoreCategories } = ctx
  const { retryPendingCategories, retryPendingTags, applyTagPatch } = deps

  /** The history the AI reads (domain/aiHistory): current state and the logs. */
  function historyData(): HistoryData {
    return {
      transactions: transactions(), categories: state.categories, tags: state.tags, rules: state.rules, savedFilters: state.savedFilters,
      categoryLog: ctx.db ? loadCategoryLog(ctx.db) : [], tagLog: ctx.db ? loadTagLog(ctx.db) : [],
      categorySources: ctx.db ? new Map(ctx.db.query<{ id: number; source: CategorySource | null }, []>("SELECT id, category_source AS source FROM transactions").all().map((r) => [r.id, r.source])) : undefined,
    }
  }

  /** Rules worth making from your repeated categorisations (all of them, or
   * those for the descriptions of `ids`). */
  function ruleOffersFor(ids?: number[]): RuleOffer[] {
    if (!ctx.db) return []
    const descriptions = ids && transactions().filter((t) => ids.includes(t.id)).map((t) => t.description)
    return ruleOffers(loadCategoryChoices(ctx.db), transactions(), state.rules, state.savedFilters, state.categories, state.tags, descriptions)
  }

  /** Ask the general model for rules (ai/ruleWriter); `llm` replaces the
   * OpenRouter one (tests). Its offers replace the last run's. */
  const writing = createLane(ctx, "writingRules", "Already asking for rules")

  function askForRules(llm?: Llm, focus?: string): Promise<string> {
    return writing.run(async () => {
      const session = ctx.session()
      const model = llm ?? createLlm()
      const result = await writeRules(model, historyData(), { declined: loadRuleDeclines(session.db), focus })
      // Offers name this database's categories and tags.
      ctx.ensureCurrent(session, "the model wrote rules")
      set({ aiRuleOffers: result.offers })
      const cost = result.usage.cost ? ` · $${result.usage.cost.toFixed(4)}` : ""
      if (result.error && !result.offers.length) return `No rules: ${result.error}${cost}`
      const turned = result.rejected.length ? `, ${result.rejected.length} turned down by the check` : ""
      return `${model.model.id.split("/").pop()} proposed ${count(result.offers.length, "rule")}${turned}${cost}`
    })
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
    const session = ctx.session()
    const target = offer.tagId != null ? state.tags.find((t) => t.id === offer.tagId) : state.categories.find((c) => c.id === offer.categoryId)
    if (!target) throw new Error(offer.tagId != null ? "tag not found" : "category not found")
    const targetName = offer.tagId != null ? `+${target.name}` : target.name
    const base = `desc-${offer.description.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "rule"}`
    let id = base
    for (let n = 2; state.savedFilters.some((f) => f.id === id); n++) id = `${base}-${n}`
    saveSavedFilter({ id, name: offer.description, expr: offer.expr })
    const ruleId = createSettingsRule({ name: `${offer.description} → ${targetName}`, savedFilterId: id, setCategoryId: offer.categoryId, addTagIds: offer.tagId != null ? [offer.tagId] : [], enabled: true })
    set({ aiRuleOffers: state.aiRuleOffers.filter((o) => o.expr !== offer.expr) })
    const before = transactions().filter((t) => offer.waiting.includes(t.id)).map((t) => ({ id: t.id, categoryId: t.categoryId, tagIds: [...t.tagIds] }))
    const applied = offer.waiting.length ? applyRules(offer.waiting) : null
    const changed = before.filter((row) => transactions().some((t) => t.id === row.id && t.categoryId !== row.categoryId))
    const tagId = offer.tagId
    const tagged = tagId != null ? before.filter((row) => !row.tagIds.includes(tagId) && transactions().some((t) => t.id === row.id && t.tagIds.includes(tagId))).map((row) => row.id) : []
    const sent = applied?.categoryChanges ? await retryPendingCategories() : null
    ctx.ensureCurrent(session, "the rule's categories were sent to Up")
    if (applied?.tagChanges) await retryPendingTags()
    ctx.ensureCurrent(session, "the rule's rows were sent to Up")
    recordUndo(`rule ${offer.description} → ${targetName}`, async () => {
      const summary = await (tagId != null ? applyTagPatch(tagged, { [tagId]: "remove" }, "undo") : restoreCategories(changed))
      ctx.ensureCurrent(session, "the rule's rows were restored")
      deleteSettingsRule(ruleId)
      deleteSavedFilter(id)
      return summary
    })
    return [
      `Rule made: ${offer.description} → ${targetName}`,
      tagId != null ? (tagged.length ? `${count(tagged.length, "row")} tagged` : "") : applied?.categoryChanges ? `${count(applied.categoryChanges, "waiting row")} categorised` : "",
      sent?.pushed ? `${sent.pushed} sent to Up` : "",
      sent?.waiting ? `${sent.waiting} waiting for Up` : "",
    ].filter(Boolean).join(" · ")
  }

  function declineRuleOffer(offer: RuleOffer): void {
    if (offer.source === "ai") {
      mutate((db) => declineRule(db, offer.expr, offer.categoryId, offer.tagId))
      set({ aiRuleOffers: state.aiRuleOffers.filter((o) => !(o.expr === offer.expr && o.categoryId === offer.categoryId && o.tagId === offer.tagId)) })
    } else mutate((db) => declineCategoryChoice(db, offer.description, offer.categoryId))
    recordUndo(`declined rule ${offer.description}`, async () => {
      mutate((db) => offer.source === "ai" ? undeclineRule(db, offer.expr, offer.categoryId, offer.tagId) : declineCategoryChoice(db, offer.description, offer.categoryId, false))
      if (offer.source === "ai") set({ aiRuleOffers: [...state.aiRuleOffers, offer] })
      return ""
    })
  }

  return { historyData, askForRules, ruleOfferNote, makeOfferedRule, declineRuleOffer }
}
