import type { JevQuestion } from "../ai/judge"
import { isPersonToPerson, rowFacts } from "./history"
import type { Category, Transaction } from "./types"

export const SUGGESTION_STATE = "Bank transactions from an Australian personal account, one per question."

export type CategoryUses = Record<string, string[]>

const USES_NOTE = " `categories_used_for` lists some of the account holder's own transactions in each category."

export function suggestionState(uses: CategoryUses = {}): string | Record<string, unknown> {
  return Object.keys(uses).length ? { about: SUGGESTION_STATE, categories_used_for: uses } : SUGGESTION_STATE
}

export const categoryPath = (c: Category, categories: Category[]) => {
  const parent = categories.find((p) => p.id === c.parentId)
  return parent ? `${parent.name} › ${c.name}` : c.name
}

export const ACCEPT_ALL_AT = 0.8

export const NO_DETAIL_CAP = 0.45

export const SUGGESTION_RANKED = 5
export const RANKED_MIN = 0.03

export const EXAMPLES_PER_CATEGORY = 4

export function suggestionCriteria(suggestable: Category[], categories: Category[]): Record<string, string> {
  const criteria: Record<string, string> = {}
  for (const c of suggestable) {
    const parent = categories.find((p) => p.id === c.parentId)
    criteria[`c${c.id}`] = `${categoryPath(c, categories)}${c.income || parent?.income ? " (income)" : ""}${c.notSpending ? " (not spending: moving your own money)" : ""}`
  }
  return criteria
}

const purchaseType = (t: Transaction) => !!t.transactionType && !isPersonToPerson(t) && /purchase/i.test(t.transactionType)

export function suggestionQuestion(t: Transaction, criteria: Record<string, string>, earlier = "", note?: string, uses = false, similar: string[] = []): JevQuestion {
  return {
    type: "choice",
    instructions: {
      question: "Which category does `transaction` belong in?" + (purchaseType(t) ? "" : " The description may be a person's name or a payment app rather than a shop: then the message, if any, says what the money was for, and the description says nothing about the category.")
        + (t.amount > 0 ? " Money back for a purchase (a refund) belongs in the category of what was bought, not income." : "")
        + (uses ? USES_NOTE : "")
        + (note ? " `transaction.merchant_note` is what the account holder says about this merchant." : "")
        + (similar.length ? " `transaction.similar_messages` are the account holder's earlier transactions with messages like this one, and their categories." : ""),
      transaction: rowFacts(t, { earlier, merchantNote: note, similar }),
    },
    criteria,
  }
}

export const MERCHANT_STATE = "Shops and merchants on an Australian personal bank account."

export function merchantBreadthQuestion(description: string, bankText: string | null, note?: string): JevQuestion {
  return {
    type: "noul",
    instructions: {
      question: note ? "Going by `merchant.note`, would the account holder's purchases at `merchant` fall into different budget categories from one time to the next?" : "Does `merchant` sell a wide range of unrelated goods (such as electronics, homewares, clothing and toys), so a purchase there could be any of them?",
      merchant: { name: description.trim(), ...(bankText && bankText !== description ? { bank_text: bankText } : {}), ...(note ? { note } : {}) },
    },
    criteria: {
      true: note ? "Different purchases there are different kinds of spending: electronics one time, clothes or a gift the next" : "A marketplace or a store selling many unrelated kinds of goods",
      false: note ? "Their purchases there are nearly always one kind of spending, such as groceries" : "A shop for one kind of thing, including a supermarket (groceries), a cafe, a petrol station or a service",
    },
  }
}

export const MIXED_AT = 0.7
export const MIXED_UNSURE_AT = 0.4

export const UNSURE_CAP = 0.75

export const matchState = (words: string) => ({ search: words })

export const MATCH_AT = 0.7
export const NEAR_AT = 0.3

export function matchQuestion(t: Transaction): JevQuestion {
  return {
    type: "noul",
    instructions: {
      question: "Would someone searching their bank history for `search` want to find `transaction`?",
      transaction: rowFacts(t, { category: true }),
    },
  }
}

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

export function searchQuestions(categories: Category[]): Record<string, JevQuestion> {
  const criteria: Record<string, string> = { none: "No category is named" }
  for (const c of categories) if (!c.isDefault) criteria[`c${c.id}`] = categoryPath(c, categories)
  return {
    period: { type: "choice", instructions: "Which period does `search` ask about?", criteria: { ...PERIODS } },
    flow: { type: "choice", instructions: "What kind of money does `search` ask about?", criteria: { ...FLOWS } },
    names_payee: { type: "noul", instructions: "Does `search` name a particular shop, merchant, company, app or person, rather than a kind of thing or spending?" },
    category: { type: "choice", instructions: "Which category does `search` ask about?", criteria },
  }
}

export function searchNumbers(query: string): string[] {
  return [...query.matchAll(/\$?\d+(?:\.\d+)?\+?/g)].map((m) => m[0])
}

export function searchPhrases(query: string): string[] {
  const words = query.split(/\s+/).map((w) => w.replace(/[?,.!]+$/, "")).filter((w) => w && !/\d/.test(w))
  const out = new Set<string>()
  for (let i = 0; i < words.length; i++) for (let n = 1; n <= 4 && i + n <= words.length; n++) out.add(words.slice(i, i + n).join(" "))
  return [...out]
}

export function searchTermQuestions(query: string): Record<string, JevQuestion> {
  const questions: Record<string, JevQuestion> = {}
  searchNumbers(query).forEach((n, i) => {
    questions[`amount${i}`] = {
      type: "choice",
      instructions: `What does "${n}" mean in \`search\`?`,
      criteria: {
        at_least: "The least amount of money wanted: over, more than, at least, or a number followed by +",
        at_most: "The most money wanted: under, less than, up to, at most",
        top_count: "How many of the biggest transactions to show: top 10, the 5 largest, biggest 3",
        smallest_count: "How many of the smallest transactions to show: the 5 cheapest, smallest 3",
        not_amount: "Not an amount of money: part of a date, a period or another count",
      },
    }
  })
  const phrases = searchPhrases(query)
  if (phrases.length) {
    questions.phrase = {
      type: "choice",
      instructions: "Which phrase in `search` names, in full, the kind of thing, shop or person it looks for, leaving out amounts, counts, dates and periods?",
      criteria: { ...Object.fromEntries(phrases.map((p, i) => [`p${i}`, `"${p}"`])), none: "Nothing in particular is named: only amounts, dates, periods, or words for any transaction such as transactions, purchases or payments" },
    }
  }
  return questions
}

export const COVERS_KIND_AT = 0.6
export const COVERS_EVERY_AT = 0.3

function routableCategories(categories: Category[]): Category[] {
  const parents = new Set(categories.map((c) => c.parentId).filter((id): id is number => id != null))
  return categories.filter((c) => !parents.has(c.id) && !c.isDefault)
}

export function coverQuestions(categories: Category[], uses = false): Record<string, JevQuestion> {
  const questions: Record<string, JevQuestion> = {}
  const note = uses ? USES_NOTE : ""
  for (const c of routableCategories(categories)) {
    const category = categoryPath(c, categories)
    questions[`kind${c.id}`] = { type: "noul", instructions: { question: `Is \`category\` a kind of spending that \`search\` asks about?${note}`, category } }
    questions[`every${c.id}`] = { type: "noul", instructions: { question: `Is every transaction in \`category\` something \`search\` asks about?${note}`, category } }
  }
  return questions
}

export const RELATED_KIND_AT = 0.4

export function relatedCategoryIds(answers: Record<string, { type: string; noul?: number }>, categories: Category[]): number[] {
  const covered = new Set(coveredCategoryIds(answers, categories))
  const kind = (id: number) => { const a = answers[`kind${id}`]; return a?.type === "noul" ? a.noul ?? 0 : 0 }
  return routableCategories(categories).filter((c) => !covered.has(c.id) && kind(c.id) >= RELATED_KIND_AT).map((c) => c.id)
}

export function coveredCategoryIds(answers: Record<string, { type: string; noul?: number }>, categories: Category[]): number[] {
  const yes = (id: string, at: number) => { const a = answers[id]; return a?.type === "noul" && (a.noul ?? 0) >= at }
  return routableCategories(categories).filter((c) => yes(`kind${c.id}`, COVERS_KIND_AT) && yes(`every${c.id}`, COVERS_EVERY_AT)).map((c) => c.id)
}

export const tagState = (name: string, examples: string[], about?: string) => ({
  tag: name,
  ...(about ? { about } : {}),
  ...(examples.length ? { tagged_before: examples.join("; ") } : {}),
})

export function tagQuestion(t: Transaction, withExamples: boolean, withAbout = false): JevQuestion {
  return {
    type: "noul",
    instructions: {
      question: "Does the tag `tag` belong on `transaction`?" + (withAbout ? " `about` says what the tag is for." : "") + (withExamples ? " `tagged_before` lists transactions already given it." : ""),
      transaction: rowFacts(t, { category: true, when: true }),
    },
  }
}
