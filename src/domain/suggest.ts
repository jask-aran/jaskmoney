import { judgeEach, type JevClient } from "../ai/jev"
import { assignableCategories } from "./categoryOptions"
import { isOrdinaryFlow, isUncategorised } from "./moneyRules"
import { EXAMPLES_PER_CATEGORY, RANKED_MIN, SUGGESTION_RANKED, SUGGESTION_STATE, suggestionCriteria, suggestionQuestion } from "./questions"
import type { Category, CategorySuggestion, Transaction } from "./types"

/**
 * Category suggestions for uncategorised transactions, for the user to accept
 * or dismiss (nothing is categorised automatically): from history (the same
 * description already categorised) first, then from Jev choosing among the
 * user's categories.
 */

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

/** For each of `suggestable`, the descriptions of up to
 * EXAMPLES_PER_CATEGORY of its rows in `history`: the most used first
 * (ties: the most recent), one per description. */
export function categoryExamples(history: Transaction[], suggestable: Category[]): Map<number, string[]> {
  const allowed = new Set(suggestable.map((c) => c.id))
  const tally = new Map<number, Map<string, { description: string; count: number; latest: string }>>()
  for (const t of history) {
    if (isUncategorised(t) || t.categoryId == null || !allowed.has(t.categoryId)) continue
    const byKey = tally.get(t.categoryId) ?? new Map()
    tally.set(t.categoryId, byKey)
    const k = t.description.trim().toLowerCase()
    const entry = byKey.get(k) ?? { description: t.description.trim(), count: 0, latest: "" }
    entry.count++
    if (t.dateISO > entry.latest) entry.latest = t.dateISO
    byKey.set(k, entry)
  }
  const out = new Map<number, string[]>()
  for (const [categoryId, byKey] of tally) {
    const ranked = [...byKey.values()].sort((a, b) => b.count - a.count || b.latest.localeCompare(a.latest))
    out.set(categoryId, ranked.slice(0, EXAMPLES_PER_CATEGORY).map((e) => e.description.length > 40 ? `${e.description.slice(0, 39)}…` : e.description))
  }
  return out
}

/**
 * Suggestions history settles without asking Jev: for an ordinary
 * uncategorised merchant row (not person-to-person, no message of its own)
 * whose description at least HISTORY_MIN_ROWS earlier rows share, nearly all
 * in one category. Confidence shrinks for small samples: count / (total + 1),
 * so 3 of 3 is 0.75. Everything else goes to Jev with the history as context.
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
    suggestions.push({ transactionId: t.id, categoryId: top.categoryId, confidence: top.count / (total + 1), source: "history",
      ranked: ranked.map((e) => ({ categoryId: e.categoryId, confidence: e.count / (total + 1) }))
        .filter((e) => e.categoryId === top.categoryId || e.confidence >= RANKED_MIN).slice(0, SUGGESTION_RANKED),
    })
  }
  return suggestions
}

/**
 * Ask Jev about each transaction (packed into as few requests as fit),
 * telling it how rows with the same description in `history` were
 * categorised. Confidence is Jev's probability for its pick. Picks naming no
 * suggestable category are dropped; a failed request is reported through
 * `onError` with its rows, and the rest carry on.
 */
export async function jevSuggestions(
  jev: Pick<JevClient, "judge">,
  transactions: Transaction[],
  categories: Category[],
  options: { history?: Transaction[]; onSuggestion?: (s: CategorySuggestion) => void; onError?: (transactionIds: number[], error: unknown) => void } = {},
): Promise<CategorySuggestion[]> {
  const suggestable = suggestionCategories(categories)
  if (!suggestable.length || !transactions.length) return []
  const criteria = suggestionCriteria(suggestable, categories, categoryExamples(options.history ?? [], suggestable))
  const categoryIds = new Map(suggestable.map((c) => [`c${c.id}`, c.id]))
  const names = new Map(categories.map((c) => [c.id, c.name]))
  const evidence = historyEvidence(options.history ?? [], categories)
  const earlier = (t: Transaction) => evidence(t).ranked.map((e) => `${names.get(e.categoryId)} ×${e.count}`).join(", ")
  const suggestions: CategorySuggestion[] = []
  await judgeEach(jev, transactions, (t) => suggestionQuestion(t, criteria, earlier(t)), SUGGESTION_STATE, {
    onAnswers: (answers) => {
      for (const [t, answer] of answers) {
        if (answer.type !== "choice") continue
        const categoryId = categoryIds.get(answer.choice)
        if (categoryId == null) continue
        const confidence = answer.probabilities[answer.choice] ?? answer.confidence
        const ranked = Object.entries(answer.probabilities).flatMap(([key, probability]) => {
          const id = categoryIds.get(key)
          return id != null && id !== categoryId && probability >= RANKED_MIN ? [{ categoryId: id, confidence: probability }] : []
        }).sort((a, b) => b.confidence - a.confidence)
        const suggestion: CategorySuggestion = {
          transactionId: t.id, categoryId, confidence, source: "jev",
          ranked: [{ categoryId, confidence }, ...ranked].slice(0, SUGGESTION_RANKED),
        }
        options.onSuggestion?.(suggestion)
        suggestions.push(suggestion)
      }
    },
    onError: (error, rows) => options.onError?.(rows.map((t) => t.id), error),
  })
  return suggestions
}
