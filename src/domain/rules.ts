import { evalFilter, parseFilterStrict } from "./filter"
import type { Category, Rule, RuleRunResult, SavedFilter, Tag, Transaction } from "./types"

export interface RuleSample {
  transaction: Transaction
  categoryId: number | null
  addedTagIds: number[]
}

export interface DryRunReport extends RuleRunResult {
  transactionCount: number
  rules: {
    rule: Rule
    error: string | null
    matched: number
    categoryChanges: number
    tagChanges: number
    samples: RuleSample[]
  }[]
  changes: { id: number; categoryId: number | null; categorySet: boolean; tagIds: number[] }[]
}

/** The names a filter matches a transaction by, from ids: its category's
 * name ("Uncategorised" without one) and its tags' names. Shared by rule
 * evaluation and the editors' live match counts. */
export function filterRowNames(categories: Category[], tags: Tag[]) {
  const categoryNames = new Map(categories.map((category) => [category.id, category.name]))
  const tagNames = new Map(tags.map((tag) => [tag.id, tag.name]))
  return {
    row: (transaction: Transaction, categoryId: number | null, tagIds: Iterable<number>) => ({
      ...transaction,
      categoryName: categoryNames.get(categoryId ?? -1) ?? "Uncategorised",
      tagNames: [...tagIds].map((id) => tagNames.get(id)).filter((name): name is string => !!name),
    }),
  }
}

/** Evaluate in stored order. Each rule sees the changes from earlier rules. */
export function dryRunRules(transactions: Transaction[], rules: Rule[], savedFilters: SavedFilter[], categories: Category[], tags: Tag[]): DryRunReport {
  const filters = new Map(savedFilters.map((filter) => [filter.id, parseFilterStrict(filter.expr)]))
  const names = filterRowNames(categories, tags)
  const report: DryRunReport = {
    transactionCount: transactions.length, updatedTransactions: 0, categoryChanges: 0, tagChanges: 0, failedRules: [], changes: [],
    rules: rules.filter((rule) => rule.enabled).map((rule) => {
      const parsed = filters.get(rule.savedFilterId)
      return { rule, error: !parsed ? `missing: ${rule.savedFilterId}` : parsed.error ?? (!parsed.node ? "invalid: empty expression" : null), matched: 0, categoryChanges: 0, tagChanges: 0, samples: [] }
    }),
  }
  for (const result of report.rules) {
    if (transactions.length && result.error && !report.failedRules.includes(result.rule.savedFilterId)) report.failedRules.push(result.rule.savedFilterId)
  }
  for (const transaction of transactions) {
    let categoryId = transaction.categoryId
    let categorySet = false
    let changed = false
    const tagIds = new Set(transaction.tagIds)
    for (const result of report.rules) {
      const rule = result.rule
      const expression = filters.get(rule.savedFilterId)?.node
      if (result.error || !expression) continue
      if (!evalFilter(expression, names.row(transaction, categoryId, tagIds))) continue
      result.matched++
      let newCategory: number | null = null
      const addedTagIds: number[] = []
      if (rule.setCategoryId != null && rule.setCategoryId !== categoryId) {
        categoryId = rule.setCategoryId
        newCategory = categoryId
        categorySet = true
        result.categoryChanges++
        report.categoryChanges++
      }
      for (const id of rule.addTagIds) if (!tagIds.has(id)) {
        tagIds.add(id)
        addedTagIds.push(id)
        result.tagChanges++
        report.tagChanges++
      }
      if (newCategory !== null || addedTagIds.length) {
        changed = true
        if (result.samples.length < 3) result.samples.push({ transaction, categoryId: newCategory, addedTagIds })
      }
    }
    if (changed) report.changes.push({ id: transaction.id, categoryId, categorySet, tagIds: [...tagIds] })
  }
  report.updatedTransactions = report.changes.length
  return report
}
