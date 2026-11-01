import type { JevQuestion } from "../ai/judge"
import { isPersonToPerson, rowFacts } from "./history"
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
 *
 * Checked again on 2026-10-29 with 325 merchants held out of the history
 * (each half of the merchants judged against the other half's history):
 * the account holder's examples named in each option (e.g. …) 66.2% top-1;
 * no examples 64.9%; the examples once in the state (`categories_used_for`)
 * 66.2%, with more of its 80%-sure picks right (86% of 189, against 79% of
 * 191) at 40% fewer tokens. How the card was used, the time, the account
 * and a foreign amount added nothing (65.2%), nor did each row's 5 most
 * similar past rows by shared words (64.3%). Most misses were Up's own
 * labels (313 of the 325) on a fine line: a cafe as Takeaway, a roaster as
 * Groceries.
 *
 * Rows with a message (2026-10-30, the 59 categorised ones, each half held
 * out against the other): a payment from a person is told by its message,
 * which merchant history and examples don't cover. Adding up to three of
 * your rows whose messages share rarer words (similar_messages): top-1 73 →
 * 75%, top-3 83 → 85%, 38 picks at 80%+ (35 right) against 28 (26); the
 * standard eval unchanged (203/300, twice, against 200–202). Also naming
 * person-to-person messages among each category's examples: about the same
 * on messages, but a point lower on the standard eval (197, 198); dropped.
 */

// ---------- Category suggestions ----------

/** Shared by every suggestion question in a request. */
export const SUGGESTION_STATE = "Bank transactions from an Australian personal account, one per question."

/** The account holder's own transactions in each category (by its path,
 * as the options name it): in the state once, shared by every question in
 * a request (suggestions, and smart search's category questions), so
 * their choices carry over to merchants Jev hasn't seen with them. */
export type CategoryUses = Record<string, string[]>

/** Said by a question when the state has `categories_used_for`. */
const USES_NOTE = " `categories_used_for` lists some of the account holder's own transactions in each category."

/** The suggestion state: what the rows are, and the account holder's examples when there are any. */
export function suggestionState(uses: CategoryUses = {}): string | Record<string, unknown> {
  return Object.keys(uses).length ? { about: SUGGESTION_STATE, categories_used_for: uses } : SUGGESTION_STATE
}

/** A category as options and `categories_used_for` name it: "Parent › Name". */
export const categoryPath = (c: Category, categories: Category[]) => {
  const parent = categories.find((p) => p.id === c.parentId)
  return parent ? `${parent.name} › ${c.name}` : c.name
}

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

/** `categories_used_for` names this many of the account holder's own
 * transactions in each category. Named in each option (2026-10-27), on the
 * rows with no same-description history, this lifted top-1 by about 1.5
 * points (59 → 60%, three runs each) and let ~30 more of 297 rows reach
 * ACCEPT_ALL_AT at the same precision; 8 did no better. */
export const EXAMPLES_PER_CATEGORY = 4

/** One option per suggestable category, keyed `c<id>`: its path, and
 * whether it is income or not spending. */
export function suggestionCriteria(suggestable: Category[], categories: Category[]): Record<string, string> {
  const criteria: Record<string, string> = {}
  for (const c of suggestable) {
    const parent = categories.find((p) => p.id === c.parentId)
    criteria[`c${c.id}`] = `${categoryPath(c, categories)}${c.income || parent?.income ? " (income)" : ""}${c.notSpending ? " (not spending: moving your own money)" : ""}`
  }
  return criteria
}

/** The bank says the row is a card purchase (Up's "Purchase", "International
 * Purchase"): the description is a business, not a person. */
const purchaseType = (t: Transaction) => !!t.transactionType && !isPersonToPerson(t) && /purchase/i.test(t.transactionType)

/** `uses`: the state has `categories_used_for` (suggestionState). */
export function suggestionQuestion(t: Transaction, criteria: Record<string, string>, earlier = "", note?: string, uses = false, similar: string[] = []): JevQuestion {
  return {
    type: "choice",
    instructions: {
      // A row whose bank type says it's a purchase is at a business: told
      // every row that the description might be a person, Jev filed card
      // purchases at shops with person-like names under People.
      question: "Which category does `transaction` belong in?" + (purchaseType(t) ? "" : " The description may be a person's name or a payment app rather than a shop: then the message, if any, says what the money was for, and the description says nothing about the category.")
        // Money in only: refunds belong with what was bought (said to every
        // row, it cost a point of accuracy on spending).
        + (t.amount > 0 ? " Money back for a purchase (a refund) belongs in the category of what was bought, not income." : "")
        + (uses ? USES_NOTE : "")
        + (note ? " `transaction.merchant_note` is what the account holder says about this merchant." : "")
        + (similar.length ? " `transaction.similar_messages` are the account holder's earlier transactions with messages like this one, and their categories." : ""),
      transaction: rowFacts(t, { earlier, merchantNote: note, similar }),
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
      transaction: rowFacts(t, { category: true }),
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
  const criteria: Record<string, string> = { none: "No category is named" }
  for (const c of categories) if (!c.isDefault) criteria[`c${c.id}`] = categoryPath(c, categories)
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

/** Two questions per category about `search`: kind<id> and every<id>.
 * `uses`: the state has `categories_used_for`. With it (2026-10-29, 30
 * searches), a third as many unrelated categories passed RELATED_KIND_AT
 * (0.7 a search, from 2.0) and none was wrongly covered (from 2), every
 * expected category still related. */
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
      transaction: rowFacts(t, { category: true, when: true }),
    },
  }
}
