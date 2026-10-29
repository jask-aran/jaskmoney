import type { JevQuestion } from "../ai/jev"
import { formatMoney } from "./dashboard"
import { MONTHS, weekdayIndex } from "./days"
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
export function transactionFacts(t: Transaction, extra: { category?: boolean; earlier?: string; note?: string } = {}): Record<string, string> {
  return {
    description: t.description,
    amount: `${t.amount < 0 ? "-" : "+"}${formatMoney(Math.abs(t.amount))}`,
    direction: t.amount < 0 ? "money out" : "money in",
    ...(t.transactionType ? { bank_type: t.transactionType } : {}),
    ...(t.message ? { message: t.message } : {}),
    ...(t.rawText && t.rawText !== t.description ? { bank_text: t.rawText } : {}),
    ...(extra.category && t.categoryId != null && t.categoryName && t.categoryName !== "Uncategorised" ? { category: t.categoryName } : {}),
    ...(extra.earlier ? { categorised_before: extra.earlier } : {}),
    ...(extra.note ? { merchant_note: extra.note } : {}),
  }
}

// ---------- Category suggestions ----------

/** Shared by every suggestion question in a request. */
export const SUGGESTION_STATE = "Bank transactions from an Australian personal account, one per question."

/** A suggestion is at least this likely (Jev's probability for its pick) for
 * accept-all (`Y`) to take it unseen. On the tuning rows, about 83% of picks
 * this sure matched the user's category. */
export const ACCEPT_ALL_AT = 0.8

/** A person-to-person payment with no message (Beem, a PayID, "Deposit"
 * from a name) says nothing about what the money was for: its suggestion is
 * at most this sure, so it reads as a guess and accept-all never takes it.
 * Jev still ranks it (one earlier Beem row in Holidays & Travel made Jev
 * 60–82% sure of travel for every Beem row). */
export const NO_DETAIL_CAP = 0.45

/** A suggestion keeps this many of the categories it weighed (the picker
 * lists them first, with their confidence), each at least RANKED_MIN. */
export const SUGGESTION_RANKED = 5
export const RANKED_MIN = 0.03

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

export function suggestionQuestion(t: Transaction, criteria: Record<string, string>, earlier = "", note?: string): JevQuestion {
  return {
    type: "choice",
    instructions: {
      question: "Which category does `transaction` belong in? The description may be a person's name or a payment app rather than a shop: then the message, if any, says what the money was for, and the description says nothing about the category."
        // Money in only: refunds belong with what was bought (said to every
        // row, it cost a point of accuracy on spending).
        + (t.amount > 0 ? " Money back for a purchase (a refund) belongs in the category of what was bought, not income." : "")
        + (namesExamples(criteria) ? " Each category lists some of the account holder's own transactions in it." : "")
        + (note ? " `transaction.merchant_note` is what the account holder says about this merchant." : ""),
      transaction: transactionFacts(t, { earlier, note }),
    },
    criteria,
  }
}

// ---------- Merchant breadth ----------

/** Shared by every merchant-breadth question in a request. */
export const MERCHANT_STATE = "Shops and merchants on an Australian personal bank account."

/**
 * Whether a merchant's name says what was bought: a marketplace or a store
 * selling many unrelated goods (eBay, Kmart) doesn't, a supermarket or a
 * cafe does. Asked once per name (cached). Probed 2026-10-29 on the user's
 * ~80 most used merchants: marketplaces and department stores 0.87–0.95,
 * convenience stores 0.58, an office supplier 0.45, supermarkets 0.15–0.26,
 * cafes, bars, fuel and services under 0.4. Wordings that let supermarkets
 * through (Coles 0.77–0.93): "Does it sell many different kinds of goods?"
 * and "Could a purchase there belong in many spending categories?".
 *
 * With the user's note (merchant_notes) it asks about their own purchases
 * there instead. On 12 notes (2026-10-29) this wording put "always
 * groceries", "groceries", "only books", "stationery for uni" at 0.08–0.27
 * and "varies…", "presents and homewares" at 0.80–0.93; "Does the holder buy
 * many different kinds of things there?" read "groceries" (Coles) as 0.49.
 */
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

/** At or above: the name doesn't say what was bought (mixed). From
 * MIXED_UNSURE_AT up: it might not (unsure). On the probe 0.3–0.4 held a
 * pub, a cafe and a petrol station, so the band starts at 0.4. */
export const MIXED_AT = 0.7
export const MIXED_UNSURE_AT = 0.4

/** An unsure merchant's suggestion, with no message to say what was bought,
 * is at most this sure: below ACCEPT_ALL_AT, so accept-all doesn't take it
 * unseen. A mixed one's is at most NO_DETAIL_CAP, a guess. */
export const UNSURE_CAP = 0.75

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
        top_count: "How many of the biggest transactions to show: top 10, the 5 largest, biggest 3",
        // Its own role so "the 5 cheapest" is never read as the 5 biggest.
        smallest_count: "How many of the smallest transactions to show: the 5 cheapest, smallest 3",
        not_amount: "Not an amount of money: part of a date, a period or another count",
      },
    }
  })
  const phrases = searchPhrases(query)
  if (phrases.length) {
    questions.phrase = {
      type: "choice",
      // "Which words name what it looks for: a shop, a person, or a kind of
      // thing?" picked fragments ("stuff" of "stuff for the car"); this
      // took the full phrase on 2 of 8 searches and matched the rest (2026-10-29).
      instructions: "Which phrase in `search` names, in full, the kind of thing, shop or person it looks for, leaving out amounts, counts, dates and periods?",
      criteria: { ...Object.fromEntries(phrases.map((p, i) => [`p${i}`, `"${p}"`])), none: "Nothing in particular is named: only amounts, dates, periods, or words for any transaction such as transactions, purchases or payments" },
    }
  }
  return questions
}

// ---------- Category routing ----------

/** A broad search ("stuff for the car") is routed to the user's categories
 * it covers: Jev rates each category as "a kind of spending the search asks
 * about" (kind) and "every transaction in it is something the search asks
 * about" (every). A category needs both: kind alone takes the category a
 * narrow search sits inside (coffee → Restaurants & Cafes); every alone
 * misses most. Tuned on 20 searches, checked on 14 more (2026-10-27): 81%
 * and 100% of the expected categories found, 2 and 1 wrong. */
export const COVERS_KIND_AT = 0.6
export const COVERS_EVERY_AT = 0.3

/** Categories a search can be routed to: assignable leaves, not Uncategorised. */
function routableCategories(categories: Category[]): Category[] {
  const parents = new Set(categories.map((c) => c.parentId).filter((id): id is number => id != null))
  return categories.filter((c) => !parents.has(c.id) && !c.isDefault)
}

const categoryPath = (c: Category, categories: Category[]) => {
  const parent = categories.find((p) => p.id === c.parentId)
  return parent ? `${parent.name} › ${c.name}` : c.name
}

/** Two questions per category about `search`: kind<id> and every<id>. */
export function coverQuestions(categories: Category[]): Record<string, JevQuestion> {
  const questions: Record<string, JevQuestion> = {}
  for (const c of routableCategories(categories)) {
    const category = categoryPath(c, categories)
    questions[`kind${c.id}`] = { type: "noul", instructions: { question: "Is `category` a kind of spending that `search` asks about?", category } }
    questions[`every${c.id}`] = { type: "noul", instructions: { question: "Is every transaction in `category` something `search` asks about?", category } }
  }
  return questions
}

/** A category the search doesn't cover is still related at this "kind"
 * or more: Jev reads only related and uncategorised rows, not every row.
 * Probed on 8 searches (2026-10-29): coffee → Restaurants & Cafes 0.78,
 * Takeaway 0.60, Groceries 0.59 (beans), with Pubs & Bars 0.33 left out;
 * gifts → Holidays & Travel, Children & Family, People 0.44–0.54. */
export const RELATED_KIND_AT = 0.4

/** Categories related to a search but not covered by it (see RELATED_KIND_AT). */
export function relatedCategoryIds(answers: Record<string, { type: string; noul?: number }>, categories: Category[]): number[] {
  const covered = new Set(coveredCategoryIds(answers, categories))
  const kind = (id: number) => { const a = answers[`kind${id}`]; return a?.type === "noul" ? a.noul ?? 0 : 0 }
  return routableCategories(categories).filter((c) => !covered.has(c.id) && kind(c.id) >= RELATED_KIND_AT).map((c) => c.id)
}

/** The categories a search covers, by coverQuestions' answers. */
export function coveredCategoryIds(answers: Record<string, { type: string; noul?: number }>, categories: Category[]): number[] {
  const yes = (id: string, at: number) => { const a = answers[id]; return a?.type === "noul" && (a.noul ?? 0) >= at }
  return routableCategories(categories).filter((c) => yes(`kind${c.id}`, COVERS_KIND_AT) && yes(`every${c.id}`, COVERS_EVERY_AT)).map((c) => c.id)
}

// ---------- Tag suggestions ----------

/** When a row happened, as a person reads it: "Fri 22 May 2026, 18:45"
 * (the time when the provider gives one: Up does, CSV doesn't). */
export function whenText(t: Pick<Transaction, "dateISO" | "dateRaw">): string {
  const [y, m, d] = t.dateISO.split("-").map(Number) as [number, number, number]
  const date = `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][weekdayIndex(t.dateISO)]} ${d} ${MONTHS[m - 1]} ${y}`
  const time = /T(\d\d:\d\d)/.exec(t.dateRaw ?? "")?.[1]
  return time ? `${date}, ${time}` : date
}

/** The tag, what it was found as (a detected trip's place and dates), and
 * how it has been used; shared by every row's question. Without `about`
 * Jev put coffee and parking at home in the days before a trip at 61–73%. */
export const tagState = (name: string, examples: string[], about?: string) => ({
  tag: name,
  ...(about ? { about } : {}),
  ...(examples.length ? { tagged_before: examples.join("; ") } : {}),
})

/** Whether the tag belongs on one row: the row with its category, when it
 * happened, and any foreign amount (a trip's are). */
export function tagQuestion(t: Transaction, withExamples: boolean, withAbout = false): JevQuestion {
  return {
    type: "noul",
    instructions: {
      question: "Does the tag `tag` belong on `transaction`?" + (withAbout ? " `about` says what the tag is for." : "") + (withExamples ? " `tagged_before` lists transactions already given it." : ""),
      transaction: { ...transactionFacts(t, { category: true }), when: whenText(t), ...(t.foreignAmount ? { foreign_amount: t.foreignAmount } : {}) },
    },
  }
}
