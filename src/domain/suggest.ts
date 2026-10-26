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

/** Up transaction types whose description names a person or a payment app
 * (Beem, a PayID), not a merchant: the same description says little about
 * what the money was for. */
const PERSON_TO_PERSON = new Set(["Payment", "Pay Anyone", "Transfer", "Osko Payment Received", "Payment Received", "Deposit", "EFTPOS Deposit", "EFTPOS Withdrawal"])

/** How history settles a row on its own: this many earlier rows at least,
 * this share of them in one category. */
const HISTORY_MIN_ROWS = 3
const HISTORY_MIN_SHARE = 0.9

interface Evidence { categoryId: number; count: number; latest: Transaction }

/** For a row, how other rows with the same description were categorised,
 * most common first (ties: the most recent): same-sign rows when there are
 * any, else all. */
function historyEvidence(transactions: Transaction[], categories: Category[]): (t: Transaction) => { total: number; ranked: Evidence[] } {
  const assignable = new Set(suggestionCategories(categories).map((c) => c.id))
  const byKey = new Map<string, Transaction[]>()
  const key = (t: Transaction) => t.description.trim().toLowerCase()
  for (const t of transactions) {
    if (isUncategorised(t) || t.categoryId == null || !assignable.has(t.categoryId)) continue
    const rows = byKey.get(key(t)) ?? []
    rows.push(t)
    byKey.set(key(t), rows)
  }
  return (t) => {
    const matching = (byKey.get(key(t)) ?? []).filter((row) => row.id !== t.id)
    const sameSign = matching.filter((row) => Math.sign(row.amount) === Math.sign(t.amount))
    const rows = sameSign.length ? sameSign : matching
    const counts = new Map<number, Evidence>()
    for (const row of rows) {
      const entry = counts.get(row.categoryId!)
      const latest = !entry || row.dateISO > entry.latest.dateISO || (row.dateISO === entry.latest.dateISO && row.id > entry.latest.id) ? row : entry.latest
      counts.set(row.categoryId!, { categoryId: row.categoryId!, count: (entry?.count ?? 0) + 1, latest })
    }
    const ranked = [...counts.values()].sort((a, b) => b.count - a.count || b.latest.dateISO.localeCompare(a.latest.dateISO) || b.latest.id - a.latest.id)
    return { total: rows.length, ranked }
  }
}

/**
 * Suggestions history settles without asking Clef: for an ordinary
 * uncategorised merchant row (not person-to-person, no message of its own)
 * whose description at least HISTORY_MIN_ROWS earlier rows share, nearly all
 * in one category. Confidence shrinks for small samples: count / (total + 1),
 * so 3 of 3 is 0.75. Everything else goes to Clef with the history as context.
 */
export function historySuggestions(transactions: Transaction[], categories: Category[], targetIds?: ReadonlySet<number>): CategorySuggestion[] {
  const evidence = historyEvidence(transactions, categories)
  const suggestions: CategorySuggestion[] = []
  for (const t of transactions) {
    if (!isOrdinaryFlow(t) || !isUncategorised(t) || (targetIds && !targetIds.has(t.id))) continue
    if (t.message || (t.transactionType && PERSON_TO_PERSON.has(t.transactionType))) continue
    const { total, ranked } = evidence(t)
    const top = ranked[0]
    if (!top || total < HISTORY_MIN_ROWS || top.count / total < HISTORY_MIN_SHARE) continue
    suggestions.push({ transactionId: t.id, categoryId: top.categoryId, confidence: top.count / (total + 1), source: "history" })
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
  return {
    type: "choice",
    instructions: "Which category does this bank transaction belong in? The description may be a person's name or a payment app rather than a shop: then the message, if any, says what the money was for, and the description says nothing about the category.",
    criteria,
  }
}

/** The facts Clef sees about a transaction, one per line: what the bank
 * says, the payment's message, and how rows with the same description were
 * categorised before (`earlier`, as "Groceries ×3, Takeaway ×1"). */
export function clefState(t: Transaction, earlier = ""): string {
  return [
    `Description: ${t.description}`,
    `Amount: ${t.amount < 0 ? "-" : "+"}${formatMoney(Math.abs(t.amount))} (${t.amount < 0 ? "money out" : "money in"})`,
    ...(t.transactionType == null ? [] : [`Type: ${t.transactionType}`]),
    ...(t.message == null ? [] : [`Message: ${t.message}`]),
    ...(t.rawText == null || t.rawText === t.description ? [] : [`Bank text: ${t.rawText}`]),
    `Date: ${t.dateISO}`,
    `Account: ${t.accountName}`,
    ...(earlier ? [`Earlier with this description: ${earlier}`] : []),
  ].join("\n")
}

/** Ask Clef about each transaction, `concurrency` at a time, telling it how
 * rows with the same description in `history` were categorised. Answers
 * naming no suggestable category are dropped; a failed call is reported
 * through `onError` and the rest carry on. */
export async function clefSuggestions(
  ai: Pick<WorkersAiClient, "clef">,
  transactions: Transaction[],
  categories: Category[],
  options: { history?: Transaction[]; concurrency?: number; onSuggestion?: (s: CategorySuggestion) => void; onError?: (transactionId: number, error: unknown) => void } = {},
): Promise<CategorySuggestion[]> {
  const concurrency = options.concurrency ?? 4
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("concurrency must be a positive integer")
  const question = clefQuestion(categories)
  const categoryIds = new Map(suggestionCategories(categories).map((c) => [`c${c.id}`, c.id]))
  const names = new Map(categories.map((c) => [c.id, c.name]))
  const evidence = historyEvidence(options.history ?? [], categories)
  const earlier = (t: Transaction) => evidence(t).ranked.map((e) => `${names.get(e.categoryId)} ×${e.count}`).join(", ")
  if (!categoryIds.size) return []
  const suggestions: CategorySuggestion[] = []
  let next = 0
  async function worker() {
    for (;;) {
      const t = transactions[next++]
      if (!t) return
      try {
        const answer = (await ai.clef({ category: question }, clefState(t, earlier(t)), "clef")).category
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
