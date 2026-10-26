import { expect, test } from "bun:test"
import type { WorkersAiClient } from "../ai/workersAi"
import { category, transaction } from "../testing/fixtures"
import { clefQuestion, clefState, clefSuggestions, historySuggestions } from "./suggest"

const categories = [category({ id: 1 }), category({ id: 2 }), category({ id: 3, isDefault: true, name: "Uncategorised" })]
const evidence = (id: number, categoryId: number, amount = -10, dateISO = "2026-01-01") => transaction({ id, categoryId, categoryName: `Category ${categoryId}`, description: " SHOP ", amount, dateISO })
const target = (id = 10) => transaction({ id, description: "shop" })

test("history prefers the same sign and falls back to either sign", () => {
  const rows = [target(), evidence(1, 1), evidence(2, 2, 10), evidence(3, 2, 10)]
  expect(historySuggestions(rows, categories)).toEqual([{ transactionId: 10, categoryId: 1, confidence: 1, source: "history" }])
  expect(historySuggestions([target(), ...rows.slice(2)], categories)[0]?.categoryId).toBe(2)
})

test("history chooses the most common category and its confidence share", () => {
  expect(historySuggestions([target(), evidence(1, 1), evidence(2, 1), evidence(3, 2, -10, "2026-10-01")], categories))
    .toEqual([{ transactionId: 10, categoryId: 1, confidence: 2 / 3, source: "history" }])
})

test("history breaks ties by the newest row, then id on the same date", () => {
  expect(historySuggestions([target(), evidence(9, 1), evidence(2, 2, -10, "2026-02-01")], categories)[0]?.categoryId).toBe(2)
  expect(historySuggestions([target(), evidence(9, 1), evidence(2, 2)], categories)[0]?.categoryId).toBe(1)
})

test("history excludes groups and uncategorised evidence and limits eligible targets", () => {
  const tree = [...categories, category({ id: 4, parentId: 1 })]
  expect(historySuggestions([target(), evidence(1, 1), evidence(2, 3), evidence(3, 999)], tree)).toEqual([])
  const rows = [target(), target(11), evidence(1, 2), transaction({ id: 12, description: "shop", excluded: true }), transaction({ id: 13, description: "shop", tagNames: ["ignore"] })]
  expect(historySuggestions(rows, tree).map((s) => s.transactionId)).toEqual([10, 11])
  expect(historySuggestions(rows, tree, new Set([11])).map((s) => s.transactionId)).toEqual([11])
  expect(historySuggestions(rows, tree, new Set())).toEqual([])
  expect(historySuggestions([transaction({ description: "unknown" })], tree)).toEqual([])
})

test("Clef question uses assignable keys, category paths and money notes", () => {
  expect(clefQuestion([
    category({ id: 1, name: "Good Life" }), category({ id: 18, parentId: 1, name: "Holidays & Travel" }),
    category({ id: 2, name: "Income", income: true }), category({ id: 19, parentId: 2, name: "Salary" }),
    category({ id: 20, name: "Transfers", notSpending: true }), category({ id: 21, name: "Bonus", income: true }),
    category({ id: 3, name: "Uncategorised", isDefault: true }),
  ])).toEqual({ type: "choice", instructions: "Which category does this bank transaction belong in?", criteria: {
    c18: "Good Life › Holidays & Travel", c19: "Income › Salary (income)", c20: "Transfers (not spending: moving your own money)", c21: "Bonus (income)",
  } })
})

test("Clef state supplies signed money, type, date and account", () => {
  expect(clefState(transaction({ description: "SAM PARKER", amount: 882, transactionType: "Osko Payment Received", dateISO: "2026-02-03", accountName: "Spending" })))
    .toBe("Description: SAM PARKER\nAmount: +$882.00 (money in)\nType: Osko Payment Received\nDate: 2026-02-03\nAccount: Spending")
  expect(clefState(transaction({ amount: -12.5 }))).toBe("Description: x\nAmount: -$12.50 (money out)\nDate: 2026-10-05\nAccount: A")
})

test.each([1, 2, undefined])("Clef caps concurrency (%s), streams results, continues after failures and drops unknown keys", async (concurrency) => {
  let active = 0, peak = 0
  const errors: Array<[number, unknown]> = []
  const arrived: number[] = []
  const failure = new Error("fake failure")
  const ai: Pick<WorkersAiClient, "clef"> = {
    async clef(questions, state, model) {
      expect(questions).toEqual({ category: clefQuestion(categories) })
      expect(model).toBe("clef")
      const id = Number(state.split("\n")[0]!.slice("Description: ".length))
      active++
      peak = Math.max(peak, active)
      await Bun.sleep(2)
      active--
      if (id === 2) throw failure
      return { category: { type: "choice", choice: id === 3 ? "c999" : id === 4 ? "c3" : "c1", confidence: 0.8, probabilities: {} } }
    },
  }
  const results = await clefSuggestions(ai, Array.from({ length: 8 }, (_, id) => transaction({ id, description: String(id) })), categories, {
    concurrency, onSuggestion: (s) => arrived.push(s.transactionId), onError: (id, error) => errors.push([id, error]),
  })
  expect(peak).toBe(concurrency ?? 4)
  expect(errors).toEqual([[2, failure]])
  expect(results.map((s) => s.transactionId).sort()).toEqual([0, 1, 5, 6, 7])
  expect(arrived).toEqual(results.map((s) => s.transactionId))
  expect(results.every((s) => s.categoryId === 1 && s.confidence === 0.8 && s.source === "clef")).toBe(true)
})

test("Clef skips an empty category list and rejects invalid concurrency", async () => {
  const ai: Pick<WorkersAiClient, "clef"> = { clef: async () => { throw new Error("must not call") } }
  expect(await clefSuggestions(ai, [target()], [])).toEqual([])
  await expect(clefSuggestions(ai, [target()], categories, { concurrency: 0 })).rejects.toThrow("concurrency must be a positive integer")
})


test("Clef drops a group key even when it names an existing category", async () => {
  const ai: Pick<WorkersAiClient, "clef"> = { clef: async () => ({ category: { type: "choice", choice: "c1", probabilities: {}, confidence: 1 } }) }
  expect(await clefSuggestions(ai, [target()], [...categories, category({ id: 4, parentId: 1 })])).toEqual([])
})
