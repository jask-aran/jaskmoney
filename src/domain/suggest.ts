import type { ClefQuestion, WorkersAiClient } from "../ai/workersAi"
import { assignableCategories } from "./categoryOptions"
import { formatMoney } from "./dashboard"
import { isOrdinaryFlow, isUncategorised } from "./moneyRules"
import type { Category, CategorySuggestion, Transaction } from "./types"

/**
 * Category suggestions for uncategorised transactions, for the user to accept
 * or dismiss (nothing is categorised automatically): from history (the same
 * description already categorised) first, then from Clef choosing among the
 * user's categories.
 */

/** Confidence at which accept-all (`Y`) takes a suggestion unseen. */
export const ACCEPT_ALL_AT = 0.8

/** Categories a suggestion may name: assignable ones, not Uncategorised. */
function suggestionCategories(categories: Category[]): Category[] {
  return assignableCategories(categories, "").filter((c) => !c.isDefault)
}

/** For each ordinary uncategorised row (or those in `targetIds`), the most
 * common category among other rows with the same description, preferring
 * rows with the same sign (ties: the most recent). Confidence is its share. */
export function historySuggestions(transactions: Transaction[], categories: Category[], targetIds?: ReadonlySet<number>): CategorySuggestion[] {
  const assignable = new Set(suggestionCategories(categories).map((c) => c.id))
  const evidence = new Map<string, Transaction[]>()
  const key = (t: Transaction) => t.description.trim().toLowerCase()
  for (const t of transactions) {
    if (isUncategorised(t) || t.categoryId == null || !assignable.has(t.categoryId)) continue
    const rows = evidence.get(key(t)) ?? []
    rows.push(t)
    evidence.set(key(t), rows)
  }
  const suggestions: CategorySuggestion[] = []
  for (const t of transactions) {
    if (!isOrdinaryFlow(t) || !isUncategorised(t) || (targetIds && !targetIds.has(t.id))) continue
    const matching = (evidence.get(key(t)) ?? []).filter((row) => row.id !== t.id)
    const sameSign = matching.filter((row) => Math.sign(row.amount) === Math.sign(t.amount))
    const rows = sameSign.length ? sameSign : matching
    const counts = new Map<number, { count: number; latest: Transaction }>()
    for (const row of rows) {
      if (row.categoryId == null) continue
      const entry = counts.get(row.categoryId)
      const latest = !entry || row.dateISO > entry.latest.dateISO || (row.dateISO === entry.latest.dateISO && row.id > entry.latest.id) ? row : entry.latest
      counts.set(row.categoryId, { count: (entry?.count ?? 0) + 1, latest })
    }
    const winner = [...counts].sort((a, b) => b[1].count - a[1].count || b[1].latest.dateISO.localeCompare(a[1].latest.dateISO) || b[1].latest.id - a[1].latest.id)[0]
    if (winner) suggestions.push({ transactionId: t.id, categoryId: winner[0], confidence: winner[1].count / rows.length, source: "history" })
  }
  return suggestions
}

/** Clef's question: one choice per suggestable category, keyed `c<id>`,
 * described by its path and whether it is income or not spending. */
export function clefQuestion(categories: Category[]): ClefQuestion {
  const criteria: Record<string, string> = {}
  for (const c of suggestionCategories(categories)) {
    const parent = categories.find((p) => p.id === c.parentId)
    criteria[`c${c.id}`] = `${parent ? `${parent.name} › ` : ""}${c.name}${c.income || parent?.income ? " (income)" : ""}${c.notSpending ? " (not spending: moving your own money)" : ""}`
  }
  return { type: "choice", instructions: "Which category does this bank transaction belong in?", criteria }
}

/** The facts Clef sees about a transaction, one per line. */
export function clefState(t: Transaction): string {
  return [
    `Description: ${t.description}`,
    `Amount: ${t.amount < 0 ? "-" : "+"}${formatMoney(Math.abs(t.amount))} (${t.amount < 0 ? "money out" : "money in"})`,
    ...(t.transactionType == null ? [] : [`Type: ${t.transactionType}`]),
    `Date: ${t.dateISO}`,
    `Account: ${t.accountName}`,
  ].join("\n")
}

/** Ask Clef about each transaction, `concurrency` at a time. Answers naming
 * no suggestable category are dropped; a failed call is reported through
 * `onError` and the rest carry on. */
export async function clefSuggestions(
  ai: Pick<WorkersAiClient, "clef">,
  transactions: Transaction[],
  categories: Category[],
  options: { concurrency?: number; onSuggestion?: (s: CategorySuggestion) => void; onError?: (transactionId: number, error: unknown) => void } = {},
): Promise<CategorySuggestion[]> {
  const concurrency = options.concurrency ?? 4
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("concurrency must be a positive integer")
  const question = clefQuestion(categories)
  const categoryIds = new Map(suggestionCategories(categories).map((c) => [`c${c.id}`, c.id]))
  if (!categoryIds.size) return []
  const suggestions: CategorySuggestion[] = []
  let next = 0
  async function worker() {
    for (;;) {
      const t = transactions[next++]
      if (!t) return
      try {
        const answer = (await ai.clef({ category: question }, clefState(t), "clef")).category
        if (answer?.type !== "choice") continue
        const categoryId = categoryIds.get(answer.choice)
        if (categoryId == null) continue
        const suggestion: CategorySuggestion = { transactionId: t.id, categoryId, confidence: answer.confidence, source: "clef" }
        options.onSuggestion?.(suggestion)
        suggestions.push(suggestion)
      } catch (error) {
        options.onError?.(t.id, error)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, transactions.length) }, worker))
  return suggestions
}
