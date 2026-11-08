import { ASK_DEFAULT_DAYS, ASK_LIMIT } from "../domain/ask"
import { EXAMPLE_LENGTH } from "../domain/history"
import { SUGGESTION_STATE, ACCEPT_ALL_AT, COVERS_EVERY_AT, COVERS_KIND_AT, EXAMPLES_PER_CATEGORY, MATCH_AT, MIXED_AT, MIXED_UNSURE_AT, NEAR_AT, NO_DETAIL_CAP, RELATED_KIND_AT, SUGGESTION_RANKED, UNSURE_CAP } from "../domain/questions"
import { RULE_AFTER, RULE_SHARE } from "../domain/ruleOffers"
import { TAG_SHOW_AT } from "../domain/tagSuggest"
import { RULE_WRITER_TURNS } from "./ruleWriter"

/**
 * What the AI does, described once for Settings › AI models: the uses, the
 * app features in each and the code behind them, every query a use sends,
 * and the context blocks each query is built from (domain/history gathers
 * them). The thresholds quoted are the constants the code reads, and a test
 * (catalog.test) checks each query's real request (app/sentPreview) has
 * exactly the fields declared here, so this can't drift from the code.
 */

export const AI_USES = ["suggestions", "search", "rules"] as const
export type AiUse = (typeof AI_USES)[number]

type BlockId = "framing" | "row" | "merchant" | "merchantHistory" | "merchantNote" | "similarMessages" | "merchantCheck" | "categories" | "categoryExamples" | "tag" | "tagExamples" | "search" | "today" | "jql" | "ruleBrief" | "ruleTools"

/** A piece of context: what it says, where it's gathered from, and the code that gathers it. */
interface ContextBlock {
  name: string
  says: string
  from: string
  code: string
}

const pct = (p: number) => `${Math.round(p * 100)}%`

export const BLOCKS: Record<BlockId, ContextBlock> = {
  framing: {
    name: "What the rows are",
    says: `One fixed sentence: "${SUGGESTION_STATE}"`,
    from: "the app",
    code: "questions.SUGGESTION_STATE",
  },
  row: {
    name: "The transaction",
    says: "Its description (the merchant as the bank names it), amount, money in or out, the bank's type, message and raw text, what its order emails say it bought (Amazon, eBay, through Executor), and your own note, tags and any foreign amount; per query, its category, date, account or card use.",
    from: "the row itself (Up's sync or a CSV import)",
    code: "history.rowFacts",
  },
  merchant: {
    name: "The merchant",
    says: "The merchant's name and the bank's text for it.",
    from: "the newest row with that description",
    code: "questions.merchantBreadthQuestion",
  },
  merchantHistory: {
    name: "Same merchant, before",
    says: "How your rows with the same description were categorised, \"Groceries ×3, Takeaway ×1\": same-sign rows when there are any. Left out for a mixed merchant.",
    from: "your categorised rows",
    code: "history.categorisedByMerchant + rankCategories",
  },
  merchantNote: {
    name: "Your merchant note",
    says: "What you wrote about the merchant (\"varies: electronics, gifts\").",
    from: "Merchants view, n (or N on a row)",
    code: "merchant_notes table",
  },
  similarMessages: {
    name: "Messages like it",
    says: "For a row with a message: up to three of your categorised rows whose messages share its rarer words, as \"panavs gift\" (money in, $30.00) → Gifts & Charity. A person's name says nothing; the message says what it was for.",
    from: "your categorised rows with messages",
    code: "history.similarMessages",
  },
  merchantCheck: {
    name: "Merchant check",
    says: `Not sent: decides. A merchant Jev rates ${pct(MIXED_AT)}+ as selling unrelated things (or whose rows you spread over categories) is mixed: its history and examples aren't used and its suggestions are capped at ${pct(NO_DETAIL_CAP)}; ${pct(MIXED_UNSURE_AT)}+ is unsure, capped at ${pct(UNSURE_CAP)}.`,
    from: "the Merchant check query's answers, stored per merchant",
    code: "suggest.merchantBreadth",
  },
  categories: {
    name: "Your categories",
    says: "Each category you can assign, as \"Group › Name\" (for suggestions, income and not-spending marked).",
    from: "Settings › Categories",
    code: "questions.categoryPath",
  },
  categoryExamples: {
    name: "Your examples per category",
    says: `Up to ${EXAMPLES_PER_CATEGORY} merchants in each category, the most used first (cut at ${EXAMPLE_LENGTH} characters), once for the whole request.`,
    from: "your categorised rows, leaving out people, payment apps and mixed merchants",
    code: "history.examplesOf via suggest.categoryUses",
  },
  tag: {
    name: "The tag",
    says: "Its name and About text; for a trip, its place and dates.",
    from: "Settings › Tags, and the trip detected in your history",
    code: "questions.tagState",
  },
  tagExamples: {
    name: "The tag's examples",
    says: "Up to 8 merchants already given the tag, the most used first.",
    from: "your tagged rows",
    code: "history.examplesOf via tagSuggest.tagExamples",
  },
  search: {
    name: "Your search",
    says: "The words of the search (after ?, or of an ask: term).",
    from: "the search bar",
    code: "app/smartSearch, app/ask",
  },
  today: {
    name: "Today's date",
    says: "So written dates (\"3 March\") resolve to the right year.",
    from: "the clock",
    code: "days.appToday",
  },
  jql: {
    name: "The JQL guide",
    says: "How a filter is written: the same description as F1 in the search bar, without what rules can't use.",
    from: "the JQL description",
    code: "filterLanguage.filterGuide",
  },
  ruleBrief: {
    name: "The rule brief",
    says: "Your categories and tags with their row counts and recent choices, the rows waiting by description, your rules, and rules you declined.",
    from: "your history: rows, the category and tag logs, rules",
    code: "ruleWriter.ruleWriterBrief",
  },
  ruleTools: {
    name: "History tools",
    says: "What the model can look up as it works: a category's or tag's history (its rows' shared facts, your recent choices, descriptions by purity, look-alikes), test a rule, list the waiting rows. Rows come back as The transaction.",
    from: "your history, on request",
    code: "aiHistory.categoryHistory, tagHistory, matchReport, waitingOverview",
  },
}

export type QueryId = "suggestion" | "merchantCheck" | "tagFind" | "searchTerms" | "searchCategories" | "clairic" | "ask" | "ruleWriter"

/** Where a block goes in a query's request: its field names there, or none
 * when the block decides without being sent. `via` a tool's result rather
 * than the first request. */
interface BlockUse { block: BlockId; fields: string[]; via?: "tools" }

interface QueryInfo {
  use: AiUse
  name: string
  model: "jev" | "clairic" | "general"
  /** The code that sends it. */
  code: string
  /** When it's sent, and how many to a request. */
  when: string
  /** What it asks, in plain words. */
  asks: string
  /** What comes back, and what the app does with it. */
  answer: string
  context: BlockUse[]
}

export const QUERIES: Record<QueryId, QueryInfo> = {
  suggestion: {
    use: "suggestions",
    name: "Category suggestion",
    model: "jev",
    code: "suggest.jevSuggestions (questions.suggestionQuestion)",
    when: "For each waiting row history can't settle: in the background after a sync, an import and at startup, when you open i, and after you categorise a row with the same description. One question per row, as many rows a request as fit.",
    asks: "Which of your categories does this transaction belong in?",
    answer: `A probability for every category. The likeliest is the suggestion; at ${pct(ACCEPT_ALL_AT)}+ Y takes it unseen. A person or payment app with no message is capped at ${pct(NO_DETAIL_CAP)}, as the merchant check says for mixed and unsure merchants, unless its order emails say what it bought. The ${SUGGESTION_RANKED} likeliest are kept for the picker (c).`,
    context: [
      { block: "framing", fields: ["about"] },
      { block: "row", fields: ["transaction"] },
      { block: "merchantHistory", fields: ["categorised_before"] },
      { block: "merchantNote", fields: ["merchant_note"] },
      { block: "similarMessages", fields: ["similar_messages"] },
      { block: "categories", fields: ["criteria"] },
      { block: "categoryExamples", fields: ["categories_used_for"] },
      { block: "merchantCheck", fields: [] },
    ],
  },
  merchantCheck: {
    use: "suggestions",
    name: "Merchant check",
    model: "jev",
    code: "suggest.askMerchantBreadth (questions.merchantBreadthQuestion)",
    when: "Once per merchant you spend at, before its rows are suggested; again when you change its note. One question per merchant.",
    asks: "Does this merchant sell many unrelated kinds of things, so a purchase there could be anything? (With your note: would your purchases there fall into different categories?)",
    answer: `A yes/no probability, stored per merchant: ${pct(MIXED_AT)}+ mixed, ${pct(MIXED_UNSURE_AT)}+ unsure (see Merchant check under context).`,
    context: [
      { block: "merchant", fields: ["merchant"] },
      { block: "merchantNote", fields: ["note"] },
    ],
  },
  tagFind: {
    use: "suggestions",
    name: "Finding a tag's transactions",
    model: "jev",
    code: "tagSuggest.jevTagCandidates (questions.tagQuestion)",
    when: "When you choose a tag with T: one question per row in the tag's categories (a trip: its dates) that the tag isn't on and history doesn't already settle, newest first.",
    asks: "Does this tag belong on this transaction?",
    answer: `A yes/no probability: rows at ${pct(TAG_SHOW_AT)}+ are listed, most likely first; at ${pct(ACCEPT_ALL_AT)}+ Y takes them.`,
    context: [
      { block: "row", fields: ["transaction"] },
      { block: "tag", fields: ["tag", "about"] },
      { block: "tagExamples", fields: ["tagged_before"] },
    ],
  },
  searchTerms: {
    use: "search",
    name: "Smart search: your words",
    model: "jev",
    code: "smartSearch.smartSearch (questions.searchQuestions, searchTermQuestions)",
    when: "Once per smart search (enter on ?words), with the two below at the same time.",
    asks: "Which period does the search mean? Money in or out? What does each number mean (at least, at most, the top N)? Does it name a shop or person? Which phrase names what you want? Does it name one of your categories?",
    answer: "Each a choice; the app writes the JQL from them: a period → date:, money in or out → type:, numbers → amt: or top:, a shop → desc:, a category named → cat:, anything else → ask:.",
    context: [
      { block: "search", fields: ["search"] },
      { block: "categories", fields: ["criteria"] },
    ],
  },
  searchCategories: {
    use: "search",
    name: "Smart search: your categories",
    model: "jev",
    code: "smartSearch.smartSearch (questions.coverQuestions)",
    when: "With the request above, in a request of its own (your examples swayed the phrase pick when they shared one). Two questions per category.",
    asks: "For each category: is it a kind of spending the search asks about? Is every transaction in it something the search asks about?",
    answer: `Both at ${pct(COVERS_KIND_AT)} and ${pct(COVERS_EVERY_AT)}: the category matches outright (cat:). Only the first at ${pct(RELATED_KIND_AT)}+: Jev reads its rows for ask:.`,
    context: [
      { block: "search", fields: ["search"] },
      { block: "categories", fields: ["category"] },
      { block: "categoryExamples", fields: ["categories_used_for"] },
    ],
  },
  clairic: {
    use: "search",
    name: "Smart search: words and dates",
    model: "clairic",
    code: "workersAi.clairic",
    when: "With the Jev requests, when Clairic is connected and on (Search's dialog).",
    asks: "Which words name the merchant or thing? Is a first or last date written?",
    answer: "Typed fields: the words become desc: or ask:, the dates date:. Without Clairic, Jev's phrase pick stands in and written dates aren't read.",
    context: [
      { block: "search", fields: ["state"] },
      { block: "today", fields: ["reference_date"] },
    ],
  },
  ask: {
    use: "search",
    name: "ask: judging",
    model: "jev",
    code: "ask.judgeRows (questions.matchQuestion), from app/ask runAsk",
    when: `For a search with ask:, each row the rest of it allows (from smart search, only its related categories and Uncategorised), the last ${ASK_DEFAULT_DAYS} days unless date: says, at most ${ASK_LIMIT.toLocaleString("en-AU")}. One question per row, many rows a request; answers last the session.`,
    asks: "Would someone searching their history for these words want to find this transaction?",
    answer: `A yes/no probability: ${pct(MATCH_AT)}+ matches; ${pct(NEAR_AT)}–${pct(MATCH_AT)} is a near miss, listed below the matches (n).`,
    context: [
      { block: "search", fields: ["search"] },
      { block: "row", fields: ["transaction"] },
    ],
  },
  ruleWriter: {
    use: "rules",
    name: "Writing rules",
    model: "general",
    code: "ruleWriter.writeRules, through harness.runAgent",
    when: `When you ask (R, then a on its last row): this first request, then one per turn as the model uses the tools, up to ${RULE_WRITER_TURNS} turns.`,
    asks: "Propose precise rules (a JQL filter and a category or tag) from your history, testing each first.",
    answer: `Proposals, each checked by the app before it's offered: at least ${pct(RULE_SHARE)} of the rows it finds already in the target, ${RULE_AFTER} or more of them, and not done by a rule already.`,
    context: [
      { block: "jql", fields: ["system"] },
      { block: "ruleBrief", fields: ["messages"] },
      { block: "ruleTools", fields: ["tools"] },
      { block: "row", fields: [], via: "tools" },
    ],
  },
}

/** An app feature a use powers: what it's called, how you reach it, and the code. */
interface Feature { name: string; reach: string; code: string; queries: QueryId[] }

export const USES: Record<AiUse, { name: string; features: Feature[]; withoutModel?: string }> = {
  suggestions: {
    name: "Suggestions",
    features: [
      { name: "Category suggestions", reach: "i, and in the background", code: "data.suggestCategories, resuggestLike", queries: ["suggestion", "merchantCheck"] },
      { name: "Merchant notes", reach: "n in Merchants", code: "data.setMerchantNote", queries: ["merchantCheck"] },
      { name: "Finding a tag's transactions", reach: "T", code: "data.openTagReview", queries: ["tagFind"] },
    ],
    withoutModel: "History settles a row first, with no model, when enough of your rows with its description sit in one category (suggest.historySuggestions).",
  },
  search: {
    name: "Search",
    features: [
      { name: "Smart search", reach: "? then words", code: "app/smartSearch.runSmartSearch", queries: ["searchTerms", "searchCategories", "clairic"] },
      { name: "ask: terms", reach: "ask:words in any search", code: "app/ask.runAsk → data.askAbout", queries: ["ask"] },
    ],
  },
  rules: {
    name: "Rules",
    features: [{ name: "The rule writer", reach: "R, then a", code: "data.askForRules", queries: ["ruleWriter"] }],
    withoutModel: "Rule offers (R) need no model: they come from choosing one category for a description several times (domain/ruleOffers).",
  },
}

/** A use's queries, in the order its features name them. */
export const useQueries = (use: AiUse): QueryId[] => [...new Set(USES[use].features.flatMap((f) => f.queries))]

/** What each kind of model is, and how it's signed in to. Its address,
 * limits and price come from the clients and pi-ai's catalog (aiDialog). */
export const MODEL_KINDS: Record<"jev" | "clairic" | "general", { does: string; price?: string }> = {
  jev: {
    does: "Answers typed questions about the data sent with them: a choice among named options, with a probability for each, or a yes/no probability. It returns no text.",
    price: "$0.042 per million input tokens; output is free (TypeSafe's price in October 2026)",
  },
  clairic: {
    does: "Reads typed fields (text, a number, a date) out of a piece of text.",
    price: "Workers AI's free daily allowance, then Cloudflare's per-use price",
  },
  general: {
    does: "A general model: writes text and calls tools in a loop (pi-ai's harness), working through your history with the rule writer's tools.",
  },
}

/** A model's queries, by kind. */
export const queriesOf = (model: QueryInfo["model"]): QueryId[] => (Object.keys(QUERIES) as QueryId[]).filter((id) => QUERIES[id].model === model)
