import type { RuleDecline } from "../db/client"
import { Type } from "@earendil-works/pi-ai"
import { categoryHistory, tagHistory, FILTER_GUIDE, findRows, matchReport, waitingOverview, type HistoryData } from "../domain/aiHistory"
import { isUncategorised } from "../domain/moneyRules"
import { RULE_AFTER, RULE_SHARE, type RuleOffer } from "../domain/ruleOffers"
import { agentTool, runAgent, type AgentUsage } from "./harness"
import type { Llm } from "./llm"

/**
 * The general model writes category or tag rules from the history. It reads an
 * overview, looks at categories and tests expressions with read-only tools,
 * then proposes rules; each proposal is checked here against the same bar
 * the repeat heuristic uses (RULE_SHARE precision, RULE_AFTER rows already in
 * the category, not done by a rule already, not declined) before it is
 * offered. Nothing is made until you accept it.
 */
export const RULE_WRITER_TURNS = 14
/** History calls a run may make: after these it tests what it has. */
export const HISTORY_LOOKS = 10
const PROPOSALS = 8

const SYSTEM = `You write categorisation rules for a personal finance app.
A rule is a filter expression and a category: every new transaction the filter finds is put in that category on sync, without review. So a rule must be precise: the rows it finds should already be (nearly) all in that category.
A rule can instead add a tag: give the exact tag name instead of a category, with the same precision and minimum evidence bar. For tags, waiting means found rows without the tag; Up categorisation does not matter. Use tag_history to inspect tag evidence and recent manual changes; never propose IGNORE.
The bank (Up) categorises most card purchases itself. Rules matter for what it leaves: transfers, payments to and from people, bills paid by transfer, deposits, and merchants the user keeps categorising by hand (recent_choices).
Work from evidence, and be economical: you have ${RULE_WRITER_TURNS} turns, and the last can only answer. Start from the categories with recent_choices and from the waiting rows in the brief; look at a category with category_history only when you have a candidate for it; don't survey every category. Test every rule with test_rule before proposing it (several tests per turn is fine). Only propose rules whose test shows precision of at least ${RULE_SHARE}, at least ${RULE_AFTER} rows in the category, and already_by_rules false. A rule whose rows Up already categorised itself (set_by_up close to in_target, nothing waiting) adds nothing: skip it. Be wary of payments to a person (a $handle or a name): what they're for changes; an amount range only holds while amounts don't overlap. Prefer rules that cover the user's recent choices or rows waiting for a category. Use the narrowest expression that does the job (an exact description in quotes beats a single common word); combine terms with OR to cover several descriptions of one thing, and with amt:, acc: or type: to separate look-alikes. Don't propose a rule an existing rule or a declined rule already covers.
Answer with finish. Give each rule a short name, the exact category or tag name, the expression, and why in one sentence citing the evidence. Propose nothing rather than a weak rule.

${FILTER_GUIDE}`

export type ProposedRule = { name: string; expr: string; why: string } & ({ category: string; tag?: never } | { tag: string; category?: never })

export interface RuleWriterResult {
  offers: RuleOffer[]
  /** Proposals the check turned down, and why (shown in logs and tests). */
  rejected: { rule: ProposedRule; reason: string }[]
  usage: AgentUsage
  turns: number
  /** The model's tool calls, in order (for tuning). */
  calls: { name: string; args: unknown }[]
  error?: string
}

/** What the model starts from: categories, where recent work went, what's waiting, the rules there are. */
export function ruleWriterBrief(data: HistoryData, declined: RuleDecline[], focus?: string) {
  const recent = new Map<number, number>()
  for (const e of data.categoryLog) if (e.categoryId != null && e.how !== "rule") recent.set(e.categoryId, (recent.get(e.categoryId) ?? 0) + 1)
  const recentTags = new Map<number, number>()
  for (const e of data.tagLog) if (e.how === "picker" || e.how === "review") recentTags.set(e.tagId, (recentTags.get(e.tagId) ?? 0) + 1)
  const tagName = (id: number) => data.tags.find((t) => t.id === id)?.name ?? "?"
  const name = (id: number) => data.categories.find((c) => c.id === id)?.name ?? "?"
  return {
    ...(focus ? { focus: `Rules for ${focus}` } : {}),
    categories: data.categories.filter((c) => !c.isDefault).map((c) => ({
      name: c.name,
      rows: data.transactions.filter((t) => t.categoryId === c.id).length,
      ...(recent.get(c.id) ? { recent_choices: recent.get(c.id) } : {}),
    })),
    tags: data.tags.filter((t) => t.name.toUpperCase() !== "IGNORE").map((t) => ({
      name: t.name,
      rows: data.transactions.filter((row) => row.tagIds.includes(t.id)).length,
      ...(recentTags.get(t.id) ? { recent_changes: recentTags.get(t.id) } : {}),
    })),
    waiting: waitingOverview(data, 30),
    rules: data.rules.filter((r) => r.enabled).map((r) => ({ name: r.name, expr: data.savedFilters.find((f) => f.id === r.savedFilterId)?.expr ?? "", category: r.setCategoryId != null ? name(r.setCategoryId) : null, ...(r.addTagIds.length ? { tags: r.addTagIds.map(tagName) } : {}) })),
    declined: declined.map((d) => d.tagId != null ? { expr: d.expr, tag: tagName(d.tagId) } : { expr: d.expr, category: name(d.categoryId) }),
  }
}

export async function writeRules(
  llm: Llm,
  data: HistoryData,
  options: { declined?: RuleDecline[]; focus?: string; signal?: AbortSignal } = {},
): Promise<RuleWriterResult> {
  const declined = options.declined ?? []
  let looks = 0
  const categoryNamed = (name: string) => data.categories.find((c) => c.name.toLowerCase() === name.trim().toLowerCase())
  const tagNamed = (name: string) => data.tags.find((t) => t.name.toLowerCase() === name.trim().toLowerCase())
  // Flat optional fields, checked in code: providers' tool schemas want a
  // plain object (OpenAI refuses anyOf/allOf at the top).
  const target = {
    category: Type.Optional(Type.String({ description: "Exact category name (or tag, not both)" })),
    tag: Type.Optional(Type.String({ description: "Exact tag name (or category, not both)" })),
  }
  const oneTarget = (rule: { category?: string; tag?: string }) => (rule.category == null) !== (rule.tag == null)
  const tools = [
    agentTool({
      name: "category_history",
      description: "A category's history: rows' shared facts, the user's recent choices into it, its descriptions by purity (perfect = every row with that description is in it), look-alike descriptions elsewhere, and rules that set it.",
      parameters: Type.Object({ category: Type.String({ description: "Exact category name" }) }),
      run: ({ category }) => {
        if (++looks > HISTORY_LOOKS) throw new Error(`You've looked at ${HISTORY_LOOKS} categories: test your candidates with test_rule now, then finish.`)
        const c = categoryNamed(category)
        if (!c) throw new Error(`no category named ${category}`)
        return categoryHistory(data, c.id, { recent: 20, descriptions: 25 })
      },
    }),
    agentTool({
      name: "tag_history",
      description: "A tag's history: shared facts, recent changes, descriptions by purity, look-alikes without it, and rules that add it.",
      parameters: Type.Object({ tag: Type.String({ description: "Exact tag name" }) }),
      run: ({ tag }) => {
        if (++looks > HISTORY_LOOKS) throw new Error(`You've looked at ${HISTORY_LOOKS} categories or tags: test your candidates with test_rule now, then finish.`)
        const t = tagNamed(tag)
        if (!t) throw new Error(`no tag named ${tag}`)
        return tagHistory(data, t.id, { recent: 20, descriptions: 25 })
      },
    }),
    agentTool({
      name: "test_rule",
      description: "Test a filter expression as a rule for exactly one category or tag: rows found, in_target, elsewhere (mistakes), waiting, precision, how many of the user's choices it covers, whether rules already do it, and sample rows (mistakes first).",
      parameters: Type.Object({ expr: Type.String(), ...target }),
      run: ({ expr, category, tag }) => {
        if (!oneTarget({ category, tag })) throw new Error("give exactly one of category or tag")
        if (tag != null) {
          const t = tagNamed(tag)
          if (!t) throw new Error(`no tag named ${tag}`)
          return matchReport(data, expr, { tagId: t.id }, 6)
        }
        const c = categoryNamed(category!)
        if (!c) throw new Error(`no category named ${category}`)
        return matchReport(data, expr, { categoryId: c.id }, 6)
      },
    }),
    agentTool({
      name: "waiting",
      description: "Rows waiting for a category, by description, most first.",
      parameters: Type.Object({ limit: Type.Optional(Type.Number({ minimum: 1, maximum: 80 })) }),
      run: ({ limit }) => waitingOverview(data, limit ?? 40),
    }),
  ]
  const finish = {
    description: "Propose rules (at most 8; none is fine).",
    parameters: Type.Object({
      rules: Type.Array(Type.Object({ name: Type.String(), expr: Type.String(), why: Type.String(), ...target }), { maxItems: PROPOSALS }),
    }),
  }
  const run = await runAgent(llm, {
    system: SYSTEM,
    prompt: JSON.stringify(ruleWriterBrief(data, declined, options.focus)),
    tools,
    finish,
    maxTurns: RULE_WRITER_TURNS,
    signal: options.signal,
  })
  const result: RuleWriterResult = { offers: [], rejected: [], usage: run.usage, turns: run.turns, calls: run.calls, ...(run.error ? { error: run.error } : {}) }
  const seen = new Set(data.savedFilters.map((f) => f.expr.toLowerCase()))
  for (const rule of run.result?.rules ?? []) {
    const reject = (reason: string) => result.rejected.push({ rule: rule as ProposedRule, reason })
    if (!oneTarget(rule)) { reject("give exactly one of category or tag"); continue }
    if (rule.tag != null) {
      const tag = tagNamed(rule.tag)
      if (!tag) { reject(`no tag named ${rule.tag}`); continue }
      if (tag.name.toUpperCase() === "IGNORE") { reject("cannot propose IGNORE"); continue }
      const report = matchReport(data, rule.expr, { tagId: tag.id })
      if (!report.valid) { reject(report.error); continue }
      if (declined.some((d) => d.expr === rule.expr && d.tagId === tag.id)) { reject("declined before"); continue }
      if (seen.has(rule.expr.toLowerCase())) { reject("a saved filter already says this"); continue }
      if (report.already_by_rules) { reject("rules already do it"); continue }
      if ((report.precision ?? 0) < RULE_SHARE) { reject(`precision ${report.precision ?? 0}`); continue }
      if (report.in_target < RULE_AFTER) { reject(`only ${report.in_target} rows in ${tag.name}`); continue }
      seen.add(rule.expr.toLowerCase())
      const found = findRows(data, rule.expr)
      const rows = "rows" in found ? found.rows : []
      result.offers.push({
        source: "ai", description: rule.name.trim() || rule.expr, expr: rule.expr,
        categoryId: null, tagId: tag.id,
        times: report.covers_your_choices.covered,
        categorised: report.rows, agreeing: report.in_target,
        waiting: rows.filter((t) => !t.tagIds.includes(tag.id)).map((t) => t.id).sort((a, b) => a - b),
        others: [], why: rule.why,
      })
      continue
    }
    const category = categoryNamed(rule.category!)
    if (!category) { reject(`no category named ${rule.category}`); continue }
    if (declined.some((d) => d.expr === rule.expr && d.categoryId === category.id)) { reject("declined before"); continue }
    const report = matchReport(data, rule.expr, { categoryId: category.id })
    if (!report.valid) { reject(report.error); continue }
    if (seen.has(rule.expr.toLowerCase())) { reject("a saved filter already says this"); continue }
    if (report.already_by_rules) { reject("rules already do it"); continue }
    if ((report.precision ?? 0) < RULE_SHARE) { reject(`precision ${report.precision ?? 0}`); continue }
    if (report.in_target < RULE_AFTER) { reject(`only ${report.in_target} rows in ${category.name}`); continue }
    // Up (or sync, from Up's type) already categorises these, and none wait.
    if (!report.waiting && report.set_by_up >= report.in_target * RULE_SHARE) { reject("Up already categorises these"); continue }
    seen.add(rule.expr.toLowerCase())
    const found = findRows(data, rule.expr)
    const rows = "rows" in found ? found.rows : []
    result.offers.push({
      source: "ai",
      description: rule.name.trim() || rule.expr,
      expr: rule.expr,
      categoryId: category.id,
      tagId: null,
      times: report.covers_your_choices.covered,
      categorised: report.in_target + report.elsewhere,
      agreeing: report.in_target,
      waiting: rows.filter(isUncategorised).map((t) => t.id).sort((a, b) => a - b),
      others: [],
      why: rule.why,
    })
  }
  return result
}
