import { expect, test } from "bun:test"
import type { JevClient, JevQuestion } from "../ai/jev"
import { category, transaction } from "../testing/fixtures"
import { NO_DETAIL_CAP } from "./questions"
import { categoryExamples, historySuggestions, jevSuggestions, merchantBreadth } from "./suggest"

const categories = [category({ id: 1 }), category({ id: 2 }), category({ id: 3, isDefault: true, name: "Uncategorised" })]
const done = (id: number, description: string, categoryId: number) => transaction({ id, description, categoryId, categoryName: `Category ${categoryId}` })

test("a mixed merchant teaches nothing: history doesn't settle its rows, it isn't an example, and Jev isn't told how it went before", async () => {
  const breadth = merchantBreadth([], categories, new Map([["ebay", 0.95]]))
  const earlier = [done(1, "eBay", 1), done(2, "eBay", 1), done(3, "eBay", 1), done(4, "Corner Bar", 1)]
  const waiting = transaction({ id: 10, description: "eBay" })
  expect(historySuggestions([waiting, ...earlier], categories)).toHaveLength(1)
  expect(historySuggestions([waiting, ...earlier], categories, undefined, breadth)).toEqual([])
  expect(categoryExamples(earlier, categories, breadth).get(1)).toEqual(["Corner Bar"])
  const seen: JevQuestion[] = []
  const jev: Pick<JevClient, "judge"> = { async judge(questions) {
    seen.push(...Object.values(questions))
    return Object.fromEntries(Object.keys(questions).map((id) => [id, { type: "choice", choice: "c1", confidence: 0.9, probabilities: { c1: 0.99 } }]))
  } }
  const [suggestion] = await jevSuggestions(jev, [waiting], categories, { history: earlier, breadth })
  expect(suggestion?.confidence).toBe(NO_DETAIL_CAP)
  expect((seen[0]!.instructions as { transaction: Record<string, string> }).transaction.categorised_before).toBeUndefined()
})
