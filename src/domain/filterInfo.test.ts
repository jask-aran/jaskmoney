import { expect, test } from "bun:test"
import { canonicalFilter, evalFilter, parseFilter, parseFilterStrict, type FilterTxn } from "./filter"
import { JQL } from "./filterLanguage"

/**
 * info: (approved 2026-10-30, a term legacy Go filter.go doesn't have):
 * what's known about a row beyond its description — what its order emails
 * say it bought, the bank's message, and the bank's raw text — matched as
 * desc: and note: match. Bare words stay description-only.
 */

const row = (over: Partial<FilterTxn> = {}): FilterTxn => ({
  description: "Amazon", categoryId: null, categoryName: "Uncategorised", accountName: "Spending",
  notes: "", amount: -69.99, dateISO: "2026-10-20", tagNames: [], ...over,
})
const matches = (input: string, t: FilterTxn) => {
  const r = parseFilter(input)
  expect(r.error).toBeUndefined()
  return evalFilter(r.node, t)
}

const brush = row({ bought: [{ name: "Oral-B iO Series 3 Electric Toothbrush" }, { name: "Brush Heads" }] })

test("info: finds what a row bought, ignoring case, spaces and punctuation", () => {
  expect(matches("info:toothbrush", brush)).toBe(true)
  expect(matches("info:oralb", brush)).toBe(true)
  expect(matches("info:\"brush heads\"", brush)).toBe(true)
  expect(matches("info:blender", brush)).toBe(false)
})

test("info: finds the bank's message and raw text", () => {
  expect(matches("info:rent", row({ description: "Sam Lee", message: "Rent for October" }))).toBe(true)
  expect(matches("info:marketplace", row({ rawText: "AMAZON AU MARKETPLACE, SYDNEY" }))).toBe(true)
})

test("info: doesn't search the description, notes or category; a row with nothing more never matches", () => {
  expect(matches("info:amazon", row())).toBe(false)
  expect(matches("info:gift", row({ notes: "gift" }))).toBe(false)
  expect(matches("info:anything", row({ bought: [], message: null, rawText: null }))).toBe(false)
})

test("bare words and desc: stay description-only", () => {
  expect(matches("toothbrush", brush)).toBe(false)
  expect(matches("desc:toothbrush", brush)).toBe(false)
  expect(matches("amazon info:toothbrush", brush)).toBe(true)
  expect(matches("info:toothbrush OR info:blender", brush)).toBe(true)
  expect(matches("NOT info:toothbrush", brush)).toBe(false)
})

test("info: is strict JQL, saved as written", () => {
  expect(parseFilterStrict("info:toothbrush").error).toBeUndefined()
  expect(canonicalFilter("info:toothbrush").text).toBe("info:toothbrush")
  expect(canonicalFilter('info:"brush heads"').text).toBe('info:"brush heads"')
})

test("the JQL description has info: as a term", () => {
  const terms = JQL.find((s) => s.title === "Terms")!.blocks.flatMap((b) => (b.kind === "rows" ? b.rows : []))
  expect(terms.some((r) => r.write.startsWith("info:"))).toBe(true)
})
