import { ASK_DEFAULT_DAYS } from "./ask"

/**
 * JQL (Jask Query Language), described once, from a reading of the parser
 * (domain/filter): F1 in the search bar shows the brief version, `m` there
 * and the rule writer's guide (aiHistory FILTER_GUIDE) the full one, so
 * the two can't drift. What only the search bar has (top:, ask:, ?words,
 * what it forgives, names found by bare words, the fallback) is marked: a
 * rule's guide leaves it out, so the model writes the full form.
 * filterLanguage.test checks every example parses, each forgiven input
 * reads as it says, and each gotcha's wrong input really reads differently
 * from its fix.
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
  /** What it reads as, in JQL (forgiven input). */
  reads?: string
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
      { write: "info:toothbrush", means: "what it bought, the bank's message or raw text", brief: true },
      { write: "cat:Groceries", means: "this category, or a group and its subcategories", brief: true },
      { write: "tag:TRAVEL", means: "has this tag", brief: true },
      { write: "acc:Spending", means: "account is this", brief: true },
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
      { write: "a b OR c", means: "reads as (a b) OR c", reads: "(a b) OR c", brief: true },
      { write: "NOT a b", means: "reads as (NOT a) b", reads: "(NOT a) b", brief: true },
    ] }],
  },
  {
    title: "Forgiving",
    aside: "as you type; saving writes it in full",
    brief: true,
    blocks: [{ kind: "rows", rows: [
      { write: "kfc or mcdonalds", reads: "kfc OR mcdonalds", means: "reads as kfc OR mcdonalds", brief: true, searchOnly: true },
      { write: "uber -eats", reads: "uber NOT eats", means: "reads as uber NOT eats", brief: true, searchOnly: true },
      { write: "amt:< -50", reads: "amt:<-50", means: "reads as amt:<-50", brief: true, searchOnly: true },
      { write: "cat:restaurants", reads: "cat:\"Restaurants & Cafes\"", means: "reads as cat:\"Restaurants & Cafes\", if one fits", brief: true, searchOnly: true },
      { write: "12:30", reads: "\"12:30\"", means: "reads as \"12:30\": not a field, so text", brief: true, searchOnly: true },
      { write: "amt:-10..-50", reads: "amt:-50..-10", means: "reads as amt:-50..-10: a range in either order", searchOnly: true },
      { write: "amt:-50 .. -10", reads: "amt:-50..-10", means: "spaces in a value read as none", searchOnly: true },
      { write: "kfc OR", reads: "kfc", means: "a trailing AND, OR or NOT waits for more", searchOnly: true },
      { write: "(kfc OR mcdonalds", reads: "(kfc OR mcdonalds)", means: "a missing ) is closed", searchOnly: true },
      { write: "cat:insurance", reads: "cat:\"Rates & Insurance\" OR cat:\"Car Insurance, Rego & Maintenance\"", means: "several fit: any of them; the bar names them", searchOnly: true },
      { write: "catt:x", reads: "\"catt:x\"", means: "text, and the bar asks: did you mean cat:?", searchOnly: true },
    ] }],
  },
  {
    title: "How strict",
    aside: "loose as you type, full on saving",
    brief: true,
    blocks: [{ kind: "rows", rows: [
      { write: "words only", means: "match the description, category, tags, items, notes…", brief: true, searchOnly: true },
      { write: "add a field", means: "bare words then match only the description", brief: true, searchOnly: true },
      { write: "enter", means: "flags an ambiguous name or a mistyped field", brief: true, searchOnly: true },
      { write: "save it", means: "written in full: brackets, OR, NOT, full names", brief: true },
    ] }],
  },
  {
    title: "Gotchas",
    brief: true,
    blocks: [{ kind: "gotchas", rows: [
      { write: "cat:Groceries coffee", fix: "coffee cat:Groceries", means: "the value runs on", brief: true },
      { write: "desc:uber eats", fix: "uber eats", means: "one phrase; bare words are two", brief: true },
      { write: "cat:insurance", fix: "cat:\"Rates & Insurance\"", means: "several names fit: saving asks for one" },
    ] }],
  },
  {
    title: "Grammar",
    blocks: [{ kind: "code", lines: [
      "query      = or_expr ;",
      "or_expr    = and_expr { ( \"OR\" | \"or\" ) and_expr } ;  (* or: typing *)",
      "and_expr   = unary { [ \"AND\" ] unary } ;   (* side by side = AND *)",
      "unary      = { \"NOT\" } [ \"-\" ] primary ;   (* -x: no space *)",
      "primary    = \"(\" or_expr \")\" | quoted | field_term | text ;",
      "field_term = multi \":\" ( quoted | word { word } )",
      "           | single \":\" ( quoted | word { word } ) ;  (* joined *)",
      "multi      = \"desc\" | \"note\" | \"info\" | \"cat\" | \"tag\" | \"acc\" | \"ask\" ;",
      "single     = \"amt\" | \"date\" | \"type\" | \"top\" ;  (* any case *)",
      "text       = word [ \":\" [ word ] ] ;    (* not a field: text *)",
      "word       = { char but space ( ) : \" } ;  (* not AND OR NOT *)",
      "quoted     = '\"' { char | '\\\"' | '\\\\' } '\"' ;",
    ] }],
  },
  {
    title: "Reading",
    blocks: [
      { kind: "text", text: "Spaces only separate. ( ) : and \" are tokens of their own, so cat : Groceries is cat:Groceries. A word before : that isn't one of the eleven fields is text with what's joined to it: 12:30, ref:ABC." },
      { kind: "text", text: "AND, OR and NOT are operators in capitals, standing alone. A - joined to the start of a term is NOT (-eats, -cat:Takeaway, -\"uber eats\"); -50, a lone - and Coca-Cola are text. NOT may repeat (NOT NOT a is a)." },
      { kind: "text", text: "In the search bar, a lowercase or between two terms is OR; at either end, or quoted, it's a word. A trailing AND, OR or NOT is left for you to finish, and a missing ) is closed.", searchOnly: true },
      { kind: "text", text: "A multi-word value (desc note info cat tag acc ask) takes words until the next field, AND, OR, NOT, a -term, a bracket or quoted text; several spaces read as one. amt, date, type and top take one value, which may be spaced: amt:< -50, date:a .. b. Quoted text may escape \\\" and \\\\." },
    ],
  },
  {
    title: "Matching",
    blocks: [{ kind: "rows", rows: [
      { write: "words, \"…\", desc:, note:, info:", means: "contain the text, ignoring case, spaces and punctuation on both sides (desc:mcdonalds finds McDonald's); the letters stay in order, so a phrase must appear as one run. Text with no letters or digits is matched as written." },
      { write: "bare words", means: "search the description; with no field anywhere in the search, category and tag names, what it bought, its message and your notes too", searchOnly: true },
      { write: "bare words", means: "search the description", ruleOnly: true },
      { write: "cat: tag: acc:", means: "equal the whole name, ignoring case; a group's name also finds its subcategories' rows. cat:Uncategorised is rows without a category." },
      { write: "short names", means: "in the search bar, a name is found by its start, else by any part, when only one fits; several fitting find any of them", searchOnly: true },
      { write: "type:", means: "debit is any money out, credit any money in; spending is money out (or a refund back into a spending category) outside the income categories, income is money in an income category; neither counts transfers, excluded categories or IGNORE-tagged rows" },
      { write: "amt:", means: "the signed amount (money out is negative): -12 or =-12 exactly; < > <= >= compare; lo..hi inclusive, either order" },
      { write: "date:", means: "the row's date: YYYY-MM-DD a day; YYYY-MM or YY-MM a whole month; a..b inclusive, each end a day or a month (2026-09..2026-10 is September to October), either order" },
      { write: "top:N", means: "applied last: the N rows with the biggest amounts, money out or in, ties the newest; once, ANDed at the top level (not inside OR, NOT or brackets)", searchOnly: true },
      { write: "ask:words", means: "Jev judges whether each row is what someone searching for the words wants; a row it hasn't judged yet doesn't match", searchOnly: true },
    ] }],
  },
  {
    title: "Saving",
    blocks: [
      { kind: "text", text: "In the search bar, input that still doesn't parse is searched as one phrase, wherever words alone look, and the bar marks it parse, in red. Enter keeps the search; it flags what saving would refuse.", searchOnly: true },
      { kind: "text", text: "A saved filter or a rule is stored in full: brackets around AND inside OR (and OR inside AND), OR and NOT in capitals, full names, ranges low to high. Saving refuses only what has no one reading: a name several fit, a name nothing fits, a mistyped field." },
    ],
  },
  {
    title: "Examples",
    blocks: [{ kind: "rows", rows: [
      { write: "uber NOT eats", means: "Uber, but not Uber Eats" },
      { write: "cat:\"Restaurants & Cafes\" date:2026-10", means: "a category, in October" },
      { write: "(cat:Groceries OR cat:Takeaway) amt:<-30", means: "either category, over $30 spent" },
      { write: "cat:Home NOT cat:\"Rent & Mortgage\"", means: "the Home group, less rent" },
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
