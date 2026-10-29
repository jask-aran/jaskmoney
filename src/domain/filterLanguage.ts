import { ASK_DEFAULT_DAYS } from "./ask"

/**
 * JQL (Jask Query Language), described once, from a reading of the parser
 * (domain/filter): F1 in the search bar shows the brief version, `m` there
 * and the rule writer's guide (aiHistory FILTER_GUIDE) the full one, so
 * the two can't drift. What only the search bar has (top:, ask:, ?words,
 * names found by bare words, the fallback) is marked: a rule's guide leaves
 * it out. filterLanguage.test checks every example parses, and that each
 * gotcha's wrong input really reads differently from its fix.
 */

export interface Row {
  write: string
  means: string
  /** In the brief version too. */
  brief?: boolean
  /** Only the search bar has it: not in a rule's guide. */
  searchOnly?: boolean
  /** Only in the search bar's version (a rule's says it differently). */
  ruleOnly?: boolean
}

/** A mistake as people make it, what's wrong, and the input that works. */
export interface Gotcha extends Row { fix: string }

export type Block =
  | { kind: "text"; text: string; searchOnly?: boolean }
  | { kind: "code"; lines: string[] }
  | { kind: "rows"; rows: Row[] }
  | { kind: "gotchas"; rows: Gotcha[] }

export interface Section {
  title: string
  /** Said beside the title. */
  aside?: string
  /** In the brief version (its brief rows). */
  brief?: boolean
  blocks: Block[]
}

export const JQL_SUMMARY = "A search is a list of terms. A space between terms means AND, OR means either, NOT leaves out, and brackets group."

/** The example under the summary, and what it finds. */
export const JQL_EXAMPLE = { write: "(kfc OR mcdonalds) date:2026-10 amt:<-10", means: "KFC or McDonald's, in October, over $10 spent" }

export const JQL: Section[] = [
  {
    title: "Terms",
    brief: true,
    blocks: [{ kind: "rows", rows: [
      { write: "coffee", means: "description contains it; ignores case, punctuation", brief: true },
      { write: "\"uber eats\"", means: "this phrase, words together and in order", brief: true },
      { write: "desc:uber eats", means: "description contains the phrase (a value runs on)", brief: true },
      { write: "note:gift", means: "your own notes on the row contain it", brief: true },
      { write: "cat:Groceries", means: "category is exactly this, not its subcategories", brief: true },
      { write: "tag:TRAVEL", means: "has this tag", brief: true },
      { write: "acc:Spending", means: "account is exactly this", brief: true },
      { write: "type:spending", means: "spending, income, debit (out) or credit (in)", brief: true },
      { write: "amt:<-50", means: "amount, spent is negative: < > <= >= = or -50..-10", brief: true },
      { write: "date:2026-10", means: "a month, a day (2026-10-14), or a range with ..", brief: true },
      { write: "top:5", means: "only the 5 biggest of what the rest finds", brief: true, searchOnly: true },
      { write: "ask:work lunches", means: `Jev judges each row (${ASK_DEFAULT_DAYS} days, unless date: says)`, brief: true, searchOnly: true },
      { write: "?coffee last month", means: "say it in words; the search is written for you", brief: true, searchOnly: true },
    ] }],
  },
  {
    title: "Precedence",
    aside: "NOT binds tightest, then AND (or a space), then OR",
    brief: true,
    blocks: [{ kind: "rows", rows: [
      { write: "a b OR c", means: "reads as (a b) OR c", brief: true },
      { write: "NOT a b", means: "reads as (NOT a) b", brief: true },
    ] }],
  },
  {
    title: "Gotchas",
    brief: true,
    blocks: [{ kind: "gotchas", rows: [
      { write: "kfc or mcdonalds", fix: "kfc OR mcdonalds", means: "lowercase or is a word to find", brief: true },
      { write: "-eats", fix: "NOT eats", means: "- isn't NOT; it's ignored", brief: true },
      { write: "cat:Groceries coffee", fix: "coffee cat:Groceries", means: "the value runs on", brief: true },
      { write: "amt:< -50", fix: "amt:<-50", means: "amt: date: type: top: take one word", brief: true },
      { write: "catt:x", fix: "cat:x", means: "not a field: the search becomes one phrase", brief: true, searchOnly: true },
      { write: "catt:x", fix: "cat:x", means: "not a field: the filter doesn't parse", ruleOnly: true },
      { write: "12:30", fix: "\"12:30\"", means: "a : outside a field needs quotes" },
      { write: "date:2026-10-01 .. 2026-10-14", fix: "date:2026-10-01..2026-10-14", means: "a range is one word" },
      { write: "amt:-10..-50", fix: "amt:-50..-10", means: "a range starts at its low end" },
      { write: "a b OR c", fix: "(a b) OR c", means: "saved filters and rules bracket mixed AND/OR" },
    ] }],
  },
  {
    title: "Grammar",
    blocks: [{ kind: "code", lines: [
      "query      = or_expr ;",
      "or_expr    = and_expr { \"OR\" and_expr } ;",
      "and_expr   = unary { [ \"AND\" ] unary } ;  (* side by side = AND *)",
      "unary      = { \"NOT\" } primary ;",
      "primary    = \"(\" or_expr \")\" | quoted | field_term | word ;",
      "field_term = multi \":\" ( quoted | word { word } )",
      "           | single \":\" ( quoted | word ) ;",
      "multi      = \"desc\" | \"note\" | \"cat\" | \"tag\" | \"acc\" | \"ask\" ;",
      "single     = \"amt\" | \"date\" | \"type\" | \"top\" ;  (* fields: any case *)",
      "word       = { char but space ( ) : \" } ;  (* not AND, OR, NOT *)",
      "quoted     = '\"' { char | '\\\"' | '\\\\' } '\"' ;",
    ] }],
  },
  {
    title: "Reading",
    blocks: [
      { kind: "text", text: "Spaces only separate. ( ) : and \" are tokens of their own, so cat : Groceries is cat:Groceries, and a : that doesn't follow a field name is an error unless it's inside quotes." },
      { kind: "text", text: "AND, OR and NOT are operators only in capitals and standing alone; and, or, not and NOTE are words. NOT may repeat (NOT NOT a is a)." },
      { kind: "text", text: "A word just before : is a field only if it's one of the ten names. A multi-word value (desc note cat tag acc ask) takes words until the next field, AND, OR, NOT, bracket or quoted text; several spaces read as one. amt, date, type and top take one word. Quoted text may escape \\\" and \\\\." },
    ],
  },
  {
    title: "Matching",
    blocks: [{ kind: "rows", rows: [
      { write: "words, \"…\", desc:, note:", means: "contain the text, ignoring case, spaces and punctuation on both sides (desc:mcdonalds finds McDonald's); the letters stay in order, so a phrase must appear as one run. Text with no letters or digits is matched as written." },
      { write: "bare words", means: "search the description; with no field anywhere in the search, category and tag names too", searchOnly: true },
      { write: "bare words", means: "search the description", ruleOnly: true },
      { write: "cat: tag: acc:", means: "equal the whole name, ignoring case. cat:Uncategorised is rows without a category; a group's name finds rows in the group itself, not in its subcategories." },
      { write: "type:", means: "debit is any money out, credit any money in; spending is money out (or a refund back into a spending category) outside the income categories, income is money in an income category; neither counts transfers, excluded categories or IGNORE-tagged rows" },
      { write: "amt:", means: "the signed amount (money out is negative): -12 or =-12 exactly; < > <= >= compare; lo..hi inclusive, low end first" },
      { write: "date:", means: "the row's date: YYYY-MM-DD a day; YYYY-MM or YY-MM a whole month; a..b inclusive, each end a day or a month (2026-09..2026-10 is September to October)" },
      { write: "top:N", means: "applied last: the N rows with the biggest amounts, money out or in, ties the newest; once, ANDed at the top level (not inside OR, NOT or brackets)", searchOnly: true },
      { write: "ask:words", means: "Jev judges whether each row is what someone searching for the words wants; a row it hasn't judged yet doesn't match", searchOnly: true },
    ] }],
  },
  {
    title: "When it doesn't parse",
    blocks: [
      { kind: "text", text: "In the search bar, input that doesn't parse is searched as one phrase, in descriptions and category and tag names, and the bar marks it parse, in red.", searchOnly: true },
      { kind: "text", text: "A saved filter or a rule must parse, and must bracket AND inside OR (or OR inside AND)." },
    ],
  },
  {
    title: "Examples",
    blocks: [{ kind: "rows", rows: [
      { write: "uber NOT eats", means: "Uber, but not Uber Eats" },
      { write: "cat:\"Restaurants & Cafes\" date:2026-10", means: "a category, in October" },
      { write: "(cat:Groceries OR cat:Takeaway) amt:<-30", means: "either category, over $30 spent" },
      { write: "note:gift date:2026-01..2026-06", means: "your notes say gift, January to June" },
      { write: "type:credit NOT cat:Salary", means: "money in that isn't pay" },
      { write: "type:spending date:2026-09 top:5", means: "September's 5 biggest", searchOnly: true },
      { write: "?coffee over $5 last month", means: "in words", searchOnly: true },
    ] }],
  },
]

/** What a version keeps: the search bar's has everything but the rule-only
 * wording; a rule's leaves out what only the search bar has. */
export const keeps = (forRules: boolean) => (x: { searchOnly?: boolean; ruleOnly?: boolean }) => (forRules ? !x.searchOnly : !x.ruleOnly)

/** The full language as text, for the rule writer (what a rule can use): every section, in order. */
export function filterGuide(): string {
  const keep = keeps(true)
  const out = [JQL_SUMMARY, `Example: ${JQL_EXAMPLE.write}  (${JQL_EXAMPLE.means})`]
  for (const section of JQL) {
    out.push("", `${section.title.toUpperCase()}${section.aside ? `: ${section.aside}` : ""}`)
    for (const block of section.blocks) {
      if (block.kind === "text") { if (keep(block)) out.push(block.text); continue }
      if (block.kind === "code") { out.push(...block.lines.map((l) => `  ${l}`)); continue }
      if (block.kind === "gotchas") out.push(...block.rows.filter(keep).map((r) => `  ${r.write}  →  ${r.fix}  (${r.means})`))
      else out.push(...block.rows.filter(keep).map((r) => `  ${r.write}  ${r.means}`))
    }
  }
  return out.join("\n")
}
