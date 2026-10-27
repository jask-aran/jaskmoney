import { expect, test } from "bun:test"
import type { JevQuestion } from "../ai/jev"
import { category, transaction } from "../testing/fixtures"
import { historySuggestions, jevSuggestions } from "./suggest"
import { SUGGESTION_STATE, suggestionCriteria, transactionFacts } from "./questions"

const categories = [category({ id: 1 }), category({ id: 2 }), category({ id: 3, isDefault: true, name: "Uncategorised" })]
const evidence = (id: number, categoryId: number, amount = -10, dateISO = "2026-01-01") => transaction({ id, categoryId, categoryName: `Category ${categoryId}`, description: " SHOP ", amount, dateISO })
const target = (id = 10) => transaction({ id, description: "shop" })

test("history settles a merchant only with three or more earlier rows nearly all in one category; small samples are less sure", () => {
  const three = [evidence(1, 1), evidence(2, 1), evidence(3, 1)]
  expect(historySuggestions([target(), ...three], categories)).toEqual([{ transactionId: 10, categoryId: 1, confidence: 3 / 4, source: "history" }])
  expect(historySuggestions([target(), ...three.slice(0, 2)], categories)).toEqual([])
  // 3 of 4 is not nearly all: Clef decides, with the history as context.
  expect(historySuggestions([target(), ...three, evidence(4, 2)], categories)).toEqual([])
  const ten = Array.from({ length: 10 }, (_, i) => evidence(i + 20, 1))
  expect(historySuggestions([target(), ...ten], categories)[0]?.confidence).toBe(10 / 11)
})

test("history prefers the same sign and falls back to either sign", () => {
  const out = [evidence(1, 1), evidence(2, 1), evidence(3, 1)], into = [evidence(4, 2, 10), evidence(5, 2, 10), evidence(6, 2, 10)]
  expect(historySuggestions([target(), ...out, ...into], categories)[0]?.categoryId).toBe(1)
  expect(historySuggestions([target(), ...into], categories)[0]?.categoryId).toBe(2)
})

test("history leaves person-to-person payments and rows with a message to Clef", () => {
  const three = [evidence(1, 1), evidence(2, 1), evidence(3, 1)]
  expect(historySuggestions([transaction({ id: 10, description: "shop", transactionType: "Payment" }), ...three], categories)).toEqual([])
  expect(historySuggestions([transaction({ id: 10, description: "shop", transactionType: "EFTPOS Withdrawal" }), ...three], categories)).toEqual([])
  expect(historySuggestions([transaction({ id: 10, description: "shop", message: "Kestrel ram" }), ...three], categories)).toEqual([])
  expect(historySuggestions([transaction({ id: 10, description: "shop", transactionType: "Purchase" }), ...three], categories)).toHaveLength(1)
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

test("criteria: one per suggestable category, by path, with income and not-spending noted", () => {
  const tree = [
    category({ id: 1, name: "Good Life" }), category({ id: 18, parentId: 1, name: "Holidays & Travel" }),
    category({ id: 2, name: "Income", income: true }), category({ id: 19, parentId: 2, name: "Salary" }),
    category({ id: 20, name: "Transfers", notSpending: true }), category({ id: 21, name: "Bonus", income: true }),
  ]
  expect(suggestionCriteria(tree.filter((c) => [18, 19, 20, 21].includes(c.id)), tree)).toEqual({
    c18: "Good Life › Holidays & Travel", c19: "Income › Salary (income)", c20: "Transfers (not spending: moving your own money)", c21: "Bonus (income)",
  })
})

test("Jev sees the transaction as named facts: signed money, direction, type, message, the bank's own text when it differs, earlier categories", () => {
  expect(transactionFacts(transaction({ description: "Corner Bar", amount: -120, transactionType: "Payment", message: "Kestrel ram" })))
    .toEqual({ description: "Corner Bar", amount: "-$120.00", direction: "money out", bank_type: "Payment", message: "Kestrel ram" })
  expect(transactionFacts(transaction({ description: "$friend_a", amount: 23, rawText: "Deniz Turkyilmaz" }), { earlier: "Holidays & Travel ×2" }))
    .toEqual({ description: "$friend_a", amount: "+$23.00", direction: "money in", bank_text: "Deniz Turkyilmaz", categorised_before: "Holidays & Travel ×2" })
  expect(transactionFacts(transaction({ description: "Beem", rawText: "Beem" }))).not.toHaveProperty("bank_text")
  // The category only where asked, and only a real one.
  expect(transactionFacts(transaction({ categoryId: 4, categoryName: "Groceries" }), { category: true })).toHaveProperty("category", "Groceries")
  expect(transactionFacts(transaction({ categoryId: 4, categoryName: "Groceries" }))).not.toHaveProperty("category")
  expect(transactionFacts(transaction({ categoryName: "Uncategorised" }), { category: true })).not.toHaveProperty("category")
})

test("each row is its own question with the transaction inline; Jev is told how rows with the same description were categorised", async () => {
  const seen: Record<string, JevQuestion>[] = []
  const jev = { async judge(qs: Record<string, JevQuestion>, state: unknown) {
    expect(state).toBe(SUGGESTION_STATE)
    seen.push(qs)
    return Object.fromEntries(Object.keys(qs).map((id) => [id, { type: "choice" as const, choice: "c1", confidence: 0.5, probabilities: { c1: 0.7, c2: 0.3 } }]))
  } }
  const results = await jevSuggestions(jev, [target(), target(11)], categories, { history: [evidence(1, 1), evidence(2, 2), evidence(3, 1)] })
  expect(seen).toHaveLength(1)
  const q = Object.values(seen[0]!)[0]!
  expect(q).toMatchObject({ type: "choice", criteria: { c1: "Category 1", c2: "Category 2" } })
  expect((q.instructions as { transaction: Record<string, string> }).transaction.categorised_before).toBe("Category 1 ×2, Category 2 ×1")
  // Confidence is Jev's probability for its pick, not its distribution's peakedness.
  expect(results).toEqual([{ transactionId: 10, categoryId: 1, confidence: 0.7, source: "jev" }, { transactionId: 11, categoryId: 1, confidence: 0.7, source: "jev" }])
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
