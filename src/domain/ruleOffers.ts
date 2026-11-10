import type { CategoryChoice } from "../db/client"
import { evalFilter, parseFilterStrict } from "./filter"
import { filterTerm } from "./filterText"
import { isUncategorised } from "./moneyRules"
import { dryRunRules, filterRowNames } from "./rules"
import { groupByDescription } from "./transactionGroups"
import type { Category, Rule, SavedFilter, Tag, Transaction } from "./types"

export const RULE_AFTER = 3
export const RULE_SHARE = 0.9

export type RuleOffer = {
  description: string
  expr: string
  times: number
  categorised: number
  agreeing: number
  waiting: number[]
  others: string[]
  why?: string
} & ({ source: "repeat" | "ai"; categoryId: number; tagId: null } | { source: "ai"; categoryId: null; tagId: number })

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
  let seen: { t: Transaction; row: ReturnType<typeof names.row> }[] | null = null
  const filterRows = () => (seen ??= transactions.map((t) => ({ t, row: names.row(t, t.categoryId, t.tagIds) })))
  const offers: RuleOffer[] = []
  for (const choice of choices) {
    if (choice.declined || choice.times < RULE_AFTER || (only && !only.has(choice.description))) continue
    if (!categories.some((c) => c.id === choice.categoryId)) continue
    const own = byKey.get(choice.description)
    if (!own?.length) continue
    const description = mostCommonSpelling(own)
    const expr = filterTerm("desc", description.trim())
    const { node } = parseFilterStrict(expr)
    if (!node) continue
    const found = filterRows().filter((r) => evalFilter(node, r.row)).map((r) => r.t)
    const categorised = found.filter((t) => !isUncategorised(t))
    const agreeing = categorised.filter((t) => t.categoryId === choice.categoryId).length
    if (!categorised.length || agreeing / categorised.length < RULE_SHARE) continue
    const fresh = { ...own[0]!, id: -1, categoryId: null, tagIds: [] }
    if (dryRunRules([fresh], rules, savedFilters, categories, tags).changes.some((c) => c.categorySet)) continue
    const others = [...new Map(found.filter((t) => t.description.trim().toLowerCase() !== choice.description).map((t) => [t.description.trim().toLowerCase(), t.description.trim()])).values()].sort()
    offers.push({ source: "repeat", description, expr, categoryId: choice.categoryId, tagId: null, times: choice.times, categorised: categorised.length, agreeing, waiting: found.filter(isUncategorised).map((t) => t.id).sort((a, b) => a - b), others })
  }
  return offers.sort((a, b) => b.times - a.times || a.description.localeCompare(b.description))
}

function mostCommonSpelling(rows: Transaction[]): string {
  const counts = new Map<string, number>()
  for (const t of rows) counts.set(t.description.trim(), (counts.get(t.description.trim()) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1])[0]![0]
}
