import type { JevQuestion } from "../ai/jev"
import { formatMoney } from "./dashboard"
import type { Category, Transaction } from "./types"

/**
 * Every question this app asks Jev, the facts it is shown, and the
 * thresholds that read the answers: the parts to audit and tune, in one
 * place. Tuned on jev-1.14.0 against the user's own categorised rows
 * (2026-10-27), tuning on half and checking on the other half. Variants that
 * didn't beat this wording there (by more than noise): a group-then-
 * subcategory hierarchy, an ensemble of both, category definitions in the
 * criteria, "Was this money spent on …?" (it says yes far too often), and
 * each row's most similar-looking categorised rows (trigram match).
 */

/** What Jev is shown about a transaction. `category` (when it has a real
 * one) and `earlier` (how rows with the same description were categorised,
 * as "Groceries ×3, Takeaway ×1") only where the question allows. */
export function transactionFacts(t: Transaction, extra: { category?: boolean; earlier?: string } = {}): Record<string, string> {
  return {
    description: t.description,
    amount: `${t.amount < 0 ? "-" : "+"}${formatMoney(Math.abs(t.amount))}`,
    direction: t.amount < 0 ? "money out" : "money in",
    ...(t.transactionType ? { bank_type: t.transactionType } : {}),
    ...(t.message ? { message: t.message } : {}),
    ...(t.rawText && t.rawText !== t.description ? { bank_text: t.rawText } : {}),
    ...(extra.category && t.categoryId != null && t.categoryName && t.categoryName !== "Uncategorised" ? { category: t.categoryName } : {}),
    ...(extra.earlier ? { categorised_before: extra.earlier } : {}),
  }
}

// ---------- Category suggestions ----------

/** Shared by every suggestion question in a request. */
export const SUGGESTION_STATE = "Bank transactions from an Australian personal account, one per question."

/** A suggestion is at least this likely (Jev's probability for its pick) for
 * accept-all (`Y`) to take it unseen. On the tuning rows, about 83% of picks
 * this sure matched the user's category. */
export const ACCEPT_ALL_AT = 0.8

/** Each category option names this many of the account holder's own
 * transactions in it, so their choices carry over to other merchants. On
 * the rows with no same-description history this lifted top-1 by about
 * 1.5 points (59 → 60%, three runs each) and let ~30 more of 297 rows
 * reach ACCEPT_ALL_AT at the same precision; 8 did no better. */
export const EXAMPLES_PER_CATEGORY = 4

/** One option per suggestable category, keyed `c<id>`: its path, whether
 * it is income or not spending, and `examples` of the user's own
 * transactions in it. */
export function suggestionCriteria(suggestable: Category[], categories: Category[], examples?: Map<number, string[]>): Record<string, string> {
  const criteria: Record<string, string> = {}
  for (const c of suggestable) {
    const parent = categories.find((p) => p.id === c.parentId)
    const named = examples?.get(c.id) ?? []
    criteria[`c${c.id}`] = `${parent ? `${parent.name} › ` : ""}${c.name}${c.income || parent?.income ? " (income)" : ""}${c.notSpending ? " (not spending: moving your own money)" : ""}${named.length ? ` (e.g. ${named.join(", ")})` : ""}`
  }
  return criteria
}

/** Whether any option in `criteria` names examples (the question then says so). */
const namesExamples = (criteria: Record<string, string>) => Object.values(criteria).some((v) => v.includes(" (e.g. "))

export function suggestionQuestion(t: Transaction, criteria: Record<string, string>, earlier = ""): JevQuestion {
  return {
    type: "choice",
    instructions: {
      question: "Which category does `transaction` belong in? The description may be a person's name or a payment app rather than a shop: then the message, if any, says what the money was for, and the description says nothing about the category."
        + (namesExamples(criteria) ? " Each category lists some of the account holder's own transactions in it." : ""),
      transaction: transactionFacts(t, { earlier }),
    },
    criteria,
  }
}

// ---------- ask: terms ----------

/** The search words, shared by every row's question. */
export const matchState = (words: string) => ({ search: words })

/** A row matches at this probability or more. Jev's Noul runs high on
 * near-misses here; 0.7 (TypeSafe's suggested "yes") scored best. */
export const MATCH_AT = 0.7
/** From here up to MATCH_AT a row is a near miss: Jev hasn't settled it
 * (TypeSafe's suggested "no" is below 0.3). */
export const NEAR_AT = 0.3

export function matchQuestion(t: Transaction): JevQuestion {
  return {
    type: "noul",
    instructions: {
      question: "Would someone searching their bank history for `search` want to find `transaction`?",
      transaction: transactionFacts(t, { category: true }),
    },
  }
}

// ---------- Smart search ----------

export const PERIODS = {
  any: "No period mentioned",
  this_cycle: "This budget cycle, or since payday",
  last_cycle: "The previous budget cycle",
  this_month: "This calendar month",
  last_month: "Last calendar month",
  last_30: "The last 30 days, or the past month",
  last_90: "The last 3 months or 90 days",
  this_year: "This year",
  last_year: "Last year",
  explicit: "Specific dates are given",
} as const
export type Period = keyof typeof PERIODS

export const FLOWS = {
  any: "Not specified",
  spending: "Spending, purchases, money out",
  money_in: "Money received from someone, refunds, paybacks",
  income: "Income: pay, salary, interest, earnings",
} as const
export type Flow = keyof typeof FLOWS

/** Questions about a search query (the state, `search`): the period, the kind of
 * money, whether it names a payee, and which of the user's categories it
 * comes closest to (used only to break ties between named categories). */
export function searchQuestions(categories: Category[]): Record<string, JevQuestion> {
  const byId = new Map(categories.map((c) => [c.id, c]))
  const criteria: Record<string, string> = { none: "No category is named" }
  for (const c of categories) {
    if (c.isDefault) continue
    const parent = c.parentId != null ? byId.get(c.parentId) : undefined
    criteria[`c${c.id}`] = parent ? `${parent.name} › ${c.name}` : c.name
  }
  return {
    period: { type: "choice", instructions: "Which period does `search` ask about?", criteria: { ...PERIODS } },
    flow: { type: "choice", instructions: "What kind of money does `search` ask about?", criteria: { ...FLOWS } },
    names_payee: { type: "noul", instructions: "Does `search` name a particular shop, merchant, company, app or person, rather than a kind of thing or spending?" },
    category: { type: "choice", instructions: "Which category does `search` ask about?", criteria },
  }
}

/** Amounts written in a search: "$5", "30", "20+". */
export function searchNumbers(query: string): string[] {
  return [...query.matchAll(/\$?\d+(?:\.\d+)?\+?/g)].map((m) => m[0])
}

/** Every run of one to four words without a number in it: the candidates
 * for what a search names, when Clairic can't say. */
export function searchPhrases(query: string): string[] {
  const words = query.split(/\s+/).map((w) => w.replace(/[?,.!]+$/, "")).filter((w) => w && !/\d/.test(w))
  const out = new Set<string>()
  for (let i = 0; i < words.length; i++) for (let n = 1; n <= 4 && i + n <= words.length; n++) out.add(words.slice(i, i + n).join(" "))
  return [...out]
}

/** Each number's role (Jev read all 25 tuning searches' amounts right;
 * Clairic sometimes invented amounts), and which phrase names what the search
 * is for (the fallback for words: 15 of 25 right, so Clairic goes first). */
export function searchTermQuestions(query: string): Record<string, JevQuestion> {
  const questions: Record<string, JevQuestion> = {}
  searchNumbers(query).forEach((n, i) => {
    questions[`amount${i}`] = {
      type: "choice",
      instructions: `What does "${n}" mean in \`search\`?`,
      criteria: {
        at_least: "The least amount of money wanted: over, more than, at least, or a number followed by +",
        at_most: "The most money wanted: under, less than, up to, at most",
        not_amount: "Not an amount of money: part of a date, a period or a count",
      },
    }
  })
  const phrases = searchPhrases(query)
  if (phrases.length) {
    questions.phrase = {
      type: "choice",
      instructions: "Which words in `search` name what it looks for: a shop, a person, or a kind of thing bought or received?",
      criteria: { ...Object.fromEntries(phrases.map((p, i) => [`p${i}`, `"${p}"`])), none: "Nothing in particular is named, only amounts, dates or periods" },
    }
  }
  return questions
}
