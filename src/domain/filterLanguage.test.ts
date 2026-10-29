import { expect, test } from "bun:test"
import { FILTER_FIELDS, notForRules, parseFilterStrict } from "./filter"
import { FILTER_LANGUAGE, filterGuide } from "./filterLanguage"
import { FILTER_GUIDE } from "./aiHistory"
import { SEARCH_HELP, SEARCH_HELP_WIDTH } from "../state/searchHelp"

const items = FILTER_LANGUAGE.flatMap((s) => s.items)
const examples = FILTER_LANGUAGE.find((s) => s.title === "Examples")!.items

test("every field the parser knows is described, once", () => {
  for (const field of FILTER_FIELDS) expect(items.filter((i) => i.term === `${field}:`)).toHaveLength(1)
})

test("the model's guide is the same description, without what a rule can't use; its examples work in a rule", () => {
  expect(FILTER_GUIDE).toContain(filterGuide())
  for (const item of items) {
    if (item.searchOnly) expect(filterGuide()).not.toContain(`- ${item.term}  `)
    else expect(filterGuide()).toContain(`- ${item.term}  ${item.means}`)
  }
  for (const example of examples.filter((e) => !e.searchOnly)) {
    const { node, error } = parseFilterStrict(example.term)
    expect(error).toBeUndefined()
    expect(notForRules(node)).toBeNull()
  }
})

test("the search help shows all of it, within its width; its examples parse as written", () => {
  const text = SEARCH_HELP.map((l) => l.map((p) => p.text).join("")).join(" ").replace(/\s+/g, " ")
  for (const line of SEARCH_HELP) expect(line.map((p) => p.text).join("").length).toBeLessThanOrEqual(SEARCH_HELP_WIDTH)
  for (const item of items) expect(text).toContain(item.term)
  for (const example of examples.filter((e) => !e.term.startsWith("?"))) expect(parseFilterStrict(example.term).error).toBeUndefined()
})
