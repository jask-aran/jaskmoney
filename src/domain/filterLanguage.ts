import { ASK_DEFAULT_DAYS } from "./ask"

/**
 * The filter language, described once: the search help (F1) lays it out for
 * people, and the rule writer's guide (aiHistory FILTER_GUIDE) gives it to
 * the model, so the two can't drift. What a rule can't use (ask:, top:)
 * or only the search bar does is marked, and the guide leaves it out.
 */
export interface LanguageItem {
  term: string
  means: string
  /** Not in a rule: only the search bar does or allows it. */
  searchOnly?: boolean
}

export interface LanguageSection {
  title: string
  /** Said under the title. */
  lead?: string
  items: LanguageItem[]
  /** Sentences after the items. */
  notes?: LanguageItem[]
}

export const FILTER_LANGUAGE: LanguageSection[] = [
  {
    title: "Words",
    items: [
      { term: "coffee", means: "a plain word is looked for in the description; case, spaces and punctuation don't matter" },
      { term: "uber eats", means: "several words: a row needs them all, in any order" },
      { term: '"uber eats"', means: "quotes keep words together as one phrase, or hold a value with : or ( ) in it; otherwise they're optional" },
    ],
    notes: [{ term: "", means: "With no field in the search, words also find category and tag names.", searchOnly: true }],
  },
  {
    title: "Fields",
    lead: "name:value, any case; values may have spaces",
    items: [
      { term: "desc:", means: "description has the words (case, spaces and punctuation ignored)" },
      { term: "note:", means: "your own notes on the row have the words" },
      { term: "cat:", means: "category is the name (cat:Uncategorised for none)" },
      { term: "tag:", means: "has the tag" },
      { term: "acc:", means: "account is the name" },
      { term: "type:", means: "spending, income, debit (money out) or credit (money in)" },
      { term: "amt:", means: "amount, spent is negative: <-50  >50  >=10  =-30  -50..-10" },
      { term: "date:", means: "2026-10  2026-10-14  2026-10-01..2026-10-14" },
      { term: "top:", means: "only the N biggest of what the rest finds; for the whole search", searchOnly: true },
      { term: "ask:", means: `Jev judges each row (the last ${ASK_DEFAULT_DAYS} days, unless date: says)`, searchOnly: true },
    ],
    notes: [{ term: "", means: "A value runs to the next field, AND, OR or bracket: write plain words first (coffee cat:Groceries), or put the value in quotes." }],
  },
  {
    title: "Combining",
    items: [
      { term: "a b", means: "both (AND is implied)" },
      { term: "a OR b", means: "either" },
      { term: "NOT a", means: "leave these out" },
      { term: "( … )", means: "group" },
      { term: "?words", means: "at the start: say it in words, and a search is written", searchOnly: true },
    ],
    notes: [
      { term: "", means: "AND, OR and NOT work only in capitals. NOT binds first, then AND, then OR: kfc OR mcdonalds amt:<-10 is all KFC, plus McDonald's over $10." },
      { term: "", means: "If the search can't be read, the whole text is looked for as one phrase.", searchOnly: true },
    ],
  },
  {
    title: "Examples",
    items: [
      { term: "(kfc OR mcdonalds) amt:<-10", means: "either shop, over $10" },
      { term: "cat:Restaurants & Cafes date:2026-10", means: "a category, in October" },
      { term: "uber NOT eats", means: "Uber, but not Uber Eats" },
      { term: "cat:Groceries OR cat:Takeaway", means: "either category" },
      { term: "type:spending date:2026-09 top:5", means: "September's 5 biggest", searchOnly: true },
      { term: "note:gift date:2026-01..2026-06", means: "your notes say gift, January–June" },
      { term: "?coffee over $5 last month", means: "in words", searchOnly: true },
    ],
  },
]

/** The language as the rule writer's model reads it: what a rule can use. */
export function filterGuide(): string {
  return FILTER_LANGUAGE.map((section) => {
    const items = section.items.filter((i) => !i.searchOnly).map((i) => `- ${i.term}  ${i.means}`)
    const notes = (section.notes ?? []).filter((n) => !n.searchOnly).map((n) => n.means)
    return [`${section.title}${section.lead ? ` (${section.lead})` : ""}:`, ...items, ...notes].join("\n")
  }).join("\n")
}
