import { expect, test } from "bun:test"
import { canonicalFilter, evalFilter, parseFilter, parseFilterStrict, reparseFilterInput, type FilterTxn } from "./filter"

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

test("info: finds what a row bought (ignoring case, spaces and punctuation), the bank's message and raw text", () => {
  expect(matches("info:toothbrush", brush)).toBe(true)
  expect(matches("info:oralb", brush)).toBe(true)
  expect(matches("info:\"brush heads\"", brush)).toBe(true)
  expect(matches("info:blender", brush)).toBe(false)
  expect(matches("info:rent", row({ description: "Sam Lee", message: "Rent for October" }))).toBe(true)
  expect(matches("info:marketplace", row({ rawText: "AMAZON AU MARKETPLACE, SYDNEY" }))).toBe(true)

  expect(matches("info:amazon", row())).toBe(false)
  expect(matches("info:gift", row({ notes: "gift" }))).toBe(false)
  expect(matches("info:anything", row({ bought: [], message: null, rawText: null }))).toBe(false)
})

test("bare words in rules and desc: stay description-only", () => {
  expect(matches("toothbrush", brush)).toBe(false)
  expect(matches("desc:toothbrush", brush)).toBe(false)
  expect(matches("amazon info:toothbrush", brush)).toBe(true)
  expect(matches("info:toothbrush OR info:blender", brush)).toBe(true)
  expect(matches("NOT info:toothbrush", brush)).toBe(false)
  expect(parseFilterStrict("info:toothbrush").error).toBeUndefined()
  expect(canonicalFilter('info:"brush heads"').text).toBe('info:"brush heads"')

  expect(searched("toothbrush", brush)).toBe(true)
  expect(searched("rent", row({ description: "Sam Lee", message: "Rent for October" }))).toBe(true)
  expect(searched("gift", row({ notes: "Gift for Sam" }))).toBe(true)
  expect(searched("marketplace", row({ rawText: "AMAZON AU MARKETPLACE, SYDNEY" }))).toBe(false)
  expect(searched("toothbrush amt:<0", brush)).toBe(false)
  expect(searched("amazon amt:<0", brush)).toBe(true)
})

const searched = (input: string, t: FilterTxn) => evalFilter(reparseFilterInput(input).expr, t)
