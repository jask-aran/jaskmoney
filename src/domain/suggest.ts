import { judgeEach, type JevClient } from "../ai/jev"
import { assignableCategories } from "./categoryOptions"
import { isOrdinaryFlow, isUncategorised } from "./moneyRules"
import { EXAMPLES_PER_CATEGORY, MERCHANT_STATE, merchantBreadthQuestion, MIXED_AT, MIXED_UNSURE_AT, NO_DETAIL_CAP, RANKED_MIN, SUGGESTION_RANKED, SUGGESTION_STATE, UNSURE_CAP, suggestionCriteria, suggestionQuestion } from "./questions"
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
export const PERSON_TO_PERSON = new Set(["Payment", "Pay Anyone", "Transfer", "Osko Payment Received", "Payment Received", "Deposit", "EFTPOS Deposit", "EFTPOS Withdrawal"])
const isPersonToPerson = (t: Transaction) => !!t.transactionType && PERSON_TO_PERSON.has(t.transactionType)

/** A merchant name as the breadth cache and history key it. */
export const merchantKey = (description: string) => description.trim().toLowerCase()

/**
 * Whether a merchant's name says what was bought: "mixed" when it doesn't
 * (Jev says it sells many unrelated goods, at MIXED_AT or more, or your rows
 * with that name already sit in different categories with none at
 * HISTORY_MIN_SHARE), "unsure" from MIXED_UNSURE_AT, else "single". A name
 * Jev hasn't been asked about counts as single.
 */
export type Breadth = "mixed" | "unsure" | "single"

export function merchantBreadth(transactions: Transaction[], categories: Category[], asked: ReadonlyMap<string, number>): (description: string) => Breadth {
  const assignable = new Set(suggestionCategories(categories).map((c) => c.id))
  const tally = new Map<string, Map<number, number>>()
  for (const t of transactions) {
    if (isUncategorised(t) || t.categoryId == null || !assignable.has(t.categoryId) || isPersonToPerson(t)) continue
    const byCategory = tally.get(merchantKey(t.description)) ?? new Map<number, number>()
    byCategory.set(t.categoryId, (byCategory.get(t.categoryId) ?? 0) + 1)
    tally.set(merchantKey(t.description), byCategory)
  }
  const spread = new Set([...tally].filter(([, byCategory]) => {
    const counts = [...byCategory.values()]
    const total = counts.reduce((a, b) => a + b, 0)
    return counts.length > 1 && Math.max(...counts) / total < HISTORY_MIN_SHARE
  }).map(([key]) => key))
  return (description) => {
    const key = merchantKey(description)
    const p = asked.get(key) ?? 0
    return spread.has(key) || p >= MIXED_AT ? "mixed" : p >= MIXED_UNSURE_AT ? "unsure" : "single"
  }
}

/** The merchants among `transactions` worth asking about: card and online
 * purchases (not a person or a payment app), one row per name not in
 * `asked`. */
export function unaskedMerchants(transactions: Transaction[], asked: ReadonlyMap<string, number>): Transaction[] {
  const out = new Map<string, Transaction>()
  for (const t of transactions) {
    const key = merchantKey(t.description)
    if (!key || asked.has(key) || out.has(key) || isPersonToPerson(t) || t.amount >= 0) continue
    out.set(key, t)
  }
  return [...out.values()]
}

/** Ask Jev whether each merchant's name says what was bought (one question
 * per name, packed into as few requests as fit). Answers arrive by request
 * through `onAnswers`; a failed request is reported and the rest carry on. */
export async function askMerchantBreadth(jev: Pick<JevClient, "judge">, merchants: Transaction[], options: { notes?: ReadonlyMap<string, string>; onAnswers: (answers: Map<string, number>) => void; onError?: (error: unknown) => void }): Promise<void> {
  await judgeEach(jev, merchants, (t) => merchantBreadthQuestion(t.description, t.rawText, options.notes?.get(merchantKey(t.description))), MERCHANT_STATE, {
    onAnswers: (answers) => {
      const out = new Map<string, number>()
      for (const [t, answer] of answers) if (answer.type === "noul") out.set(merchantKey(t.description), answer.noul)
      options.onAnswers(out)
    },
    onError: (error) => options.onError?.(error),
  })
}

/** The most sure a suggestion for `t` may be: a guess (NO_DETAIL_CAP) for a
 * person-to-person payment or a mixed merchant, below accept-all for an
 * unsure one, unless the payment's message says what it was for. */
export function suggestionCap(t: Transaction, breadth: (description: string) => Breadth = () => "single"): number {
  if (t.message) return 1
  if (isPersonToPerson(t)) return NO_DETAIL_CAP
  const b = breadth(t.description)
  return b === "mixed" ? NO_DETAIL_CAP : b === "unsure" ? UNSURE_CAP : 1
}

/** A suggestion held to `cap`: its pick and every ranked alternative. */
export function capSuggestion(s: CategorySuggestion, cap: number): CategorySuggestion {
  if (s.confidence <= cap && (s.ranked ?? []).every((r) => r.confidence <= cap)) return s
  return { ...s, confidence: Math.min(s.confidence, cap), ...(s.ranked ? { ranked: s.ranked.map((r) => ({ ...r, confidence: Math.min(r.confidence, cap) })) } : {}) }
}

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
export function categoryExamples(history: Transaction[], suggestable: Category[], breadth: (description: string) => Breadth = () => "single"): Map<number, string[]> {
  const allowed = new Set(suggestable.map((c) => c.id))
  const tally = new Map<number, Map<string, { description: string; count: number; latest: string }>>()
  for (const t of history) {
    // A person or a payment app names no merchant to learn from, and a
    // marketplace (eBay) says nothing about its category.
    if (isUncategorised(t) || t.categoryId == null || !allowed.has(t.categoryId) || isPersonToPerson(t) || breadth(t.description) === "mixed") continue
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
export function historySuggestions(transactions: Transaction[], categories: Category[], targetIds?: ReadonlySet<number>, breadth: (description: string) => Breadth = () => "single"): CategorySuggestion[] {
  const evidence = historyEvidence(transactions, categories)
  const suggestions: CategorySuggestion[] = []
  for (const t of transactions) {
    if (!isOrdinaryFlow(t) || !isUncategorised(t) || (targetIds && !targetIds.has(t.id))) continue
    // A mixed merchant's rows don't settle each other (three Amazon rows in
    // Homeware say nothing about the fourth); Jev weighs them instead.
    if (t.message || isPersonToPerson(t) || breadth(t.description) === "mixed") continue
    const { total, ranked } = evidence(t)
    const top = ranked[0]
    if (!top || total < HISTORY_MIN_ROWS || top.count / total < HISTORY_MIN_SHARE) continue
    suggestions.push(capSuggestion({ transactionId: t.id, categoryId: top.categoryId, confidence: top.count / (total + 1), source: "history",
      ranked: ranked.map((e) => ({ categoryId: e.categoryId, confidence: e.count / (total + 1) }))
        .filter((e) => e.categoryId === top.categoryId || e.confidence >= RANKED_MIN).slice(0, SUGGESTION_RANKED),
    }, suggestionCap(t, breadth)))
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
  options: { history?: Transaction[]; notes?: ReadonlyMap<string, string>; breadth?: (description: string) => Breadth; onSuggestion?: (s: CategorySuggestion) => void; onError?: (transactionIds: number[], error: unknown) => void } = {},
): Promise<CategorySuggestion[]> {
  const suggestable = suggestionCategories(categories)
  if (!suggestable.length || !transactions.length) return []
  const criteria = suggestionCriteria(suggestable, categories, categoryExamples(options.history ?? [], suggestable, options.breadth))
  const categoryIds = new Map(suggestable.map((c) => [`c${c.id}`, c.id]))
  const names = new Map(categories.map((c) => [c.id, c.name]))
  const evidence = historyEvidence(options.history ?? [], categories)
  // A marketplace's earlier categories say nothing about this purchase.
  const earlier = (t: Transaction) => options.breadth?.(t.description) === "mixed" ? "" : evidence(t).ranked.map((e) => `${names.get(e.categoryId)} ×${e.count}`).join(", ")
  const suggestions: CategorySuggestion[] = []
  await judgeEach(jev, transactions, (t) => suggestionQuestion(t, criteria, earlier(t), options.notes?.get(merchantKey(t.description))), SUGGESTION_STATE, {
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
        // Nothing but a name, an app or a marketplace to go on: a guess,
        // however sure Jev is.
        const suggestion = capSuggestion({
          transactionId: t.id, categoryId, confidence, source: "jev",
          ranked: [{ categoryId, confidence }, ...ranked].slice(0, SUGGESTION_RANKED),
        }, suggestionCap(t, options.breadth))
        options.onSuggestion?.(suggestion)
        suggestions.push(suggestion)
      }
    },
    onError: (error, rows) => options.onError?.(rows.map((t) => t.id), error),
  })
  return suggestions
}
