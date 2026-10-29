import { expect, test } from "bun:test"
import { evalFilter, FILTER_FIELDS, filterExprString, notForRules, parseFilter, parseFilterStrict, reparseFilterInput } from "./filter"
import { filterGuide, JQL, JQL_EXAMPLE, type Gotcha, type Row } from "./filterLanguage"
import { FILTER_GUIDE } from "./aiHistory"
import { SEARCH_HELP, SEARCH_HELP_FULL, SEARCH_HELP_WIDTH } from "../state/searchHelp"
import { data } from "../state/dataStore"

const section = (title: string) => JQL.find((s) => s.title === title)!
const rows = (title: string): Row[] => section(title).blocks.flatMap((b) => (b.kind === "rows" || b.kind === "gotchas" ? b.rows : []))
const gotchas = rows("Gotchas") as Gotcha[]
const read = (s: string) => { const { node, error } = parseFilter(s); return error ? `error: ${error}` : filterExprString(node) }
const text = (lines: typeof SEARCH_HELP) => lines.map((l) => l.map((p) => p.text).join(""))

test("every field the parser knows is a term, once, and in the grammar", () => {
  const terms = rows("Terms")
  for (const field of FILTER_FIELDS) {
    expect(terms.filter((r) => r.write.startsWith(`${field}:`))).toHaveLength(1)
    expect(section("Grammar").blocks.flatMap((b) => (b.kind === "code" ? b.lines : [])).join(" ")).toContain(`"${field}"`)
  }
})

test("every example and fix is valid JQL; what a rule can use parses strictly and works in a rule", () => {
  const written = [JQL_EXAMPLE.write, ...rows("Terms").map((r) => r.write), ...rows("Examples").map((r) => r.write), ...gotchas.map((g) => g.fix)]
  for (const jql of written.filter((w) => !w.startsWith("?"))) expect({ jql, error: parseFilter(jql).error }).toEqual({ jql, error: undefined })
  for (const row of [...rows("Examples"), ...gotchas.map((g) => ({ ...g, write: g.fix }))].filter((r) => !r.searchOnly && !r.write.startsWith("?"))) {
    const { node, error } = parseFilterStrict(row.write)
    expect({ jql: row.write, error, rule: notForRules(node) }).toEqual({ jql: row.write, error: undefined, rule: null })
  }
})

test("each gotcha is real: the wrong input reads differently from its fix, or a rule refuses it", () => {
  for (const g of gotchas) {
    const differs = read(g.write) !== read(g.fix)
    const refused = !!parseFilterStrict(g.write).error && !parseFilterStrict(g.fix).error
    expect({ wrong: g.write, real: differs || refused }).toEqual({ wrong: g.write, real: true })
  }
})

test("precedence reads as it says", () => {
  for (const row of rows("Precedence")) {
    const as = row.means.replace(/^reads as /, "")
    expect(read(row.write)).toBe(read(as))
  }
})

test("what the description claims about matching holds", () => {
  const row = (o: object) => ({ description: "Uber Eats Sydney", categoryId: 1, categoryName: "Takeaway", accountName: "Spending", notes: "", amount: -12, dateISO: "2026-10-03", tagNames: ["TRAVEL"], ...o })
  const is = (jql: string, o: object = {}) => evalFilter(parseFilter(jql).node, row(o))
  // A field's value is one phrase; bare words are separate.
  expect(is("desc:uber eats")).toBe(true)
  expect(is("desc:uber eats", { description: "Uber trip eats" })).toBe(false)
  expect(is("uber eats", { description: "Uber trip eats" })).toBe(true)
  // Case, spaces and punctuation are ignored; - is punctuation, not NOT.
  expect(is("desc:mcdonalds", { description: "McDonald's" })).toBe(true)
  expect(is("-eats")).toBe(true)
  // cat: is the whole name, not a group's subcategories.
  expect(is("cat:takeaway")).toBe(true)
  expect(is("cat:Good Life")).toBe(false)
  // Bare words find category and tag names only in the search bar, with no field.
  expect(evalFilter(reparseFilterInput("takeaway").expr, row({}))).toBe(true)
  expect(evalFilter(reparseFilterInput("takeaway amt:<0").expr, row({}))).toBe(false)
  expect(is("takeaway")).toBe(false)
  // A month, and a month-to-month range.
  expect(is("date:26-10")).toBe(true)
  expect(is("date:2026-09..2026-10")).toBe(true)
  // The ladder: words alone match names too; a field narrows them to the
  // description; mixed AND/OR is fine in the bar, refused when saved.
  expect(evalFilter(reparseFilterInput("travel").expr, row({}))).toBe(true)
  expect(evalFilter(reparseFilterInput("travel type:debit").expr, row({}))).toBe(false)
  expect(reparseFilterInput("a b OR c").err).toBe("")
  expect(parseFilterStrict("a b OR c").error).toBeDefined()
  expect(reparseFilterInput("catt:x").expr).toMatchObject({ kind: "text", value: "catt:x" })
  // Enter searches it anyway, and flags what a rule wouldn't take.
  data.init(":memory:")
  for (const loose of ["a b OR c", "catt:x"]) {
    const result = data.commitFilter(loose)
    expect({ loose, ok: result.ok, searching: data.state.filterExpr != null, flagged: !!data.state.filterErr }).toEqual({ loose, ok: false, searching: true, flagged: true })
  }
  // Spaces around : don't matter.
  expect(read("cat : Takeaway")).toBe(read("cat:Takeaway"))
})

test("the rule writer gets the full version, without what only the search bar has", () => {
  const guide = filterGuide()
  expect(FILTER_GUIDE).toContain(guide)
  expect(guide).toContain("GRAMMAR")
  for (const r of [...rows("Terms"), ...rows("Examples"), ...rows("Matching"), ...gotchas]) {
    if (r.searchOnly) expect(guide).not.toContain(r.means)
    else expect(guide).toContain(r.means)
  }
})

test("F1's brief version fits a dialog; m's full version has all of it; both within the width", () => {
  const brief = text(SEARCH_HELP)
  const full = text(SEARCH_HELP_FULL)
  expect(brief.length).toBeLessThanOrEqual(38)
  for (const line of [...brief, ...full]) expect(line.length).toBeLessThanOrEqual(SEARCH_HELP_WIDTH)
  const all = (lines: string[]) => lines.join(" ").replace(/\s+/g, " ")
  for (const r of [...rows("Terms"), ...rows("Precedence"), ...gotchas]) if (r.brief) expect(all(brief)).toContain(r.write)
  expect(all(brief)).not.toContain("GRAMMAR")
  for (const r of [...rows("Terms"), ...rows("Examples"), ...rows("Matching"), ...gotchas]) if (!r.ruleOnly) expect(all(full)).toContain(r.write)
})
