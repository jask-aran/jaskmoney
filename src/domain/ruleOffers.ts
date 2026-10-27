import type { CategoryChoice } from "../db/client"
import { evalFilter, parseFilterStrict } from "./filter"
import { isUncategorised } from "./moneyRules"
import { dryRunRules, filterRowNames } from "./rules"
import { groupByDescription } from "./transactionGroups"
import type { Category, Rule, SavedFilter, Tag, Transaction } from "./types"

/**
 * Turning repeated categorisations into rules. Once you've put a
 * description's rows in one category RULE_AFTER times, a rule that does it
 * on every new row is offered, if:
 * - the rule's filter (`desc:`, which matches any description containing
 *   the words) finds rows that are nearly all (RULE_SHARE) in that category
 *   already: "Coles" isn't offered when "Coles Express" rows are Fuel;
 * - no enabled rule would already categorise a new row like these;
 * - you haven't declined it.
 */
export const RULE_AFTER = 3
export const RULE_SHARE = 0.9

export interface RuleOffer {
  /** "repeat": you chose it RULE_AFTER times; "ai": the general model wrote it (ai/ruleWriter). */
  source: "repeat" | "ai"
  /** The description as your rows spell it most often; for an AI rule, its name. */
  description: string
  expr: string
  categoryId: number
  /** Times you've put it in the category (AI: of your recent choices, how many it covers). */
  times: number
  /** Rows the filter finds that are categorised, and of those in the category. */
  categorised: number
  agreeing: number
  /** Rows the filter finds still waiting for a category: the rule takes them now. */
  waiting: number[]
  /** Other descriptions the filter finds ("Coles Express" for Coles): what
   * else the rule will categorise. */
  others: string[]
  /** The model's reason (AI rules). */
  why?: string
}

/** `desc:"…"` for a description, quoted and escaped. */
export function descExpr(description: string): string {
  return `desc:"${description.trim().replace(/["\\]/g, "\\$&")}"`
}

/** Offers among `choices` (all of them, or those for `descriptions`), most
 * chosen first. */
export function ruleOffers(
  choices: CategoryChoice[],
  transactions: Transaction[],
  rules: Rule[],
  savedFilters: SavedFilter[],
  categories: Category[],
  tags: Tag[],
  descriptions?: string[],
): RuleOffer[] {
  const only = descriptions && new Set(descriptions.map((d) => d.trim().toLowerCase()))
  const names = filterRowNames(categories, tags)
  const byKey = groupByDescription(transactions)
  const offers: RuleOffer[] = []
  for (const choice of choices) {
    if (choice.declined || choice.times < RULE_AFTER || (only && !only.has(choice.description))) continue
    if (!categories.some((c) => c.id === choice.categoryId)) continue
    const own = byKey.get(choice.description)
    if (!own?.length) continue
    const description = mostCommonSpelling(own)
    const expr = descExpr(description)
    const { node } = parseFilterStrict(expr)
    if (!node) continue
    const found = transactions.filter((t) => evalFilter(node, names.row(t, t.categoryId, t.tagIds)))
    const categorised = found.filter((t) => !isUncategorised(t))
    const agreeing = categorised.filter((t) => t.categoryId === choice.categoryId).length
    if (!categorised.length || agreeing / categorised.length < RULE_SHARE) continue
    // A new row like these, with no category: would a rule already set one?
    const fresh = { ...own[0]!, id: -1, categoryId: null, tagIds: [] }
    if (dryRunRules([fresh], rules, savedFilters, categories, tags).changes.some((c) => c.categorySet)) continue
    const others = [...new Map(found.filter((t) => t.description.trim().toLowerCase() !== choice.description).map((t) => [t.description.trim().toLowerCase(), t.description.trim()])).values()].sort()
    offers.push({ source: "repeat", description, expr, categoryId: choice.categoryId, times: choice.times, categorised: categorised.length, agreeing, waiting: found.filter(isUncategorised).map((t) => t.id).sort((a, b) => a - b), others })
  }
  return offers.sort((a, b) => b.times - a.times || a.description.localeCompare(b.description))
}

function mostCommonSpelling(rows: Transaction[]): string {
  const counts = new Map<string, number>()
  for (const t of rows) counts.set(t.description.trim(), (counts.get(t.description.trim()) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1])[0]![0]
}
