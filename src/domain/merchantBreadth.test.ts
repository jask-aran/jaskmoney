import { expect, test } from "bun:test"
import type { JevClient, JevQuestion } from "../ai/jev"
import { category, transaction } from "../testing/fixtures"
import { MIXED_AT, MIXED_UNSURE_AT, NO_DETAIL_CAP, UNSURE_CAP } from "./questions"
import { askMerchantBreadth, capSuggestion, categoryExamples, historySuggestions, jevSuggestions, merchantBreadth, suggestionCap, unaskedMerchants } from "./suggest"

const categories = [category({ id: 1 }), category({ id: 2 }), category({ id: 3, isDefault: true, name: "Uncategorised" })]
const done = (id: number, description: string, categoryId: number) => transaction({ id, description, categoryId, categoryName: `Category ${categoryId}` })

test("a merchant is mixed when Jev says it sells unrelated goods or your own rows sit in different categories; unsure in between", () => {
  const asked = new Map([["ebay", MIXED_AT], ["officeworks", MIXED_UNSURE_AT], ["coles", MIXED_UNSURE_AT - 0.01]])
  const rows = [done(1, "Bakery", 1), done(2, "Bakery", 2), ...[3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((id) => done(id, "Coles", 1))]
  const breadth = merchantBreadth(rows, categories, asked)
  expect(breadth(" eBay ")).toBe("mixed")
  expect(breadth("Officeworks")).toBe("unsure")
  expect(breadth("Coles")).toBe("single")
  // Split 1–1: the name doesn't settle it, whatever Jev thinks.
  expect(breadth("Bakery")).toBe("mixed")
  // Nearly all in one (10 of 11) is still one merchant's habit.
  expect(merchantBreadth([...rows, done(13, "Coles", 2)], categories, asked)("Coles")).toBe("single")
  expect(breadth("Never asked")).toBe("single")
})

test("a mixed merchant's suggestion is a guess, an unsure one's stays below accept-all; a message lifts the cap", () => {
  const breadth = merchantBreadth([], categories, new Map([["ebay", 0.95], ["officeworks", 0.5]]))
  expect(suggestionCap(transaction({ description: "eBay" }), breadth)).toBe(NO_DETAIL_CAP)
  expect(suggestionCap(transaction({ description: "Officeworks" }), breadth)).toBe(UNSURE_CAP)
  expect(suggestionCap(transaction({ description: "Corner Bar" }), breadth)).toBe(1)
  expect(suggestionCap(transaction({ description: "eBay", message: "phone case" }), breadth)).toBe(1)
  expect(suggestionCap(transaction({ description: "Sam", transactionType: "Payment" }), breadth)).toBe(NO_DETAIL_CAP)
  const sure = { transactionId: 1, categoryId: 1, confidence: 1, source: "jev" as const, ranked: [{ categoryId: 1, confidence: 1 }, { categoryId: 2, confidence: 0.2 }] }
  expect(capSuggestion(sure, NO_DETAIL_CAP)).toEqual({ ...sure, confidence: NO_DETAIL_CAP, ranked: [{ categoryId: 1, confidence: NO_DETAIL_CAP }, { categoryId: 2, confidence: 0.2 }] })
  expect(capSuggestion(sure, 1)).toBe(sure)
})

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

test("each merchant name is asked about once: card spending only, not people, refunds or names already asked", async () => {
  const rows = [transaction({ id: 1, description: "eBay", rawText: "eBay O*04-1,INTERNET" }), transaction({ id: 2, description: " EBAY " }), transaction({ id: 3, description: "Sam", transactionType: "Payment" }),
    transaction({ id: 4, description: "Refunder", amount: 5 }), transaction({ id: 5, description: "Coles" })]
  const unasked = unaskedMerchants(rows, new Map([["coles", 0.2]]))
  expect(unasked.map((t) => t.id)).toEqual([1])
  const questions: JevQuestion[] = []
  const got = new Map<string, number>()
  await askMerchantBreadth({ async judge(qs) {
    questions.push(...Object.values(qs))
    return Object.fromEntries(Object.keys(qs).map((id) => [id, { type: "noul", noul: 0.9 }]))
  } }, unasked, { onAnswers: (answers) => answers.forEach((p, k) => got.set(k, p)) })
  expect(got).toEqual(new Map([["ebay", 0.9]]))
  expect(questions[0]!.instructions).toMatchObject({ merchant: { name: "eBay", bank_text: "eBay O*04-1,INTERNET" } })
})
