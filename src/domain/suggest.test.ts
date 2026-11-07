import { expect, test } from "bun:test"
import type { JevQuestion } from "../ai/jev"
import { category, transaction } from "../testing/fixtures"
import { historySuggestions, jevSuggestions } from "./suggest"

const categories = [category({ id: 1 }), category({ id: 2 }), category({ id: 3, isDefault: true, name: "Uncategorised" })]
const evidence = (id: number, categoryId: number, amount = -10, dateISO = "2026-01-01") => transaction({ id, categoryId, categoryName: `Category ${categoryId}`, description: " SHOP ", amount, dateISO })
const target = (id = 10) => transaction({ id, description: "shop" })

test("history settles a merchant only with three or more earlier rows nearly all in one category; small samples are less sure", () => {
  const three = [evidence(1, 1), evidence(2, 1), evidence(3, 1)]
  expect(historySuggestions([target(), ...three], categories)).toEqual([{ transactionId: 10, categoryId: 1, confidence: 3 / 4, source: "history", ranked: [{ categoryId: 1, confidence: 3 / 4 }] }])
  expect(historySuggestions([target(), ...three.slice(0, 2)], categories)).toEqual([])
  // 3 of 4 is not nearly all: Clef decides, with the history as context.
  expect(historySuggestions([target(), ...three, evidence(4, 2)], categories)).toEqual([])
  const ten = Array.from({ length: 10 }, (_, i) => evidence(i + 20, 1))
  expect(historySuggestions([target(), ...ten], categories)[0]?.confidence).toBe(10 / 11)
})

test("history excludes groups and uncategorised evidence and limits eligible targets", () => {
  const tree = [...categories, category({ id: 4, parentId: 1 })]
  expect(historySuggestions([target(), evidence(1, 1), evidence(2, 3), evidence(3, 999), evidence(4, 1), evidence(5, 3)], tree)).toEqual([])
  const rows = [target(), target(11), evidence(1, 2), evidence(2, 2), evidence(3, 2), transaction({ id: 12, description: "shop", excluded: true }), transaction({ id: 13, description: "shop", tagNames: ["ignore"] })]
  expect(historySuggestions(rows, tree).map((s) => s.transactionId)).toEqual([10, 11])
  expect(historySuggestions(rows, tree, new Set([11])).map((s) => s.transactionId)).toEqual([11])
  expect(historySuggestions(rows, tree, new Set())).toEqual([])
  expect(historySuggestions([transaction({ description: "unknown" })], tree)).toEqual([])
})

test("unknown and group picks are dropped; a failed request reports its rows; no categories, no request", async () => {
  const tree = [...categories, category({ id: 4, parentId: 1 })]
  const errors: Array<[number[], unknown]> = []
  const pick = (choice: string) => ({ async judge(qs: Record<string, JevQuestion>) { return Object.fromEntries(Object.keys(qs).map((id) => [id, { type: "choice" as const, choice, confidence: 1, probabilities: { [choice]: 1 } }])) } })
  expect(await jevSuggestions(pick("c999"), [target()], tree)).toEqual([])
  expect(await jevSuggestions(pick("c1"), [target()], tree)).toEqual([])
  expect(await jevSuggestions(pick("c4"), [target()], tree)).toHaveLength(1)
  const failure = new Error("fake failure")
  expect(await jevSuggestions({ judge: async () => { throw failure } }, [target(), target(11)], tree, { onError: (ids, e) => errors.push([ids, e]) })).toEqual([])
  expect(errors).toEqual([[[10, 11], failure]])
  expect(await jevSuggestions({ judge: async () => { throw new Error("must not call") } }, [target()], [])).toEqual([])
})
